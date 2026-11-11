import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, board, freshGame, longestRoadLength, refreshLongestRoad, score, VICTORY_POINTS } from '../game.js';

const newGame = () => freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }], () => 0);

function trail(start, length, forbidden = new Set()) {
  const edges = [];
  const vertices = [start];
  function visit(vertex) {
    if (edges.length === length) return true;
    for (const edgeId of board.vertices[vertex].edges) {
      if (forbidden.has(edgeId) || edges.includes(edgeId)) continue;
      const edge = board.edges[edgeId];
      const next = edge.a === vertex ? edge.b : edge.a;
      if (vertices.includes(next)) continue;
      edges.push(edgeId);
      vertices.push(next);
      if (visit(next)) return true;
      edges.pop();
      vertices.pop();
    }
    return false;
  }
  assert.ok(visit(start));
  return { edges, vertices };
}

test('five connected roads award two points; a branch is not added to the route', () => {
  let game = newGame();
  const path = trail(0, 5);
  game.phase = 'turn'; game.rolled = true;
  game.owner[path.vertices[0]] = 0;
  for (const edge of path.edges.slice(0, 4)) game.roads[edge] = 0;
  assert.equal(longestRoadLength(game, 0), 4);
  assert.equal(refreshLongestRoad(game).current, null);
  game = applyAction(game, 0, { type: 'road', index: path.edges[4] });
  assert.equal(game.longestRoad, 0);
  assert.equal(score(game, 0), 3);
  const spur = board.vertices[path.vertices[2]].edges.find(edge => !path.edges.includes(edge));
  game.roads[spur] = 0;
  assert.equal(longestRoadLength(game, 0), 5);
});

test('an opposing settlement splits a road and removes its award', () => {
  let game = newGame();
  const path = trail(0, 5);
  game.phase = 'turn'; game.rolled = true; game.player = 1;
  for (const edge of path.edges) game.roads[edge] = 0;
  game.longestRoad = 0;
  const crossing = path.vertices[2];
  const access = board.vertices[crossing].edges.find(edge => !path.edges.includes(edge));
  game.roads[access] = 1;
  game = applyAction(game, 1, { type: 'settlement', index: crossing });
  assert.equal(longestRoadLength(game, 0), 3);
  assert.equal(game.longestRoad, null);
  assert.equal(score(game, 0), 0);
});

test('road holder keeps a tie; a strictly longer road takes the award', () => {
  const game = newGame();
  const first = trail(0, 5);
  const second = trail(board.vertices.length - 1, 6, new Set(first.edges));
  for (const edge of first.edges) game.roads[edge] = 0;
  for (const edge of second.edges.slice(0, 5)) game.roads[edge] = 1;
  assert.equal(refreshLongestRoad(game).current, null);
  game.longestRoad = 0;
  assert.equal(refreshLongestRoad(game).current, 0);
  game.roads[second.edges[5]] = 1;
  assert.equal(refreshLongestRoad(game).current, 1);
  assert.equal(score(game, 1), 2);
});

test('largest army transfers only after another player exceeds its knight count', () => {
  let game = newGame();
  game.phase = 'turn'; game.turnNumber = 2;
  game.players[0].knightsPlayed = 3; game.largestArmy = 0;
  game.player = 1; game.players[1].knightsPlayed = 2;
  game.players[1].devCards = [{ type: 'knight', boughtOn: 0 }];
  game = applyAction(game, 1, { type: 'play-dev', card: 'knight' });
  assert.equal(game.players[1].knightsPlayed, 2);
  game = applyAction(game, 1, { type: 'move-robber', index: board.tiles.findIndex((_, index) => index !== game.robberTile) });
  assert.equal(game.largestArmy, 0);
  game.phase = 'turn'; game.devPlayed = false;
  game.players[1].devCards = [{ type: 'knight', boughtOn: 0 }];
  game = applyAction(game, 1, { type: 'play-dev', card: 'knight' });
  assert.equal(game.largestArmy, 0);
  game = applyAction(game, 1, { type: 'move-robber', index: board.tiles.findIndex((_, index) => index !== game.robberTile) });
  assert.equal(game.largestArmy, 1);
  assert.equal(score(game, 1), 2);
});

test('a knight stays in hand until the robber moves and can be cancelled', () => {
  let game = newGame();
  game.phase = 'turn'; game.turnNumber = 2;
  game.players[0].devCards = [{ type: 'knight', boughtOn: 0 }];
  game = applyAction(game, 0, { type: 'play-dev', card: 'knight' });
  assert.equal(game.phase, 'robber-move');
  assert.equal(game.players[0].devCards.length, 1);
  assert.equal(game.players[0].knightsPlayed, 0);
  assert.equal(game.devPlayed, false);
  game = applyAction(game, 0, { type: 'cancel-knight' });
  assert.equal(game.phase, 'turn');
  assert.equal(game.players[0].devCards.length, 1);
  assert.equal(game.devPlayed, false);
  assert.throws(() => applyAction(game, 0, { type: 'cancel-knight' }), /нельзя отменить/);
  game = applyAction(game, 0, { type: 'play-dev', card: 'knight' });
  const target = board.tiles.findIndex((_, index) => index !== game.robberTile);
  game = applyAction(game, 0, { type: 'move-robber', index: target });
  assert.equal(game.players[0].devCards.length, 0);
  assert.equal(game.players[0].knightsPlayed, 1);
  assert.equal(game.devPlayed, true);
  const seven = newGame();
  seven.phase = 'robber-move'; seven.robberSource = 'seven';
  assert.throws(() => applyAction(seven, seven.player, { type: 'cancel-knight' }), /нельзя отменить/);
});

test('victory requires ten points on the active player turn', () => {
  let game = newGame();
  game.phase = 'turn'; game.rolled = true;
  for (let vertex = 0; vertex < 9; vertex++) game.owner[vertex] = 0;
  game.players[0].resources.wood = 8;
  assert.equal(VICTORY_POINTS, 10);
  game = applyAction(game, 0, { type: 'trade', from: 'wood', to: 'brick' });
  assert.equal(game.winner, null);
  game.owner[9] = 0;
  game = applyAction(game, 0, { type: 'trade', from: 'wood', to: 'brick' });
  assert.equal(game.winner, 0);
});
