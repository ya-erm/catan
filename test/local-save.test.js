import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, board, boardFor, canSettle, freshGame, replayBoardAt } from '../game.js';
import { hotseatSeat } from '../hotseat.js';
import { normalizeLocalSession, parseLocalFile, serializeLocalFile } from '../local-save.js';

const names = ['Аня', 'Борис', 'Вера'];
const makeSession = (ruleset, mapGeneration = 'fixed') => ({
  names,
  game: freshGame(names.map((name, index) => ({ id: `local-${index}`, name })), () => 0, ruleset, mapGeneration),
  revision: 0,
  colorOrder: [2, 0, 1, 3],
});

test('local file preserves the full game and resumes the next action', () => {
  const session = makeSession('new', 'random');
  session.game = applyAction(session.game, 0, { type: 'settlement', index: 0 });
  session.revision = 1;
  const restored = parseLocalFile(serializeLocalFile(session));
  assert.deepEqual(restored, session);
  assert.deepEqual(restored.game.layout, session.game.layout);
  assert.equal(hotseatSeat(restored.game), 1);
  const next = board.vertices.findIndex((_, index) => canSettle(restored.game, index));
  const continued = applyAction(restored.game, 1, { type: 'settlement', index: next });
  assert.equal(continued.owner[next], 1);
});

test('local files preserve the map option and infer it for older saves', () => {
  const fixed = makeSession('new');
  assert.equal(parseLocalFile(serializeLocalFile(fixed)).game.mapGeneration, 'fixed');
  const oldRandom = makeSession('new', 'random');
  delete oldRandom.game.mapGeneration;
  assert.equal(normalizeLocalSession(oldRandom).game.mapGeneration, 'random');
  const invalid = makeSession('new');
  invalid.game.mapGeneration = 'unknown';
  assert.throws(() => normalizeLocalSession(invalid), /повреждён/);
});

test('public action history reconstructs the board and survives a file round trip', () => {
  const session = makeSession('new');
  const first = 0;
  session.game = applyAction(session.game, 0, { type: 'settlement', index: first });
  const second = board.vertices.findIndex((_, index) => canSettle(session.game, index));
  session.game = applyAction(session.game, 1, { type: 'settlement', index: second });
  const restored = parseLocalFile(serializeLocalFile(session));
  assert.deepEqual(restored.game.history.map(event => event.type), ['start', 'settlement', 'settlement']);
  assert.ok(replayBoardAt(restored.game, 0).owner.every(owner => owner === null));
  assert.equal(replayBoardAt(restored.game, 1).owner[first], 0);
  assert.equal(replayBoardAt(restored.game, 1).owner[second], null);
  assert.equal(replayBoardAt(restored.game, 2).owner[second], 1);
  assert.ok(restored.game.history.every(event => !('resources' in event) && !('devCards' in event)));
});

test('older saves gain one board baseline before their next action', () => {
  const session = makeSession('new');
  delete session.game.history;
  session.game = applyAction(session.game, 0, { type: 'settlement', index: 0 });
  assert.deepEqual(session.game.history.map(event => event.type), ['baseline', 'settlement']);
  assert.equal(replayBoardAt(session.game, 0).owner[0], null);
  assert.equal(replayBoardAt(session.game, 1).owner[0], 0);
  assert.deepEqual(parseLocalFile(serializeLocalFile(session)).game.history, session.game.history);
});

test('local save keeps per-building production markers for replay', () => {
  const session = makeSession('new');
  const tileIndex = boardFor(session.game).tiles.findIndex(tile => tile.number);
  const tile = boardFor(session.game).tiles[tileIndex];
  session.game.phase = 'turn';
  session.game.owner[tile.corners[0]] = 0;
  session.game.city[tile.corners[0]] = true;
  const dice = tile.number <= 7 ? [1, tile.number - 1] : [6, tile.number - 6];
  session.game = applyAction(session.game, 0, { type: 'roll' }, () => dice.shift());
  const restored = parseLocalFile(serializeLocalFile(session));
  assert.ok(restored.game.history.at(-1).production.some(item =>
    item.tileIndex === tileIndex && item.vertex === tile.corners[0] && item.amount === 2));
  assert.deepEqual(replayBoardAt(restored.game, restored.game.history.length - 1).production,
    restored.game.history.at(-1).production);
});

test('classic game and pending interaction survive file round trip', () => {
  const session = makeSession('classic');
  session.game.phase = 'trade-offer';
  session.game.tradeOffer = { from: 0, to: 1,
    give: { wood: 1, brick: 0, wheat: 0, sheep: 0, ore: 0 },
    want: { wood: 0, brick: 0, wheat: 0, sheep: 1, ore: 0 } };
  const restored = parseLocalFile(serializeLocalFile(session));
  assert.equal(restored.game.ruleset, 'classic');
  assert.equal(restored.game.tradeOffer.to, 1);
  assert.equal(hotseatSeat(restored.game), 1);
  assert.deepEqual(restored.game.devDeck, session.game.devDeck);
});

test('invalid or incomplete saves are rejected', () => {
  const session = makeSession('new', 'random');
  assert.throws(() => parseLocalFile('{}'), /не файл локальной партии/);
  assert.throws(() => parseLocalFile(JSON.stringify({ format: 'catan-local-game', version: 2, session })), /Версия файла/);
  const privateView = structuredClone(session);
  delete privateView.game.devDeck;
  assert.throws(() => normalizeLocalSession(privateView), /повреждён/);
  const invalidLayout = structuredClone(session);
  invalidLayout.game.layout.tiles[0].number = 13;
  assert.throws(() => normalizeLocalSession(invalidLayout), /повреждён/);
  session.game.owner.pop();
  assert.throws(() => parseLocalFile(JSON.stringify({ format: 'catan-local-game', version: 1, session })), /повреждён/);
});
