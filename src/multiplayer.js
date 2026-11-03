const { compareEvaluations } = require('./poker');

function nextSeat(players, afterSeat, eligible = () => true) {
  const ordered = players.filter(eligible).slice().sort((a, b) => a.seat - b.seat);
  return (ordered.find(player => player.seat > afterSeat) || ordered[0])?.seat ?? null;
}

function canRaise(game, player) {
  const actedAt = player?.lastActedBet ?? player?.bet ?? 0;
  return Boolean(player && !player.folded && !player.allIn && player.chips > 0
    && game.players.some(other => other.seat !== player.seat && !other.folded && !other.allIn)
    && (!player.hasActed || actedAt === 0 || game.currentBet - actedAt >= game.minRaise));
}

function settlePots(game) {
  const active = game.players.filter(player => !player.folded);
  const winnings = new Map();
  const pots = [];
  const refunds = [];
  const bestPlayers = (players) => {
    if (players.length === 1) return players;
    const best = players.reduce((a, b) => compareEvaluations(a.evaluation, b.evaluation) >= 0 ? a : b);
    return players.filter(player => compareEvaluations(player.evaluation, best.evaluation) === 0);
  };
  const levels = [...new Set(game.players.map(player => player.totalBet).filter(Boolean))].sort((a, b) => a - b);
  let previous = 0;
  for (const level of levels) {
    const contributors = game.players.filter(player => player.totalBet >= level);
    const amount = (level - previous) * contributors.length;
    previous = level;
    if (contributors.length === 1) {
      const player = contributors[0];
      player.chips += amount;
      player.totalBet -= amount;
      player.bet = Math.max(0, player.bet - amount);
      refunds.push({ seat: player.seat, name: player.name, amount });
      continue;
    }
    const eligible = contributors.filter(player => !player.folded);
    const winners = bestPlayers(eligible.length ? eligible : active).sort((a, b) => {
      const order = seat => seat > game.dealerSeat ? seat : seat + 6;
      return order(a.seat) - order(b.seat);
    });
    const share = Math.floor(amount / winners.length);
    const remainder = amount % winners.length;
    const awards = winners.map((player, i) => {
      const award = share + (i < remainder ? 1 : 0);
      player.chips += award;
      winnings.set(player.seat, (winnings.get(player.seat) || 0) + award);
      return { seat: player.seat, name: player.name, amount: award, hand: player.evaluation?.label };
    });
    pots.push({ amount, winners: awards });
  }
  if (!pots.length) for (const player of bestPlayers(active)) winnings.set(player.seat, 0);
  return { pots, refunds, winners: [...winnings].map(([seat, amount]) => {
    const player = game.players.find(item => item.seat === seat);
    return { seat, name: player.name, amount, hand: player.evaluation?.label };
  }) };
}

module.exports = { nextSeat, canRaise, settlePots };
