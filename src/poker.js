const RANKS = ["6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS = ["spades", "hearts", "diamonds", "clubs"];

const RANK_VALUE = {
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14
};

const VALUE_RANK = Object.fromEntries(Object.entries(RANK_VALUE).map(([rank, value]) => [value, rank]));

const CATEGORY_NAMES = [
  "高牌",
  "一对",
  "两对",
  "三条",
  "顺子",
  "葫芦",
  "同花",
  "四条",
  "同花顺"
];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit, value: RANK_VALUE[rank] });
    }
  }
  return deck;
}

function shuffle(deck) {
  const copy = deck.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function compareEvaluations(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < length; i += 1) {
    const av = a.tiebreakers[i] || 0;
    const bv = b.tiebreakers[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function combinations(cards, size) {
  const result = [];
  const current = [];

  function walk(start) {
    if (current.length === size) {
      result.push(current.slice());
      return;
    }

    for (let i = start; i <= cards.length - (size - current.length); i += 1) {
      current.push(cards[i]);
      walk(i + 1);
      current.pop();
    }
  }

  walk(0);
  return result;
}

function straightHigh(values) {
  const unique = Array.from(new Set(values)).sort((a, b) => a - b);
  if (unique.length !== 5) return null;

  const isWheel = [6, 7, 8, 9, 14].every((value) => unique.includes(value));
  if (isWheel) return 9;

  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i] !== unique[i - 1] + 1) return null;
  }

  return unique[4];
}

function evaluateFive(cards) {
  const values = cards.map((card) => card.value).sort((a, b) => b - a);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = straightHigh(values);
  const counts = new Map();

  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  const grouped = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  if (flush && straight) {
    return {
      category: 8,
      tiebreakers: [straight],
      name: CATEGORY_NAMES[8],
      cards
    };
  }

  if (grouped[0].count === 4) {
    return {
      category: 7,
      tiebreakers: [grouped[0].value, grouped[1].value],
      name: CATEGORY_NAMES[7],
      cards
    };
  }

  if (flush) {
    return {
      category: 6,
      tiebreakers: values,
      name: CATEGORY_NAMES[6],
      cards
    };
  }

  if (grouped[0].count === 3 && grouped[1]?.count === 2) {
    return {
      category: 5,
      tiebreakers: [grouped[0].value, grouped[1].value],
      name: CATEGORY_NAMES[5],
      cards
    };
  }

  if (straight) {
    return {
      category: 4,
      tiebreakers: [straight],
      name: CATEGORY_NAMES[4],
      cards
    };
  }

  if (grouped[0].count === 3) {
    const kickers = grouped.filter((item) => item.count === 1).map((item) => item.value);
    return {
      category: 3,
      tiebreakers: [grouped[0].value, ...kickers],
      name: CATEGORY_NAMES[3],
      cards
    };
  }

  if (grouped[0].count === 2 && grouped[1]?.count === 2) {
    const pairs = grouped.filter((item) => item.count === 2).map((item) => item.value).sort((a, b) => b - a);
    const kicker = grouped.find((item) => item.count === 1).value;
    return {
      category: 2,
      tiebreakers: [...pairs, kicker],
      name: CATEGORY_NAMES[2],
      cards
    };
  }

  if (grouped[0].count === 2) {
    const kickers = grouped.filter((item) => item.count === 1).map((item) => item.value);
    return {
      category: 1,
      tiebreakers: [grouped[0].value, ...kickers],
      name: CATEGORY_NAMES[1],
      cards
    };
  }

  return {
    category: 0,
    tiebreakers: values,
    name: CATEGORY_NAMES[0],
    cards
  };
}

function evaluateSeven(cards) {
  if (cards.length < 5) {
    throw new Error("At least five cards are required to evaluate a hand.");
  }

  let best = null;
  for (const combo of combinations(cards, 5)) {
    const evaluated = evaluateFive(combo);
    if (!best || compareEvaluations(evaluated, best) > 0) {
      best = evaluated;
    }
  }

  return {
    ...best,
    label: describeEvaluation(best)
  };
}

function describeEvaluation(evaluation) {
  const [primary, secondary] = evaluation.tiebreakers;
  const rank = (value) => VALUE_RANK[value] || String(value);

  switch (evaluation.category) {
    case 8:
      return `${rank(primary)}高同花顺`;
    case 7:
      return `${rank(primary)}四条`;
    case 6:
      return `${rank(primary)}高同花`;
    case 5:
      return `${rank(primary)}满${rank(secondary)}`;
    case 4:
      return primary === 9 ? "A-6-7-8-9顺子" : `${rank(primary)}高顺子`;
    case 3:
      return `${rank(primary)}三条`;
    case 2:
      return `${rank(primary)}和${rank(secondary)}两对`;
    case 1:
      return `${rank(primary)}一对`;
    default:
      return `${rank(primary)}高牌`;
  }
}

module.exports = {
  CATEGORY_NAMES,
  RANKS,
  RANK_VALUE,
  SUITS,
  compareEvaluations,
  createDeck,
  evaluateFive,
  evaluateSeven,
  shuffle,
  straightHigh
};
