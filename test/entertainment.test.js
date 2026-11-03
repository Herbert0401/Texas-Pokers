const assert = require("node:assert/strict");
const test = require("node:test");
const {
  compareEvaluations,
  evaluateSeven
} = require("../src/poker");
const {
  DRAMATIC_HAND_SCRIPTS,
  buildDramaticDeck
} = require("../src/entertainment");

function drawScriptedCards(deck) {
  return Array.from({ length: 9 }, () => deck.pop());
}

function cardKey(card) {
  return `${card.rank}-${card.suit}`;
}

function evaluateScript(deck) {
  const cards = drawScriptedCards(deck);
  const playerA = cards.slice(0, 2);
  const playerB = cards.slice(2, 4);
  const board = cards.slice(4, 9);
  return {
    playerA: evaluateSeven([...playerA, ...board]),
    playerB: evaluateSeven([...playerB, ...board])
  };
}

test("dramatic hand scripts build complete unique decks", () => {
  for (const script of DRAMATIC_HAND_SCRIPTS) {
    const { deck } = buildDramaticDeck(script, { swapSeats: false });
    assert.equal(deck.length, 36);
    assert.equal(new Set(deck.map(cardKey)).size, 36);
  }
});

test("dramatic hand scripts create river comebacks for either seat", () => {
  for (const script of DRAMATIC_HAND_SCRIPTS) {
    const normal = evaluateScript(buildDramaticDeck(script, { swapSeats: false }).deck);
    assert.ok(
      compareEvaluations(normal.playerB, normal.playerA) > 0,
      `${script.id} should favor player B before seat swap`
    );

    const swapped = evaluateScript(buildDramaticDeck(script, { swapSeats: true }).deck);
    assert.ok(
      compareEvaluations(swapped.playerA, swapped.playerB) > 0,
      `${script.id} should favor player A after seat swap`
    );
  }
});

test("multiplayer entertainment reserves the board after every player's hole cards", () => {
  for (const playerCount of [3, 4, 5, 6]) {
    for (const script of DRAMATIC_HAND_SCRIPTS) {
      const { deck } = buildDramaticDeck(script, { playerCount, swapSeats: false });
      assert.equal(new Set(deck.map(cardKey)).size, 36);
      const dealt = Array.from({ length: playerCount * 2 + 5 }, () => deck.pop());
      const expected = drawScriptedCards(buildDramaticDeck(script, { swapSeats: false }).deck).slice(4);
      assert.deepEqual(dealt.slice(playerCount * 2), expected);
    }
  }
});
