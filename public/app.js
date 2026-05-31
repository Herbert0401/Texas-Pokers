const joinView = document.querySelector("#joinView");
const gameView = document.querySelector("#gameView");
const joinForm = document.querySelector("#joinForm");
const nameInput = document.querySelector("#nameInput");
const roomInput = document.querySelector("#roomInput");
const roomCodeEl = document.querySelector("#roomCode");
const tableTitle = document.querySelector("#tableTitle");
const playerList = document.querySelector("#playerList");
const startButton = document.querySelector("#startButton");
const nextHandButton = document.querySelector("#nextHandButton");
const restartButton = document.querySelector("#restartButton");
const rulesButton = document.querySelector("#rulesButton");
const rulesDialog = document.querySelector("#rulesDialog");
const closeRules = document.querySelector("#closeRules");
const potText = document.querySelector("#potText");
const streetBadge = document.querySelector("#streetBadge");
const communityCards = document.querySelector("#communityCards");
const statusText = document.querySelector("#statusText");
const heroPanel = document.querySelector("#heroPanel");
const opponentPanel = document.querySelector("#opponentPanel");
const actionHint = document.querySelector("#actionHint");
const quickActions = document.querySelector(".quick-actions");
const customAmount = document.querySelector("#customAmount");
const customBet = document.querySelector("#customBet");
const historyList = document.querySelector("#historyList");
const toast = document.querySelector("#toast");
const gameOverDialog = document.querySelector("#gameOverDialog");
const gameOverTitle = document.querySelector("#gameOverTitle");
const gameOverText = document.querySelector("#gameOverText");
const closeGameOver = document.querySelector("#closeGameOver");

let socket;
let state;
let toastTimer;
let shownGameOverKey = null;
let leavingPage = false;
const DEFAULT_MIN_BET = 20;

const STREET_LABELS = {
  waiting: "等待",
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  handOver: "已结算"
};

const SUIT_SYMBOLS = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣"
};

const SUIT_CLASSES = {
  spades: "spades",
  hearts: "hearts",
  diamonds: "diamonds",
  clubs: "clubs",
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs"
};

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const roomCode = roomInput.value.trim();
  if (!name || !/^\d{4}$/.test(roomCode)) {
    showToast("请输入名字和四位数字房间密码。");
    return;
  }

  connect();
  const join = () => {
    send({ type: "join", name, roomCode });
  };

  if (socket.readyState === WebSocket.OPEN) {
    join();
  } else {
    socket.addEventListener("open", join, { once: true });
  }
});

roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value.replace(/\D/g, "").slice(0, 4);
});

startButton.addEventListener("click", () => send({ type: "start" }));
nextHandButton.addEventListener("click", () => send({ type: "nextHand" }));
restartButton.addEventListener("click", () => send({ type: "restart" }));
rulesButton.addEventListener("click", () => rulesDialog.showModal());
closeRules.addEventListener("click", () => rulesDialog.close());
closeGameOver.addEventListener("click", () => gameOverDialog.close());

window.addEventListener("pagehide", notifyLeave);
window.addEventListener("beforeunload", notifyLeave);

quickActions.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || !state?.game?.canAct) return;

  const action = button.dataset.action;
  if (action === "fold") send({ type: "action", action: "fold" });
  if (action === "check") send({ type: "action", action: "check" });
  if (action === "call") send({ type: "action", action: "call" });
  if (action === "bet20") send({ type: "action", action: "bet", amount: DEFAULT_MIN_BET });
  if (action === "allin") send({ type: "action", action: "bet", amount: heroPlayer().chips });

  if (button.dataset.fraction) {
    send({
      type: "action",
      action: "bet",
      amount: calculatePotBet(Number(button.dataset.fraction))
    });
  }
});

customBet.addEventListener("click", () => {
  if (!state?.game?.canAct) return;
  const amount = Number.parseInt(customAmount.value, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("请输入有效筹码数量。");
    return;
  }
  send({ type: "action", action: "bet", amount });
  customAmount.value = "";
});

