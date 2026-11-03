const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { startTestServer } = require('../scripts/local-server.cjs');
const { createDeck } = require('../src/poker');
const fs = require('node:fs');

async function connect(url, roomCode, name, session = {}) {
  const ws = new WebSocket(url.replace('http', 'ws'));
  const client = { ws, state: null, notices: [], send(message) { ws.send(JSON.stringify(message)); } };
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.type === 'state') client.state = message.state;
    if (message.type === 'notice') client.notices.push(message.text);
  });
  await new Promise(resolve => ws.once('open', resolve));
  client.send({ type: 'join', roomCode, name, ...session });
  await until(() => client.state || client.notices.length);
  assert.deepEqual(client.notices, []);
  return client;
}
async function until(predicate) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('State transition timed out');
}

test('four-player room preserves a live hand when joining, folding, refreshing and leaving', async () => {
  const server = await startTestServer();
  const clients = [];
  try {
    for (let i = 0; i < 2; i++) clients.push(await connect(server.url, '4512', `P${i}`));
    clients[0].send({ type: 'start' });
    await until(() => clients.every(c => c.state.game));
    const old = clients.map(c => c.state.game.players.find(p => p.isYou));
    for (let i = 2; i < 4; i++) clients.push(await connect(server.url, '4512', `P${i}`));
    assert.equal(clients[2].state.game.players.length, 2);
    assert.equal(clients[2].state.game.canAct, false);
    for (let i = 0; i < 2; i++) assert.deepEqual(clients[i].state.game.players.find(p => p.isYou), old[i]);
    clients.find(c => c.state.game.canAct).send({ type: 'action', action: 'fold' });
    await until(() => clients.every(c => c.state.game.result));
    clients[0].send({ type: 'nextHand' });
    await until(() => clients.every(c => c.state.game.handNumber === 2));
    assert.equal(clients[0].state.game.players.length, 4);
    assert.equal(new Set(clients[0].state.game.players.map(p => p.seat)).size, 4);
    const actor = clients.find(c => c.state.game.canAct);
    actor.send({ type: 'action', action: 'fold' });
    await until(() => clients.every(c => c.state.game.players.some(p => p.folded)));
    assert.equal(clients[0].state.game.result, null, 'one fold must not end a four-way hand');
    const target = clients.find(c => c !== actor);
    const saved = target.state;
    target.ws.terminate();
    const resumed = await connect(server.url, '4512', 'Resume', { playerId: saved.you, sessionToken: saved.sessionToken });
    clients.push(resumed);
    assert.deepEqual(resumed.state.game, saved.game);
    const leaving = clients.find(c => c.state.game.canAct && c.ws.readyState === WebSocket.OPEN);
    leaving.send({ type: 'leave', sessionToken: leaving.state.sessionToken });
    await until(() => resumed.state.players.length === 3);
    assert.equal(resumed.state.stage, 'playing');
    assert.equal(resumed.state.game.handNumber, 2);
    assert.equal(resumed.state.game.result, null);
    assert.equal(resumed.state.game.players.filter(p => p.folded).length, 2);
  } finally {
    clients.forEach(c => c.ws.terminate());
    await server.stop();
  }
});

function savedHand(stacks = [1000, 1000, 150, 1000]) {
  const deck = createDeck();
  const players = stacks.map((chips, seat) => ({ id: `p${seat}`, name: `P${seat}`, seat, chips,
    sessionToken: `token${seat}`, connected: true, disconnectedAt: null }));
  return { code: '5566', ownerId: 'p0', stage: 'playing', players, createdAt: Date.now(),
    game: { handNumber: 1, dealerSeat: 3, deck, community: [], street: 'preflop', pot: 0,
      currentBet: 0, minRaise: 10, actionSeat: 0, history: [], result: null, gameOver: false,
      players: players.map(p => ({ id: p.id, name: p.name, seat: p.seat, chips: p.chips,
        holeCards: [deck.pop(), deck.pop()], bet: 0, totalBet: 0, folded: false, allIn: false,
        hasActed: false, lastActedBet: 0, evaluation: null })) } };
}

test('short all-in preserves turn order, locks re-raise rights and survives process restart', async () => {
  let server = await startTestServer([savedHand()]);
  let clients = [];
  try {
    for (let i = 0; i < 4; i++) clients.push(await connect(server.url, '5566', `P${i}`, { playerId: `p${i}`, sessionToken: `token${i}` }));
    const act = async (seat, action, amount) => {
      await until(() => clients[seat].state.game.canAct);
      const old = JSON.stringify(clients[seat].state.game);
      clients[seat].send({ type: 'action', action, amount });
      await until(() => JSON.stringify(clients[seat].state.game) !== old);
    };
    await act(0, 'bet', 100);
    await act(1, 'call');
    await act(2, 'bet', 150);
    await act(3, 'call');
    await until(() => clients[0].state.game.canAct);
    assert.equal(clients[0].state.game.canRaise, false);
    const unchanged = structuredClone(clients[0].state.game);
    clients[0].send({ type: 'action', action: 'bet', amount: 200 });
    await until(() => clients[0].notices.length);
    assert.match(clients[0].notices.pop(), /不能再次加注/);
    assert.deepEqual(clients[0].state.game, unchanged);
    await act(0, 'call');
    await act(1, 'call');
    assert.equal(clients[1].state.game.street, 'flop');
    assert.equal(clients[1].state.game.pot, 600);
    const before = structuredClone(clients[0].state.game);
    clients.forEach(c => c.ws.terminate());
    await until(() => JSON.parse(fs.readFileSync(server.store, 'utf8')).rooms[0].players.every(p => !p.connected));
    const stored = JSON.parse(fs.readFileSync(server.store, 'utf8')).rooms;
    await server.stop();
    server = await startTestServer(stored);
    clients = [];
    for (let i = 0; i < 4; i++) clients.push(await connect(server.url, '5566', `P${i}`, { playerId: `p${i}`, sessionToken: `token${i}` }));
    assert.deepEqual(clients[0].state.game, before);
    clients[0].send({ type: 'restart' });
    await until(() => clients[0].notices.length);
    assert.match(clients[0].notices.pop(), /整场结束/);
    assert.deepEqual(clients[0].state.game, before);
    while (!clients[0].state.game.result) {
      const seat = clients[0].state.game.actionSeat;
      await act(seat, 'check');
      await until(() => clients.every(c => c.state.game.street === clients[seat].state.game.street));
    }
    assert.equal(clients[0].state.game.players.reduce((sum, p) => sum + p.chips, 0), 3150);
  } finally {
    clients.forEach(c => c.ws.terminate());
    await server.stop();
  }
});

test('expired disconnected seats are released after a server restart', async () => {
  const room = savedHand([1000, 1000, 1000, 1000, 1000, 1000]);
  room.players.forEach(p => { p.connected = false; p.disconnectedAt = Date.now() - 11 * 60 * 1000; });
  const server = await startTestServer([room]);
  let newcomer;
  try {
    newcomer = await connect(server.url, '5566', 'New');
    assert.equal(newcomer.state.stage, 'lobby');
    assert.equal(newcomer.state.players.length, 1);
  } finally {
    newcomer?.ws.terminate();
    await server.stop();
  }
});
