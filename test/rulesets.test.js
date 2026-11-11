import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, bankAvailable, board, boardFor, canCity, canRoad, canSettle, freshGame, mapGenerationOf, pieceSupply, rulesetOf, score, validBoardLayout } from '../game.js';

const players = ['Аня', 'Борис', 'Вера'].map((name, index) => ({ id: String(index), name }));
const randomIndex = () => 0;

test('fixed maps reuse the base board and random maps store a valid shuffled layout', () => {
  const seeded = seed => {
    let value = seed;
    return count => ((value = (value * 1664525 + 1013904223) >>> 0) % count);
  };
  const fixed = freshGame(players, seeded(123));
  const fixedAgain = freshGame(players, seeded(456));
  assert.equal(fixed.mapGeneration, 'fixed');
  assert.equal(boardFor(fixed), board);
  assert.equal(boardFor(fixedAgain), board);
  assert.equal(fixed.robberTile, board.tiles.findIndex(tile => tile.type === 'desert'));
  assert.equal(Object.hasOwn(fixed, 'layout'), false);
  const first = freshGame(players, seeded(123), 'new', 'random');
  const second = freshGame(players, seeded(456), 'new', 'random');
  assert.equal(first.mapGeneration, 'random');
  assert.ok(validBoardLayout(first.layout));
  assert.ok(validBoardLayout(second.layout));
  assert.notDeepEqual(first.layout, second.layout);
  assert.deepEqual([...first.layout.ports].sort(), board.ports.map(port => port.type).sort());
  assert.deepEqual([...second.layout.ports].sort(), [...first.layout.ports].sort());
  assert.notDeepEqual(first.layout.ports, second.layout.ports);
  assert.deepEqual(boardFor(first).ports.map(port => port.type), first.layout.ports);
  assert.equal(boardFor(first).tiles[first.robberTile].type, 'desert');
  assert.deepEqual(boardFor(first).tiles.map(tile => [tile.type, tile.number]), first.layout.tiles.map(tile => [tile.type, tile.number]));
  delete first.layout;
  assert.equal(boardFor(first), board);
  assert.equal(mapGenerationOf('random').name, 'Случайная карта');
  assert.throws(() => mapGenerationOf('unknown'), /Неизвестный вариант/);
  assert.throws(() => freshGame(players, seeded(123), 'new', 'unknown'), /Неизвестный вариант/);
});

test('ruleset registry validates players and preserves the existing default', () => {
  assert.equal(rulesetOf('classic').minPlayers, 3);
  assert.throws(() => rulesetOf('unknown'), /Неизвестный набор/);
  assert.throws(() => freshGame(players.slice(0, 2), randomIndex, 'classic'), /от 3 до 4/);
  const modern = freshGame(players.slice(0, 2), randomIndex);
  assert.equal(modern.ruleset, 'new');
  assert.equal(modern.players[0].resources.wood, 2);
});

test('classic setup places two settlements and adjacent roads in snake order', () => {
  let game = freshGame(players, randomIndex, 'classic');
  const sequence = [0, 1, 2, 2, 1, 0];
  const secondVertices = [];
  for (let step = 0; step < sequence.length; step++) {
    const actor = sequence[step];
    assert.equal(game.player, actor);
    assert.equal(game.phase, 'setup');
    const vertex = board.vertices.findIndex((_, index) => canSettle(game, index));
    if (step >= players.length) secondVertices[actor] = vertex;
    game = applyAction(game, actor, { type: 'settlement', index: vertex });
    assert.equal(game.phase, 'setup-road');
    assert.equal(game.player, actor);
    assert.equal(game.players[actor].resources.wood + game.players[actor].resources.brick + game.players[actor].resources.wheat + game.players[actor].resources.sheep + game.players[actor].resources.ore, 0);
    const edge = board.edges.findIndex((_, index) => canRoad(game, index));
    const connected = board.edges[edge];
    assert.ok(connected.a === vertex || connected.b === vertex);
    game = applyAction(game, actor, { type: 'road', index: edge });
  }
  assert.equal(game.phase, 'turn');
  assert.equal(game.player, 0);
  for (let player = 0; player < 3; player++) {
    assert.equal(score(game, player), 2);
    assert.equal(game.roads.filter(owner => owner === player).length, 2);
    for (const key of ['wood', 'brick', 'wheat', 'sheep', 'ore']) {
      const expected = boardFor(game).tiles.filter(tile => tile.corners.includes(secondVertices[player]) && tile.type === key).length;
      assert.equal(game.players[player].resources[key], expected);
    }
  }
});

