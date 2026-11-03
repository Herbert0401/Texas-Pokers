const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocket, WebSocketServer } = require("ws");
const {
  evaluateSeven
} = require("./src/poker");
const { createDeckForHand } = require("./src/entertainment");
const { nextSeat, canRaise, settlePots } = require("./src/multiplayer");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const STARTING_CHIPS = 1000;
const MAX_PLAYERS = 6;
const MIN_BET = 10;
const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_MISSED_PONGS = 3;
const RECONNECT_WINDOW_MS = 10 * 60 * 1000;
const APP_VERSION = process.env.RENDER_GIT_COMMIT || "local-dev";
const ROOM_STORE_PATH = process.env.ROOM_STORE_PATH || path.join(__dirname, ".data", "rooms.json");

const rooms = new Map();
const sockets = new Map();

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

loadPersistedRooms();

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/version") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ version: APP_VERSION }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/leave") {
    readJsonBody(req, (payload) => {
      const roomCode = String(payload?.roomCode || "");
      const playerId = String(payload?.playerId || "");
      const sessionToken = String(payload?.sessionToken || "");
      if (roomCode && playerId && sessionToken) {
        leaveRoom(roomCode, playerId, sessionToken);
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }

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
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store, max-age=0"
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  socket.isAlive = true;
  socket.missedPongs = 0;
  const client = {
    id: crypto.randomUUID(),
    socket,
    roomCode: null,
    playerId: null
  };
  sockets.set(socket, client);

  socket.on("pong", () => {
    socket.isAlive = true;
    socket.missedPongs = 0;
  });

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
    markPlayerDisconnected(activeClient.roomCode, activeClient.playerId);
  });

  send(socket, { type: "hello", clientId: client.id });
});

const heartbeatInterval = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.missedPongs >= MAX_MISSED_PONGS) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.missedPongs += 1;
    try {
      socket.ping();
    } catch {
      socket.terminate();
    }
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

function handleMessage(client, message) {
  switch (message.type) {
    case "join":
      joinRoom(client, message);
      break;
    case "start":
      startGame(client);
      break;
    case "settings":
      updateRoomSettings(client, message);
      break;
    case "ping":
      send(client.socket, { type: "pong", now: Date.now() });
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
    case "leave":
      leaveRoom(client.roomCode, client.playerId, message.sessionToken);
      client.roomCode = null;
      client.playerId = null;
      break;
    default:
      throw new Error("未知操作。");
  }
}

function joinRoom(client, message) {
  if (client.roomCode) throw new Error("请先退出当前房间。");
  const name = String(message.name || "").trim().slice(0, 18);
  const roomCode = String(message.roomCode || "").trim();
  const requestedPlayerId = String(message.playerId || "");
  const requestedSessionToken = String(message.sessionToken || "");

  if (!name) throw new Error("请输入玩家名字。");
  if (!/^\d{4}$/.test(roomCode)) throw new Error("房间密码必须是四位数字。");

  let room = rooms.get(roomCode);
  if (!room) {
    room = createRoom(roomCode);
    rooms.set(roomCode, room);
  } else {
    cleanupExpiredPlayers(room);
    room = rooms.get(roomCode);
    if (!room) {
      room = createRoom(roomCode);
      rooms.set(roomCode, room);
    }
  }

  const reconnectingPlayer = room.players.find((player) => (
    player.id === requestedPlayerId && player.sessionToken === requestedSessionToken
  ));

  if (reconnectingPlayer) {
    reconnectPlayer(room, reconnectingPlayer, client);
    return;
  }

  if (room.players.length >= MAX_PLAYERS) throw new Error("这个房间已经满员。");
  const occupied = new Set(room.players.map(player => player.seat));
  if (room.game?.street !== "handOver") room.game?.players.forEach(player => occupied.add(player.seat));
  const seat = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find(i => !occupied.has(i));
  if (seat === undefined) throw new Error("本手座位暂未释放，请在本手结束后加入。");

  const player = {
    id: crypto.randomUUID(),
    name,
    seat,
    connected: true,
    socket: client.socket,
    sessionToken: crypto.randomUUID(),
    disconnectedAt: null,
    chips: STARTING_CHIPS
  };

  room.players.push(player);
  room.ownerId ||= player.id;
  client.roomCode = roomCode;
  client.playerId = player.id;

  if (room.game?.street === "handOver") updateGameOver(room);

  broadcast(room);
}

