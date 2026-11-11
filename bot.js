import { board, boardFor, RESOURCE_KEYS, COSTS, canSettle, canRoad, canCity, canPay, harborRate, bankAvailable, pieceSupply, longestRoadLength, applyAction } from './game.js?v=bot-tactics1';

const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const LEVELS = [1, 2, 3];
export const validBotLevel = value => LEVELS.includes(value);
const pick = (items, random) => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
const count = (bag, key) => bag[key] || 0;
const resourceTotal = bag => RESOURCE_KEYS.reduce((sum, key) => sum + count(bag, key), 0);
const playerBotLevel = (game, index) => game.players[index]?.botLevel;

export function nextBotSeat(game) {
  if (!game || game.winner !== null) return null;
  if (game.phase === 'robber-discard') {
    const index = game.robberDiscards?.findIndex((amount, seat) => amount > 0 && validBotLevel(playerBotLevel(game, seat)));
    if (index >= 0) return index;
    if (game.robberDiscards?.some(Boolean)) return null;
  }
  if (game.phase === 'trade-offer') return validBotLevel(playerBotLevel(game, game.tradeOffer?.to)) ? game.tradeOffer.to : null;
  return validBotLevel(playerBotLevel(game, game.player)) ? game.player : null;
}

function vertexValue(game, index, level) {
  const terrain = boardFor(game).tiles;
  const resources = new Set();
  let value = 0;
  for (const tileIndex of board.vertices[index].tiles) {
    const tile = terrain[tileIndex];
    if (tile.type === 'desert') continue;
    resources.add(tile.type);
    value += (PIPS[tile.number] || 0) * (level === 3 && ['wheat', 'ore'].includes(tile.type) ? 1.18 : 1);
    if (tileIndex === game.robberTile) value -= 1.5;
  }
  if (level >= 2) value += resources.size * .7;
  if (level >= 2) {
    // An isolated high-pip ore field is a poor first settlement if it cannot fund expansion.
    const produced = board.vertices[index].tiles.map(tileIndex => terrain[tileIndex].type);
    if (produced.includes('wood')) value += 1.5;
    if (produced.includes('brick')) value += 1.5;
    if (produced.includes('wheat')) value += 1;
    if (produced.includes('sheep')) value += .7;
  }
  if (level === 3) for (const port of boardFor(game).ports) {
    const edge = board.edges[port.edge];
    if (edge.a === index || edge.b === index) value += port.type === 'generic' ? 1.2 : 1;
  }
  return value;
}

function vertexProduction(game, index) {
  const production = { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 };
  for (const tileIndex of board.vertices[index].tiles) {
    const tile = boardFor(game).tiles[tileIndex];
    if (production[tile.type] !== undefined) production[tile.type] += PIPS[tile.number] || 0;
  }
  return production;
}

function playerProduction(game, actor) {
  const production = { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 };
  game.owner.forEach((owner, index) => {
    if (owner !== actor) return;
    const vertex = vertexProduction(game, index);
    for (const resource of RESOURCE_KEYS) production[resource] += vertex[resource] * (game.city[index] ? 2 : 1);
  });
  return production;
}

function balanceProductionGain(current, site) {
  // Diminishing returns make a second productive field of a scarce resource more
  // valuable than another field of a resource the player already receives often.
  return RESOURCE_KEYS.reduce((gain, key) => {
    const priority = key === 'wood' || key === 'brick' ? 1.25 : 1;
    return gain + priority * 4 * (Math.sqrt(current[key] + site[key] + 1) - Math.sqrt(current[key] + 1));
  }, 0);
}

function openingExpansionValue(game, owner, first, second) {
  const projected = { ...game, owner: [...owner] };
  projected.owner[second] = game.player;
  let best = 0;
  for (const origin of [first, second]) for (const edge of board.vertices[origin].edges) {
    const link = board.edges[edge];
    const neighbor = link.a === origin ? link.b : link.a;
    if (projected.owner[neighbor] !== null) continue;
    for (const nextEdge of board.vertices[neighbor].edges) {
      const nextLink = board.edges[nextEdge];
      const site = nextLink.a === neighbor ? nextLink.b : nextLink.a;
      if (openVertex(projected, site)) best = Math.max(best, vertexValue(game, site, 3));
    }
  }
  return best;
}

function openingPairScores(game, first, second, owner) {
  const supply = projectedProduction(vertexProduction(game, first), vertexProduction(game, second));
  const quality = (vertexValue(game, first, 3) + vertexValue(game, second, 3)) * .45;
  const diversity = RESOURCE_KEYS.filter(key => supply[key] > 0).length;
  const scores = [
    { tactic: 'balance', score: quality + balanceProductionGain({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 }, supply) + diversity * 1.5 },
    { tactic: 'road_rush', score: quality + Math.min(supply.wood, supply.brick) * 3 +
      (supply.wood + supply.brick) * .6 + (supply.wheat > 0 ? 2 : 0) +
      openingExpansionValue(game, owner, first, second) * .35 },
  ];
  for (const site of [first, second]) {
    const port = portAt(game, site);
    if (!port) continue;
    const potential = harborTradePotential(supply, port);
    if (potential >= 1.5) scores.push({ tactic: 'harbor', score: quality + potential * 6 +
      (port.type === 'generic' ? 2 : 4) });
  }
  return scores;
}

