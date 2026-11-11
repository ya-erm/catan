import test from 'node:test';
import assert from 'node:assert/strict';
import { freshGame, applyAction, board, boardFor, canSettle, canRoad } from '../game.js';
import { chooseBotAction, applyBotChoice, nextBotSeat } from '../bot.js';
import { hotseatRoom } from '../hotseat.js';
import { normalizeLocalSession, parseLocalFile, serializeLocalFile } from '../local-save.js';

const randomIndex = () => 0;
const die = () => 3;
const resources = () => ({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });

function humanAction(game) {
  const actor = game.phase === 'robber-discard' ? game.robberDiscards.findIndex(Boolean)
    : game.phase === 'trade-offer' ? game.tradeOffer.to : game.player;
  if (game.phase === 'trade-offer') return { actor, action: { type: 'reject-trade' } };
  if (game.phase === 'setup') return { actor, action: { type: 'settlement', index: board.vertices.findIndex((_, index) => canSettle(game, index)) } };
  if (game.phase === 'setup-road') return { actor, action: { type: 'road', index: board.edges.findIndex((_, index) => canRoad(game, index)) } };
  if (game.phase === 'turn') return { actor, action: { type: game.rolled ? 'end' : 'roll' } };
  if (game.phase === 'robber-discard') {
    const bag = resources();
    let remaining = game.robberDiscards[actor];
    for (const key of Object.keys(bag)) { bag[key] = Math.min(remaining, game.players[actor].resources[key]); remaining -= bag[key]; }
    return { actor, action: { type: 'discard', resources: bag } };
  }
  if (game.phase === 'robber-move') return { actor, action: { type: 'move-robber', index: game.robberTile === 0 ? 1 : 0 } };
  if (game.phase === 'robber-steal') return { actor, action: { type: 'steal', victim: game.robberVictims[0] } };
  throw new Error(`Unexpected human phase ${game.phase}`);
}

test('bots of all levels progress through setup, turns and robber phases in both rulesets', () => {
  for (const ruleset of ['new', 'classic']) for (const level of [1, 2, 3]) {
    const players = [{ id: 'human', name: 'Человек' }, { id: 'bot', name: 'Бот 1', botLevel: level }];
    if (ruleset === 'classic') players.push({ id: 'bot2', name: 'Бот 2', botLevel: 2 });
    let game = freshGame(players, randomIndex, ruleset);
    let botActions = 0;
    for (let step = 0; step < 350 && game.round < 8 && game.winner === null; step++) {
      const choice = chooseBotAction(game, () => .37) || humanAction(game);
      if (game.players[choice.actor].botLevel) botActions++;
      game = game.players[choice.actor].botLevel ? applyBotChoice(game, choice, die, randomIndex) : applyAction(game, choice.actor, choice.action, die, randomIndex);
    }
    assert.ok(game.round >= 8 || game.winner !== null, `${ruleset}, level ${level} stalled in ${game.phase}`);
    assert.ok(botActions > 10);
    assert.equal(nextBotSeat({ ...game, winner: 0 }), null);
  }
});

test('all difficulty levels expand beyond their starting settlement in fifteen rounds', () => {
  let seed = 2;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const randomIndex = count => Math.floor(random() * count);
  const players = [1, 2, 3, 3].map((botLevel, index) => ({ id: `bot-${index}`, name: `Бот ${index}`, botLevel }));
  let game = freshGame(players, randomIndex, 'new', 'random');
  let actions = 0;
  while (game.round <= 15 && game.winner === null && actions < 1000) {
    const choice = chooseBotAction(game, random);
    assert.ok(choice, `bot stalled in ${game.phase}`);
    game = applyBotChoice(game, choice, () => 1 + randomIndex(6), randomIndex);
    actions++;
  }
  assert.ok(actions < 1000, 'bots must complete turns without looping');
  for (let actor = 0; actor < players.length; actor++) {
    assert.ok(game.owner.filter(owner => owner === actor).length >= 2,
      `level ${players[actor].botLevel} did not expand beyond the starting settlement; counts: ${players.map((_, i) => game.owner.filter(owner => owner === i).length).join(', ')}, cities: ${players.map((_, i) => game.owner.filter((owner, index) => owner === i && game.city[index]).length).join(', ')}`);
  }
});

