export function stackHeight(chips, denomination = 100) {
  return chips > 0 ? Math.min(12, Math.floor(chips / denomination)) : 0;
}

export function chipValues(amount, mixed = false) {
  const values = [];
  let remaining = Math.max(0, Math.floor(amount));
  if (mixed) {
    for (const [value, limit] of [[10, 5], [50, 3]]) {
      const count = Math.min(limit, Math.floor(remaining / value));
      values.push(...Array(count).fill(value));
      remaining -= count * value;
    }
  }
  for (const value of [100, 50, 10, 1]) {
    values.push(...Array(Math.floor(remaining / value)).fill(value));
    remaining %= value;
  }
  return values.sort((a, b) => b - a);
}

export function wagerChanges(previous, next) {
  if (!previous || !next.hand || previous.hand !== next.hand) return [];
  if (next.players && previous.players) return next.players.flatMap(player => {
    const old = previous.players.find(item => item.id === player.id);
    const amount = old ? player.totalBet - old.totalBet : 0;
    return amount > 0 ? [{ player: player.id, amount }] : [];
  });
  return ['hero', 'opponent'].flatMap((player) => {
    const amount = next[player].totalBet - previous[player].totalBet;
    return amount > 0 ? [{ player, amount }] : [];
  });
}

export function tableView(state) {
  const game = state?.game;
  const player = (seat) => {
    return { id: seat?.id ?? (seat?.isYou ? 'hero' : 'opponent'), seat: seat?.seat ?? 0,
      isYou: Boolean(seat?.isYou || seat?.id && seat.id === state?.you),
      cards: seat?.waiting ? [] : seat?.holeCards || [null, null], chips: seat?.chips ?? 0,
      bet: seat?.bet || 0, totalBet: seat?.totalBet || 0, dealer: Boolean(seat?.dealer), folded: Boolean(seat?.folded) };
  };
  const roster = (game?.players || []).filter(seat => !seat.left).map(player);
  for (const seat of state?.players || []) {
    if (!roster.some(item => item.id === seat.id)) roster.push(player({ ...seat, waiting: true }));
  }
  const hero = roster.find(item => item.isYou) || player();
  const order = seat => seat >= hero.seat ? seat - hero.seat : seat - hero.seat + 6;
  roster.sort((a, b) => order(a.seat) - order(b.seat));
  return {
    preview: !state,
    hand: game?.handNumber || 0,
    board: !state ? ['A', 'K', 'Q', 'J', 'T'].map((rank) => ({ rank, suit: 'spades' }))
      : Array.from({ length: 5 }, (_, i) => game?.community[i] || null),
    players: roster, hero, opponent: roster.find(item => !item.isYou) || player(), pot: game?.pot || 0
  };
}

export function seatLayout(index, count) {
  const layouts = {
    3: [[0, 2.5], [-3.5, -1.65], [3.5, -1.65]],
    4: [[0, 2.5], [-4.05, 0], [0, -2.5], [4.05, 0]],
    5: [[0, 2.5], [-4, 0.8], [-2.65, -2.5], [2.65, -2.5], [4, 0.8]],
    6: [[0, 2.5], [-4, 1], [-3, -2.15], [0, -2.6], [3, -2.15], [4, 1]]
  };
  const [x, z] = (layouts[count] || layouts[6])[index];
  return { x, z };
}