function startGame(client) {
  const room = requireRoom(client);
  requireOwner(room, client.playerId);
  if (room.stage !== "lobby") throw new Error("游戏已经开始。");
  if (room.players.filter(player => player.connected).length < 2) throw new Error("至少需要两名在线玩家才能开始。");

  room.stage = "playing";
  room.players.forEach((player) => {
    player.chips = STARTING_CHIPS;
  });
  room.game = {
    handNumber: 0,
    dealerSeat: -1,
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
    gameOver: false,
    entertainment: null
  };

  beginHand(room);
}

function restartGame(client) {
  const room = requireRoom(client);
  requireOwner(room, client.playerId);
  if (room.stage !== "playing") throw new Error("游戏尚未开始。");
  if (room.game.street !== "handOver" || !room.game.gameOver) throw new Error("整场结束后才能重新开始。");
  if (room.players.filter(player => player.connected).length < 2) throw new Error("至少需要两名在线玩家才能开始。");
  room.players.forEach((player) => {
    player.chips = STARTING_CHIPS;
  });
  room.game.dealerSeat = -1;
  room.game.handNumber = 0;
  room.game.gameOver = false;
  beginHand(room);
}

function nextHand(client) {
  const room = requireRoom(client);
  const game = requireGame(room);
  if (game.street !== "handOver") throw new Error("当前手牌还没有结束。");
  if (game.gameOver) throw new Error("可参与玩家不足两名，请等待加入或重新开始整场。");
  beginHand(room);
}

function beginHand(room) {
  const game = requireGame(room);
  const participants = room.players.filter(player => player.connected && player.chips > 0);
  if (participants.length < 2) throw new Error("至少需要两名有筹码的在线玩家。");
  const handDeck = createDeckForHand({ entertainmentMode: room.entertainmentMode, playerCount: participants.length });
  game.handNumber += 1;
  game.dealerSeat = nextSeat(participants, game.dealerSeat);
  game.deck = handDeck.deck;
  game.community = [];
  game.street = "preflop";
  game.pot = 0;
  game.currentBet = 0;
  game.minRaise = MIN_BET;
  game.result = null;
  game.gameOver = false;
  game.entertainment = handDeck.entertainment;
  game.history = [`第 ${game.handNumber} 手牌开始，${seatName(room, game.dealerSeat)} 是庄家。`];
  if (room.entertainmentMode) {
    game.history.push("娱乐模式开启：约半数手牌会出现更强听牌和河牌转折。");
  }

  game.players = participants.map((player) => ({
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
    lastActedBet: 0,
    evaluation: null
  }));

  game.actionSeat = nextActionSeat(game, game.dealerSeat);
  broadcast(room);
}