test('local saves retain bot difficulty and hide bot hands from the human view', () => {
  const players = [{ id: 'local-0', name: 'Человек' }, { id: 'local-1', name: 'Бот 2', botLevel: 3 }];
  const game = freshGame(players, randomIndex);
  const session = { names: players.map(player => player.name), game, revision: 0, colorOrder: [0, 1, 2, 3] };
  const parsed = parseLocalFile(serializeLocalFile(session));
  assert.equal(parsed.game.players[1].botLevel, 3);
  const view = hotseatRoom(parsed.game, parsed.names, 0, 0);
  assert.equal(view.members[1].botLevel, 3);
  assert.equal(view.game.players[1].resources, null);
  assert.throws(() => normalizeLocalSession({ ...session, game: { ...game, players: game.players.map(player => ({ ...player, botLevel: 2 })) } }));
});

test('city tactic is chosen when the bot can upgrade and its goal survives a save', () => {
  const players = [{ id: 'human', name: 'Человек' }, { id: 'bot', name: 'Бот', botLevel: 3 }];
  const game = freshGame(players, randomIndex);
  game.phase = 'turn'; game.player = 1; game.rolled = true; game.owner[0] = 1;
  game.players[1].resources = { wood: 0, brick: 0, wheat: 2, sheep: 0, ore: 3 };
  const choice = chooseBotAction(game, () => 0);
  assert.deepEqual(choice.action, { type: 'city', index: 0 });
  assert.equal(choice.plan.tactic, 'city');
  const after = applyBotChoice(game, choice, die, randomIndex);
  assert.deepEqual(after.botPlans[1], choice.plan);
  const saved = parseLocalFile(serializeLocalFile({ names: players.map(player => player.name), game: after, revision: 1 }));
  assert.deepEqual(saved.game.botPlans[1], choice.plan);
  assert.equal(hotseatRoom(saved.game, saved.names, 0, 1).game.botPlans, undefined);
  assert.throws(() => normalizeLocalSession({ names: saved.names, revision: 1,
    game: { ...saved.game, botPlans: [null, { tactic: 'city', target: 999, chosenRound: 1 }] } }));
});

test('army tactic plays a ready knight when settlement and city growth are blocked', () => {
  const game = freshGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B', botLevel: 3 }], randomIndex);
  game.phase = 'turn'; game.player = 1; game.rolled = true; game.turnNumber = 2;
  game.owner.fill(0); game.owner[0] = 1; game.city[0] = true;
  game.players[1].devCards.push({ type: 'knight', boughtOn: 1 });
  const choice = chooseBotAction(game, () => 0);
  assert.equal(choice.plan.tactic, 'army');
  assert.deepEqual(choice.action, { type: 'play-dev', card: 'knight' });
});

test('high-level bot opens with road resources and can commit to a valuable road route', () => {
  const setup = level => freshGame([{ id: 'bot', name: 'Бот', botLevel: level }, { id: 'human', name: 'Человек' }], randomIndex);
  const production = index => board.vertices[index].tiles.reduce((sum, tileIndex) => {
    const tile = board.tiles[tileIndex];
    return sum + (['wood', 'brick'].includes(tile.type) ? { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 }[tile.number] || 0 : 0);
  }, 0);
  const medium = chooseBotAction(setup(2), () => 0);
  const high = chooseBotAction(setup(3), () => 0);
  assert.ok(production(high.action.index) > production(medium.action.index));

  const game = setup(3);
  game.phase = 'turn'; game.rolled = true; game.owner[high.action.index] = 0;
  game.players[0].resources = { wood: 2, brick: 2, wheat: 0, sheep: 0, ore: 0 };
  const choice = chooseBotAction(game, () => 0);
  assert.ok(['road_rush', 'balance'].includes(choice.plan.tactic));
  assert.equal(choice.action.type, 'road');
  let after = applyBotChoice(game, choice, die, randomIndex);
  assert.deepEqual(after.botPlans[0], choice.plan);
  for (let step = 0; step < 3 && !board.vertices[choice.plan.target].edges.some(edge => after.roads[edge] === 0); step++) {
    after.players[0].resources.wood = 2;
    after.players[0].resources.brick = 2;
    const next = chooseBotAction(after, () => 0);
    assert.equal(next.plan.target, choice.plan.target);
    assert.equal(next.action.type, 'road');
    after = applyBotChoice(after, next, die, randomIndex);
  }
  after.players[0].resources = { wood: 1, brick: 1, wheat: 1, sheep: 1, ore: 0 };
  const settlement = chooseBotAction(after, () => 0);
  assert.deepEqual(settlement.action, { type: 'settlement', index: choice.plan.target });
  const saved = parseLocalFile(serializeLocalFile({ names: game.players.map(player => player.name), game: after, revision: 1 }));
  assert.equal(saved.game.botPlans[0].tactic, choice.plan.tactic);
});

