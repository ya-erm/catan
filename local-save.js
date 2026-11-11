import { board, DEVELOPMENT_TYPES, RESOURCE_KEYS, RULESETS, MAP_GENERATIONS, validBoardLayout } from './game.js?v=bots1';

export const LOCAL_FILE_FORMAT = 'catan-local-game';
export const LOCAL_FILE_VERSION = 1;

const seatIndex = (value, count) => Number.isInteger(value) && value >= 0 && value < count;
const resourceBag = value => value && typeof value === 'object' &&
  RESOURCE_KEYS.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0);
const tradeBag = value => value && typeof value === 'object' &&
  RESOURCE_KEYS.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0);
const replayOwners = (value, count, players) => typeof value === 'string' && value.length === count &&
  [...value].every(owner => owner === '-' || /^[0-3]$/.test(owner) && Number(owner) < players);
const replayTypes = new Set(['start', 'baseline', 'settlement', 'road', 'city', 'roll', 'discard',
  'move-robber', 'cancel-knight', 'steal', 'buy-dev', 'play-dev', 'finish-dev-road',
  'offer-trade', 'accept-trade', 'counter-trade', 'reject-trade', 'cancel-trade', 'end', 'trade']);
const replayDice = dice => Array.isArray(dice) && dice.length === 2 &&
  dice.every(value => value === null || Number.isInteger(value) && value >= 1 && value <= 6);
const replayProduction = (production, players) => Array.isArray(production) && production.length <= 114 &&
  production.every(item => item && seatIndex(item.tileIndex, board.tiles.length) &&
    seatIndex(item.vertex, board.vertices.length) && board.tiles[item.tileIndex].corners.includes(item.vertex) &&
    seatIndex(item.player, players) && RESOURCE_KEYS.includes(item.resource) &&
    Number.isSafeInteger(item.amount) && item.amount >= 1 && item.amount <= 2);
const replayEvent = (frame, players, position) => frame && replayTypes.has(frame.type) &&
  (position !== 0 || frame.type === 'start' || frame.type === 'baseline') &&
  seatIndex(frame.actor, players) && seatIndex(frame.player, players) &&
  Number.isSafeInteger(frame.round) && frame.round >= 1 &&
  typeof frame.label === 'string' && frame.label.length <= 500 &&
  (frame.winner === undefined || frame.winner === null || seatIndex(frame.winner, players)) &&
  (!['settlement', 'city', 'road', 'move-robber'].includes(frame.type) ||
    seatIndex(frame.index, frame.type === 'road' ? board.edges.length : frame.type === 'move-robber' ? board.tiles.length : board.vertices.length)) &&
  (frame.type !== 'roll' || replayDice(frame.dice)) &&
  (frame.production === undefined || frame.type === 'roll' && replayProduction(frame.production, players)) &&
  (frame.type !== 'baseline' || replayOwners(frame.owner, board.vertices.length, players) &&
    replayOwners(frame.roads, board.edges.length, players) &&
    typeof frame.city === 'string' && frame.city.length === board.vertices.length && /^[01]+$/.test(frame.city) &&
    seatIndex(frame.robberTile, board.tiles.length) && replayDice(frame.dice) &&
    (frame.winner === null || seatIndex(frame.winner, players)));

