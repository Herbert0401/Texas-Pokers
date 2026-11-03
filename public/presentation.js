const PokerPresentation = (() => {
  function settledBankroll(player, game) {
    const settled = game?.result || game?.street === "handOver";
    return player.chips + (settled ? 0 : player.totalBet || 0);
  }

  function settlementFrames(previous, next) {
    const before = previous?.game;
    const after = next?.game;
    if (!before || !after?.result || before.result || before.handNumber !== after.handNumber
      || previous.roomCode !== next.roomCode || previous.you !== next.you
      || after.result.type === 'fold') return [];

    const players = after.players.map(player => {
      const old = before.players.find(item => item.id === player.id);
      return { ...player, chips: old.chips - (player.totalBet - old.totalBet),
        holeCards: old.holeCards, evaluation: null, isTurn: false };
    });
    const game = { ...after, players, history: before.history,
      pot: players.reduce((sum, player) => sum + player.totalBet, 0),
      result: null, gameOver: false, canAct: false, canNextHand: false, canRestart: false, actionSeat: null };
    const frames = [];
    const contributed = after.players.some(player => player.totalBet > before.players.find(old => old.id === player.id).totalBet);
    if (contributed) frames.push({ duration: 1700, state: { ...next, game: {
      ...game, community: before.community, street: before.street, presentation: "筹码入池"
    } } });

    // Keep the authoritative result untouched; these frames only delay its presentation.
    const counts = [3, 4, 5].filter(count => count > before.community.length && count <= after.community.length);
    if (!counts.length) counts.push(after.community.length);
    for (const count of counts) {
      frames.push({ duration: 1000, state: { ...next, game: {
        ...game, community: after.community.slice(0, count),
        street: { 3: "flop", 4: "turn", 5: "river" }[count] || before.street,
        presentation: "摊牌中", players: players.map((player, i) => ({ ...player, holeCards: after.players[i].holeCards }))
      } } });
    }
    return frames;
  }
  return { settledBankroll, settlementFrames };
})();

if (typeof module !== "undefined") module.exports = PokerPresentation;
