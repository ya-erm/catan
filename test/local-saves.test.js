import test from 'node:test';
import assert from 'node:assert/strict';
import { freshGame } from '../game.js';
import { LOCAL_LIBRARY_KEY, loadLocalLibrary, saveLocalLibrarySession,
  selectLocalLibrarySession, deleteLocalLibrarySession } from '../local-saves.js';

const storage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};
const session = (first, second) => {
  const names = [first, second];
  return { names, game: freshGame(names.map((name, index) => ({ id: `local-${index}`, name })), () => 0),
    revision: 0, colorOrder: [0, 1, 2, 3] };
};

test('old single save becomes a library entry and stays deleted', () => {
  const browser = storage();
  browser.setItem('catan-hotseat-v1', JSON.stringify(session('Саша', 'Маша')));
  const migrated = loadLocalLibrary(browser);
  assert.equal(migrated.saves.length, 1);
  assert.deepEqual(migrated.saves[0].session.names, ['Саша', 'Маша']);
  assert.equal(migrated.activeId, 'legacy');
  deleteLocalLibrarySession(browser, 'legacy');
  assert.deepEqual(loadLocalLibrary(browser).saves, []);
  assert.ok(browser.getItem(LOCAL_LIBRARY_KEY));
});

test('separate games can be resumed, updated and deleted independently', () => {
  const browser = storage();
  saveLocalLibrarySession(browser, session('Аня', 'Борис'), 'first');
  saveLocalLibrarySession(browser, session('Вера', 'Глеб'), 'second');
  saveLocalLibrarySession(browser, session('Даша', 'Егор'), 'third');
  assert.deepEqual(loadLocalLibrary(browser).saves.map(entry => entry.id), ['third', 'second', 'first']);
  assert.equal(selectLocalLibrarySession(browser, 'first').session.names[0], 'Аня');
  assert.equal(loadLocalLibrary(browser).activeId, 'first');
  const updated = session('Аня', 'Борис');
  updated.revision = 1;
  saveLocalLibrarySession(browser, updated, 'first');
  assert.deepEqual(loadLocalLibrary(browser).saves.map(entry => entry.id), ['first', 'third', 'second']);
  assert.equal(loadLocalLibrary(browser).saves[0].session.revision, 1);
  deleteLocalLibrarySession(browser, 'third');
  assert.deepEqual(loadLocalLibrary(browser).saves.map(entry => entry.id), ['first', 'second']);
  deleteLocalLibrarySession(browser, 'first');
  assert.equal(loadLocalLibrary(browser).activeId, 'second');
});
