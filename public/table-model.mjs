export function stackHeight(chips, denomination = 100) {
  return chips > 0 ? Math.min(12, Math.floor(chips / denomination)) : 0;
}

export function tableView(state) {
  const game = state?.game;
  const player = (isYou) => {
    const seat = game?.players.find((item) => Boolean(item.isYou) === isYou);
    return { cards: seat?.holeCards || [null, null], chips: seat?.chips ?? 0,
      bet: seat?.bet || 0, dealer: Boolean(seat?.dealer), folded: Boolean(seat?.folded) };
  };
  return {
    preview: !state,
    board: !state ? ['A', 'K', 'Q', 'J', 'T'].map((rank) => ({ rank, suit: 'spades' }))
      : Array.from({ length: 5 }, (_, i) => game?.community[i] || null),
    hero: player(true), opponent: player(false), pot: game?.pot || 0
  };
}