function bestOpeningPairs(game, first, owner) {
  const projected = { ...game, owner };
  const best = new Map();
  for (let second = 0; second < board.vertices.length; second++) {
    if (!openVertex(projected, second)) continue;
    for (const option of openingPairScores(game, first, second, owner)) {
      if (option.score > (best.get(option.tactic)?.score ?? -Infinity))
        best.set(option.tactic, { ...option, second });
    }
  }
  return best;
}

function projectedOpeningOwners(game, actor, first, intervening) {
  const owner = [...game.owner];
  owner[first] = actor;
  const projected = { ...game, owner };
  // Approximate opponents taking the strongest available settlements before our second placement.
  for (let step = 0; step < intervening; step++) {
    let choice = null;
    let best = -Infinity;
    for (let index = 0; index < board.vertices.length; index++) {
      if (!openVertex(projected, index)) continue;
      const value = vertexValue(game, index, 2);
      if (value > best) { best = value; choice = index; }
    }
    if (choice === null) break;
    owner[choice] = -1;
  }
  return owner;
}

function chooseClassicOpening(game, actor, candidates) {
  if (game.setupPlacements[actor] === 1) {
    const first = game.owner.findIndex(owner => owner === actor);
    const options = bestOpeningPairs(game, first, game.owner);
    const previous = game.botPlans?.[actor];
    const chosen = [...options.values()].map(option => ({ ...option,
      score: option.score + (option.tactic === previous?.tactic ? 3 : 0) +
        (option.tactic === previous?.tactic && option.second === previous.target ? 2 : 0) }))
      .sort((a, b) => b.score - a.score)[0];
    return { index: chosen?.second ?? candidates[0], tactic: chosen?.tactic ?? 'balance', second: chosen?.second ?? candidates[0] };
  }
  const count = game.players.length;
  const position = (actor - game.setupStart + count) % count;
  const intervening = 2 * (count - 1 - position);
  let best = null;
  for (const first of candidates) {
    const currentOwner = [...game.owner];
    currentOwner[first] = actor;
    const optimistic = bestOpeningPairs(game, first, currentOwner);
    const conservative = intervening ? bestOpeningPairs(game, first,
      projectedOpeningOwners(game, actor, first, intervening)) : optimistic;
    for (const [tactic, option] of conservative) {
      const score = option.score * (intervening ? .75 : 1) +
        (optimistic.get(tactic)?.score || 0) * (intervening ? .25 : 0) +
        vertexValue(game, first, 3) * .15;
      if (!best || score > best.score) best = { index: first, tactic, second: option.second, score };
    }
  }
  return best || { index: candidates[0], tactic: 'balance', second: candidates[0] };
}

function roadOpeningValue(game, index, existing) {
  const site = vertexProduction(game, index);
  const before = Math.min(existing.wood, existing.brick);
  const after = Math.min(existing.wood + site.wood, existing.brick + site.brick);
  const wheatGap = existing.wheat + site.wheat === 0 ? 5 : 0;
  return (site.wood + site.brick) * 1.05 + (after - before) * 1.8 - site.ore * .35 - wheatGap;
}

function contestedSiteValue(game, index, actor) {
  let pressure = 0;
  for (const edgeIndex of board.vertices[index].edges) {
    const edge = board.edges[edgeIndex];
    if (game.roads[edgeIndex] !== null && game.roads[edgeIndex] !== actor) pressure = Math.max(pressure, 9);
    const neighbor = edge.a === index ? edge.b : edge.a;
    for (const nearEdge of board.vertices[neighbor].edges) {
      const link = board.edges[nearEdge];
      const rival = game.owner[link.a === neighbor ? link.b : link.a];
      if (rival !== null && rival !== actor) pressure = Math.max(pressure, 5);
    }
  }
  return pressure;
}

function chooseVertex(game, candidates, level, random) {
  const existing = new Set(board.vertices.flatMap((vertex, index) => game.owner[index] === game.player
    ? vertex.tiles.map(tileIndex => boardFor(game).tiles[tileIndex].type) : []));
  const existingProduction = level === 3 && game.phase === 'setup' ? playerProduction(game, game.player) : null;
  const ranked = candidates.map(index => {
    let value = vertexValue(game, index, level);
    if (game.phase === 'setup') {
      const types = new Set(board.vertices[index].tiles.map(tileIndex => boardFor(game).tiles[tileIndex].type));
      for (const type of types) if (!existing.has(type)) value += ({ wood: 4, brick: 4, wheat: 5, sheep: 2.5, ore: 1.5 })[type] || 0;
      if (types.has('wheat') && (types.has('wood') || types.has('brick'))) value += 3;
      if (types.has('wood') && types.has('brick')) value += 3;
      if (existingProduction) value += roadOpeningValue(game, index, existingProduction);
    }
    return { index, value: value + random() * (level === 1 ? 7 : level === 2 ? 2 : .25) };
  })
    .sort((a, b) => b.value - a.value);
  return ranked[0].index;
}

function openVertex(game, index) {
  if (game.owner[index] !== null) return false;
  return board.vertices[index].edges.every(edgeIndex => {
    const edge = board.edges[edgeIndex];
    return game.owner[edge.a === index ? edge.b : edge.a] === null;
  });
}