test('medium bot values a harbor from dice production rather than cards in hand', () => {
  let seed = 1;
  const randomIndex = count => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % count; };
  const game = freshGame([{ id: 'bot', name: 'Бот', botLevel: 2 }, { id: 'human', name: 'Человек' }], randomIndex, 'new', 'random');
  game.phase = 'turn'; game.player = 0; game.rolled = true;
  game.owner[1] = 0; game.owner[board.vertices.length - 1] = 1;
  game.players[0].resources = { wood: 1, brick: 1, wheat: 1, sheep: 1, ore: 0 };
  const first = chooseBotAction(game, () => 0);
  assert.equal(first.plan.tactic, 'harbor');
  game.players[0].resources.ore = 8;
  const withDifferentHand = chooseBotAction(game, () => 0);
  assert.equal(withDifferentHand.plan.target, first.plan.target);
  assert.equal(withDifferentHand.plan.surplusTarget, undefined);
});

test('high-level bot can plan two harbor sites, keep their order and abandon a lost race', () => {
  const game = freshGame([{ id: 'bot', name: 'Бот', botLevel: 3 }, { id: 'human', name: 'Человек' }], randomIndex);
  game.phase = 'turn'; game.player = 0; game.rolled = true;
  game.owner[1] = 0; game.owner[board.vertices.length - 1] = 1;
  game.players[0].resources = { wood: 4, brick: 4, wheat: 1, sheep: 1, ore: 0 };
  const initial = chooseBotAction(game, () => 0);
  assert.equal(initial.plan.tactic, 'harbor');
  assert.ok(Number.isInteger(initial.plan.surplusTarget));
  const port = boardFor(game).ports.find(item => {
    const edge = board.edges[item.edge];
    return edge.a === initial.plan.target || edge.b === initial.plan.target;
  });
  assert.equal(port.type, initial.plan.resource);
  const rivalNearSite = structuredClone(game);
  rivalNearSite.roads[board.vertices[initial.plan.surplusTarget].edges[0]] = 1;
  assert.notDeepEqual(chooseBotAction(rivalNearSite, () => 0).plan, initial.plan);
  const cityReady = structuredClone(game);
  cityReady.players[0].resources = { wood: 4, brick: 4, wheat: 2, sheep: 1, ore: 3 };
  assert.equal(chooseBotAction(cityReady, () => 0).plan.tactic, 'city');

  let progress = game;
  for (let step = 0; step < 12 && progress.owner[initial.plan.firstTarget] !== 0; step++) {
    progress.players[0].resources = { wood: 4, brick: 4, wheat: 2, sheep: 2, ore: 0 };
    const choice = chooseBotAction(progress, () => 0);
    progress = applyBotChoice(progress, choice, die, randomIndex);
  }
  assert.equal(progress.owner[initial.plan.firstTarget], 0);
  const continuation = chooseBotAction(progress, () => 0);
  assert.equal(continuation.plan.tactic, 'harbor');
  assert.equal(continuation.plan.firstTarget, initial.plan.firstTarget);
  assert.equal(continuation.plan.surplusTarget, initial.plan.surplusTarget);
  const saved = parseLocalFile(serializeLocalFile({ names: progress.players.map(player => player.name), game: progress, revision: 1 }));
  assert.equal(saved.game.botPlans[0].surplusTarget, initial.plan.surplusTarget);
});

test('high-level bot may use a generic harbor when that is the better production pair', () => {
  let seed = 1;
  const randomIndex = count => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % count; };
  const game = freshGame([{ id: 'bot', name: 'Бот', botLevel: 3 }, { id: 'human', name: 'Человек' }], randomIndex, 'new', 'random');
  game.phase = 'turn'; game.player = 0; game.rolled = true;
  game.owner[0] = 0; game.owner[board.vertices.length - 1] = 1;
  game.players[0].resources = { wood: 4, brick: 4, wheat: 1, sheep: 1, ore: 0 };
  const plan = chooseBotAction(game, () => 0).plan;
  assert.equal(plan.tactic, 'harbor');
  assert.ok(Number.isInteger(plan.surplusTarget));
  const port = boardFor(game).ports.find(item => {
    const edge = board.edges[item.edge];
    return edge.a === plan.target || edge.b === plan.target;
  });
  assert.equal(port.type, 'generic');
});

