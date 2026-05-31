const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocket, WebSocketServer } = require("ws");
const {
  compareEvaluations,
  createDeck,
  evaluateSeven,
  shuffle
} = require("./src/poker");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const STARTING_CHIPS = 2000;
const MAX_PLAYERS = 2;
const MIN_BET = 20;

const rooms = new Map();
const sockets = new Map();

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  const client = {
    id: crypto.randomUUID(),
    socket,
    roomCode: null,
    playerId: null
  };
  sockets.set(socket, client);

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "notice", level: "error", text: "消息格式错误。" });
      return;
    }

    try {
      handleMessage(client, message);
    } catch (error) {
      send(socket, { type: "notice", level: "error", text: error.message });
    }
  });

  socket.on("close", () => {
    const activeClient = sockets.get(socket);
    sockets.delete(socket);
    if (!activeClient?.roomCode || !activeClient?.playerId) return;
    const room = rooms.get(activeClient.roomCode);
    if (!room) return;
    const player = room.players.find((item) => item.id === activeClient.playerId);
    if (player) {
      player.connected = false;
      player.socket = null;
    }
    if (cleanupRoomAfterDisconnect(room)) return;
    broadcast(room);
  });

  send(socket, { type: "hello", clientId: client.id });
});

function handleMessage(client, message) {
  switch (message.type) {
    case "join":
      joinRoom(client, message);
      break;
    case "start":
      startGame(client);
      break;
    case "action":
      playerAction(client, message);
      break;
    case "nextHand":
      nextHand(client);
      break;
    case "restart":
      restartGame(client);
      break;
    default:
      throw new Error("未知操作。");
  }
}

function joinRoom(client, message) {
  const name = String(message.name || "").trim().slice(0, 18);
  const roomCode = String(message.roomCode || "").trim();

  if (!name) throw new Error("请输入玩家名字。");
  if (!/^\d{4}$/.test(roomCode)) throw new Error("房间密码必须是四位数字。");

  let room = rooms.get(roomCode);
  if (!room) {
    room = createRoom(roomCode);
    rooms.set(roomCode, room);
  } else if (!room.players.some((player) => player.connected)) {
    rooms.delete(roomCode);
    room = createRoom(roomCode);
    rooms.set(roomCode, room);
  } else {
    pruneDisconnectedLobbySeats(room);
  }

  if (room.players.length >= MAX_PLAYERS) throw new Error("这个房间已经满员。");
  if (room.stage !== "lobby") throw new Error("这局已经开始，请换一个房间密码。");

  const player = {
    id: crypto.randomUUID(),
    name,
    seat: room.players.length,
    connected: true,
    socket: client.socket,
    chips: STARTING_CHIPS
  };

  room.players.push(player);
  room.ownerId ||= player.id;
  client.roomCode = roomCode;
  client.playerId = player.id;

  broadcast(room);
}

function startGame(client) {
  const room = requireRoom(client);
  requireOwner(room, client.playerId);
  if (room.players.length !== MAX_PLAYERS) throw new Error("需要两名玩家都进入房间后才能开始。");

  room.stage = "playing";
  room.players.forEach((player) => {
    player.chips = STARTING_CHIPS;
  });
  room.game = {
    handNumber: 0,
    dealerSeat: 1,
    deck: [],
    community: [],
    street: "waiting",
    pot: 0,
    currentBet: 0,
    minRaise: MIN_BET,
    actionSeat: null,
    players: [],
    history: [],
    result: null,
    gameOver: false
  };

  beginHand(room);
}

function restartGame(client) {
  const room = requireRoom(client);
  requireOwner(room, client.playerId);
  if (room.stage !== "playing") throw new Error("游戏尚未开始。");
  room.players.forEach((player) => {
    player.chips = STARTING_CHIPS;
  });
  room.game.dealerSeat = 1;
  room.game.handNumber = 0;
  room.game.gameOver = false;
  beginHand(room);
}

