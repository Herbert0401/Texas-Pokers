import test from 'node:test';
import assert from 'node:assert/strict';
import { tableView, stackHeight } from '../public/table-model.mjs';

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