function roadRoutes(game, actor) {
  const distance = Array(board.vertices.length).fill(Infinity);
  const firstRoad = Array(board.vertices.length).fill(null);
  const frontier = [];
  for (let index = 0; index < board.vertices.length; index++) {
    if (game.owner[index] === actor || game.owner[index] === null && board.vertices[index].edges.some(edge => game.roads[edge] === actor)) {
      distance[index] = 0;
      frontier.push(index);
    }
  }
  // Existing roads cost nothing; each missing road costs one. Enemy buildings
  // block the route even if a road can touch the vertex from its other end.
  while (frontier.length) {
    frontier.sort((a, b) => distance[a] - distance[b]);
    const vertex = frontier.shift();
    for (const edgeIndex of board.vertices[vertex].edges) {
      if (game.roads[edgeIndex] !== null && game.roads[edgeIndex] !== actor) continue;
      const edge = board.edges[edgeIndex];
      const other = edge.a === vertex ? edge.b : edge.a;
      if (game.owner[other] !== null && game.owner[other] !== actor) continue;
      const cost = game.roads[edgeIndex] === actor ? 0 : 1;
      const next = distance[vertex] + cost;
      if (next >= distance[other]) continue;
      distance[other] = next;
      firstRoad[other] = firstRoad[vertex] ?? (cost ? edgeIndex : null);
      frontier.push(other);
    }
  }
  return { distance, firstRoad };
}

function roadTargets(game, level, random) {
  const { distance, firstRoad } = roadRoutes(game, game.player);
  return board.vertices.map((_, index) => ({ index, roads: distance[index], first: firstRoad[index] }))
    .filter(({ index, roads, first }) => openVertex(game, index) && roads <= (level === 1 ? 2 : 4) && (roads === 0 || first !== null))
    .map(target => ({ ...target, score: vertexValue(game, target.index, Math.max(level, 2))
      - (target.roads - 1) * (level === 1 ? 4.5 : 4) + random() * (level === 1 ? 2 : level === 2 ? .8 : .2) }))
    .sort((a, b) => b.score - a.score);
}

function roadPlan(game, level, random) {
  return roadTargets(game, level, random).find(target => target.roads >= 1) ?? null;
}

function setupDistance(game, start, target) {
  const seen = new Set([start]);
  let frontier = [start];
  for (let steps = 0; steps < 5 && frontier.length; steps++) {
    if (frontier.includes(target)) return steps;
    frontier = frontier.flatMap(vertex => board.vertices[vertex].edges.map(edge => {
      const link = board.edges[edge];
      return link.a === vertex ? link.b : link.a;
    })).filter(vertex => {
      if (seen.has(vertex) || game.owner[vertex] !== null && vertex !== target) return false;
      seen.add(vertex);
      return true;
    });
  }
  return Infinity;
}

function chooseRoad(game, candidates, level, random) {
  if (game.phase === 'dev-road') {
    const planned = game.botPlans?.[game.player];
    if (planned?.tactic === 'road' && candidates.includes(planned.target)) return planned.target;
    if (['expand', 'balance', 'harbor', 'road_rush'].includes(planned?.tactic)) {
      const activeTarget = planned.tactic === 'harbor' ? activeHarborTarget(game, planned, game.player) : planned.target;
      const first = roadTargets(game, level, () => 0).find(target => target.index === activeTarget)?.first;
      if (candidates.includes(first)) return first;
    }
  }
  if (game.phase === 'setup-road' && level === 3) {
    const production = playerProduction(game, game.player);
    const openingTarget = game.setupRound === 1 ? game.botPlans?.[game.player]?.target : null;
    return candidates.map(index => {
      const edge = board.edges[index];
      const next = edge.a === game.setupVertex ? edge.b : edge.a;
      const reachable = board.vertices[next].edges.map(link => {
        const end = board.edges[link].a === next ? board.edges[link].b : board.edges[link].a;
        return openVertex(game, end) ? vertexValue(game, end, level) + roadOpeningValue(game, end, production)
          + contestedSiteValue(game, end, game.player) : -Infinity;
      });
      const distance = Number.isInteger(openingTarget) ? setupDistance(game, next, openingTarget) : Infinity;
      return { index, score: Math.max(...reachable, 0) + (distance < 4 ? (4 - distance) * 3 : 0) + random() * .2 };
    }).sort((a, b) => b.score - a.score)[0]?.index;
  }
  const plan = roadPlan(game, level, random);
  if (plan && candidates.includes(plan.first)) return plan.first;
  // During classic setup every road must start at the just-placed settlement.
  if (game.phase === 'setup-road') return candidates.map(index => ({ index, score: Math.max(...[board.edges[index].a, board.edges[index].b]
    .filter(vertex => vertex !== game.setupVertex && openVertex(game, vertex))
    .map(vertex => vertexValue(game, vertex, level)), 0) + random() * .4 }))
    .sort((a, b) => b.score - a.score)[0]?.index;
  return null;
}

function buildCandidates(game) {
  return {
    settlement: board.vertices.map((_, index) => canSettle(game, index) ? index : null).filter(index => index !== null),
    city: board.vertices.map((_, index) => canCity(game, index) ? index : null).filter(index => index !== null),
    road: board.edges.map((_, index) => canRoad(game, index) ? index : null).filter(index => index !== null),
  };
}