document.querySelectorAll(".mini-cards").forEach((node) => {
  node.replaceChildren(...node.dataset.example.split(" ").map(renderMiniCard));
});

function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}`);

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "state") {
      state = payload.state;
      render();
    }
    if (payload.type === "notice") {
      showToast(payload.text);
    }
  });

  socket.addEventListener("close", () => {
    if (!leavingPage) showToast("连接已断开，请刷新页面重新进入。");
    setControlsEnabled(false);
  });
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast("还没有连接到牌桌。");
    return;
  }
  socket.send(JSON.stringify(payload));
}

function notifyLeave() {
  if (leavingPage || !state?.roomCode || !state?.you) return;
  leavingPage = true;

  const payload = JSON.stringify({
    roomCode: state.roomCode,
    playerId: state.you
  });

  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "leave" }));
    socket.close(1000, "leaving");
  }

  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", new Blob([payload], { type: "application/json" }));
    return;
  }

  fetch("/api/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true
  }).catch(() => {});
}

function render() {
  joinView.classList.add("hidden");
  gameView.classList.remove("hidden");
  roomCodeEl.textContent = state.roomCode;
  renderPlayers();

  startButton.classList.toggle("hidden", !state.canStart);

  if (state.stage === "lobby") {
    renderLobby();
    return;
  }

  renderGame();
}

function renderLobby() {
  tableTitle.textContent = state.players.length === 2 ? "房主可以开始游戏" : "等待第二名玩家";
  potText.textContent = "底池 0";
  streetBadge.textContent = "大厅";
  communityCards.replaceChildren(...Array.from({ length: 5 }, () => renderPlaceholder()));
  statusText.textContent = state.players.length === 2 ? "两名玩家已就位，等待房主开始。" : "把四位房间密码发给对手，对方输入同样密码即可加入。";
  heroPanel.replaceChildren(renderEmptySeat("你的座位"));
  opponentPanel.replaceChildren(renderEmptySeat("对手座位"));
  actionHint.textContent = state.isOwner ? "两人到齐后你可以开始游戏。" : "等待房主开始游戏。";
  historyList.replaceChildren();
  nextHandButton.classList.add("hidden");
  restartButton.classList.add("hidden");
  setControlsEnabled(false);
}

function renderGame() {
  const game = state.game;
  const hero = heroPlayer();
  const opponent = opponentPlayer();

  tableTitle.textContent = game.street === "handOver" ? `第 ${game.handNumber} 手牌结束` : `第 ${game.handNumber} 手`;
  potText.textContent = `底池 ${game.pot}`;
  streetBadge.textContent = STREET_LABELS[game.street] || game.street;
  communityCards.replaceChildren(...renderCommunity(game.community));
  heroPanel.replaceChildren(renderPlayerPanel(hero));
  opponentPanel.replaceChildren(renderPlayerPanel(opponent));
  nextHandButton.classList.toggle("hidden", !game.canNextHand);
  restartButton.classList.toggle("hidden", !game.canRestart);
  renderStatus(game);
  renderActions(game, hero);
  renderHistory(game.history);
  maybeShowGameOver(game);
}

function renderPlayers() {
  const items = state.players.map((player) => {
    const node = document.createElement("div");
    node.className = "player-list-item";
    const title = document.createElement("strong");
    title.textContent = `${player.name}${player.isOwner ? " · 房主" : ""}`;
    const meta = document.createElement("span");
    meta.textContent = `${player.chips} 筹码`;
    node.append(title, meta);
    return node;
  });

  while (items.length < 2) {
    const empty = document.createElement("div");
    empty.className = "player-list-item";
    empty.innerHTML = "<strong>空座</strong><span>等待中</span>";
    items.push(empty);
  }

  playerList.replaceChildren(...items);
}

function renderStatus(game) {
  if (game.result) {
    statusText.textContent = game.result.gameOver?.text || (game.gameOver ? `${game.result.text} 有玩家筹码归零，可重新开始整场。` : game.result.text);
    return;
  }

  const acting = game.players.find((player) => player.seat === game.actionSeat);
  if (acting) {
    statusText.textContent = acting.isYou ? "轮到你行动。" : `等待 ${acting.name} 行动。`;
    return;
  }

  statusText.textContent = "牌局进行中。";
}

function renderActions(game, hero) {
  const canAct = Boolean(game.canAct);
  const toCall = game.toCall || 0;
  const minBet = game.minBet || DEFAULT_MIN_BET;
  const label = canAct
    ? toCall > 0
      ? `需要跟注 ${toCall}。可弃牌、跟注、加注或全下。`
      : `你可以过牌，也可以下注，最低投入 ${minBet} 筹码。`
    : "等待对手行动。";
  actionHint.textContent = game.street === "handOver" ? "本手牌已结束。" : label;

  setControlsEnabled(canAct);
  quickActions.querySelector('[data-action="check"]').disabled = !canAct || toCall > 0;
  quickActions.querySelector('[data-action="call"]').disabled = !canAct || toCall <= 0;
  quickActions.querySelector('[data-action="fold"]').disabled = !canAct || toCall <= 0;

  const bet20Button = quickActions.querySelector('[data-action="bet20"]');
  bet20Button.textContent = `下注${minBet}`;
  bet20Button.disabled = !canAct || toCall > 0 || hero.chips < minBet;

  quickActions.querySelectorAll("[data-fraction]").forEach((button) => {
    const amount = calculatePotBet(Number(button.dataset.fraction));
    button.textContent = `${button.dataset.fraction === "0.667" ? "2/3" : Number(button.dataset.fraction) === 1 ? "满" : "1/2"}池 · ${amount}`;
    button.disabled = !canAct || amount <= 0 || hero.chips <= 0;
  });

  const allIn = quickActions.querySelector('[data-action="allin"]');
  allIn.textContent = `All-in · ${hero?.chips || 0}`;
  allIn.disabled = !canAct || hero.chips <= 0;
  customBet.disabled = !canAct;
  customAmount.disabled = !canAct;
  customAmount.min = String(toCall > 0 ? toCall : minBet);
  customAmount.step = String(minBet);
  customAmount.placeholder = toCall > 0 ? "跟注或加注筹码" : `至少${minBet}筹码`;
}

function setControlsEnabled(enabled) {
  quickActions.querySelectorAll("button").forEach((button) => {
    button.disabled = !enabled;
  });
  customBet.disabled = !enabled;
  customAmount.disabled = !enabled;
}

function renderHistory(history = []) {
  if (!history.length) {
    historyList.replaceChildren();
    return;
  }
  historyList.replaceChildren(...history.slice().reverse().map((item) => {
    const node = document.createElement("div");
    node.className = "history-item";
    node.textContent = item;
    return node;
  }));
}

function renderPlayerPanel(player) {
  if (!player) return renderEmptySeat("等待玩家");

  const wrapper = document.createElement("div");
  wrapper.className = "player-meta";

  const nameRow = document.createElement("div");
  nameRow.className = "name-row";

  const name = document.createElement("span");
  name.className = "player-name";
  name.textContent = player.isYou ? `${player.name}（你）` : player.name;
  nameRow.append(name);

  if (player.dealer) {
    const dealer = document.createElement("span");
    dealer.className = "dealer-chip";
    dealer.textContent = "庄";
    nameRow.append(dealer);
  }

  if (player.isTurn) {
    const turn = document.createElement("span");
    turn.className = "turn-chip";
    turn.textContent = "行动";
    nameRow.append(turn);
  }

  const chipRow = document.createElement("div");
  chipRow.className = "chip-row";
  chipRow.innerHTML = `<span>筹码 ${player.chips}</span><span>本轮 ${player.bet}</span>${player.allIn ? "<span>All-in</span>" : ""}${player.folded ? "<span>已弃牌</span>" : ""}`;

  const handLabel = document.createElement("div");
  handLabel.className = "chip-row";
  handLabel.textContent = player.evaluation?.label || "";

  wrapper.append(nameRow, chipRow, handLabel);

  const cards = document.createElement("div");
  cards.className = "card-row";
  if (player.holeCards) {
    cards.replaceChildren(...player.holeCards.map(renderCard));
  } else {
    cards.replaceChildren(renderBackCard(), renderBackCard());
  }

  const fragment = document.createDocumentFragment();
  fragment.append(wrapper, cards);
  return fragment;
}

function renderEmptySeat(label) {
  const fragment = document.createDocumentFragment();
  const meta = document.createElement("div");
  meta.className = "player-meta";
  meta.innerHTML = `<div class="name-row"><span class="player-name">${label}</span></div><div class="chip-row"><span>等待中</span></div>`;
  const cards = document.createElement("div");
  cards.className = "card-row";
  cards.append(renderBackCard(), renderBackCard());
  fragment.append(meta, cards);
  return fragment;
}

function renderCommunity(cards) {
  const nodes = cards.map(renderCard);
  while (nodes.length < 5) nodes.push(renderPlaceholder());
  return nodes;
}

function renderCard(card) {
  const node = document.createElement("div");
  const suitClass = SUIT_CLASSES[card.suit] || "spades";
  node.className = `card ${suitClass}`;
  node.innerHTML = `<span class="rank">${displayRank(card.rank)}</span><span class="suit-mark">${SUIT_SYMBOLS[card.suit]}</span><span class="corner">${SUIT_SYMBOLS[card.suit]}</span>`;
  return node;
}

function renderBackCard() {
  const node = document.createElement("div");
  node.className = "card back";
  return node;
}

function renderPlaceholder() {
  const node = document.createElement("div");
  node.className = "card placeholder";
  node.textContent = "公共牌";
  return node;
}

function renderMiniCard(token) {
  const rank = token.slice(0, -1);
  const suit = token.slice(-1);
  const node = document.createElement("span");
  node.className = `mini-card ${SUIT_CLASSES[suit]}`;
  node.textContent = `${displayRank(rank)}${SUIT_SYMBOLS[suit]}`;
  return node;
}

function displayRank(rank) {
  return rank === "T" ? "10" : rank;
}

function heroPlayer() {
  return state?.game?.players.find((player) => player.isYou);
}

function opponentPlayer() {
  return state?.game?.players.find((player) => !player.isYou);
}

function calculatePotBet(fraction) {
  const game = state?.game;
  const hero = heroPlayer();
  if (!game || !hero) return 0;
  const toCall = game.toCall || 0;
  const potAfterCall = game.pot + toCall;
  const wager = toCall + Math.ceil(potAfterCall * fraction);
  const minBet = game.minBet || DEFAULT_MIN_BET;
  const minimum = toCall > 0 ? toCall + game.minRaise : minBet;
  return Math.max(Math.min(hero.chips, minimum), Math.min(hero.chips, wager));
}

function calculateMinimumBet() {
  const game = state?.game;
  const hero = heroPlayer();
  if (!game || !hero) return 0;
  const toCall = game.toCall || 0;
  const minBet = game.minBet || DEFAULT_MIN_BET;
  const amount = toCall > 0 ? toCall + Math.max(game.minRaise || minBet, minBet) : minBet;
  return Math.min(hero.chips, amount);
}

function maybeShowGameOver(game) {
  const summary = game.result?.gameOver;
  if (!summary) return;

  const key = `${game.handNumber}:${summary.winner.name}:${summary.loser.name}`;
  if (shownGameOverKey === key) return;
  shownGameOverKey = key;

  gameOverTitle.textContent = `${summary.winner.name} 获胜`;
  gameOverText.textContent = `${summary.loser.name} 筹码归零，${summary.winner.name} 赢下本场。`;
  if (typeof gameOverDialog.showModal === "function" && !gameOverDialog.open) {
    gameOverDialog.showModal();
  } else {
    showToast(summary.text);
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3200);
}