function nextHand(client) {
  const room = requireRoom(client);
  requireOwner(room, client.playerId);
  const game = requireGame(room);
  if (game.street !== "handOver") throw new Error("当前手牌还没有结束。");
  if (game.gameOver) throw new Error("有玩家筹码归零，请重新开始整场。");
  beginHand(room);
}

function beginHand(room) {
  const game = requireGame(room);
  game.handNumber += 1;
  game.dealerSeat = otherSeat(game.dealerSeat);
  game.deck = shuffle(createDeck());
  game.community = [];
  game.street = "preflop";
  game.pot = 0;
  game.currentBet = 0;
  game.minRaise = MIN_BET;
  game.result = null;
  game.history = [`第 ${game.handNumber} 手牌开始，${seatName(room, game.dealerSeat)} 是庄家。`];

  game.players = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    chips: player.chips,
    holeCards: [draw(game), draw(game)],
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    evaluation: null
  }));

  game.actionSeat = nextActionSeat(game, otherSeat(game.dealerSeat));
  broadcast(room);
}

function playerAction(client, message) {
  const room = requireRoom(client);
  const game = requireGame(room);
  const player = game.players.find((item) => item.id === client.playerId);
  if (!player) throw new Error("你不在当前牌局中。");
  if (game.street === "handOver") throw new Error("当前手牌已经结束。");
  if (game.actionSeat !== player.seat) throw new Error("还没有轮到你行动。");
  if (player.folded || player.allIn) throw new Error("你当前不能行动。");

  const action = String(message.action || "");
  const toCall = Math.max(0, game.currentBet - player.bet);

  if (action === "fold") {
    player.folded = true;
    player.hasActed = true;
    game.history.push(`${player.name} 弃牌。`);
    finishByFold(room);
    return;
  }

  if (action === "check") {
    if (toCall > 0) throw new Error("面对下注时不能过牌。");
    player.hasActed = true;
    game.history.push(`${player.name} 过牌。`);
    afterAction(room);
    return;
  }

  if (action === "call") {
    if (toCall <= 0) throw new Error("当前没有需要跟注的金额。");
    const committed = Math.min(toCall, player.chips);
    commitChips(game, player, committed);
    player.hasActed = true;
    game.history.push(`${player.name} 跟注 ${committed}${player.allIn ? "，全下" : ""}。`);
    afterAction(room);
    return;
  }

  if (action === "bet") {
    let amount = Number.parseInt(message.amount, 10);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("请输入有效筹码数量。");
    amount = Math.min(amount, player.chips);
    const isAllIn = amount === player.chips;

    if (toCall === 0) {
      if (amount < MIN_BET && !isAllIn) throw new Error(`最小下注为 ${MIN_BET}。`);
      commitChips(game, player, amount);
      game.currentBet = player.bet;
      game.minRaise = Math.max(MIN_BET, amount);
      markAggression(game, player);
      game.history.push(`${player.name} 下注 ${amount}${player.allIn ? "，全下" : ""}。`);
      afterAction(room);
      return;
    }

    if (amount < toCall && !isAllIn) throw new Error(`至少需要跟注 ${toCall}。`);
    const previousBet = game.currentBet;
    commitChips(game, player, amount);

    if (player.bet > previousBet) {
      const raiseSize = player.bet - previousBet;
      if (raiseSize < game.minRaise && !player.allIn) {
        rollbackCommit(game, player, amount);
        throw new Error(`最小加注额为 ${game.minRaise}。`);
      }

      game.currentBet = player.bet;
      if (raiseSize >= game.minRaise) game.minRaise = raiseSize;
      markAggression(game, player);
      game.history.push(`${player.name} 加注到 ${player.bet}${player.allIn ? "，全下" : ""}。`);
    } else {
      player.hasActed = true;
      game.history.push(`${player.name} 跟注 ${amount}${player.allIn ? "，全下" : ""}。`);
    }

    afterAction(room);
    return;
  }

  throw new Error("未知行动。");
}

