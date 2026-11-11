const SIZE = 72;
const CENTER = { x: 380, y: 345 };
const TYPES = {
  wood: { name: 'Дерево', genitive: 'дерева', accusative: 'дерево', short: 'Д', icon: '♠', color: '#4c8060' },
  brick: { name: 'Кирпичи', genitive: 'кирпичей', accusative: 'кирпичи', short: 'К', icon: '▰', color: '#c87757' },
  wheat: { name: 'Пшеница', genitive: 'пшеницы', accusative: 'пшеницу', short: 'П', icon: '✳', color: '#e5be64' },
  sheep: { name: 'Шерсть', genitive: 'шерсти', accusative: 'шерсть', short: 'Ш', icon: '☁', color: '#a5b775' },
  ore: { name: 'Камень', genitive: 'камня', accusative: 'камень', short: 'К', icon: '◆', color: '#89949a' },
  desert: { name: 'Пустыня', short: '—', icon: '☀', color: '#d1b880' },
};
const RESOURCE_KEYS = ['wood', 'brick', 'wheat', 'sheep', 'ore'];
const COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wheat: 1, sheep: 1 },
  city: { ore: 3, wheat: 2 },
  development: { ore: 1, wheat: 1, sheep: 1 },
};
export function ruForm(count, one, few, many) {
  const lastTwo = Math.abs(count) % 100;
  const last = lastTwo % 10;
  return lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}
