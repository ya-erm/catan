import { createServer } from 'node:http';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, statSync, createReadStream } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freshGame, applyAction, rulesetOf, mapGenerationOf, RESOURCE_KEYS, bankAvailable } from './game.js';
import { chooseBotAction, applyBotChoice, validBotLevel } from './bot.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ROOM_ID = /^[A-F0-9]{10}$/;
const hashSession = token => token ? createHash('sha256').update(token).digest('hex') : null;
function sessionToken(req) {
  const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('catan_session='))?.slice(14);
  return /^[A-Za-z0-9_-]{43}$/.test(token || '') ? token : null;
}
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function nameFrom(value) {
  if (typeof value !== 'string') fail(400, 'Введите своё имя.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || Array.from(name).length > 24 || /[\x00-\x1f\x7f]/.test(name)) fail(400, 'Имя должно содержать от 1 до 24 символов.');
  return name;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Ожидается JSON.');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) fail(413, 'Слишком большой запрос.');
  }
  try {
    const data = JSON.parse(body);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { fail(400, 'Некорректный запрос.'); }
}

export function createApp({ dataDir = join(ROOT, 'data'), publicDir = ROOT, secureCookies = false, publicOrigin = '', die = () => randomInt(1, 7) } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const rooms = new Map();
  const streams = new Map();
  const rates = new Map();
  for (const file of readdirSync(dataDir)) {
    if (!/^[A-F0-9]{10}\.json$/.test(file)) continue;
    const room = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
    if (room.id !== file.slice(0, -5) || !Array.isArray(room.members)) throw new Error(`Invalid saved room: ${file}`);
    rooms.set(room.id, room);
  }
  function persist(room) {
    const target = join(dataDir, `${room.id}.json`);
    writeFileSync(`${target}.tmp`, JSON.stringify(room), { mode: 0o600 });
    renameSync(`${target}.tmp`, target);
    rooms.set(room.id, room);
  }
  function isOnline(roomId, memberId) {
    return [...(streams.get(roomId) || [])].some(stream => stream.memberId === memberId);
  }
  const roomMapGeneration = room => room.mapGeneration || room.game?.mapGeneration || (room.game && !room.game.layout ? 'fixed' : 'random');
  function snapshot(room, sessionHash) {
    const index = room.members.findIndex(member => sessionHash && member.sessionHash === sessionHash);
    const game = index >= 0 && room.game ? structuredClone(room.game) : null;
    if (game) {
      delete game.botPlans;
      if (game.lastSteal && index !== game.lastSteal.from && index !== game.lastSteal.to) game.lastSteal.resource = null;
      if (game.ruleset === 'classic') game.bank = Object.fromEntries(RESOURCE_KEYS.map(key => [key, bankAvailable(game, key)]));
      game.devDeckCount = game.devDeck?.length ?? 25;
      delete game.devDeck;
      game.players = game.players.map((player, i) => ({
        ...player, resourceTotal: Object.values(player.resources).reduce((sum, amount) => sum + amount, 0),
        devCardCount: player.devCards?.length ?? 0,
        resources: i === index ? player.resources : null,
        devCards: i === index ? (player.devCards || []) : null,
      }));
    }
    return {
      id: room.id, revision: room.revision, ruleset: room.ruleset || 'new', mapGeneration: roomMapGeneration(room), me: index >= 0 ? index : null, host: index === 0,
      status: room.game ? (room.game.winner !== null ? 'finished' : 'playing') : 'lobby',
      members: room.members.map(({ id, name, colorIndex, botLevel }, i) => ({ id, name, colorIndex: colorIndex ?? i, host: i === 0, online: !!botLevel || isOnline(room.id, id), ...(botLevel ? { botLevel } : {}) })),
      game,
    };
  }
  function broadcast(roomId) {
    const room = rooms.get(roomId);
    for (const stream of streams.get(roomId) || []) {
      stream.res.write(`event: state\ndata: ${JSON.stringify(snapshot(room, stream.sessionHash))}\n\n`);
    }
  }
  function limit(key, maximum) {
    const time = Date.now();
    let entry = rates.get(key);
    if (!entry || entry.until < time) { entry = { count: 0, until: time + 60_000 }; rates.set(key, entry); }
    if (++entry.count > maximum) fail(429, 'Слишком много запросов. Попробуйте через минуту.');
  }
  function setSession(req, res) {
    const token = sessionToken(req) || randomBytes(32).toString('base64url');
    res.setHeader('Set-Cookie', `catan_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureCookies ? '; Secure' : ''}`);
    return hashSession(token);
  }
  function streamRoom(req, res, room, sessionHash) {
    const member = room.members.find(person => sessionHash && person.sessionHash === sessionHash);
    if (!member) fail(403, 'Сначала присоединитесь к комнате.');
    let clients = streams.get(room.id);
    if (!clients) { clients = new Set(); streams.set(room.id, clients); }
    if (clients.size >= 20) fail(429, 'Слишком много открытых вкладок этой комнаты.');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const client = { res, sessionHash, memberId: member.id };
    clients.add(client);
    broadcast(room.id);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    heartbeat.unref();
    res.on('close', () => {
      clearInterval(heartbeat); clients.delete(client);
      if (!clients.size) streams.delete(room.id);
      broadcast(room.id);
    });
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://catan.local');
      const path = url.pathname;
      if (path === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true });
      if (path.startsWith('/api/')) {
        if (req.method === 'POST') {
          const origin = req.headers.origin;
          if (origin && (publicOrigin ? origin !== publicOrigin : new URL(origin).host !== req.headers.host)) fail(403, 'Запрос с другого сайта запрещён.');
        }
        let sessionHash = hashSession(sessionToken(req));
        if (path === '/api/rooms' && req.method === 'POST') {
          limit(`create:${req.socket.remoteAddress}`, 30);
          const body = await readBody(req);
          const name = nameFrom(body.name);
          let ruleset, mapGeneration;
          try { ruleset = rulesetOf(body.ruleset ?? 'new'); } catch { fail(400, 'Неизвестный набор правил.'); }
          try { mapGeneration = mapGenerationOf(body.mapGeneration ?? 'fixed'); } catch { fail(400, 'Неизвестный вариант генерации карты.'); }
          if (rooms.size >= 2000) fail(503, 'Сервер заполнен. Попробуйте позднее.');
          sessionHash = setSession(req, res);
          let id;
          do { id = randomBytes(5).toString('hex').toUpperCase(); } while (rooms.has(id));
          const room = { id, revision: 0, createdAt: Date.now(), ruleset: ruleset.id, mapGeneration: mapGeneration.id, members: [{ id: randomBytes(8).toString('hex'), name, sessionHash }], game: null };
          persist(room);
          return json(res, 201, snapshot(room, sessionHash));
        }
        const match = path.match(/^\/api\/rooms\/([A-F0-9]{10})(?:\/(join|actions|events))?$/);
        if (!match || !ROOM_ID.test(match[1])) fail(404, 'Комната не найдена. Проверьте ссылку.');
        let room = rooms.get(match[1]);
        if (!room) fail(404, 'Комната не найдена. Проверьте ссылку.');
        const route = match[2];
        if (req.method === 'GET' && !route) return json(res, 200, snapshot(room, sessionHash));
        if (req.method === 'GET' && route === 'events') return streamRoom(req, res, room, sessionHash);
        if (req.method !== 'POST') fail(405, 'Этот метод не поддерживается.');
        const body = await readBody(req);
        // Body reads are asynchronous: use the latest revision before committing.
        room = rooms.get(match[1]);
        if (route === 'join') {
          limit(`join:${req.socket.remoteAddress}`, 60);
          if (sessionHash && room.members.some(member => member.sessionHash === sessionHash)) {
            setSession(req, res);
            return json(res, 200, snapshot(room, sessionHash));
          }
          if (room.game) fail(409, 'Партия уже началась. Новые игроки смогут войти перед следующей партией.');
          if (room.members.length >= 4) fail(409, 'Комната заполнена: максимум 4 игрока.');
          const name = nameFrom(body.name);
          if (room.members.some(member => member.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail(409, 'Это имя уже занято. Выберите другое.');
          sessionHash = setSession(req, res);
          const next = structuredClone(room);
          next.members.push({ id: randomBytes(8).toString('hex'), name, sessionHash });
          next.revision++;
          persist(next); broadcast(next.id);
          return json(res, 200, snapshot(next, sessionHash));
        }
        if (route !== 'actions') fail(404, 'Неизвестный адрес.');
        const actor = room.members.findIndex(member => sessionHash && member.sessionHash === sessionHash);
        if (actor < 0) fail(403, 'Сначала присоединитесь к комнате.');
        limit(`actions:${sessionHash}`, 120);
        if (body.revision !== room.revision) fail(409, 'Партия обновилась. Повторите действие.');
        const next = structuredClone(room);
        if (body.type === 'add-bot') {
          if (actor !== 0 || next.game) fail(403, 'Добавлять ботов может создатель до начала партии.');
          if (next.members.length >= 4) fail(409, 'В комнате уже четыре игрока.');
          if (!validBotLevel(body.level)) fail(400, 'Выберите сложность бота от 1 до 3.');
          let number = next.members.filter(member => member.botLevel).length + 1;
          let name = `Бот ${number}`;
          while (next.members.some(member => member.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `Бот ${++number}`;
          next.members.push({ id: randomBytes(8).toString('hex'), name, botLevel: body.level, sessionHash: null });
        } else if (body.type === 'remove-bot') {
          if (actor !== 0 || next.game) fail(403, 'Убирать ботов может создатель до начала партии.');
          const index = next.members.findIndex(member => member.id === body.id && member.botLevel);
          if (index < 0) fail(404, 'Бот не найден.');
          next.members.splice(index, 1);
        } else if (body.type === 'update-profile') {
          const name = nameFrom(body.name);
          const colorIndex = body.colorIndex;
          if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex > 7) fail(400, 'Выберите цвет игрока.');
          if (next.members.some((member, index) => index !== actor && member.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail(409, 'Это имя уже занято. Выберите другое.');
          if (next.members.some((member, index) => index !== actor && (member.colorIndex ?? index) === colorIndex)) fail(409, 'Этот цвет уже занят. Выберите другой.');
          next.members[actor].name = name;
          next.members[actor].colorIndex = colorIndex;
          if (next.game) next.game.players[actor].name = name;
        } else if (body.type === 'start') {
          if (actor !== 0) fail(403, 'Партию запускает создатель комнаты.');
          if (next.game) fail(409, 'Партия уже началась.');
          if (next.members.length < 2) fail(400, 'Пригласите хотя бы одного игрока.');
          try { next.game = freshGame(next.members, count => randomInt(count), next.ruleset || 'new', roomMapGeneration(next)); }
          catch (error) { fail(400, error.message); }
        } else if (body.type === 'restart') {
          if (actor !== 0) fail(403, 'Новую партию создаёт хозяин комнаты.');
          if (!next.game || next.game.winner === null) fail(409, 'Сначала завершите текущую партию.');
          next.game = null;
        } else {
          if (!next.game) fail(409, 'Дождитесь начала партии.');
          try { next.game = applyAction(next.game, actor, body, die, count => randomInt(count)); }
          catch (error) { fail(400, error.message); }
        }
        if (next.game) {
          for (let step = 0; step < 100; step++) {
            const choice = chooseBotAction(next.game);
            if (!choice) break;
            next.game = applyBotChoice(next.game, choice, die, count => randomInt(count));
            if (step === 99) fail(500, 'Бот сделал слишком много действий подряд.');
          }
        }
        next.revision++;
        persist(next); broadcast(next.id);
        return json(res, 200, snapshot(next, sessionHash));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Этот метод не поддерживается.');
      const relative = decodeURIComponent(path).replace(/^\/+/, '') || 'index.html';
      const allowed = ['index.html', 'app.js', 'game.js', 'bot.js', 'hotseat.js', 'local-save.js', 'style.css'].includes(relative) || /^assets\/[a-zA-Z0-9/_-]+\.(png|svg|webp|mp3)$/.test(relative);
      const target = resolve(publicDir, relative);
      if (!allowed || !target.startsWith(resolve(publicDir) + '/')) fail(404, 'Файл не найден.');
      let stat;
      try { stat = statSync(target); } catch { fail(404, 'Файл не найден.'); }
      if (!stat.isFile()) fail(404, 'Файл не найден.');
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg' }[extname(target)];
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': relative.startsWith('assets/') ? 'public, max-age=3600' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(target).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      if (!error.status) console.error('Catan request failed:', error.message);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Ошибка сервера. Попробуйте ещё раз.' });
      else res.end();
    }
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 20_000;
  const cleanup = setInterval(() => { for (const [key, entry] of rates) if (entry.until < Date.now()) rates.delete(key); }, 60_000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  function closeStreams() { for (const clients of streams.values()) for (const client of clients) client.res.end(); }
  return { server, closeStreams };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server, closeStreams } = createApp({
    dataDir: process.env.DATA_DIR || join(ROOT, 'data'),
    secureCookies: process.env.SECURE_COOKIES === 'true',
    publicOrigin: process.env.PUBLIC_ORIGIN || '',
  });
  const port = Number(process.env.PORT || 4173);
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Catan listening on port ${port}`));
  const stop = () => { closeStreams(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