function commitChips(game, player, amount) {
  const committed = Math.max(0, Math.min(amount, player.chips));
  player.chips -= committed;
  player.bet += committed;
  player.totalBet += committed;
  game.pot += committed;
  if (player.chips === 0) player.allIn = true;
}

function rollbackCommit(game, player, amount) {
  const rollback = Math.min(amount, player.bet, player.totalBet);
  player.chips += rollback;
  player.bet -= rollback;
  player.totalBet -= rollback;
  game.pot -= rollback;
  player.allIn = player.chips === 0;
}

function markAggression(game, aggressor) {
  game.players.forEach((player) => {
    player.hasActed = false;
  });
  aggressor.hasActed = true;
}

function afterAction(room) {
  const game = requireGame(room);

  if (activePlayers(game).every((player) => player.allIn)) {
    runOutBoard(game);
    finishByShowdown(room);
    return;
  }

  if (isBettingRoundClosed(game)) {
    if (shouldRunToShowdown(game)) {
      runOutBoard(game);
      finishByShowdown(room);
      return;
    }

    advanceStreet(room);
    return;
  }

  game.actionSeat = nextActionSeat(game, otherSeat(game.actionSeat));
  broadcast(room);
}

function advanceStreet(room) {
  const game = requireGame(room);
  game.players.forEach((player) => {
    player.bet = 0;
    player.hasActed = false;
  });
  game.currentBet = 0;
  game.minRaise = MIN_BET;

  if (game.street === "preflop") {
    game.community.push(draw(game), draw(game), draw(game));
    game.street = "flop";
    game.history.push(`翻牌：${cardsText(game.community.slice(0, 3))}`);
  } else if (game.street === "flop") {
    game.community.push(draw(game));
    game.street = "turn";
    game.history.push(`转牌：${cardText(game.community[3])}`);
  } else if (game.street === "turn") {
    game.community.push(draw(game));
    game.street = "river";
    game.history.push(`河牌：${cardText(game.community[4])}`);
  } else {
    finishByShowdown(room);
    return;
  }

  const nextSeat = nextActionSeat(game, otherSeat(game.dealerSeat));
  if (nextSeat === null) {
    runOutBoard(game);
    finishByShowdown(room);
    return;
  }

  game.actionSeat = nextSeat;
  broadcast(room);
}

function runOutBoard(game) {
  while (game.community.length < 5) {
    game.community.push(draw(game));
  }
}

function finishByFold(room) {
  const game = requireGame(room);
  const winner = activePlayers(game)[0];
  const amount = game.pot;
  winner.chips += amount;
  game.pot = 0;
  game.street = "handOver";
  game.actionSeat = null;
  game.result = {
    type: "fold",
    winners: [{ seat: winner.seat, name: winner.name, amount }],
    text: `${winner.name} 赢得 ${amount} 筹码。`
  };
  game.history.push(game.result.text);
  syncRoomChips(room);
  updateGameOver(game);
  attachGameOverSummary(game);
  broadcast(room);
}

function finishByShowdown(room) {
  const game = requireGame(room);
  runOutBoard(game);
  normalizeShowdownPot(game);

  for (const player of activePlayers(game)) {
    player.evaluation = evaluateSeven([...player.holeCards, ...game.community]);
  }

  const contenders = activePlayers(game);
  const best = contenders.reduce((currentBest, player) => {
    if (!currentBest) return player;
    return compareEvaluations(player.evaluation, currentBest.evaluation) > 0 ? player : currentBest;
  }, null);
  const winners = contenders.filter((player) => compareEvaluations(player.evaluation, best.evaluation) === 0);
  const share = Math.floor(game.pot / winners.length);
  let remainder = game.pot % winners.length;
  const resultWinners = [];

  for (const winner of winners) {
    const amount = share + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    winner.chips += amount;
    resultWinners.push({ seat: winner.seat, name: winner.name, amount, hand: winner.evaluation.label });
  }

  const resultText = winners.length === 1
    ? `${winners[0].name} 以 ${winners[0].evaluation.label} 赢得 ${game.pot} 筹码。`
    : `双方 ${winners[0].evaluation.label} 平分底池 ${game.pot}。`;

  game.pot = 0;
  game.street = "handOver";
  game.actionSeat = null;
  game.result = {
    type: "showdown",
    winners: resultWinners,
    text: resultText
  };
  game.history.push(resultText);
  syncRoomChips(room);
  updateGameOver(game);
  attachGameOverSummary(game);
  broadcast(room);
}

