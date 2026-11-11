// Browser-only turn routing and private views for a shared-device game.
import { RESOURCE_KEYS, bankAvailable } from './game.js?v=bots1';
export function hotseatSeat(game) {
  if (game.phase === 'robber-discard' && Array.isArray(game.robberDiscards)) {
    for (let offset = 0; offset < game.players.length; offset++) {
      const index = (game.player + offset) % game.players.length;
      if (game.robberDiscards[index] > 0) return index;
    }
  }
  if (game.phase === 'trade-offer' && Number.isInteger(game.tradeOffer?.to)) return game.tradeOffer.to;
  return game.player;
}

export function hotseatRoom(game, names, seat, revision) {
  const view = structuredClone(game);
  if (view.lastSteal && seat !== view.lastSteal.from && seat !== view.lastSteal.to) view.lastSteal.resource = null;
  if (game.ruleset === 'classic') view.bank = Object.fromEntries(RESOURCE_KEYS.map(key => [key, bankAvailable(game, key)]));
  view.devDeckCount = view.devDeck?.length ?? 25;
  delete view.devDeck;
  delete view.botPlans;
  view.players = view.players.map((player, index) => ({
    ...player,
    resourceTotal: Object.values(player.resources).reduce((sum, amount) => sum + amount, 0),
    devCardCount: player.devCards?.length ?? 0,
    resources: index === seat ? player.resources : null,
    devCards: index === seat ? (player.devCards || []) : null,
  }));
  return {
    id: 'LOCAL', local: true, ruleset: game.ruleset || 'new', mapGeneration: game.mapGeneration || (game.layout ? 'random' : 'fixed'), revision, me: seat, host: true,
    status: game.winner === null ? 'playing' : 'finished',
    members: names.map((name, index) => ({ id: `local-${index}`, name, host: index === 0, online: true,
      ...(game.players[index].botLevel ? { botLevel: game.players[index].botLevel } : {}) })),
    game: view,
  };
}
