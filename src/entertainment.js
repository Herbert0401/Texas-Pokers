const {
  createDeck,
  shuffle
} = require("./poker");

const SUIT_BY_CODE = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs"
};

const DRAMATIC_HAND_SCRIPTS = [
  {
    id: "river-royal-flush-over-quads",
    label: "河牌同花顺反超四条",
    sequence: ["AS", "AH", "KD", "QD", "AD", "AC", "JD", "9S", "TD"]
  },
  {
    id: "river-straight-over-top-set",
    label: "河牌顺子反超顶三条",
    sequence: ["KH", "KC", "6S", "7D", "KD", "8C", "9H", "QS", "TC"]
  },
  {
    id: "river-flush-over-full-house",
    label: "河牌同花反超葫芦",
    sequence: ["QC", "QS", "AH", "JH", "QH", "JC", "JD", "KH", "9H"]
  },
  {
    id: "river-straight-flush-over-quads",
    label: "河牌同花顺压过四条",
    sequence: ["TC", "TS", "8H", "9H", "TD", "6H", "7H", "KC", "TH"]
  }
];

function createDeckForHand({ entertainmentMode = false, playerCount = 2 } = {}) {
  if (!entertainmentMode || Math.random() >= 0.5) {
    return {
      deck: shuffle(createDeck()),
      entertainment: {
        enabled: Boolean(entertainmentMode),
        dramatic: false,
        label: null
      }
    };
  }

  return buildDramaticDeck(undefined, { playerCount });
}

function buildDramaticDeck(script = randomScript(), { swapSeats = Math.random() < 0.5, playerCount = 2 } = {}) {
  const sequence = script.sequence.map(cardFromToken);
  let drawSequence = swapSeats ? swapPlayerHoleCards(sequence) : sequence;
  if (playerCount > 2) {
    const reserved = new Set(sequence.map(cardKey));
    const extra = shuffle(createDeck().filter(card => !reserved.has(cardKey(card)))).slice(0, (playerCount - 2) * 2);
    const hands = [drawSequence.slice(0, 2), drawSequence.slice(2, 4)];
    for (let i = 0; i < extra.length; i += 2) hands.push(extra.slice(i, i + 2));
    drawSequence = [...shuffle(hands).flat(), ...drawSequence.slice(4)];
  }

  return {
    deck: stackDrawSequence(drawSequence),
    entertainment: {
      enabled: true,
      dramatic: true,
      label: script.label,
      scriptId: script.id
    }
  };
}

function randomScript() {
  const index = Math.floor(Math.random() * DRAMATIC_HAND_SCRIPTS.length);
  return DRAMATIC_HAND_SCRIPTS[index];
}

function swapPlayerHoleCards(sequence) {
  return [
    sequence[2],
    sequence[3],
    sequence[0],
    sequence[1],
    ...sequence.slice(4)
  ];
}

function stackDrawSequence(drawSequence) {
  const seen = new Set(drawSequence.map(cardKey));
  if (seen.size !== drawSequence.length) {
    throw new Error("Dramatic hand script contains duplicate cards.");
  }

  const remainder = shuffle(createDeck().filter((card) => !seen.has(cardKey(card))));
  return [...remainder, ...drawSequence.slice().reverse()];
}

function cardFromToken(token) {
  const rank = token.slice(0, -1);
  const suitCode = token.slice(-1).toUpperCase();
  const suit = SUIT_BY_CODE[suitCode];
  if (!suit) throw new Error(`Unknown suit in card token: ${token}`);
  return { rank, suit, value: rank === "T" ? 10 : rank === "J" ? 11 : rank === "Q" ? 12 : rank === "K" ? 13 : rank === "A" ? 14 : Number(rank) };
}

function cardKey(card) {
  return `${card.rank}-${card.suit}`;
}

module.exports = {
  DRAMATIC_HAND_SCRIPTS,
  buildDramaticDeck,
  cardFromToken,
  createDeckForHand,
  stackDrawSequence
};
