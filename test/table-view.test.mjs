import test from 'node:test';
import assert from 'node:assert/strict';
import { tableView, stackHeight, chipValues, wagerChanges } from '../public/table-model.mjs';

test('chip denominations preserve amounts and mix a bankroll into useful stacks', () => {
  for (const amount of [0, 7, 10, 99, 600, 990, 1000, 2000]) {
    const values = chipValues(amount, true);
    assert.equal(values.reduce((sum, value) => sum + value, 0), amount);
  }
  assert.deepEqual(new Set(chipValues(1000, true)), new Set([100, 50, 10]));
});

test('wager animation detects cumulative contributions even when a street clears bets', () => {
  const previous = { hand: 1, hero: { totalBet: 20 }, opponent: { totalBet: 0 } };
  const next = { hand: 1, hero: { totalBet: 20 }, opponent: { totalBet: 20 } };
  assert.deepEqual(wagerChanges(previous, next), [{ player: 'opponent', amount: 20 }]);
  assert.deepEqual(wagerChanges(next, next), []);
  assert.deepEqual(wagerChanges(null, next), []);
  assert.deepEqual(wagerChanges(previous, { ...next, hand: 2 }), []);
});

test('3D presentation keeps unrevealed opponent cards hidden', () => {
  const view = tableView({ game: { pot: 30, community: [], players: [
    { isYou: true, chips: 980, holeCards: [{ rank: 'A', suit: 'spades' }] },
    { isYou: false, chips: 990, holeCards: null }
  ] } });
  assert.deepEqual(view.opponent.cards, [null, null]);
  assert.equal(view.hero.cards[0].rank, 'A');
  assert.equal(view.board.length, 5);
  assert.equal(view.pot, 30);
});

test('presentation preserves revealed board, hands and zero chip values', () => {
  const cards = [{ rank: 'K', suit: 'hearts' }, { rank: 'Q', suit: 'clubs' }];
  const state = { game: { pot: 2000, community: cards, players: [
    { isYou: true, chips: 0, holeCards: cards },
    { isYou: false, chips: 0, holeCards: cards }
  ] } };
  const before = JSON.stringify(state);
  const view = tableView(state);
  assert.deepEqual(view.board.slice(0, 2), cards);
  assert.deepEqual(view.opponent.cards, cards);
  assert.equal(stackHeight(view.hero.chips), 0);
  assert.equal(JSON.stringify(state), before);
  assert.ok(stackHeight(1000000) <= 12);
  assert.equal(stackHeight(990), 9);
  assert.equal(stackHeight(40, 10), 4);
});

test('landing preview and lobby have separate card visibility', () => {
  assert.equal(tableView(null).board[0].rank, 'A');
  assert.deepEqual(tableView({ players: [] }).board, [null, null, null, null, null]);
});

test('all opponents have independent hidden cards and wager origins', () => {
  const players = Array.from({ length: 4 }, (_, seat) => ({ id: String(seat), seat, isYou: seat === 2, chips: 1000, totalBet: 0 }));
  const before = tableView({ you: '2', game: { handNumber: 1, community: [], players } });
  assert.equal(before.players.length, 4);
  assert.equal(before.players[0].id, '2');
  assert.deepEqual(before.players.map(p => p.id), ['2', '3', '0', '1']);
  for (const p of before.players) assert.deepEqual(p.cards, [null, null]);
  players[0].totalBet = 20;
  players[3].totalBet = 30;
  const after = tableView({ you: '2', game: { handNumber: 1, community: [], players } });
  assert.deepEqual(wagerChanges(before, after).map(w => [w.player, w.amount]), [['3', 30], ['0', 20]]);
});