test('high-level bot balances weak production by routing to another field of that resource', () => {
  const game = freshGame([{ id: 'bot', name: 'Bot', botLevel: 3 }, { id: 'human', name: 'Human' }], randomIndex);
  game.phase = 'turn'; game.player = 0; game.rolled = true;
  game.owner[2] = 0; game.owner[53] = 0; game.owner[45] = 1;
  game.layout = { tiles: board.tiles.map(() => ({ type: 'desert', number: null })), ports: board.ports.map(port => port.type) };
  for (const [index, type, number] of [
    [0, 'wheat', 2], [1, 'wood', 6], [4, 'brick', 6],
    [3, 'wheat', 6], [5, 'sheep', 6], [8, 'ore', 6], [18, 'sheep', 6],
  ]) game.layout.tiles[index] = { type, number };
  game.players[0].resources = { wood: 1, brick: 1, wheat: 1, sheep: 1, ore: 0 };
  const choice = chooseBotAction(game, () => 0);
  assert.equal(choice.plan.tactic, 'balance');
  assert.equal(choice.plan.target, 14);
  assert.deepEqual(choice.action, { type: 'road', index: 2 });
  assert.ok(board.vertices[choice.plan.target].tiles.includes(3), 'target should border the productive wheat field');
  game.players[0].botLevel = 2;
  assert.notEqual(chooseBotAction(game, () => 0).plan.tactic, 'balance');

  const savedGame = freshGame([{ id: 'bot', name: 'Bot', botLevel: 3 }, { id: 'human', name: 'Human' }], randomIndex);
  savedGame.botPlans[0] = { tactic: 'balance', target: 14, chosenRound: 1 };
  const saved = parseLocalFile(serializeLocalFile({ names: ['Bot', 'Human'], game: savedGame, revision: 1 }));
  assert.deepEqual(saved.game.botPlans[0], savedGame.botPlans[0]);
});

test('classic opening considers turn order, places two free pairs, and replans a taken site', () => {
  const players = [0, 1, 2, 3].map(index => ({ id: `p${index}`, name: `P${index}`, botLevel: 3 }));
  const first = freshGame(players, randomIndex, 'classic');
  const firstChoice = chooseBotAction(first, () => 0);
  assert.equal(firstChoice.plan.tactic, 'balance');
  const last = freshGame(players, randomIndex, 'classic');
  last.setupStart = 1; last.player = 0;
  const lastChoice = chooseBotAction(last, () => 0);
  assert.notEqual(firstChoice.plan.target, lastChoice.plan.target,
    'six intervening placements should change the expected second site');
  let game = applyBotChoice(last, lastChoice, die, randomIndex);
  assert.equal(game.phase, 'setup-road');
  assert.equal(game.players[0].resources.wood, 0);
  game = applyBotChoice(game, chooseBotAction(game, () => 0), die, randomIndex);
  assert.equal(game.phase, 'setup');
  assert.equal(game.setupRound, 2);
  const secondChoice = chooseBotAction(game, () => 0);
  assert.equal(secondChoice.action.index, lastChoice.plan.target);
  game = applyBotChoice(game, secondChoice, die, randomIndex);
  game = applyBotChoice(game, chooseBotAction(game, () => 0), die, randomIndex);
  assert.equal(game.owner.filter(owner => owner === 0).length, 2);
  assert.equal(game.roads.filter(owner => owner === 0).length, 2);

  const blocked = applyBotChoice(first, firstChoice, die, randomIndex);
  const afterRoad = applyBotChoice(blocked, chooseBotAction(blocked, () => 0), die, randomIndex);
  afterRoad.phase = 'setup'; afterRoad.setupRound = 2; afterRoad.player = 0;
  afterRoad.owner[firstChoice.plan.target] = 1;
  const replacement = chooseBotAction(afterRoad, () => 0);
  assert.notEqual(replacement.action.index, firstChoice.plan.target);
  assert.equal(canSettle(afterRoad, replacement.action.index), true);
});

test('classic opening can select road rush and harbor plans with empty hands', () => {
  const players = [0, 1, 2, 3].map(index => ({ id: `p${index}`, name: `P${index}`, botLevel: 3 }));
  const opening = run => {
    let seed = 100000 + run;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const game = freshGame(players, count => Math.floor(random() * count), 'classic', 'random');
    game.setupStart = 0; game.player = 0;
    return { game, choice: chooseBotAction(game, random) };
  };
  for (const [run, tactic] of [[0, 'harbor'], [1, 'road_rush']]) {
    const { game, choice } = opening(run);
    assert.equal(game.players[0].resources.wood + game.players[0].resources.brick, 0);
    assert.equal(choice.plan.tactic, tactic);
    const afterFirst = applyBotChoice(game, choice, die, randomIndex);
    afterFirst.phase = 'setup';
    assert.equal(canSettle(afterFirst, choice.plan.target), true);
  }
});