function updateRoomSettings(client, message) {
  const room = requireRoom(client);
  requireOwner(room, client.playerId);
  if (room.stage !== "lobby") throw new Error("只能在大厅中切换牌局模式。");
  room.entertainmentMode = Boolean(message.entertainmentMode);
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
    afterAction(room);
    return;
  }

  if (action === "check") {
    if (toCall > 0) throw new Error("面对下注时不能过牌。");
    player.hasActed = true;
    player.lastActedBet = game.currentBet;
    game.history.push(`${player.name} 过牌。`);
    afterAction(room);
    return;
  }

  if (action === "call") {
    if (toCall <= 0) throw new Error("当前没有需要跟注的金额。");
    const committed = Math.min(toCall, player.chips);
    commitChips(game, player, committed);
    player.hasActed = true;
    player.lastActedBet = game.currentBet;
    game.history.push(`${player.name} 跟注 ${committed}${player.allIn ? "，全下" : ""}。`);
    afterAction(room);
    return;
  }

  if (action === "bet") {
    let amount = Number(message.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("请输入有效的整数筹码数量。");
    amount = Math.min(amount, player.chips);
    const isAllIn = amount === player.chips;
    if (amount > toCall && !canRaise(game, player)) throw new Error("当前只能跟注或弃牌，不能再次加注。");

    if (toCall === 0) {
      if (amount < game.minRaise && !isAllIn) throw new Error(`最小加注额为 ${game.minRaise}。`);
      commitChips(game, player, amount);
      game.currentBet = player.bet;
      const fullRaise = amount >= game.minRaise;
      if (fullRaise) game.minRaise = amount;
      markAggression(game, player, fullRaise);
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
      const fullRaise = raiseSize >= game.minRaise;
      if (fullRaise) game.minRaise = raiseSize;
      markAggression(game, player, fullRaise);
      game.history.push(`${player.name} 加注到 ${player.bet}${player.allIn ? "，全下" : ""}。`);
    } else {
      player.hasActed = true;
      player.lastActedBet = game.currentBet;
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

function markAggression(game, aggressor, fullRaise) {
  if (fullRaise) game.players.forEach((player) => { player.hasActed = false; });
  aggressor.hasActed = true;
  aggressor.lastActedBet = game.currentBet;
}

function afterAction(room, preserveTurn = false) {
  const game = requireGame(room);
  if (activePlayers(game).length === 1) {
    finishByFold(room);
    return;
  }

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

  if (!preserveTurn || !game.players.some(player => player.seat === game.actionSeat && !player.folded && !player.allIn)) {
    game.actionSeat = nextActionSeat(game, game.actionSeat);
  }
  broadcast(room);
}

function advanceStreet(room) {
  const game = requireGame(room);
  game.players.forEach((player) => {
    player.bet = 0;
    player.hasActed = false;
    player.lastActedBet = 0;
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

  const actionSeat = nextActionSeat(game, game.dealerSeat);
  if (actionSeat === null) {
    runOutBoard(game);
    finishByShowdown(room);
    return;
  }

  game.actionSeat = actionSeat;
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
  const settlement = settlePots(game);
  const amount = settlement.winners.reduce((sum, item) => sum + item.amount, 0);
  game.pot = 0;
  game.street = "handOver";
  game.actionSeat = null;
  game.result = {
    type: "fold",
    ...settlement,
    text: `${winner.name} 赢得 ${amount} 筹码。`
  };
  game.history.push(game.result.text);
  attachEntertainmentSummary(game);
  syncRoomChips(room);
  updateGameOver(room);
  attachGameOverSummary(game);
  broadcast(room);
}

function finishByShowdown(room) {
  const game = requireGame(room);
  runOutBoard(game);

  for (const player of activePlayers(game)) {
    player.evaluation = evaluateSeven([...player.holeCards, ...game.community]);
  }

  const settlement = settlePots(game);
  const resultText = settlement.winners.map(winner => `${winner.name} 以 ${winner.hand} 赢得 ${winner.amount} 筹码`).join("；") + "。";

  game.pot = 0;
  game.street = "handOver";
  game.actionSeat = null;
  game.result = {
    type: "showdown",
    ...settlement,
    text: resultText
  };
  game.history.push(resultText);
  attachEntertainmentSummary(game);
  syncRoomChips(room);
  updateGameOver(room);
  attachGameOverSummary(game);
  broadcast(room);
}

function updateGameOver(room) {
  room.game.gameOver = room.players.filter(player => player.chips > 0).length < 2;
  if (!room.game.gameOver && room.game.result) delete room.game.result.gameOver;
}

function attachGameOverSummary(game) {
  if (!game.result) return;
  game.result.eliminated = game.players.filter(player => player.chips === 0).map(player => player.name);
  if (!game.gameOver) return;
  const ranked = game.players.slice().sort((a, b) => b.chips - a.chips);
  const winner = ranked[0];
  const loser = ranked[ranked.length - 1];
  const text = loser.chips === 0 ? `${winner.name} 获胜，其余可参与玩家筹码归零。` : "可参与玩家不足两名，等待新玩家或重新开始。";

  game.result.gameOver = {
    winner: { seat: winner.seat, name: winner.name, chips: winner.chips },
    loser: { seat: loser.seat, name: loser.name, chips: loser.chips },
    text
  };
  game.history.push(text);
}

function attachEntertainmentSummary(game) {
  if (!game.entertainment?.dramatic || !game.result) return;

  const text = game.result.type === "showdown"
    ? `娱乐模式：${game.entertainment.label}。`
    : `娱乐模式：本手原本准备了${game.entertainment.label}，但弃牌提前结束。`;

  game.result.entertainment = {
    dramatic: true,
    label: game.entertainment.label,
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

function nextActionSeat(game, afterSeat) {
  return nextSeat(game.players, afterSeat, player => !player.folded && !player.allIn
    && (!player.hasActed || player.bet < game.currentBet));
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
      startingChips: STARTING_CHIPS,
      maxPlayers: MAX_PLAYERS,
      entertainmentMode: Boolean(room.entertainmentMode),
      you: viewerId,
      isOwner: room.ownerId === viewerId,
      canStart: room.stage === "lobby" && room.ownerId === viewerId && room.players.filter(player => player.connected).length >= 2,
      sessionToken: viewer?.sessionToken || null,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        seat: player.seat,
        connected: player.connected,
        chips: player.chips,
        waiting: Boolean(game && !game.players.some(item => item.id === player.id)),
        isOwner: room.ownerId === player.id
      })),
      game: game ? publicGameState(room, game, viewer) : null
    }
  };
}

function publicGameState(room, game, viewer) {
  const viewerGamePlayer = game.players.find((player) => player.id === viewer?.id);
  const toCall = viewerGamePlayer ? Math.max(0, game.currentBet - viewerGamePlayer.bet) : 0;
  const canAct = Boolean(viewerGamePlayer
    && game.actionSeat === viewerGamePlayer.seat
    && !viewerGamePlayer.folded
    && !viewerGamePlayer.allIn
    && game.street !== "handOver");

  return {
    handNumber: game.handNumber,
    startingChips: STARTING_CHIPS,
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
    canRaise: canAct && canRaise(game, viewerGamePlayer),
    gameOver: game.gameOver,
    canNextHand: game.street === "handOver" && !game.gameOver && room.players.filter(player => player.connected && player.chips > 0).length >= 2,
    canRestart: room.ownerId === viewer?.id && game.street === "handOver" && game.gameOver && room.players.filter(player => player.connected).length >= 2,
    result: game.result,
    entertainment: {
      enabled: Boolean(room.entertainmentMode),
      revealed: game.street === "handOver" && Boolean(game.result?.entertainment),
      text: game.street === "handOver" ? game.result?.entertainment?.text || null : null
    },
    history: game.history.slice(-10),
    players: game.players.map((player) => {
      const isViewer = player.id === viewer?.id;
      const showCards = isViewer || game.street === "handOver";
      return {
        id: player.id,
        name: player.name,
        seat: player.seat,
        chips: player.chips,
        bet: player.bet,
        totalBet: player.totalBet,
        folded: player.folded,
        allIn: player.allIn,
        left: Boolean(player.left),
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
  persistRooms();
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

function readJsonBody(req, callback) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 2048) req.destroy();
  });
  req.on("end", () => {
    try {
      callback(body ? JSON.parse(body) : {});
    } catch {
      callback({});
    }
  });
}

function loadPersistedRooms() {
  if (!fs.existsSync(ROOM_STORE_PATH)) return;

  try {
    const payload = JSON.parse(fs.readFileSync(ROOM_STORE_PATH, "utf8"));
    const now = Date.now();
    for (const savedRoom of payload.rooms || []) {
      const room = {
        ...savedRoom,
        entertainmentMode: Boolean(savedRoom.entertainmentMode),
        cleanupTimer: null,
        players: (savedRoom.players || []).map((player) => ({
          ...player,
          connected: false,
          socket: null,
          disconnectedAt: player.connected ? now : player.disconnectedAt || now
        }))
      };
      if (!room.code || !room.players?.length) continue;
      rooms.set(room.code, room);
      scheduleRoomCleanup(room);
    }
  } catch (error) {
    console.warn("Failed to load persisted rooms:", error.message);
  }
}

function persistRooms() {
  try {
    fs.mkdirSync(path.dirname(ROOM_STORE_PATH), { recursive: true });
    const payload = {
      savedAt: Date.now(),
      rooms: Array.from(rooms.values()).map(serializeRoom)
    };
    const tempPath = `${ROOM_STORE_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload));
    fs.renameSync(tempPath, ROOM_STORE_PATH);
  } catch (error) {
    console.warn("Failed to persist rooms:", error.message);
  }
}

function serializeRoom(room) {
  return {
    code: room.code,
    ownerId: room.ownerId,
    stage: room.stage,
    entertainmentMode: Boolean(room.entertainmentMode),
    game: room.game,
    createdAt: room.createdAt,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      connected: player.connected,
      sessionToken: player.sessionToken,
      disconnectedAt: player.disconnectedAt,
      chips: player.chips
    }))
  };
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

function leaveRoom(roomCode, playerId, sessionToken) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const player = room.players.find((item) => item.id === playerId);
  if (!player) return;
  if (sessionToken && player.sessionToken !== sessionToken) return;

  if (player.socket) {
    const oldClient = sockets.get(player.socket);
    if (oldClient) {
      oldClient.roomCode = null;
      oldClient.playerId = null;
    }
  }

  room.players = room.players.filter((item) => item.id !== playerId);
  if (room.ownerId === playerId) room.ownerId = room.players.find(item => item.connected)?.id || room.players[0]?.id || null;

  if (room.players.length === 0) {
    rooms.delete(room.code);
    clearTimeout(room.cleanupTimer);
    persistRooms();
    return;
  }

  if (room.game) {
    const gamePlayer = room.game.players.find(item => item.id === playerId);
    if (gamePlayer) gamePlayer.left = true;
    if (room.game.street !== "handOver" && gamePlayer && !gamePlayer.folded && !gamePlayer.allIn) {
      gamePlayer.folded = true;
      gamePlayer.hasActed = true;
      room.game.history.push(`${gamePlayer.name} 退出，本手弃牌。`);
      afterAction(room, room.game.actionSeat !== gamePlayer.seat);
      return;
    }
    if (room.game.street === "handOver") updateGameOver(room);
  }

  broadcast(room);
}

function markPlayerDisconnected(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const player = room.players.find((item) => item.id === playerId);
  if (!player) return;

  player.connected = false;
  player.socket = null;
  player.disconnectedAt = Date.now();
  scheduleRoomCleanup(room);
  broadcast(room);
}

function createRoom(roomCode) {
  return {
    code: roomCode,
    ownerId: null,
    players: [],
    stage: "lobby",
    entertainmentMode: false,
    game: null,
    createdAt: Date.now(),
    cleanupTimer: null
  };
}

function reconnectPlayer(room, player, client) {
  if (player.socket && player.socket !== client.socket) {
    const oldClient = sockets.get(player.socket);
    if (oldClient) {
      oldClient.roomCode = null;
      oldClient.playerId = null;
    }
    if (player.socket.readyState === WebSocket.OPEN) {
      player.socket.close(1000, "reconnected");
    }
  }

  player.connected = true;
  player.socket = client.socket;
  player.disconnectedAt = null;
  client.roomCode = room.code;
  client.playerId = player.id;
  broadcast(room);
}

function scheduleRoomCleanup(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  const deadlines = room.players.filter(player => !player.connected && player.disconnectedAt)
    .map(player => player.disconnectedAt + RECONNECT_WINDOW_MS);
  if (!deadlines.length) return;
  room.cleanupTimer = setTimeout(() => {
    cleanupExpiredPlayers(room);
    if (rooms.has(room.code)) {
      broadcast(room);
      scheduleRoomCleanup(room);
    }
  }, Math.max(0, Math.min(...deadlines) - Date.now()) + 250);
  if (typeof room.cleanupTimer.unref === "function") room.cleanupTimer.unref();
}

function cleanupExpiredPlayers(room) {
  const activeRoom = rooms.get(room.code);
  if (!activeRoom) return;
  const now = Date.now();
  const expired = (player) => (
    !player.connected
    && player.disconnectedAt
    && now - player.disconnectedAt >= RECONNECT_WINDOW_MS
  );

  for (const player of activeRoom.players.filter(expired)) leaveRoom(room.code, player.id, player.sessionToken);
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

function shutdown() {
  persistRooms();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
