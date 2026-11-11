import { normalizeLocalSession } from './local-save.js?v=classic-opening1';

export const LOCAL_LIBRARY_KEY = 'catan-hotseat-saves-v1';
const LEGACY_SAVE_KEY = 'catan-hotseat-v1';
const validId = id => typeof id === 'string' && /^[a-z0-9-]{1,80}$/i.test(id);
const emptyLibrary = () => ({ activeId: null, saves: [] });

export function loadLocalLibrary(storage) {
  const stored = storage.getItem(LOCAL_LIBRARY_KEY);
  if (stored !== null) {
    const parsed = JSON.parse(stored);
    if (!parsed || !Array.isArray(parsed.saves)) throw new Error('Список сохранений повреждён.');
    const saves = parsed.saves.flatMap(entry => {
      try {
        if (!validId(entry?.id)) return [];
        return [{ id: entry.id, updatedAt: Number.isSafeInteger(entry.updatedAt) && entry.updatedAt >= 0 && entry.updatedAt <= 8_640_000_000_000_000 ? entry.updatedAt : 0,
          session: normalizeLocalSession(entry.session) }];
      } catch { return []; }
    }).sort((a, b) => b.updatedAt - a.updatedAt);
    return { activeId: saves.some(entry => entry.id === parsed.activeId) ? parsed.activeId : saves[0]?.id ?? null, saves };
  }
  const legacy = storage.getItem(LEGACY_SAVE_KEY);
  if (!legacy) return emptyLibrary();
  const session = normalizeLocalSession(JSON.parse(legacy));
  const library = { activeId: 'legacy', saves: [{ id: 'legacy', updatedAt: Date.now(), session }] };
  try { storage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(library)); }
  catch { /* Keep the old save available even if the browser is out of space. */ }
  return library;
}

export function saveLocalLibrarySession(storage, session, id = crypto.randomUUID()) {
  if (!validId(id)) throw new Error('Некорректный номер сохранения.');
  const library = loadLocalLibrary(storage);
  const entry = { id, updatedAt: Date.now(), session: normalizeLocalSession(session) };
  library.saves = [entry, ...library.saves.filter(saved => saved.id !== id)];
  library.activeId = id;
  storage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(library));
  return entry;
}

export function selectLocalLibrarySession(storage, id) {
  const library = loadLocalLibrary(storage);
  const entry = library.saves.find(saved => saved.id === id);
  if (!entry) return null;
  library.activeId = id;
  storage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(library));
  return entry;
}

export function deleteLocalLibrarySession(storage, id) {
  const library = loadLocalLibrary(storage);
  library.saves = library.saves.filter(saved => saved.id !== id);
  if (library.activeId === id) library.activeId = library.saves[0]?.id ?? null;
  storage.setItem(LOCAL_LIBRARY_KEY, JSON.stringify(library));
  return library;
}