function actionsThisTurn(game, actor) {
  const recent = [];
  for (let index = game.history.length - 1; index >= 0; index--) {
    const event = game.history[index];
    if (event.type === 'roll' && event.actor === actor || event.type === 'end' || event.type === 'start') break;
    if (event.actor === actor) recent.push(event.type);
  }
  return recent;
}

function desiredResource(resources, cost) {
  return RESOURCE_KEYS.filter(key => count(resources, key) < count(cost, key))
    .sort((a, b) => count(cost, b) - count(resources, b) - (count(cost, a) - count(resources, a)))[0];
}

function bankTrade(game, actor, level, recent, goals) {
  if (recent.filter(type => type === 'trade').length >= (level === 3 ? 4 : 2)) return null;
  const resources = game.players[actor].resources;
  for (const cost of goals) {
    const target = desiredResource(resources, cost);
    if (!target || game.ruleset === 'classic' && bankAvailable(game, target) < 1) continue;
    const offered = RESOURCE_KEYS.filter(key => key !== target && count(resources, key) >= harborRate(game, actor, key)
      && count(resources, key) - harborRate(game, actor, key) >= count(cost, key))
      .sort((a, b) => (count(resources, b) - count(cost, b)) - (count(resources, a) - count(cost, a)))[0];
    if (offered) return { type: 'trade', from: offered, to: target };
  }
  return null;
}

function playerTrade(game, actor, level, recent, goals) {
  if (recent.includes('offer-trade')) return null;
  const interval = level === 1 ? 5 : level === 2 ? 4 : 3;
  if (game.round % interval !== actor % interval) return null;
  const resources = game.players[actor].resources;
  for (const cost of goals) {
    const needed = RESOURCE_KEYS.filter(key => count(resources, key) < count(cost, key));
    const spare = RESOURCE_KEYS.filter(key => count(resources, key) > count(cost, key));
    for (const target of needed) for (const offered of spare) {
      const partners = game.players.map((player, index) => ({ index, resources: player.resources }))
        .filter(partner => partner.index !== actor && count(partner.resources, target) > 0)
        .sort((a, b) => {
          const score = partner => count(partner.resources, target) * .5 +
            (count(partner.resources, offered) === 0 ? 2 : 0);
          return score(b) - score(a);
        });
      if (partners.length) return { type: 'offer-trade', to: partners[0].index,
        give: { [offered]: 1 }, want: { [target]: 1 } };
    }
  }
  return null;
}

function developmentAction(game, actor, level, random) {
  if (game.devPlayed) return null;
  const player = game.players[actor];
  const available = type => player.devCards.some(card => card.type === type && card.boughtOn < game.turnNumber);
  if (available('plenty')) {
    const cost = [COSTS.city, COSTS.settlement, COSTS.development].find(goal => desiredResource(player.resources, goal));
    if (cost) {
      const missing = RESOURCE_KEYS.flatMap(key => Array(Math.max(0, count(cost, key) - count(player.resources, key))).fill(key));
      const [first, second] = [missing[0], missing[1] || missing[0]];
      if (first && (game.ruleset !== 'classic' || bankAvailable(game, first) >= (first === second ? 2 : 1) && bankAvailable(game, second) >= 1))
        return { type: 'play-dev', card: 'plenty', first, second };
    }
  }
  if (available('roads') && roadPlan(game, level, random) &&
    board.edges.some((_, index) => canRoad({ ...game, phase: 'dev-road', freeRoads: 2 }, index)))
    return { type: 'play-dev', card: 'roads' };
  if (available('monopoly')) {
    const resource = RESOURCE_KEYS.map(key => ({ key, amount: game.players.reduce((sum, player, index) => sum + (index === actor ? 0 : count(player.resources, key)), 0) }))
      .sort((a, b) => b.amount - a.amount)[0];
    if (resource.amount >= (level === 3 ? 2 : 4)) return { type: 'play-dev', card: 'monopoly', resource: resource.key };
  }
  if (available('knight') && (level === 3 || boardFor(game).tiles[game.robberTile].corners.some(vertex => game.owner[vertex] === actor)))
    return { type: 'play-dev', card: 'knight' };
  return null;
}

function visiblePoints(game, actor) {
  return game.owner.reduce((sum, owner, index) => sum + (owner === actor ? game.city[index] ? 2 : 1 : 0), 0)
    + (game.longestRoad === actor ? 2 : 0) + (game.largestArmy === actor ? 2 : 0);
}