const DEVELOPMENT_TYPES = ['knight', 'roads', 'plenty', 'monopoly', 'victory'];
const DEVELOPMENT_DECK = [
  ...Array(14).fill('knight'), ...Array(5).fill('victory'),
  ...Array(2).fill('roads'), ...Array(2).fill('plenty'), ...Array(2).fill('monopoly'),
];
export const VICTORY_POINTS = 10;
export const RULESETS = Object.freeze({
  new: Object.freeze({ id: 'new', name: 'Новые правила', minPlayers: 2, maxPlayers: 4,
    description: 'Одно начальное поселение и готовые ресурсы' }),
  classic: Object.freeze({ id: 'classic', name: 'Классическая игра', minPlayers: 3, maxPlayers: 4,
    description: 'Два поселения и две дороги, ресурсы от второго поселения' }),
});
export const MAP_GENERATIONS = Object.freeze({
  fixed: Object.freeze({ id: 'fixed', name: 'Фиксированная карта', description: 'Одинаковые гексы и числа в каждой партии' }),
  random: Object.freeze({ id: 'random', name: 'Случайная карта', description: 'Гексы, числа и гавани перемешиваются перед каждой партией' }),
});
export function rulesetOf(id) {
  if (!Object.hasOwn(RULESETS, id)) throw new Error('Неизвестный набор правил.');
  return RULESETS[id];
}
export function mapGenerationOf(id) {
  if (!Object.hasOwn(MAP_GENERATIONS, id)) throw new Error('Неизвестный вариант генерации карты.');
  return MAP_GENERATIONS[id];
}
const isClassic = state => state.ruleset === 'classic';
function shuffledDeck(randomIndex) {
  const deck = [...DEVELOPMENT_DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('Ошибка перемешивания карт.');
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function randomizer(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function makeBoard() {
  const random = randomizer(81);
  const terrain = shuffle(['wood','wood','wood','wood','sheep','sheep','sheep','sheep','wheat','wheat','wheat','wheat','brick','brick','brick','ore','ore','ore','desert'], random);
  const numbers = shuffle([2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12], random);
  const tiles = [];
  const vertices = [];
  const edges = [];
  const vertexMap = new Map();
  const edgeMap = new Map();
  for (let row = -2; row <= 2; row++) {
    for (let q = Math.max(-2, -row - 2); q <= Math.min(2, -row + 2); q++) {
      const x = CENTER.x + Math.sqrt(3) * SIZE * (q + row / 2);
      const y = CENTER.y + 1.5 * SIZE * row;
      const corners = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (-90 + i * 60);
        const vx = x + SIZE * Math.cos(angle);
        const vy = y + SIZE * Math.sin(angle);
        const key = `${Math.round(vx * 100)},${Math.round(vy * 100)}`;
        if (!vertexMap.has(key)) {
          vertexMap.set(key, vertices.length);
          vertices.push({ x: vx, y: vy, tiles: [], edges: [] });
        }
        const index = vertexMap.get(key);
        corners.push(index);
        vertices[index].tiles.push(tiles.length);
      }
      for (let i = 0; i < 6; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 6];
        const key = [a, b].sort((m, n) => m - n).join('-');
        if (!edgeMap.has(key)) {
          edgeMap.set(key, edges.length);
          edges.push({ a, b });
          vertices[a].edges.push(edges.length - 1);
          vertices[b].edges.push(edges.length - 1);
        }
      }
      const type = terrain[tiles.length];
      tiles.push({ x, y, corners, type, number: type === 'desert' ? null : numbers.shift() });
    }
  }
  const edgeTileCounts = Array(edges.length).fill(0);
  for (const tile of tiles) {
    for (let i = 0; i < 6; i++) {
      const key = [tile.corners[i], tile.corners[(i + 1) % 6]].sort((a, b) => a - b).join('-');
      edgeTileCounts[edgeMap.get(key)]++;
    }
  }
  const coastalEdges = edges.map((edge, index) => edgeTileCounts[index] === 1 ? index : null).filter(index => index !== null);
  const angle = point => Math.atan2(point.y - CENTER.y, point.x - CENTER.x);
  const edgeMidpoint = index => {
    const edge = edges[index], a = vertices[edge.a], b = vertices[edge.b];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  coastalEdges.sort((a, b) => angle(edgeMidpoint(a)) - angle(edgeMidpoint(b)));
  const coastVertices = [...new Set(coastalEdges.flatMap(index => [edges[index].a, edges[index].b]))]
    .sort((a, b) => angle(vertices[a]) - angle(vertices[b]));
  const portTypes = ['generic', 'wood', 'brick', 'generic', 'wheat', 'sheep', 'generic', 'ore', 'generic'];
  const portPositions = [1, 4, 7, 11, 14, 17, 21, 24, 27];
  const ports = portPositions.map((position, index) => {
    const edge = coastalEdges[position];
    const midpoint = edgeMidpoint(edge);
    const distance = Math.hypot(midpoint.x - CENTER.x, midpoint.y - CENTER.y);
    return { edge, type: portTypes[index], x: midpoint.x + 26 * (midpoint.x - CENTER.x) / distance,
      y: midpoint.y + 26 * (midpoint.y - CENTER.y) / distance };
  });
  return { tiles, vertices, edges, coastalEdges, coastVertices, ports };
}

const board = makeBoard();

export { SIZE, CENTER, TYPES, RESOURCE_KEYS, COSTS, DEVELOPMENT_TYPES, board };

const TERRAIN_POOL = ['wood','wood','wood','wood','sheep','sheep','sheep','sheep',
  'wheat','wheat','wheat','wheat','brick','brick','brick','ore','ore','ore','desert'];
const NUMBER_POOL = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
const PORT_POOL = ['generic','generic','generic','generic', ...RESOURCE_KEYS];
const sameCounts = (values, expected) => {
  if (!Array.isArray(values) || values.length !== expected.length) return false;
  const count = list => list.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
  const actual = count(values);
  return [...count(expected)].every(([key, amount]) => actual.get(key) === amount);
};
const neighbors = board.tiles.map((tile, index) => board.tiles.map((other, otherIndex) =>
  otherIndex !== index && tile.corners.filter(corner => other.corners.includes(corner)).length === 2 ? otherIndex : null)
  .filter(value => value !== null));

export function validBoardLayout(layout) {
  if (!layout || !Array.isArray(layout.tiles) || layout.tiles.length !== board.tiles.length) return false;
  const types = layout.tiles.map(tile => tile?.type);
  const numbers = layout.tiles.filter(tile => tile?.type !== 'desert').map(tile => tile?.number);
  return sameCounts(types, TERRAIN_POOL) && sameCounts(numbers, NUMBER_POOL) &&
    layout.tiles.every(tile => tile && (tile.type === 'desert') === (tile.number === null)) &&
    layout.tiles.every((tile, index) => ![6, 8].includes(tile.number) ||
      neighbors[index].every(other => ![6, 8].includes(layout.tiles[other].number))) &&
    sameCounts(layout.ports, PORT_POOL);
}

function shuffleWithIndex(values, randomIndex) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('Ошибка перемешивания карты.');
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function newBoardLayout(randomIndex) {
  const types = shuffleWithIndex(TERRAIN_POOL, randomIndex);
  const available = shuffleWithIndex(board.tiles.map((_, index) => index).filter(index => types[index] !== 'desert'), randomIndex);
  const hot = [];
  function chooseHot(start) {
    if (hot.length === 4) return true;
    for (let i = start; i < available.length; i++) {
      const index = available[i];
      if (hot.some(other => neighbors[index].includes(other))) continue;
      hot.push(index);
      if (chooseHot(i + 1)) return true;
      hot.pop();
    }
    return false;
  }
  if (!chooseHot(0)) throw new Error('Не удалось расставить числа на карте.');
  const tiles = types.map(type => ({ type, number: null }));
  shuffleWithIndex([6,6,8,8], randomIndex).forEach((number, index) => { tiles[hot[index]].number = number; });
  const remaining = shuffleWithIndex(NUMBER_POOL.filter(number => number !== 6 && number !== 8), randomIndex);
  available.filter(index => !hot.includes(index)).forEach((index, position) => { tiles[index].number = remaining[position]; });
  return { tiles, ports: shuffleWithIndex(PORT_POOL, randomIndex) };
}

const boardCache = new WeakMap();
export function boardFor(game) {
  const layout = game?.layout;
  if (!layout) return board;
  if (boardCache.has(layout)) return boardCache.get(layout);
  const result = { ...board,
    tiles: board.tiles.map((tile, index) => ({ ...tile, ...layout.tiles[index] })),
    ports: board.ports.map((port, index) => ({ ...port, type: layout.ports[index] })) };
  boardCache.set(layout, result);
  return result;
}

function historyBaseline(state) {
  const encodeOwners = owners => owners.map(owner => owner === null ? '-' : owner).join('');
  return {
    type: 'baseline', actor: state.player,
    owner: encodeOwners(state.owner), roads: encodeOwners(state.roads),
    city: state.city.map(built => built ? '1' : '0').join(''),
    robberTile: state.robberTile, player: state.player, round: state.round,
    dice: [...state.dice], winner: state.winner, label: 'История доступна с этого момента',
  };
}
function historyEvent(state, actor, action, label, rollProduction) {
  const event = { type: action.type, actor, player: state.player, round: state.round, label };
  if (['settlement', 'road', 'city', 'move-robber'].includes(action.type)) event.index = action.index;
  if (action.type === 'roll') {
    event.dice = [...state.dice];
    event.production = rollProduction;
  }
  if (state.winner !== null) event.winner = state.winner;
  return event;
}

export function replayBoardAt(game, index) {
  const events = game.history;
  if (!Array.isArray(events) || index < 0 || index >= events.length) return null;
  const owners = encoded => [...encoded].map(value => value === '-' ? null : Number(value));
  let owner = Array(board.vertices.length).fill(null);
  let roads = Array(board.edges.length).fill(null);
  let city = Array(board.vertices.length).fill(false);
  let robberTile = boardFor(game).tiles.findIndex(tile => tile.type === 'desert');
  let dice = [null, null];
  let production = [];
  let winner = null;
  let player = events[0].player;
  let round = events[0].round;
  for (let step = 0; step <= index; step++) {
    const event = events[step];
    if (event.type === 'baseline') {
      owner = owners(event.owner);
      roads = owners(event.roads);
      city = [...event.city].map(value => value === '1');
      robberTile = event.robberTile;
      dice = [...event.dice];
      production = [];
      winner = event.winner;
    } else if (event.type === 'settlement') owner[event.index] = event.actor;
    else if (event.type === 'road') roads[event.index] = event.actor;
    else if (event.type === 'city') city[event.index] = true;
    else if (event.type === 'move-robber') robberTile = event.index;
    else if (event.type === 'roll') { dice = [...event.dice]; production = event.production || []; }
    else if (event.type === 'end') { dice = [null, null]; production = []; }
    player = event.player;
    round = event.round;
    if (event.winner !== undefined) winner = event.winner;
  }
  return { owner, roads, city, robberTile, dice, production, winner, player, round };
}

export function freshGame(players, randomIndex = count => Math.floor(Math.random() * count), ruleset = 'new', mapGeneration = 'fixed') {
  const selected = rulesetOf(ruleset);
  mapGenerationOf(mapGeneration);
  if (players.length < selected.minPlayers || players.length > selected.maxPlayers) throw new Error(`Для набора «${selected.name}» нужны от ${selected.minPlayers} до ${selected.maxPlayers} игроков.`);
  const startingPlayer = ruleset === 'classic' ? randomIndex(players.length) : 0;
  if (!Number.isInteger(startingPlayer) || startingPlayer < 0 || startingPlayer >= players.length) throw new Error('Ошибка выбора первого игрока.');
  const layout = mapGeneration === 'random' ? newBoardLayout(randomIndex) : undefined;
  const tiles = layout?.tiles || board.tiles;
  const game = {
    ruleset,
    mapGeneration,
    ...(layout ? { layout } : {}),
    players: players.map(({ id, name, botLevel }) => ({ id, name, ...(botLevel ? { botLevel } : {}), resources: ruleset === 'classic' ? { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 } : { wood: 2, brick: 2, wheat: 2, sheep: 2, ore: 1 }, devCards: [], knightsPlayed: 0 })),
    owner: Array(board.vertices.length).fill(null),
    city: Array(board.vertices.length).fill(false),
    roads: Array(board.edges.length).fill(null),
    botPlans: Array(players.length).fill(null),
    player: startingPlayer, phase: 'setup', round: 1, rolled: false, dice: [null, null], rollCounts: Array(13).fill(0), dieCounts: Array(7).fill(0), lastProduction: [], winner: null,
    robberTile: tiles.findIndex(tile => tile.type === 'desert'), robberDiscards: null, robberVictims: [], robberSource: null, lastSteal: null, tradeOffer: null,
    devDeck: shuffledDeck(randomIndex), devPlayed: false, pendingKnight: false, turnNumber: 0, freeRoads: 0, largestArmy: null, longestRoad: null,
    ...(ruleset === 'classic' ? { setupPlacements: Array(players.length).fill(0), setupVertex: null, setupRound: 1, setupStart: startingPlayer } : {}),
    log: [ruleset === 'classic' ? 'Партия началась. Каждый игрок ставит поселение и дорогу; второй круг идёт в обратном порядке.' : 'Партия началась. Каждый игрок выбирает первое поселение.'],
  };
  game.history = [{ type: 'start', actor: startingPlayer, player: startingPlayer, round: 1, label: 'Начало партии' }];
  return game;
}

export function score(state, player) {
  const cards = state.players[player]?.devCards;
  const victory = Array.isArray(cards) ? cards.filter(card => card.type === 'victory').length : (state.players[player]?.revealedVictoryPoints || 0);
  return state.owner.reduce((sum, owner, index) => sum + (owner === player ? (state.city[index] ? 2 : 1) : 0), 0)
    + victory + (state.largestArmy === player ? 2 : 0) + (state.longestRoad === player ? 2 : 0);
}
// A road may use each edge once; a rival's settlement ends the route at its vertex.
export function longestRoadLength(state, player) {
  const adjacency = new Map();
  state.roads.forEach((owner, edgeId) => {
    if (owner !== player) return;
    const { a, b } = board.edges[edgeId];
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push([edgeId, b]);
    adjacency.get(b).push([edgeId, a]);
  });
  let longest = 0;
  const used = new Set();
  function visit(vertex, length) {
    if (length > longest) longest = length;
    if (length && state.owner[vertex] !== null && state.owner[vertex] !== player) return;
    for (const [edgeId, next] of adjacency.get(vertex) || []) {
      if (used.has(edgeId)) continue;
      used.add(edgeId);
      visit(next, length + 1);
      used.delete(edgeId);
    }
  }
  for (const vertex of adjacency.keys()) visit(vertex, 0);
  return longest;
}

export function refreshLongestRoad(state) {
  const lengths = state.players.map((_, player) => longestRoadLength(state, player));
  const best = Math.max(...lengths);
  const previous = state.longestRoad ?? null;
  const leaders = lengths.map((length, player) => length === best ? player : null).filter(player => player !== null);
  state.longestRoad = best < 5 ? null : leaders.includes(previous) ? previous : leaders.length === 1 ? leaders[0] : null;
  return { previous, current: state.longestRoad, lengths };
}
export function canPay(resources, cost) {
  return !!resources && Object.entries(cost).every(([key, amount]) => resources[key] >= amount);
}
export function harborRate(state, player, resource) {
  if (!RESOURCE_KEYS.includes(resource)) return 4;
  let rate = 4;
  for (const port of boardFor(state).ports) {
    const edge = board.edges[port.edge];
    if (state.owner[edge.a] !== player && state.owner[edge.b] !== player) continue;
    if (port.type === resource) return 2;
    if (port.type === 'generic') rate = 3;
  }
  return rate;
}
function pay(state, cost) {
  for (const [key, amount] of Object.entries(cost)) state.players[state.player].resources[key] -= amount;
}
export function pieceSupply(state, player, type) {
  const used = type === 'road'
    ? state.roads.filter(owner => owner === player).length
    : state.owner.reduce((total, owner, index) => total + (owner === player && !!state.city[index] === (type === 'city') ? 1 : 0), 0);
  const limit = isClassic(state) ? { settlement: 5, city: 4, road: 15 }[type] : null;
  return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
}
export function canSettle(state, index) {
  if (!Number.isInteger(index) || !board.vertices[index] || state.owner[index] !== null) return false;
  const vertex = board.vertices[index];
  if (vertex.edges.some(edgeId => {
    const edge = board.edges[edgeId];
    return state.owner[edge.a === index ? edge.b : edge.a] !== null;
  })) return false;
  if (state.phase === 'setup') return true;
  return state.phase === 'turn' && state.rolled && pieceSupply(state, state.player, 'settlement').remaining !== 0
    && vertex.edges.some(edge => state.roads[edge] === state.player) && canPay(state.players[state.player].resources, COSTS.settlement);
}
export function canRoad(state, index) {
  if (state.phase === 'setup-road' && isClassic(state)) {
    if (!Number.isInteger(index) || !board.edges[index] || state.roads[index] !== null) return false;
    const edge = board.edges[index];
    return edge.a === state.setupVertex || edge.b === state.setupVertex;
  }
  const free = state.phase === 'dev-road' && state.freeRoads > 0;
  if (!Number.isInteger(index) || !board.edges[index] || (!free && (state.phase !== 'turn' || !state.rolled || !canPay(state.players[state.player].resources, COSTS.road))) || state.roads[index] !== null) return false;
  if (pieceSupply(state, state.player, 'road').remaining === 0) return false;
  const edge = board.edges[index];
  return [edge.a, edge.b].some(vertex => state.owner[vertex] === state.player || (state.owner[vertex] === null && board.vertices[vertex].edges.some(other => state.roads[other] === state.player)));
}
export function canCity(state, index) {
  return Number.isInteger(index) && !!board.vertices[index] && state.phase === 'turn' && state.rolled && state.owner[index] === state.player && !state.city[index]
    && pieceSupply(state, state.player, 'city').remaining !== 0
    && canPay(state.players[state.player].resources, COSTS.city);
}

// Online rooms call this on the server; shared-device games call it with a local full state.
const resourceTotal = resources => RESOURCE_KEYS.reduce((sum, key) => sum + resources[key], 0);
export const bankAvailable = (state, resource) => 19 - state.players.reduce((sum, player) => sum + player.resources[resource], 0);
function transferVector(value, resources) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !RESOURCE_KEYS.includes(key))) throw new Error('Некорректный набор ресурсов.');
  const result = {};
  for (const key of RESOURCE_KEYS) {
    const amount = value[key] ?? 0;
    if (!Number.isInteger(amount) || amount < 0 || amount > 100 || (resources && amount > resources[key])) throw new Error('Недостаточно ресурсов или некорректное количество.');
    result[key] = amount;
  }
  return result;
}
const vectorTotal = vector => RESOURCE_KEYS.reduce((sum, key) => sum + vector[key], 0);
function transfer(from, to, vector) {
  for (const key of RESOURCE_KEYS) { from[key] -= vector[key]; to[key] += vector[key]; }
}
export function applyAction(current, actor, action, die, randomIndex = count => Math.floor(Math.random() * count)) {
  if (!Number.isInteger(actor) || !current.players[actor]) throw new Error('Игрок не найден.');
  const otherPlayerAction = action.type === 'discard' || action.type === 'accept-trade' || action.type === 'reject-trade' || action.type === 'counter-trade' || action.type === 'cancel-trade';
  if (!otherPlayerAction && actor !== current.player) throw new Error('Сейчас ход другого игрока.');
  if (current.winner !== null) throw new Error('Партия уже завершена.');
  const state = structuredClone(current);
  const player = state.players[actor];
  const addLog = message => { state.log.unshift(message); state.log = state.log.slice(0, 12); };
  const rollProduction = [];
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const updateRoadAward = () => {
    const { previous, current, lengths } = refreshLongestRoad(state);
    if (current !== previous) {
      if (current !== null) addLog(`${state.players[current].name} получил «Самый длинный тракт» (${lengths[current]} дорог, +2 очка).`);
      else addLog('Награда «Самый длинный тракт» больше никому не принадлежит.');
    }
  };
  if (state.longestRoad === undefined) updateRoadAward();
  switch (action.type) {
    case 'settlement':
      ensure(canSettle(state, action.index), 'Здесь нельзя построить поселение.');
      if (state.phase !== 'setup') pay(state, COSTS.settlement);
      state.owner[action.index] = actor;
      addLog(`${player.name} построил поселение.`);
      updateRoadAward();
      if (state.phase === 'setup') {
        if (isClassic(state)) {
          state.setupPlacements[actor]++;
          state.setupVertex = action.index;
          state.phase = 'setup-road';
        } else {
          state.player = (actor + 1) % state.players.length;
          if (state.player === 0) { state.phase = 'turn'; addLog('Подготовка завершена. Можно бросать кубики.'); }
        }
      }
      break;
    case 'road':
      ensure(canRoad(state, action.index), 'Здесь нельзя построить дорогу.');
      if (state.phase === 'setup-road') {
        state.roads[action.index] = actor;
        if (state.setupRound === 2) {
          for (const tile of boardFor(state).tiles) {
            if (!tile.corners.includes(state.setupVertex) || tile.type === 'desert') continue;
            player.resources[tile.type]++;
          }
          addLog(`${player.name} получил начальные ресурсы от второго поселения.`);
        }
        state.setupVertex = null;
        const lastFirstRound = (state.setupStart + state.players.length - 1) % state.players.length;
        if (state.setupRound === 1) {
          if (actor === lastFirstRound) state.setupRound = 2;
          else state.player = (actor + 1) % state.players.length;
        } else if (actor === state.setupStart) {
          state.phase = 'turn';
          addLog('Подготовка завершена. Можно бросать кубики.');
        } else state.player = (actor + state.players.length - 1) % state.players.length;
        if (state.phase !== 'turn') state.phase = 'setup';
        addLog(`${player.name} поставил начальную дорогу.`);
      } else if (state.phase === 'dev-road') {
        state.roads[action.index] = actor;
        state.freeRoads--;
        addLog(`${player.name} построил бесплатную дорогу.`);
        if (!state.freeRoads || !board.edges.some((_, index) => canRoad(state, index))) { state.phase = 'turn'; state.freeRoads = 0; }
      } else {
        pay(state, COSTS.road); state.roads[action.index] = actor;
        addLog(`${player.name} построил дорогу.`);
      }
      updateRoadAward();
      break;
    case 'city':
      ensure(canCity(state, action.index), 'Нельзя улучшить это поселение.');
      pay(state, COSTS.city); state.city[action.index] = true;
      addLog(`${player.name} построил город.`);
      break;
    case 'roll': {
      ensure(state.phase === 'turn' && !state.rolled, 'Кубики уже брошены или ещё идёт подготовка.');
      state.dice = [die(), die()];
      ensure(state.dice.every(value => Number.isInteger(value) && value >= 1 && value <= 6), 'Ошибка броска кубиков.');
      state.rolled = true;
      state.lastProduction = [];
      const total = state.dice[0] + state.dice[1];
      if (!Array.isArray(state.rollCounts)) {
        state.rollCounts = Array(13).fill(0);
        state.rollStatsPartial = true;
      }
      if (!Array.isArray(state.dieCounts)) {
        state.dieCounts = Array(7).fill(0);
        state.rollStatsPartial = true;
      }
      state.rollCounts[total]++;
      for (const value of state.dice) state.dieCounts[value]++;
      const gained = Array(state.players.length).fill(0);
      if (total === 7) {
        state.robberDiscards = state.players.map(person => { const count = resourceTotal(person.resources); return count > 7 ? Math.floor(count / 2) : 0; });
        state.robberSource = 'seven';
        state.phase = state.robberDiscards.some(Boolean) ? 'robber-discard' : 'robber-move';
        addLog(`${player.name}: выпало 7. Игроки с более чем 7 картами сбрасывают половину; затем разбойник перемещается.`);
        break;
      }
      const claims = [];
      for (const [tileIndex, tile] of boardFor(state).tiles.entries()) {
        if (tile.number !== total || tileIndex === (state.robberTile ?? boardFor(state).tiles.findIndex(item => item.type === 'desert'))) continue;
        for (const vertex of tile.corners) {
          const owner = state.owner[vertex];
          if (owner === null) continue;
          const amount = state.city[vertex] ? 2 : 1;
          claims.push({ tileIndex, vertex, player: owner, resource: tile.type, amount });
        }
      }
      const shortages = new Set();
      if (isClassic(state)) for (const resource of RESOURCE_KEYS) {
        const demand = claims.filter(claim => claim.resource === resource).reduce((sum, claim) => sum + claim.amount, 0);
        const recipients = new Set(claims.filter(claim => claim.resource === resource).map(claim => claim.player));
        if (demand > bankAvailable(state, resource) && recipients.size > 1) shortages.add(resource);
      }
      for (const claim of claims) {
        if (shortages.has(claim.resource)) continue;
        const amount = isClassic(state) ? Math.min(claim.amount, Math.max(0, bankAvailable(state, claim.resource))) : claim.amount;
        if (!amount) continue;
        state.players[claim.player].resources[claim.resource] += amount;
        gained[claim.player] += amount;
        rollProduction.push({ tileIndex: claim.tileIndex, vertex: claim.vertex,
          player: claim.player, resource: claim.resource, amount });
        const event = state.lastProduction.find(item => item.tileIndex === claim.tileIndex && item.player === claim.player);
        if (event) event.amount += amount;
        else state.lastProduction.push({ tileIndex: claim.tileIndex, player: claim.player,
          resource: claim.resource, amount });
      }
      const recipients = gained.map((amount, index) => amount ? `${state.players[index].name}: +${amount}` : '').filter(Boolean);
      addLog(`${player.name}: выпало ${total}. ${recipients.length ? recipients.join('; ') : 'Ресурсы не получены.'}`);
      break;
    }
    case 'discard': {
      ensure(state.phase === 'robber-discard' && state.robberDiscards?.[actor] > 0, 'Сейчас вам не нужно сбрасывать карты.');
      const cards = transferVector(action.resources, player.resources);
      ensure(vectorTotal(cards) === state.robberDiscards[actor], `Нужно сбросить ${state.robberDiscards[actor]} ${ruForm(state.robberDiscards[actor], 'карту', 'карты', 'карт')}.`);
      for (const key of RESOURCE_KEYS) player.resources[key] -= cards[key];
      addLog(`${player.name} сбросил ${vectorTotal(cards)} ${ruForm(vectorTotal(cards), 'карту', 'карты', 'карт')}.`);
      state.robberDiscards[actor] = 0;
      if (state.robberDiscards.every(amount => amount === 0)) state.phase = 'robber-move';
      break;
    }
    case 'move-robber': {
      ensure(state.phase === 'robber-move', 'Сейчас нельзя переместить разбойника.');
      ensure(Number.isInteger(action.index) && boardFor(state).tiles[action.index] && action.index !== (state.robberTile ?? boardFor(state).tiles.findIndex(tile => tile.type === 'desert')), 'Выберите другое поле.');
      if (state.pendingKnight) {
        const cardIndex = (player.devCards || []).findIndex(card => card.type === 'knight' && card.boughtOn < (state.turnNumber ?? 0));
        ensure(cardIndex >= 0, 'Карта рыцаря больше недоступна.');
        player.devCards.splice(cardIndex, 1);
        state.devPlayed = true;
        state.pendingKnight = false;
        player.knightsPlayed = (player.knightsPlayed || 0) + 1;
        const holder = state.largestArmy;
        if (player.knightsPlayed >= 3 && (holder == null || player.knightsPlayed > (state.players[holder].knightsPlayed || 0))) {
          state.largestArmy = actor;
          addLog(`${player.name} получил «Самое большое войско» (+2 очка).`);
        }
        addLog(`${player.name} сыграл рыцаря.`);
      }
      state.robberTile = action.index;
      state.robberVictims = [...new Set(boardFor(state).tiles[action.index].corners.map(vertex => state.owner[vertex]))].filter(index => index !== null && index !== actor && resourceTotal(state.players[index].resources) > 0);
      state.phase = state.robberVictims.length ? 'robber-steal' : 'turn';
      if (state.phase === 'turn') { state.robberSource = null; state.robberDiscards = null; }
      addLog(`${player.name} переместил разбойника на поле ${action.index + 1}.`);
      break;
    }
    case 'cancel-knight':
      ensure(state.phase === 'robber-move' && state.robberSource === 'knight' && state.pendingKnight === true, 'Сейчас нельзя отменить рыцаря.');
      state.pendingKnight = false;
      state.robberSource = null;
      state.robberVictims = [];
      state.phase = 'turn';
      break;
    case 'steal': {
      ensure(state.phase === 'robber-steal' && state.robberVictims?.includes(action.victim), 'Выберите игрока у поля с разбойником.');
      const victim = state.players[action.victim];
      const cards = RESOURCE_KEYS.flatMap(key => Array(victim.resources[key]).fill(key));
      ensure(cards.length > 0, 'У игрока больше нет ресурсов.');
      const picked = randomIndex(cards.length);
      ensure(Number.isInteger(picked) && picked >= 0 && picked < cards.length, 'Ошибка выбора карты.');
      const key = cards[picked]; victim.resources[key]--; player.resources[key]++;
      state.lastSteal = { id: (state.lastSteal?.id || 0) + 1, from: action.victim, to: actor, resource: key };
      state.phase = 'turn'; state.robberVictims = []; state.robberDiscards = null; state.robberSource = null;
      addLog(`${player.name} забрал случайную карту у ${victim.name}.`);
      break;
    }
    case 'buy-dev': {
      ensure(state.phase === 'turn' && state.rolled, 'Карту развития можно купить после броска кубиков.');
      if (!Array.isArray(state.devDeck)) state.devDeck = shuffledDeck(randomIndex);
      ensure(state.devDeck.length > 0, 'Карты развития закончились.');
      ensure(canPay(player.resources, COSTS.development), 'Нужны шерсть, пшеница и камень.');
      pay(state, COSTS.development);
      player.devCards ??= [];
      state.turnNumber ??= 0;
      player.devCards.push({ type: state.devDeck.pop(), boughtOn: state.turnNumber });
      addLog(`${player.name} купил карту развития.`);
      break;
    }
    case 'play-dev': {
      ensure(state.phase === 'turn' && !state.devPlayed, 'Сейчас нельзя разыграть карту развития.');
      ensure(DEVELOPMENT_TYPES.includes(action.card) && action.card !== 'victory', 'Выберите карту действия.');
      const cardIndex = (player.devCards || []).findIndex(card => card.type === action.card && card.boughtOn < (state.turnNumber ?? 0));
      ensure(cardIndex >= 0, 'Эту карту нельзя сыграть в текущий ход.');
      if (action.card === 'roads') {
        ensure(board.edges.some((_, index) => canRoad({ ...state, phase: 'dev-road', freeRoads: 2 }, index)), 'Сейчас нет места для новой дороги.');
      }
      if (action.card === 'plenty') {
        ensure(RESOURCE_KEYS.includes(action.first) && RESOURCE_KEYS.includes(action.second), 'Выберите два ресурса.');
        if (isClassic(state)) ensure(bankAvailable(state, action.first) >= (action.first === action.second ? 2 : 1) && bankAvailable(state, action.second) >= 1, 'В банке недостаточно выбранных ресурсов.');
      }
      if (action.card === 'monopoly') ensure(RESOURCE_KEYS.includes(action.resource), 'Выберите ресурс для монополии.');
      if (action.card === 'knight') {
        state.pendingKnight = true;
        state.robberSource = 'knight'; state.phase = 'robber-move';
        break;
      }
      player.devCards.splice(cardIndex, 1);
      state.devPlayed = true;
      if (action.card === 'roads') {
        state.phase = 'dev-road'; state.freeRoads = 2;
        addLog(`${player.name} сыграл «Строительство дорог».`);
      } else if (action.card === 'plenty') {
        player.resources[action.first]++; player.resources[action.second]++;
        addLog(`${player.name} сыграл «Год изобилия» и получил два ресурса.`);
      } else {
        let count = 0;
        for (const [index, other] of state.players.entries()) {
          if (index === actor) continue;
          const amount = other.resources[action.resource];
          other.resources[action.resource] = 0; count += amount;
        }
        player.resources[action.resource] += count;
        addLog(`${player.name} сыграл «Монополию»: ${TYPES[action.resource].name.toLowerCase()}, +${count}.`);
      }
      break;
    }
    case 'finish-dev-road':
      ensure(state.phase === 'dev-road' && state.freeRoads === 1, 'Сначала постройте хотя бы одну дорогу.');
      state.phase = 'turn'; state.freeRoads = 0;
      addLog(`${player.name} завершил строительство дорог.`);
      break;
    case 'offer-trade': {
      ensure(state.phase === 'turn' && state.rolled && !state.tradeOffer, 'Сейчас нельзя предложить обмен.');
      ensure(Number.isInteger(action.to) && state.players[action.to] && action.to !== actor, 'Выберите другого игрока.');
      const give = transferVector(action.give, player.resources);
      const want = transferVector(action.want);
      ensure(vectorTotal(give) + vectorTotal(want) > 0, 'Выберите хотя бы один ресурс для обмена.');
      state.tradeOffer = { from: actor, to: action.to, give, want };
      state.phase = 'trade-offer';
      addLog(`${player.name} предложил обмен игроку ${state.players[action.to].name}.`);
      break;
    }
    case 'accept-trade': {
      const offer = state.tradeOffer;
      ensure(state.phase === 'trade-offer' && offer?.to === actor, 'Этот обмен вам не предложен.');
      ensure(canPay(state.players[offer.from].resources, offer.give) && canPay(player.resources, offer.want), 'Для обмена уже не хватает ресурсов.');
      transfer(state.players[offer.from].resources, player.resources, offer.give);
      transfer(player.resources, state.players[offer.from].resources, offer.want);
      state.tradeOffer = null; state.phase = 'turn';
      addLog(`${player.name} принял обмен от ${state.players[offer.from].name}.`);
      break;
    }
    case 'counter-trade': {
      const offer = state.tradeOffer;
      ensure(state.phase === 'trade-offer' && offer?.to === actor, 'Этот обмен вам не предложен.');
      const give = transferVector(action.give, player.resources);
      const want = transferVector(action.want);
      ensure(vectorTotal(give) + vectorTotal(want) > 0, 'Выберите хотя бы один ресурс для встречного предложения.');
      state.tradeOffer = { from: actor, to: offer.from, give, want };
      addLog(`${player.name} отправил встречное предложение игроку ${state.players[offer.from].name}.`);
      break;
    }
    case 'reject-trade':
      ensure(state.phase === 'trade-offer' && state.tradeOffer?.to === actor, 'Этот обмен вам не предложен.');
      addLog(`${player.name} отклонил обмен.`); state.tradeOffer = null; state.phase = 'turn';
      break;
    case 'cancel-trade':
      ensure(state.phase === 'trade-offer' && state.tradeOffer?.from === actor, 'Нет вашего предложения обмена.');
      addLog(`${player.name} отменил предложение обмена.`); state.tradeOffer = null; state.phase = 'turn';
      break;
    case 'end':
      ensure(state.phase === 'turn' && state.rolled, 'Сначала бросьте кубики.');
      state.player = (actor + 1) % state.players.length;
      if (state.player === (state.setupStart ?? 0)) state.round++;
      state.rolled = false; state.dice = [null, null]; state.lastProduction = [];
      state.turnNumber = (state.turnNumber ?? 0) + 1; state.devPlayed = false;
      addLog(`Ходит ${state.players[state.player].name}.`);
      break;
    case 'trade':
      ensure(state.phase === 'turn' && state.rolled, 'Обмен доступен после броска кубиков.');
      if (action.give || action.want) {
        const give = transferVector(action.give || {}, player.resources);
        const want = transferVector(action.want || {});
        let credits = 0;
        for (const key of RESOURCE_KEYS) {
          const rate = harborRate(state, actor, key);
          ensure(give[key] % rate === 0, `Для обмена ${TYPES[key].genitive} нужны группы по ${rate} карты.`);
          ensure(!give[key] || !want[key], 'Нельзя одновременно отдать и получить один ресурс.');
          credits += give[key] / rate;
          if (isClassic(state)) ensure(want[key] <= bankAvailable(state, key), `В банке не хватает ${TYPES[key].genitive}.`);
        }
        ensure(credits > 0 && vectorTotal(want) === credits, 'Количество получаемых карт должно соответствовать курсу обмена.');
        for (const key of RESOURCE_KEYS) player.resources[key] += want[key] - give[key];
        addLog(`${player.name}: морской обмен — отдал ${vectorTotal(give)}, получил ${credits} ${ruForm(credits, 'карту', 'карты', 'карт')}.`);
        break;
      }
      ensure(RESOURCE_KEYS.includes(action.from) && RESOURCE_KEYS.includes(action.to) && action.from !== action.to, 'Выберите разные ресурсы для обмена.');
      const rate = harborRate(state, actor, action.from);
      ensure(player.resources[action.from] >= rate, `Для обмена нужны ${rate} одинаковых ресурса.`);
      if (isClassic(state)) ensure(bankAvailable(state, action.to) > 0, 'В банке нет выбранного ресурса.');
      player.resources[action.from] -= rate; player.resources[action.to]++;
      addLog(`${player.name}: морской обмен ${rate}:1 — ${TYPES[action.from].name} на ${TYPES[action.to].accusative}.`);
      break;
    default: throw new Error('Неизвестное действие.');
  }
  if (state.phase === 'turn' && score(state, actor) >= VICTORY_POINTS) {
    state.winner = actor;
    player.revealedVictoryPoints = (player.devCards || []).filter(card => card.type === 'victory').length;
    addLog(`${player.name} набрал ${VICTORY_POINTS} очков и победил!`);
  }
  if (!Array.isArray(state.history)) state.history = [historyBaseline(current)];
  state.history.push(historyEvent(state, actor, action,
    state.log[0] !== current.log?.[0] ? state.log[0] : action.type === 'cancel-knight' ? 'Рыцарь не сыгран.' : 'Положение на карте', rollProduction));
  return state;
}
