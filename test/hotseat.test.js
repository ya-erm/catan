import test from 'node:test';
import assert from 'node:assert/strict';
import { freshGame, applyAction, board, canSettle } from '../game.js';
import { hotseatSeat, hotseatRoom } from '../hotseat.js';

const names = ['Аня', 'Борис', 'Вера'];
const makeGame = () => freshGame(names.map((name, index) => ({ id: `local-${index}`, name })), () => 0);

test('one-device turn handoff follows setup, seven discards, and trade replies', () => {
  let game = makeGame();
  assert.equal(hotseatSeat(game), 0);
  game = applyAction(game, 0, { type: 'settlement', index: 0 });
  assert.equal(hotseatSeat(game), 1);
  game = applyAction(game, 1, { type: 'settlement', index: board.vertices.findIndex((_, index) => canSettle(game, index)) });
  assert.equal(hotseatSeat(game), 2);
  game = applyAction(game, 2, { type: 'settlement', index: board.vertices.findIndex((_, index) => canSettle(game, index)) });
  assert.equal(hotseatSeat(game), 0);
  const dice = [3, 4];
  game = applyAction(game, 0, { type: 'roll' }, () => dice.shift());
  assert.equal(hotseatSeat(game), 0);
  game = applyAction(game, 0, { type: 'discard', resources: { wood: 2, brick: 2 } });
  assert.equal(hotseatSeat(game), 1);
  game = applyAction(game, 1, { type: 'discard', resources: { wood: 2, brick: 2 } });
  assert.equal(hotseatSeat(game), 2);
  game = applyAction(game, 2, { type: 'discard', resources: { wood: 2, brick: 2 } });
  assert.equal(hotseatSeat(game), 0);
  const target = board.tiles.findIndex((_, index) => index !== game.robberTile && !board.tiles[index].corners.some(vertex => game.owner[vertex] !== null));
  game = applyAction(game, 0, { type: 'move-robber', index: target });
  game = applyAction(game, 0, { type: 'offer-trade', to: 2, give: { wheat: 1 }, want: { sheep: 1 } });
  assert.equal(hotseatSeat(game), 2);
  game = applyAction(game, 2, { type: 'reject-trade' });
  assert.equal(hotseatSeat(game), 0);
  game = applyAction(game, 0, { type: 'end' });
  assert.equal(hotseatSeat(game), 1);
});

test('one-device view hides other players’ resources, development cards and deck', () => {
  const game = makeGame();
  game.players[1].devCards.push({ type: 'victory', boughtOn: 0 });
  const view = hotseatRoom(game, names, 0, 7);
  assert.equal(view.local, true);
  assert.equal(view.revision, 7);
  assert.equal(view.game.devDeck, undefined);
  assert.equal(view.game.players[0].resources.wood, 2);
  assert.equal(view.game.players[1].resources, null);
  assert.equal(view.game.players[1].devCards, null);
  assert.equal(view.game.players[1].devCardCount, 1);
  assert.equal(game.players[1].devCards[0].type, 'victory');
});

test('only players in a theft see which resource was stolen', () => {
  const game = makeGame();
  game.lastSteal = { id: 1, from: 1, to: 0, resource: 'ore' };
  assert.equal(hotseatRoom(game, names, 0, 1).game.lastSteal.resource, 'ore');
  assert.equal(hotseatRoom(game, names, 1, 1).game.lastSteal.resource, 'ore');
  assert.equal(hotseatRoom(game, names, 2, 1).game.lastSteal.resource, null);
  assert.equal(game.lastSteal.resource, 'ore');
});