function robberTile(game, actor, level, random) {
  const choices = boardFor(game).tiles.map((tile, index) => ({ tile, index })).filter(({ index }) => index !== game.robberTile);
  if (level === 1) return pick(choices, random).index;
  if (level === 3) {
    const points = game.players.map((_, seat) => visiblePoints(game, seat));
    const rivalPoints = points.filter((_, seat) => seat !== actor);
    const leader = Math.max(...rivalPoints);
    const earlyGame = rivalPoints.reduce((sum, value) => sum + value, 0) / rivalPoints.length < 6;
    const safe = choices.filter(({ tile }) => tile.corners.every(vertex => game.owner[vertex] !== actor));
    // If every legal destination borders our buildings, moving the robber is still mandatory.
    const candidates = safe.length ? safe : choices;
    return candidates.map(({ tile, index }) => ({ index, value: tile.corners.reduce((sum, vertex) => {
      const owner = game.owner[vertex];
      if (owner === null) return sum;
      const yieldValue = (PIPS[tile.number] || 0) * (game.city[vertex] ? 2 : 1);
      if (owner === actor) return sum - yieldValue * 2;
      const leadWeight = 1 + points[owner] * .12 + (points[owner] === leader && leader > 0 ? .25 : 0);
      const roadResourceWeight = earlyGame && ['wood', 'brick'].includes(tile.type) ? 1.5 : 1;
      return sum + yieldValue * leadWeight * roadResourceWeight;
    }, 0) + random() * .2 })).sort((a, b) => b.value - a.value)[0].index;
  }
  return choices.map(({ tile, index }) => ({ index, value: tile.corners.reduce((score, vertex) => {
    const owner = game.owner[vertex];
    if (owner === null) return score;
    const yieldValue = (PIPS[tile.number] || 0) * (game.city[vertex] ? 2 : 1);
    return score + (owner === actor ? -yieldValue * 2 : yieldValue);
  }, 0) + random() * (level === 2 ? 2 : .2) })).sort((a, b) => b.value - a.value)[0].index;
}

function discardCards(game, actor, level, random) {
  const available = { ...game.players[actor].resources };
  const resources = Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0]));
  for (let i = 0; i < game.robberDiscards[actor]; i++) {
    const choices = RESOURCE_KEYS.filter(key => available[key] > 0);
    const key = level === 1 ? pick(choices, random) : choices.sort((a, b) => available[b] - available[a]
      + (level === 3 && ['wheat', 'ore'].includes(a) ? 1 : 0))[0];
    resources[key]++; available[key]--;
  }
  return resources;
}

function tradeReply(game, actor, level) {
  const { give, want } = game.tradeOffer;
  const resources = game.players[actor].resources;
  if (!canPay(resources, want)) return { type: 'reject-trade' };
  const needs = RESOURCE_KEYS.filter(key => [COSTS.road, COSTS.settlement, COSTS.city]
    .some(cost => count(cost, key) > count(resources, key)));
  const value = bag => RESOURCE_KEYS.reduce((sum, key) => sum + count(bag, key) *
    (needs.includes(key) ? 1.5 : count(resources, key) >= 4 ? .8 : 1), 0);
  return { type: value(give) >= value(want) ? 'accept-trade' : 'reject-trade' };
}

// A tactic has one concrete target. It survives turn changes and is replaced only
// after completion, obstruction, or a clearly better opportunity appears.
export const BOT_TACTICS = Object.freeze({
  expand: 'Новые поселения',
  balance: 'Баланс ресурсов',
  road_rush: 'Упор на дороги',
  city: 'Развитие городов',
  road: 'Самый длинный тракт',
  army: 'Самое большое войско',
  harbor: 'Гавани и морская торговля',
});

function portAt(game, vertex) {
  return boardFor(game).ports.find(port => {
    const edge = board.edges[port.edge];
    return edge.a === vertex || edge.b === vertex;
  });
}

function portSurplus(production, resource) {
  // Pips are proportional to dice probability; compare long-run supply instead of the current hand.
  const alternatives = RESOURCE_KEYS.filter(key => key !== resource);
  const otherPips = alternatives.reduce((sum, key) => sum + production[key], 0) / alternatives.length;
  return Math.max(0, production[resource] - Math.max(2, otherPips * 1.25));
}

function projectedProduction(current, ...vertices) {
  const result = { ...current };
  for (const vertex of vertices) for (const key of RESOURCE_KEYS) result[key] += vertex[key];
  return result;
}

function harborTradePotential(production, port) {
  if (port.type === 'generic') return Math.max(...RESOURCE_KEYS.map(key => portSurplus(production, key))) / 3;
  return portSurplus(production, port.type) / 2;
}

function rivalRoadDistance(game, actor) {
  const distances = game.players.map((_, seat) => seat === actor ? null : roadRoutes(game, seat).distance);
  return vertex => Math.min(...distances.filter(Boolean).map(distance => distance[vertex]));
}

function activeHarborTarget(game, plan, actor) {
  if (!Number.isInteger(plan.surplusTarget)) return plan.target;
  const first = plan.firstTarget ?? plan.target;
  const second = first === plan.target ? plan.surplusTarget : plan.target;
  return game.owner[first] === actor ? second : first;
}

