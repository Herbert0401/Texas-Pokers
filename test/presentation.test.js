const test = require('node:test');
const assert = require('node:assert/strict');
const { settledBankroll, settlementFrames } = require('../public/presentation');

test('unsettled contributions are not losses, but settled payouts are final', () => {
  const player = { chips: 700, totalBet: 300 };
  assert.equal(settledBankroll(player, { street: 'flop' }), 1000);
  assert.equal(settledBankroll(player, { street: 'handOver' }), 700);
  assert.equal(settledBankroll({ chips: 1300, totalBet: 300 }, { result: {} }), 1300);
});

function states() {
  const before = { roomCode: '1234', you: 'a', game: {
    handNumber: 1, street: 'preflop', community: [], pot: 1000, history: ['a all-in'],
    players: [{ id: 'a', chips: 0, totalBet: 1000, holeCards: ['AS', 'KS'] },
      { id: 'b', chips: 1000, totalBet: 0, holeCards: null }]
  } };
  const after = structuredClone(before);
  Object.assign(after.game, { street: 'handOver', pot: 0, community: ['6S', '7S', '8S', '9S', 'TS'], result: { text: 'won' } });
  after.game.history.push('b called', 'won');
  after.game.players[0].chips = 2000;
  Object.assign(after.game.players[1], { chips: 0, totalBet: 1000, holeCards: ['AH', 'KH'] });
  return [before, after];
}

test('all-in presentation preserves pot until the flop, turn and river finish', () => {
  const [before, after] = states();
  const original = JSON.stringify([before, after]);
  const frames = settlementFrames(before, after);
  assert.deepEqual(frames.map(frame => frame.state.game.community.length), [0, 3, 4, 5]);
  for (const { state, duration } of frames) {
    assert.equal(state.game.pot, 2000);
    assert.equal(state.game.players.reduce((sum, player) => sum + player.chips, 0), 0);
    assert.equal(state.game.result, null);
    assert.equal(state.game.canAct, false);
    assert.equal(state.game.canNextHand, false);
    assert.deepEqual(state.game.history, before.game.history);
    assert.ok(duration >= 900);
  }
  assert.equal(frames[0].state.game.players[1].holeCards, null);
  assert.deepEqual(frames[1].state.game.players[1].holeCards, ['AH', 'KH']);
  assert.equal(JSON.stringify([before, after]), original);
});

test('refresh, repeated results, a different room and folds do not replay a runout', () => {
  const [before, after] = states();
  assert.deepEqual(settlementFrames(null, after), []);
  assert.deepEqual(settlementFrames(after, after), []);
  assert.deepEqual(settlementFrames(before, { ...after, roomCode: '4321' }), []);
  after.game.players[1].folded = true;
  after.game.result.type = 'fold';
  assert.deepEqual(settlementFrames(before, after), []);
});

test('short-stack all-in refund is preserved in the pre-payout presentation', () => {
  const [before, after] = states();
  before.game.players[1].chips = 700;
  after.game.players.forEach(player => { player.totalBet = 700; });
  const frame = settlementFrames(before, after)[0].state.game;
  assert.equal(frame.pot, 1400);
  assert.deepEqual(frame.players.map(player => player.chips), [300, 0]);
});