function normalizeShowdownPot(game) {
  const contenders = activePlayers(game);
  if (contenders.length !== 2) return;
  const [a, b] = contenders;
  if (a.totalBet === b.totalBet) return;

  const bigger = a.totalBet > b.totalBet ? a : b;
  const smaller = bigger === a ? b : a;
  const refund = bigger.totalBet - smaller.totalBet;
  bigger.totalBet -= refund;
  bigger.chips += refund;
  game.pot -= refund;
  game.history.push(`${bigger.name} 未被跟注的 ${refund} 筹码退回。`);
}

function updateGameOver(game) {
  game.gameOver = game.players.some((player) => player.chips <= 0);
}

function attachGameOverSummary(game) {
  if (!game.gameOver || !game.result) return;
  const ranked = game.players.slice().sort((a, b) => b.chips - a.chips);
  const winner = ranked[0];
  const loser = ranked[ranked.length - 1];
  const text = `${winner.name} 获胜，${loser.name} 筹码归零。`;

  game.result.gameOver = {
    winner: { seat: winner.seat, name: winner.name, chips: winner.chips },
    loser: { seat: loser.seat, name: loser.name, chips: loser.chips },
    text
  };
  game.history.push(text);
}

function syncRoomChips(room) {
  const game = requireGame(room);
  for (const gamePlayer of game.players) {
    const roomPlayer = room.players.find((player) => player.id === gamePlayer.id);
    if (roomPlayer) roomPlayer.chips = gamePlayer.chips;
  }
}

function isBettingRoundClosed(game) {
  return activePlayers(game).every((player) => (
    player.allIn || (player.bet === game.currentBet && player.hasActed)
  ));
}

function shouldRunToShowdown(game) {
  const active = activePlayers(game);
  return active.length > 1
    && active.some((player) => player.allIn)
    && active.filter((player) => !player.allIn).length <= 1
    && isBettingRoundClosed(game);
}

function activePlayers(game) {
  return game.players.filter((player) => !player.folded);
}

function nextActionSeat(game, startSeat) {
  for (let offset = 0; offset < MAX_PLAYERS; offset += 1) {
    const seat = (startSeat + offset) % MAX_PLAYERS;
    const player = game.players.find((item) => item.seat === seat);
    if (player && !player.folded && !player.allIn) return seat;
  }
  return null;
}

function otherSeat(seat) {
  return seat === 0 ? 1 : 0;
}

function draw(game) {
  const card = game.deck.pop();
  if (!card) throw new Error("牌堆已空。");
  return card;
}

function publicState(room, viewerId) {
  const viewer = room.players.find((player) => player.id === viewerId);
  const game = room.game;

  return {
    type: "state",
    state: {
      roomCode: room.code,
      stage: room.stage,
      you: viewerId,
      isOwner: room.ownerId === viewerId,
      canStart: room.stage === "lobby" && room.ownerId === viewerId && room.players.length === MAX_PLAYERS,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        seat: player.seat,
        connected: player.connected,
        chips: player.chips,
        isOwner: room.ownerId === player.id
      })),
      game: game ? publicGameState(room, game, viewer) : null
    }
  };
}