function harborPairOptions(game, actor, targets, production, previous) {
  const options = [];
  const stock = game.players[actor].resources;
  const byIndex = new Map(targets.map(target => [target.index, target]));
  const remaining = pieceSupply(game, actor, 'settlement').remaining;
  const rivalDistance = rivalRoadDistance(game, actor);
  // Keep an established two-site plan while both locations remain attainable.
  if (previous?.tactic === 'harbor' && Number.isInteger(previous.surplusTarget)) {
    const portOwned = game.owner[previous.target] === actor;
    const surplusOwned = game.owner[previous.surplusTarget] === actor;
    const active = activeHarborTarget(game, previous, actor);
    const activeRoute = byIndex.get(active);
    const rivalSteps = rivalDistance(active);
    if (!(portOwned && surplusOwned) && activeRoute &&
      (rivalSteps > activeRoute.roads || activeRoute.roads === 0 && canPay(stock, COSTS.settlement))) {
      const port = portAt(game, previous.target);
      if (port && (remaining === null || remaining >= (portOwned || surplusOwned ? 1 : 2))) {
        const combined = projectedProduction(production,
          ...(portOwned ? [] : [vertexProduction(game, previous.target)]),
          ...(surplusOwned ? [] : [vertexProduction(game, previous.surplusTarget)]));
        options.push({ tactic: 'harbor', target: previous.target, surplusTarget: previous.surplusTarget,
          firstTarget: previous.firstTarget, resource: previous.resource,
          score: 35 + harborTradePotential(combined, port) * 3 + (portOwned || surplusOwned ? 10 : 0) });
      }
    }
  }
  if (remaining !== null && remaining < 2) return options;
  for (const harborSite of targets) {
    const port = portAt(game, harborSite.index);
    if (!port || game.owner.some((owner, index) => owner === actor && portAt(game, index)?.edge === port.edge)) continue;
    const harborProduction = vertexProduction(game, harborSite.index);
    const harborRace = rivalDistance(harborSite.index) - harborSite.roads;
    if (harborRace <= 0) continue;
    for (const surplusSite of targets) {
      if (surplusSite.index === harborSite.index || harborSite.roads + surplusSite.roads > 6 ||
        board.vertices[harborSite.index].edges.some(edge => {
          const link = board.edges[edge];
          return (link.a === harborSite.index ? link.b : link.a) === surplusSite.index;
        })) continue;
      const plannedRoads = harborSite.roads + surplusSite.roads;
      // Reject attractive but unaffordable combinations before spending the starting road cards.
      const minimumRoadSupply = Math.min(3, plannedRoads + 1);
      if (Math.min(stock.wood + production.wood / 2, stock.brick + production.brick / 2) < minimumRoadSupply) continue;
      const surplusRace = rivalDistance(surplusSite.index) - surplusSite.roads;
      if (surplusRace <= 0) continue;
      const siteProduction = vertexProduction(game, surplusSite.index);
      const resources = port.type === 'generic' ? RESOURCE_KEYS : [port.type];
      for (const resource of resources) {
        if (siteProduction[resource] < (port.type === 'generic' ? 5 : 4)) continue;
        const combined = projectedProduction(production, harborProduction, siteProduction);
        const surplus = portSurplus(combined, resource);
        if (surplus < (port.type === 'generic' ? 7 : 5)) continue;
        const tradePotential = surplus / (port.type === 'generic' ? 3 : 2);
        const raceBonus = Math.min(4, harborRace, surplusRace);
        const firstTarget = surplusRace < harborRace ? surplusSite.index : harborSite.index;
        const score = 26 + vertexValue(game, harborSite.index, 3) * .45 +
          vertexValue(game, surplusSite.index, 3) * .55 + tradePotential * 3.5 -
          (harborSite.roads + surplusSite.roads) * 2 + raceBonus;
        options.push({ tactic: 'harbor', target: harborSite.index, surplusTarget: surplusSite.index,
          firstTarget, resource, score });
      }
    }
  }
  return options;
}