test('classic setup can start with another player', () => {
  let game = freshGame(players, () => 1, 'classic');
  for (const actor of [1, 2, 0, 0, 2, 1]) {
    assert.equal(game.player, actor);
    const vertex = board.vertices.findIndex((_, index) => canSettle(game, index));
    game = applyAction(game, actor, { type: 'settlement', index: vertex });
    const edge = board.edges.findIndex((_, index) => canRoad(game, index));
    game = applyAction(game, actor, { type: 'road', index: edge });
  }
  assert.equal(game.player, 1);
  assert.equal(game.phase, 'turn');
});

test('classic bank cancels shared production when a resource runs out', () => {
  const game = freshGame(players, randomIndex, 'classic');
  game.phase = 'turn';
  const tile = boardFor(game).tiles.find(tile => tile.number && tile.type !== 'desert');
  game.owner[tile.corners[0]] = 0;
  game.owner[tile.corners[1]] = 1;
  game.players[0].resources[tile.type] = 18;
  assert.equal(bankAvailable(game, tile.type), 1);
  const dice = tile.number <= 7 ? [1, tile.number - 1] : [6, tile.number - 6];
  const rolled = applyAction(game, 0, { type: 'roll' }, () => dice.shift());
  assert.equal(rolled.players[0].resources[tile.type], 18);
  assert.equal(rolled.players[1].resources[tile.type], 0);
  assert.equal(rolled.lastProduction.length, 0);
});

test('classic settlement supply frees a piece when upgraded to a city', () => {
  const game = freshGame(players, randomIndex, 'classic');
  game.players[0].resources = { wood: 10, brick: 10, wheat: 10, sheep: 10, ore: 10 };
  const occupied = [];
  for (let index = 0; index < board.vertices.length && occupied.length < 5; index++) {
    if (!canSettle(game, index)) continue;
    game.owner[index] = 0;
    occupied.push(index);
  }
  const open = board.vertices.findIndex((_, index) => game.owner[index] === null &&
    board.vertices[index].edges.every(edgeId => {
      const edge = board.edges[edgeId];
      return game.owner[edge.a === index ? edge.b : edge.a] === null;
    }));
  const edge = board.vertices[open].edges[0];
  game.roads[edge] = 0;
  game.phase = 'turn';
  game.rolled = true;
  assert.deepEqual(pieceSupply(game, 0, 'settlement'), { used: 5, limit: 5, remaining: 0 });
  assert.deepEqual(pieceSupply(game, 0, 'city'), { used: 0, limit: 4, remaining: 4 });
  assert.equal(canSettle(game, open), false);
  assert.equal(canCity(game, occupied[0]), true);
  game.city[occupied[0]] = true;
  assert.deepEqual(pieceSupply(game, 0, 'settlement'), { used: 4, limit: 5, remaining: 1 });
  assert.deepEqual(pieceSupply(game, 0, 'city'), { used: 1, limit: 4, remaining: 3 });
  assert.equal(canSettle(game, open), true);
  for (const vertex of occupied.slice(1, 4)) game.city[vertex] = true;
  assert.deepEqual(pieceSupply(game, 0, 'city'), { used: 4, limit: 4, remaining: 0 });
  assert.equal(canCity(game, occupied[4]), false);
});
