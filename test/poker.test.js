const test = require("node:test");
const assert = require("node:assert/strict");
const { compareEvaluations, evaluateSeven, straightHigh } = require("../src/poker");

function card(token) {
  const rank = token.slice(0, -1);
  const suitCode = token.slice(-1);
  const suit = {
    S: "spades",
    H: "hearts",
    D: "diamonds",
    C: "clubs"
  }[suitCode];
  const value = {
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    T: 10,
    J: 11,
    Q: 12,
    K: 13,
    A: 14
  }[rank];
  return { rank, suit, value };
}

function hand(tokens) {
  return evaluateSeven(tokens.split(" ").map(card));
}

test("A-6-7-8-9 is the lowest short deck straight", () => {
  assert.equal(straightHigh([14, 9, 8, 7, 6]), 9);
  const evaluated = hand("AS 9D 8C 7H 6S KD QH");
  assert.equal(evaluated.category, 4);
  assert.equal(evaluated.label, "A-6-7-8-9顺子");
});

test("flush beats full house in this short deck ranking", () => {
  const flush = hand("AH KH JH 9H 7H 6C 8D");
  const fullHouse = hand("AS AD AC 9S 9D KC QH");
  assert.equal(flush.category, 6);
  assert.equal(fullHouse.category, 5);
  assert.ok(compareEvaluations(flush, fullHouse) > 0);
});

test("straight beats trips in PokerStars 6+ style ranking", () => {
  const straight = hand("KS QD JC TH 9S 6D 7C");
  const trips = hand("AS AD AC KH QD 8C 7H");
  assert.equal(straight.category, 4);
  assert.equal(trips.category, 3);
  assert.ok(compareEvaluations(straight, trips) > 0);
});

test("best five cards are selected from seven", () => {
  const evaluated = hand("AS KS QS JS TS 9S 8S");
  assert.equal(evaluated.category, 8);
  assert.equal(evaluated.label, "A高同花顺");
});