function tacticOptions(game, actor, level, random) {
  const stock = game.players[actor].resources;
  const options = [];
  const room = pieceSupply(game, actor, 'settlement').remaining !== 0;
  const production = level === 3 ? playerProduction(game, actor) : null;
  const previous = game.botPlans?.[actor];
  const targets = room ? roadTargets(game, level, random) : [];
  if (room) for (const target of targets) {
    const buildable = target.roads === 0 && canPay(stock, COSTS.settlement);
    const score = 23 + target.score * .85 - target.roads * 1.4 + (buildable ? 9 : 0) +
      (game.owner.filter(owner => owner === actor).length < 3 ? 8 : 0);
    options.push({ tactic: 'expand', target: target.index, score });
    // Do not spend the last road materials on a route that cannot be finished
    // into a settlement without producing or trading for more of them.
    const affordableRoute = production && ['wood', 'brick'].every(key =>
      production[key] > 0 || count(stock, key) >= target.roads + 1);
    if (affordableRoute) {
      const gain = balanceProductionGain(production, vertexProduction(game, target.index));
      if (gain >= 3) options.push({ tactic: 'balance', target: target.index,
        score: 23 + target.score * .8 + gain * 1.2 - target.roads * 1.4 + (buildable ? 9 : 0) });
    }
    const finishingRush = target.roads === 0 && previous?.tactic === 'road_rush' && previous.target === target.index;
    if (production && (target.roads >= 1 || finishingRush) && production.wood >= 2 && production.brick >= 2 &&
      (finishingRush || pieceSupply(game, actor, 'road').remaining !== 0)) {
      const contested = contestedSiteValue(game, target.index, actor);
      const roadIncome = Math.min(9, Math.min(production.wood, production.brick) * 1.5);
      const siteValue = vertexValue(game, target.index, level);
      options.push({ tactic: 'road_rush', target: target.index, score: 22 + siteValue * 1.1 - target.roads * 3.5 +
        roadIncome + contested + (target.roads ? canPay(stock, COSTS.road) ? 4 : 0 : 12) });
    }
    const port = portAt(game, target.index);
    if (port && !game.owner.some((owner, index) => owner === actor && portAt(game, index)?.edge === port.edge)) {
      const projected = projectedProduction(production || playerProduction(game, actor), vertexProduction(game, target.index));
      const useful = Math.min(14, harborTradePotential(projected, port) * 3);
      options.push({ tactic: 'harbor', target: target.index, score: 23 + target.score * .8 + useful - target.roads * 1.4 + (buildable ? 8 : 0) });
    }
  }
  if (room && level === 3) options.push(...harborPairOptions(game, actor, targets, production, previous));
  if (pieceSupply(game, actor, 'city').remaining !== 0) game.owner.forEach((owner, index) => {
    if (owner !== actor || game.city[index]) return;
    const ready = canPay(stock, COSTS.city);
    options.push({ tactic: 'city', target: index, score: 10 + vertexValue(game, index, level) * .9 + (ready ? 25 : 0) +
      (pieceSupply(game, actor, 'settlement').remaining === 0 ? 5 : 0) });
  });
  if (pieceSupply(game, actor, 'road').remaining !== 0 && game.longestRoad !== actor) {
    const current = longestRoadLength(game, actor);
    const leader = Math.max(5, ...game.players.map((_, index) => longestRoadLength(game, index)));
    if (current >= 3 && current + 3 >= leader) for (const index of board.edges.map((_, index) => index).filter(index =>
      canRoad({ ...game, players: game.players.map((player, seat) => seat === actor ? { ...player, resources: { wood: 99, brick: 99 } } : player) }, index))) {
      const roads = [...game.roads]; roads[index] = actor;
      const gain = longestRoadLength({ ...game, roads }, actor) - current;
      if (gain < 1) continue;
      const edge = board.edges[index];
      const future = [edge.a, edge.b].some(vertex => openVertex(game, vertex)) ? 2 : 0;
      const newLength = current + gain;
      options.push({ tactic: 'road', target: index, score: 12 + current * 1.3 + gain * 3 + future +
        (canPay(stock, COSTS.road) ? 7 : 0) + (newLength >= leader ? 18 : 8) - Math.max(0, leader - current - 1) * 2 });
    }
  }
  const knightReady = game.players[actor].devCards.some(card => card.type === 'knight' && card.boughtOn < game.turnNumber);
  const armyLead = Math.max(3, ...game.players.map(player => player.knightsPlayed || 0));
  if (game.largestArmy !== actor && (knightReady || game.devDeck?.length)) {
    options.push({ tactic: 'army', target: null, score: 13 + (knightReady && !game.devPlayed ? 10 : 0) +
      (canPay(stock, COSTS.development) ? 5 : 0) + Math.max(0, 4 - armyLead) * 2 +
      (game.players[actor].knightsPlayed >= armyLead - 1 ? 8 : 0) });
  }
  return options;
}

function selectTactic(game, actor, level, random) {
  const options = tacticOptions(game, actor, level, random).sort((a, b) => b.score - a.score);
  const previous = game.botPlans?.[actor];
  const retained = options.find(option => option.tactic === previous?.tactic && option.target === previous?.target &&
    option.surplusTarget === previous?.surplusTarget && option.resource === previous?.resource);
  const threshold = level === 2 ? 1.35 : 1.16;
  const selected = retained && options[0]?.score < retained.score * threshold ? retained : options[0];
  const details = retained && selected === retained ? previous : selected;
  return selected ? { tactic: selected.tactic, target: selected.target,
    ...(selected.surplusTarget !== undefined ? { surplusTarget: selected.surplusTarget,
      firstTarget: details.firstTarget, resource: details.resource } : {}),
    chosenRound: retained && selected === retained ? previous.chosenRound : game.round } : null;
}

function tacticalAction(game, actor, level, recent, plan, random) {
  if (!plan) return { type: 'end' };
  const stock = game.players[actor].resources;
  const buildings = buildCandidates(game);
  const costs = [];
  if (['expand', 'balance', 'harbor', 'road_rush'].includes(plan.tactic)) {
    const activeTarget = plan.tactic === 'harbor' ? activeHarborTarget(game, plan, actor) : plan.target;
    const target = roadTargets(game, level, () => 0).find(item => item.index === activeTarget);
    if (target?.roads === 0) {
      if (buildings.settlement.includes(activeTarget)) return { type: 'settlement', index: activeTarget };
      costs.push(COSTS.settlement);
    } else if (target?.first !== null && target?.first !== undefined) {
      if (buildings.road.includes(target.first)) return { type: 'road', index: target.first };
      costs.push(COSTS.road);
    }
  } else if (plan.tactic === 'city') {
    if (buildings.city.includes(plan.target)) return { type: 'city', index: plan.target };
    costs.push(COSTS.city);
  } else if (plan.tactic === 'road') {
    if (buildings.road.includes(plan.target)) return { type: 'road', index: plan.target };
    costs.push(COSTS.road);
  } else if (plan.tactic === 'army') {
    const knight = game.players[actor].devCards.some(card => card.type === 'knight' && card.boughtOn < game.turnNumber);
    if (knight && !game.devPlayed) return { type: 'play-dev', card: 'knight' };
    if (canPay(stock, COSTS.development) && game.devDeck?.length && recent.filter(type => type === 'buy-dev').length < 2)
      return { type: 'buy-dev' };
    costs.push(COSTS.development);
  }
  if (!game.devPlayed) {
    const dev = developmentAction(game, actor, level, random);
    if (dev && ['plenty', 'roads'].includes(dev.card)) return dev;
  }
  const trade = bankTrade(game, actor, level, recent, costs);
  if (trade) return trade;
  const offer = playerTrade(game, actor, level, recent, costs);
  if (offer) return offer;
  // A spare card may still produce value while we wait for the target resources.
  const dev = developmentAction(game, actor, level, random);
  if (dev && ['knight', 'monopoly'].includes(dev.card)) return dev;
  return { type: 'end' };
}