function publicGameState(room, game, viewer) {
  const viewerGamePlayer = game.players.find((player) => player.id === viewer?.id);
  const toCall = viewerGamePlayer ? Math.max(0, game.currentBet - viewerGamePlayer.bet) : 0;
  const canAct = viewerGamePlayer
    && game.actionSeat === viewerGamePlayer.seat
    && !viewerGamePlayer.folded
    && !viewerGamePlayer.allIn
    && game.street !== "handOver";

  return {
    handNumber: game.handNumber,
    dealerSeat: game.dealerSeat,
    street: game.street,
    pot: game.pot,
    community: game.community,
    currentBet: game.currentBet,
    minBet: MIN_BET,
    minRaise: game.minRaise,
    actionSeat: game.actionSeat,
    toCall,
    canAct,
    gameOver: game.gameOver,
    canNextHand: room.ownerId === viewer?.id && game.street === "handOver" && !game.gameOver,
    canRestart: room.ownerId === viewer?.id && game.street === "handOver" && game.gameOver,
    result: game.result,
    history: game.history.slice(-10),
    players: game.players.map((player) => {
      const isViewer = player.id === viewer?.id;
      const showCards = isViewer || game.street === "handOver" && game.result?.type === "showdown";
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        chips: player.chips,
        bet: player.bet,
        totalBet: player.totalBet,
        folded: player.folded,
        allIn: player.allIn,
        dealer: player.seat === game.dealerSeat,
        isTurn: player.seat === game.actionSeat,
        isYou: isViewer,
        holeCards: showCards ? player.holeCards : null,
        evaluation: game.street === "handOver" && player.evaluation ? {
          name: player.evaluation.name,
          label: player.evaluation.label,
          cards: player.evaluation.cards
        } : null
      };
    })
  };
}

function broadcast(room) {
  for (const player of room.players) {
    if (player.socket?.readyState === WebSocket.OPEN) {
      send(player.socket, publicState(room, player.id));
    }
  }
}

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function requireRoom(client) {
  if (!client.roomCode) throw new Error("请先进入房间。");
  const room = rooms.get(client.roomCode);
  if (!room) throw new Error("房间不存在。");
  return room;
}

function requireGame(room) {
  if (!room.game) throw new Error("游戏尚未开始。");
  return room.game;
}

function requireOwner(room, playerId) {
  if (room.ownerId !== playerId) throw new Error("只有房主可以执行这个操作。");
}

function createRoom(roomCode) {
  return {
    code: roomCode,
    ownerId: null,
    players: [],
    stage: "lobby",
    game: null,
    createdAt: Date.now()
  };
}

function cleanupRoomAfterDisconnect(room) {
  if (!room.players.some((player) => player.connected)) {
    rooms.delete(room.code);
    return true;
  }

  pruneDisconnectedLobbySeats(room);
  return false;
}

function pruneDisconnectedLobbySeats(room) {
  if (room.stage !== "lobby") return;

  const connectedPlayers = room.players.filter((player) => player.connected);
  if (connectedPlayers.length === room.players.length) return;

  room.players = connectedPlayers.map((player, seat) => ({
    ...player,
    seat
  }));

  if (!room.players.some((player) => player.id === room.ownerId)) {
    room.ownerId = room.players[0]?.id || null;
  }
}

function seatName(room, seat) {
  return room.players.find((player) => player.seat === seat)?.name || `座位 ${seat + 1}`;
}

function cardText(card) {
  return `${card.rank}${suitSymbol(card.suit)}`;
}

function cardsText(cards) {
  return cards.map(cardText).join(" ");
}

function suitSymbol(suit) {
  return {
    spades: "♠",
    hearts: "♥",
    diamonds: "♦",
    clubs: "♣"
  }[suit] || "?";
}

server.listen(PORT, () => {
  console.log(`Short Deck table running at http://localhost:${PORT}`);
});