test('high-level robber favors the visible leader without reading hidden victory cards', () => {
  const game = freshGame([1, 3, 2].map((botLevel, index) => ({ id: `p${index}`, name: `P${index}`, botLevel })), randomIndex);
  game.phase = 'robber-move'; game.player = 1;
  game.layout = { tiles: board.tiles.map(() => ({ type: 'desert', number: null })), ports: board.ports.map(port => port.type) };
  game.layout.tiles[0] = { type: 'wheat', number: 6 };
  game.layout.tiles[11] = { type: 'wheat', number: 6 };
  game.owner[0] = 2; game.owner[35] = 0;
  game.longestRoad = 0;
  game.players[2].devCards = Array(4).fill(null).map(() => ({ type: 'victory', boughtOn: 1 }));
  assert.deepEqual(chooseBotAction(game, () => 0).action, { type: 'move-robber', index: 11 });
  game.players[1].botLevel = 2;
  assert.deepEqual(chooseBotAction(game, () => 0).action, { type: 'move-robber', index: 0 });
});

test('high-level robber targets road resources early and never blocks its own building when avoidable', () => {
  const game = freshGame([{ id: 'bot', name: 'Bot', botLevel: 3 }, { id: 'rival', name: 'Rival' }], randomIndex);
  game.phase = 'robber-move'; game.player = 0;
  game.layout = { tiles: board.tiles.map(() => ({ type: 'desert', number: null })), ports: board.ports.map(port => port.type) };
  game.layout.tiles[0] = { type: 'wheat', number: 6 };
  game.layout.tiles[11] = { type: 'brick', number: 6 };
  game.owner[0] = 1; game.owner[35] = 1;
  assert.equal(chooseBotAction(game, () => 0).action.index, 11);
  game.longestRoad = 1; game.largestArmy = 1;
  assert.equal(chooseBotAction(game, () => 0).action.index, 0);
  game.owner[0] = 0; game.city[0] = true;
  game.layout = { ...game.layout, tiles: game.layout.tiles.map(tile => ({ ...tile })) };
  game.layout.tiles[0] = { type: 'wood', number: 8 };
  game.layout.tiles[11] = { type: 'ore', number: 2 };
  assert.equal(chooseBotAction(game, () => 0).action.index, 11);
});

test('road-resource priority ends when opponents average six visible points', () => {
  const game = freshGame([3, 2, 2].map((botLevel, index) => ({ id: `p${index}`, name: `P${index}`, botLevel })), randomIndex);
  game.phase = 'robber-move'; game.player = 0;
  game.layout = { tiles: board.tiles.map(() => ({ type: 'desert', number: null })), ports: board.ports.map(port => port.type) };
  game.layout.tiles[0] = { type: 'wheat', number: 6 };
  game.layout.tiles[11] = { type: 'brick', number: 6 };
  for (const vertex of [0, 35, 52, 53]) game.owner[vertex] = 1;
  for (const vertex of [48, 49]) game.owner[vertex] = 2;
  game.longestRoad = 1; game.largestArmy = 1;
  // Opponents have 8 and 2 points: the leader is past six, but their average is five.
  assert.equal(chooseBotAction(game, () => 0).action.index, 11);
  game.city[48] = true; game.city[49] = true;
  // At 8 and 4 points the average is exactly six, so the bonus no longer applies.
  assert.equal(chooseBotAction(game, () => 0).action.index, 0);
});

test('high-level robber chooses a leading victim over a richer trailing victim', () => {
  const game = freshGame([3, 2, 2].map((botLevel, index) => ({ id: `p${index}`, name: `P${index}`, botLevel })), randomIndex);
  game.phase = 'robber-steal'; game.player = 0; game.robberVictims = [1, 2];
  game.owner[0] = 1; game.owner[35] = 2;
  game.longestRoad = 1; game.largestArmy = 1;
  game.players[1].resources = { wood: 2, brick: 0, wheat: 0, sheep: 0, ore: 0 };
  game.players[2].resources = { wood: 8, brick: 0, wheat: 0, sheep: 0, ore: 0 };
  assert.deepEqual(chooseBotAction(game, () => 0).action, { type: 'steal', victim: 1 });
  game.players[0].botLevel = 2;
  assert.deepEqual(chooseBotAction(game, () => 0).action, { type: 'steal', victim: 2 });
});