export function normalizeLocalSession(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('В файле нет локальной партии.');
  const { names, game, revision } = candidate;
  if (!Array.isArray(names) || names.length < 2 || names.length > 4 ||
    !names.every(name => typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 24) ||
    !Number.isSafeInteger(revision) || revision < 0 || !game || typeof game !== 'object') {
    throw new Error('Файл партии повреждён или имеет неверный формат.');
  }
  game.ruleset ||= 'new';
  game.mapGeneration ||= game.layout ? 'random' : 'fixed';
  game.botPlans ||= Array(names.length).fill(null);
  const selected = Object.hasOwn(RULESETS, game.ruleset) ? RULESETS[game.ruleset] : null;
  if (!selected || !Object.hasOwn(MAP_GENERATIONS, game.mapGeneration) ||
    names.length < selected.minPlayers || names.length > selected.maxPlayers ||
    (game.mapGeneration === 'fixed' ? game.layout !== undefined : !validBoardLayout(game.layout)) ||
    !Array.isArray(game.players) || game.players.length !== names.length ||
    game.players.every(player => player?.botLevel !== undefined) ||
    !game.players.every((player, index) => player && player.name === names[index] &&
      (player.botLevel === undefined || Number.isInteger(player.botLevel) && player.botLevel >= 1 && player.botLevel <= 3) &&
      resourceBag(player.resources) && Array.isArray(player.devCards) &&
      player.devCards.every(card => card && DEVELOPMENT_TYPES.includes(card.type)) &&
      Number.isSafeInteger(player.knightsPlayed) && player.knightsPlayed >= 0) ||
    !Array.isArray(game.owner) || game.owner.length !== board.vertices.length ||
    !game.owner.every(owner => owner === null || seatIndex(owner, names.length)) ||
    !Array.isArray(game.city) || game.city.length !== board.vertices.length ||
    !game.city.every((city, index) => typeof city === 'boolean' && (!city || game.owner[index] !== null)) ||
    !Array.isArray(game.roads) || game.roads.length !== board.edges.length ||
    !game.roads.every(owner => owner === null || seatIndex(owner, names.length)) ||
    !Array.isArray(game.botPlans) || game.botPlans.length !== names.length ||
    !game.botPlans.every((plan, index) => plan === null || game.players[index]?.botLevel >= 2 &&
      ['expand', 'balance', 'city', 'road', 'army', 'harbor', 'road_rush'].includes(plan.tactic) &&
      (plan.tactic !== 'balance' || game.players[index].botLevel === 3) &&
      (plan.tactic === 'army' ? plan.target === null : seatIndex(plan.target,
        plan.tactic === 'road' ? board.edges.length : board.vertices.length)) &&
      (plan.tactic === 'harbor' ? plan.surplusTarget === undefined ?
        plan.firstTarget === undefined && plan.resource === undefined :
        seatIndex(plan.surplusTarget, board.vertices.length) && plan.surplusTarget !== plan.target &&
        RESOURCE_KEYS.includes(plan.resource) &&
        (plan.firstTarget === plan.target || plan.firstTarget === plan.surplusTarget) :
        plan.surplusTarget === undefined && plan.firstTarget === undefined && plan.resource === undefined) &&
      Number.isSafeInteger(plan.chosenRound) && plan.chosenRound >= 1 && plan.chosenRound <= game.round) ||
    !seatIndex(game.player, names.length) ||
    !['setup', 'setup-road', 'turn', 'robber-discard', 'robber-move', 'robber-steal', 'trade-offer', 'dev-road'].includes(game.phase) ||
    !Number.isSafeInteger(game.round) || game.round < 1 || typeof game.rolled !== 'boolean' ||
    !Array.isArray(game.dice) || game.dice.length !== 2 ||
    !game.dice.every(value => value === null || Number.isInteger(value) && value >= 1 && value <= 6) ||
    !seatIndex(game.robberTile, board.tiles.length) ||
    game.winner !== null && !seatIndex(game.winner, names.length) ||
    !Array.isArray(game.devDeck) || !game.devDeck.every(card => DEVELOPMENT_TYPES.includes(card)) ||
    !Array.isArray(game.log) || !game.log.every(entry => typeof entry === 'string') ||
    game.history !== undefined && (!Array.isArray(game.history) || !game.history.length ||
      !game.history.every((frame, position) => replayEvent(frame, names.length, position))) ||
    !Array.isArray(game.lastProduction) ||
    !game.lastProduction.every(item => item && seatIndex(item.tileIndex, board.tiles.length) &&
      seatIndex(item.player, names.length) && RESOURCE_KEYS.includes(item.resource) &&
      Number.isSafeInteger(item.amount) && item.amount > 0) ||
    game.robberDiscards !== null && (!Array.isArray(game.robberDiscards) || game.robberDiscards.length !== names.length ||
      !game.robberDiscards.every(amount => Number.isSafeInteger(amount) && amount >= 0)) ||
    !Array.isArray(game.robberVictims) || !game.robberVictims.every(value => seatIndex(value, names.length)) ||
    game.phase === 'trade-offer' && (!game.tradeOffer || !seatIndex(game.tradeOffer.from, names.length) ||
      !seatIndex(game.tradeOffer.to, names.length) || !tradeBag(game.tradeOffer.give) || !tradeBag(game.tradeOffer.want)) ||
    game.phase === 'robber-discard' && !Array.isArray(game.robberDiscards) ||
    !Number.isSafeInteger(game.turnNumber) || game.turnNumber < 0 ||
    !Number.isSafeInteger(game.freeRoads) || game.freeRoads < 0 ||
    typeof game.devPlayed !== 'boolean' ||
    game.longestRoad !== null && !seatIndex(game.longestRoad, names.length) ||
    game.largestArmy !== null && !seatIndex(game.largestArmy, names.length) ||
    game.ruleset === 'classic' && (!Array.isArray(game.setupPlacements) || game.setupPlacements.length !== names.length ||
      !game.setupPlacements.every(count => Number.isInteger(count) && count >= 0 && count <= 2) ||
      !Number.isInteger(game.setupRound) || game.setupRound < 1 || game.setupRound > 2 ||
      !seatIndex(game.setupStart, names.length) ||
      game.setupVertex !== null && !seatIndex(game.setupVertex, board.vertices.length) ||
      game.phase === 'setup-road' && game.setupVertex === null)) {
    throw new Error('Файл партии повреждён или несовместим с этой версией игры.');
  }
  const colorOrder = Array.isArray(candidate.colorOrder) && candidate.colorOrder.length === 4 &&
    new Set(candidate.colorOrder).size === 4 && candidate.colorOrder.every(color => Number.isInteger(color) && color >= 0 && color < 8)
    ? candidate.colorOrder : [0, 1, 2, 3];
  return { names, game, revision, colorOrder };
}

export function serializeLocalFile(session) {
  return JSON.stringify({ format: LOCAL_FILE_FORMAT, version: LOCAL_FILE_VERSION,
    exportedAt: new Date().toISOString(), session: normalizeLocalSession(session) }, null, 2);
}

export function parseLocalFile(text) {
  let file;
  try { file = JSON.parse(text); }
  catch { throw new Error('Не удалось прочитать JSON-файл партии.'); }
  if (file?.format !== LOCAL_FILE_FORMAT) throw new Error('Это не файл локальной партии Catan.');
  if (file.version !== LOCAL_FILE_VERSION) throw new Error('Версия файла не поддерживается этой игрой.');
  return normalizeLocalSession(file.session);
}