export function applyBotChoice(game, choice, die, randomIndex) {
  const planned = choice.plan ? { ...game, botPlans: (game.botPlans || Array(game.players.length).fill(null))
    .map((plan, index) => index === choice.actor ? choice.plan : plan) } : game;
  return applyAction(planned, choice.actor, choice.action, die, randomIndex);
}

export function chooseBotAction(game, random = Math.random) {
  const actor = nextBotSeat(game);
  if (actor === null) return null;
  const level = playerBotLevel(game, actor);
  let selectedPlan = null;
  const action = (() => {
    if (game.phase === 'robber-discard') return { type: 'discard', resources: discardCards(game, actor, level, random) };
    if (game.phase === 'trade-offer') return tradeReply(game, actor, level);
    if (game.phase === 'robber-move') return { type: 'move-robber', index: robberTile(game, actor, level, random) };
    if (game.phase === 'robber-steal') return { type: 'steal', victim: level === 1 ? pick(game.robberVictims, random)
      : [...game.robberVictims].sort((a, b) => level === 3
        ? resourceTotal(game.players[b].resources) + visiblePoints(game, b) * 2 -
          resourceTotal(game.players[a].resources) - visiblePoints(game, a) * 2
        : resourceTotal(game.players[b].resources) - resourceTotal(game.players[a].resources))[0] };
    if (game.phase === 'setup') {
      const candidates = board.vertices.map((_, index) => canSettle(game, index) ? index : null).filter(index => index !== null);
      if (level === 3 && game.ruleset === 'classic') {
        const opening = chooseClassicOpening(game, actor, candidates);
        selectedPlan = { tactic: opening.tactic, target: opening.second, chosenRound: game.round };
        return { type: 'settlement', index: opening.index };
      }
      return { type: 'settlement', index: chooseVertex(game, candidates, level, random) };
    }
    if (game.phase === 'setup-road' || game.phase === 'dev-road') {
      const candidates = board.edges.map((_, index) => canRoad(game, index) ? index : null).filter(index => index !== null);
      if (!candidates.length && game.phase === 'dev-road') return { type: 'finish-dev-road' };
      const index = chooseRoad(game, candidates, level, random);
      if (index === null || index === undefined) return game.phase === 'dev-road' && game.freeRoads === 1
        ? { type: 'finish-dev-road' } : { type: 'road', index: pick(candidates, random) };
      return { type: 'road', index };
    }
    if (game.phase !== 'turn') return null;
    if (!game.rolled) return { type: 'roll' };
    const recent = actionsThisTurn(game, actor);
    if (recent.length >= 24) return { type: 'end' };
    if (level >= 2) {
      selectedPlan = selectTactic(game, actor, level, random);
      return tacticalAction(game, actor, level, recent, selectedPlan, random);
    }
    const buildings = buildCandidates(game);
    const dev = developmentAction(game, actor, level, random);
    if (buildings.settlement.length) return { type: 'settlement', index: chooseVertex(game, buildings.settlement, level, random) };
    if (buildings.city.length) return { type: 'city', index: chooseVertex(game, buildings.city, level, random) };
    if (dev && ['roads', 'plenty'].includes(dev.card)) return dev;
    const plan = roadPlan(game, level, random);
    const canExpand = game.owner.some((_, index) => openVertex(game, index) && board.vertices[index].edges.some(edge => game.roads[edge] === actor));
    const canUpgrade = game.owner.some((owner, index) => owner === actor && !game.city[index]);
    if (!canExpand && plan && buildings.road.includes(plan.first)) return { type: 'road', index: plan.first };
    const goals = [
      ...(canExpand ? [COSTS.settlement] : []),
      ...(plan ? [COSTS.road] : []),
      ...(canUpgrade ? [COSTS.city] : []),
    ];
    const trade = bankTrade(game, actor, level, recent, goals);
    if (trade) return trade;
    const playerOffer = playerTrade(game, actor, level, recent, goals);
    if (playerOffer) return playerOffer;
    if (dev) return dev;
    const stock = game.players[actor].resources;
    const hasSurplusForDevelopment = game.owner.filter(owner => owner === actor).length >= 2 ||
      count(stock, 'ore') >= 2 && count(stock, 'wheat') >= 3 && count(stock, 'sheep') >= 2;
    if (hasSurplusForDevelopment && canPay(stock, COSTS.development) && game.devDeck?.length && recent.filter(type => type === 'buy-dev').length < (level === 3 ? 2 : 1))
      return { type: 'buy-dev' };
    return { type: 'end' };
  })();
  return action ? { actor, action, ...(selectedPlan ? { plan: selectedPlan } : {}) } : null;
}
