const test = require('node:test');
const assert = require('node:assert/strict');
const { nextSeat, canRaise, settlePots } = require('../src/multiplayer');

function player(seat, totalBet, strength, folded = false) {
  return { id: String(seat), name: `P${seat}`, seat, totalBet, bet: totalBet,
    chips: 0, folded, evaluation: { category: strength, tiebreakers: [14], label: `rank${strength}` } };
}

test('seat rotation skips empty, folded and all-in seats', () => {
  const players = [{ seat: 0 }, { seat: 2, folded: true }, { seat: 4, allIn: true }, { seat: 5 }];
  const eligible = p => !p.folded && !p.allIn;
  assert.equal(nextSeat(players, 0, eligible), 5);
  assert.equal(nextSeat(players, 5, eligible), 0);
  assert.equal(nextSeat(players, 0, () => false), null);
});

test('short all-in reopens betting only after a full cumulative raise', () => {
  const p = { seat: 0, chips: 900, hasActed: true, lastActedBet: 100 };
  const game = { currentBet: 140, minRaise: 100, players: [p, { seat: 1, chips: 800 }] };
  assert.equal(canRaise(game, p), false);
  game.currentBet = 200;
  assert.equal(canRaise(game, p), true);
  game.players[1].allIn = true;
  assert.equal(canRaise(game, p), false);
});

test('saved hands from the two-player version retain already-acted raise restrictions', () => {
  const p = { seat: 0, chips: 900, hasActed: true, bet: 100 };
  const game = { currentBet: 150, minRaise: 100, players: [p, { seat: 1, chips: 800 }] };
  assert.equal(canRaise(game, p), false);
});

test('four unequal all-ins split main and side pots without losing chips', () => {
  const game = { dealerSeat: 0, pot: 1800, players: [player(0, 100, 8), player(1, 300, 7), player(2, 700, 6), player(3, 700, 5)] };
  const result = settlePots(game);
  assert.deepEqual(game.players.map(p => p.chips), [400, 600, 800, 0]);
  assert.deepEqual(result.pots.map(p => p.amount), [400, 600, 800]);
  assert.equal(result.winners.reduce((sum, p) => sum + p.amount, 0), 1800);
});

test('folded money stays in the pot and only an unmatched top layer is refunded', () => {
  const game = { dealerSeat: 0, pot: 1600, players: [player(0, 100, 8), player(1, 600, 7), player(2, 900, 9, true)] };
  settlePots(game);
  assert.deepEqual(game.players.map(p => p.chips), [300, 1000, 300]);
  assert.deepEqual(game.players.map(p => p.totalBet), [100, 600, 600]);
});

test('odd chips go clockwise after the dealer; checked-through pots still name winners', () => {
  const game = { dealerSeat: 0, pot: 33, players: [player(0, 11, 8), player(2, 11, 8), player(5, 11, 9, true)] };
  settlePots(game);
  assert.deepEqual(game.players.map(p => p.chips), [16, 17, 0]);
  const empty = { dealerSeat: 0, pot: 0, players: [player(0, 0, 4), player(2, 0, 5)] };
  assert.equal(settlePots(empty).winners[0].seat, 2);
});
