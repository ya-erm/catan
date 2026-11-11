import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { createApp } from '../server.js';
import { freshGame, applyAction, board, boardFor, canSettle, canRoad, score, harborRate, replayBoardAt } from '../game.js';

async function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'catan-test-'));
  let app, origin;
  async function start() {
    app = createApp({ dataDir, die: () => 3 });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function stop() {
    app.closeStreams();
    await new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); });
  }
  await start();
  t.after(async () => { await stop(); rmSync(dataDir, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    return {
      get cookie() { return cookie; },
      async request(path, body, headers = {}) {
        const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
          headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        return { status: response.status, body: await response.json(), headers: response.headers };
      },
    };
  }
  return { client, get origin() { return origin; }, restart: async () => { await stop(); await start(); } };
}
const action = (client, room, type, details = {}) => client.request(`/api/rooms/${room.id}/actions`, { revision: room.revision, type, ...details });
test('host can add bots to an online room and the server plays their turns', async t => {
  const f = await fixture(t);
  const host = f.client();
  let room = (await host.request('/api/rooms', { name: 'Хозяин' })).body;
  const added = await action(host, room, 'add-bot', { level: 3 });
  assert.equal(added.status, 200);
  room = added.body;
  assert.equal(room.members[1].botLevel, 3);
  assert.equal(room.members[1].online, true);
  const outsider = f.client();
  const privateView = await outsider.request(`/api/rooms/${room.id}`);
  assert.equal(privateView.body.me, null);
  assert.equal((await action(outsider, room, 'roll')).status, 403);
  room = (await action(host, room, 'start')).body;
  assert.equal(room.game.players[1].botLevel, 3);
  const settlement = board.vertices.findIndex((_, index) => canSettle(room.game, index));
  room = (await action(host, room, 'settlement', { index: settlement })).body;
  assert.equal(room.game.phase, 'turn');
  assert.equal(room.game.player, 0);
  assert.ok(room.game.owner.includes(1));
  room = (await action(host, room, 'roll')).body;
  room = (await action(host, room, 'end')).body;
  if (room.game.phase === 'trade-offer') {
    assert.equal(room.game.tradeOffer.to, 0);
    room = (await action(host, room, 'reject-trade')).body;
  }
  assert.equal(room.game.player, 0);
  assert.equal(room.game.round, 2);
  assert.ok(room.game.history.some(event => event.actor === 1 && event.type === 'roll'));
});
test('two friends can fill a four-seat room with two bots', async t => {
  const f = await fixture(t);
  const host = f.client(), friend = f.client();
  let room = (await host.request('/api/rooms', { name: 'Саша' })).body;
  room = (await friend.request(`/api/rooms/${room.id}/join`, { name: 'Маша' })).body;
  room = (await action(host, room, 'add-bot', { level: 1 })).body;
  room = (await action(host, room, 'add-bot', { level: 3 })).body;
  assert.deepEqual(room.members.map(member => member.botLevel || 0), [0, 0, 1, 3]);
  assert.equal((await f.client().request(`/api/rooms/${room.id}/join`, { name: 'Ещё друг' })).status, 409);
  const started = await action(host, room, 'start');
  assert.equal(started.status, 200);
  assert.equal(started.body.game.players.length, 4);
  assert.equal(started.body.game.players[3].botLevel, 3);
});
test('a player can update their own name and color during a game', async t => {
  const f = await fixture(t);
  const { clients, room } = await createParty(f);
  const changed = await action(clients[1], room, 'update-profile', { name: 'Маша', colorIndex: 5 });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.members[1].name, 'Маша');
  assert.equal(changed.body.members[1].colorIndex, 5);
  assert.equal(changed.body.game.players[1].name, 'Маша');
  const duplicate = await action(clients[0], changed.body, 'update-profile', { name: 'Маша', colorIndex: 0 });
  assert.equal(duplicate.status, 409);
  const occupied = await action(clients[0], changed.body, 'update-profile', { name: 'Хозяин', colorIndex: 5 });
  assert.equal(occupied.status, 409);
  await f.restart();
  const reloaded = await clients[0].request(`/api/rooms/${room.id}`);
  assert.equal(reloaded.body.game.players[1].name, 'Маша');
  assert.equal(reloaded.body.members[1].colorIndex, 5);
});
async function createParty(f, count = 2) {
  const clients = Array.from({ length: count }, () => f.client());
  let room = (await clients[0].request('/api/rooms', { name: 'Хозяин' })).body;
  for (let i = 1; i < count; i++) room = (await clients[i].request(`/api/rooms/${room.id}/join`, { name: `Друг ${i}` })).body;
  room = (await action(clients[0], room, 'start')).body;
  for (let i = 0; i < count; i++) {
    const index = board.vertices.findIndex((_, index) => canSettle(room.game, index));
    const result = await action(clients[i], room, 'settlement', { index });
    assert.equal(result.status, 200);
    room = result.body;
  }
  return { clients, room };
}

test('online room exposes public replay events without private cards', async t => {
  const f = await fixture(t);
  const { clients, room } = await createParty(f);
  assert.deepEqual(room.game.history.map(event => event.type), ['start', 'settlement', 'settlement']);
  assert.equal(room.game.history[1].actor, 0);
  assert.ok(room.game.history.every(event => !('resources' in event) && !('devCards' in event)));
  const reloaded = await clients[1].request(`/api/rooms/${room.id}`);
  assert.deepEqual(reloaded.body.game.history, room.game.history);
});

test('online API accepts a request-only offer and a one-sided counteroffer', async t => {
  const f = await fixture(t);
  const { clients, room: started } = await createParty(f);
  const rolled = await action(clients[0], started, 'roll');
  assert.equal(rolled.status, 200);

  const requested = await action(clients[0], rolled.body, 'offer-trade', { to: 1, give: {}, want: { ore: 1 } });
  assert.equal(requested.status, 200);
  assert.deepEqual(requested.body.game.tradeOffer.give, { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });
  const accepted = await action(clients[1], requested.body, 'accept-trade');
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.game.phase, 'turn');

  const proposed = await action(clients[0], accepted.body, 'offer-trade', { to: 1, give: { wood: 1 }, want: { brick: 1 } });
  assert.equal(proposed.status, 200);
  const countered = await action(clients[1], proposed.body, 'counter-trade', { give: {}, want: { wood: 1 } });
  assert.equal(countered.status, 200);
  assert.equal(countered.body.game.tradeOffer.from, 1);
  assert.equal(countered.body.game.tradeOffer.to, 0);
  const counterAccepted = await action(clients[0], countered.body, 'accept-trade');
  assert.equal(counterAccepted.status, 200);
  assert.equal(counterAccepted.body.game.tradeOffer, null);
});

test('room link, names, capacity and returning browser identity', async t => {
  const f = await fixture(t);
  const host = f.client();
  const created = await host.request('/api/rooms', { name: '  Саша  ' });
  assert.equal(created.status, 201);
  assert.match(created.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const room = created.body;
  assert.equal(room.members[0].name, 'Саша');
  assert.equal(room.me, 0); assert.equal(room.host, true);
  const visitor = f.client();
  const preview = (await visitor.request(`/api/rooms/${room.id}`)).body;
  assert.equal(preview.me, null); assert.equal(preview.game, null);
  assert.equal(JSON.stringify(preview).includes('sessionHash'), false);
  assert.equal((await visitor.request(`/api/rooms/${room.id}/join`, { name: 'саша' })).status, 409);
  assert.equal((await visitor.request(`/api/rooms/${room.id}/join`, { name: 'Друг' })).status, 200);
  const restored = (await visitor.request(`/api/rooms/${room.id}/join`, { name: 'Другое имя' })).body;
  assert.equal(restored.me, 1); assert.equal(restored.members[1].name, 'Друг');
  await Promise.all([f.client().request(`/api/rooms/${room.id}/join`, { name: 'Третий' }), f.client().request(`/api/rooms/${room.id}/join`, { name: 'Четвёртый' })]);
  const full = (await host.request(`/api/rooms/${room.id}`)).body;
  assert.equal(full.members.length, 4, 'Concurrent joins must both persist');
  assert.equal((await f.client().request(`/api/rooms/${room.id}/join`, { name: 'Пятый' })).status, 409);
  assert.equal((await visitor.request('/api/rooms/0000000000')).status, 404);
});

test('room keeps its selected ruleset and map generation through joins and server restart', async t => {
  const f = await fixture(t);
  const host = f.client();
  assert.equal((await host.request('/api/rooms', { name: 'Хозяин', ruleset: 'unknown' })).status, 400);
  assert.equal((await host.request('/api/rooms', { name: 'Хозяин', mapGeneration: 'unknown' })).status, 400);
  let room = (await host.request('/api/rooms', { name: 'Хозяин', ruleset: 'classic', mapGeneration: 'random' })).body;
  assert.equal(room.ruleset, 'classic');
  assert.equal(room.mapGeneration, 'random');
  const guest1 = f.client();
  room = (await guest1.request(`/api/rooms/${room.id}/join`, { name: 'Друг 1' })).body;
  assert.equal((await action(host, room, 'start')).status, 400);
  const guest2 = f.client();
  room = (await guest2.request(`/api/rooms/${room.id}/join`, { name: 'Друг 2' })).body;
  room = (await action(host, room, 'start')).body;
  assert.equal(room.game.ruleset, 'classic');
  assert.equal(room.game.mapGeneration, 'random');
  assert.ok(room.game.layout);
  assert.equal(room.game.players[0].resources.wood, 0);
  await f.restart();
  const restored = (await host.request(`/api/rooms/${room.id}`)).body;
  assert.equal(restored.ruleset, 'classic');
  assert.equal(restored.mapGeneration, 'random');
  assert.equal(restored.game.ruleset, 'classic');
  assert.equal(restored.game.mapGeneration, 'random');
});

test('host starts, server owns moves, private hands, four-player turn order', async t => {
  const f = await fixture(t);
  const host = f.client(), guest = f.client(), outsider = f.client();
  let room = (await host.request('/api/rooms', { name: 'Первый' })).body;
  assert.equal(room.mapGeneration, 'fixed');
  assert.equal((await action(host, room, 'start')).status, 400);
  room = (await guest.request(`/api/rooms/${room.id}/join`, { name: 'Второй' })).body;
  assert.equal((await action(guest, room, 'start')).status, 403);
  assert.equal((await action(outsider, room, 'start')).status, 403);
  room = (await action(host, room, 'start')).body;
  assert.equal(room.game.mapGeneration, 'fixed');
  assert.equal(Object.hasOwn(room.game, 'layout'), false);
  assert.ok(room.game.players[0].resources);
  assert.equal(room.game.players[1].resources, null);
  assert.equal((await outsider.request(`/api/rooms/${room.id}/join`, { name: 'Опоздал' })).status, 409);
  assert.equal((await action(guest, room, 'settlement', { index: 0 })).status, 400);
  assert.equal((await action(host, room, 'settlement', { index: -1 })).status, 400);
  assert.equal((await action(host, room, 'restart')).status, 409);

  const party = await createParty(f, 4);
  room = party.room;
  assert.equal(room.game.phase, 'turn');
  for (let i = 0; i < 4; i++) {
    assert.equal(room.game.player, i);
    const result = await action(party.clients[i], room, 'roll', { dice: [6, 6], resources: { ore: 999 } });
    assert.equal(result.status, 200); room = result.body;
    assert.ok(room.game.dice.every(die => die >= 1 && die <= 6));
    assert.equal(room.game.players[i].resources.ore < 999, true);
    assert.equal((await action(party.clients[i], room, 'roll')).status, 400);
    assert.equal((await action(party.clients[i], room, 'trade', { from: '__proto__', to: 'ore' })).status, 400);
    room = (await action(party.clients[i], room, 'end')).body;
  }
  assert.equal(room.game.player, 0); assert.equal(room.game.round, 2);
});

test('simultaneous actions cannot double-spend or overwrite a newer state', async t => {
  const f = await fixture(t);
  const { clients, room } = await createParty(f);
  const results = await Promise.all([action(clients[0], room, 'roll'), action(clients[0], room, 'roll')]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const next = (await clients[0].request(`/api/rooms/${room.id}`)).body;
  assert.equal(next.revision, room.revision + 1);
  const index = board.edges.findIndex((_, index) => canRoad(next.game, index));
  assert.ok(index >= 0);
  const built = await action(clients[0], next, 'road', { index });
  assert.equal(built.status, 200); assert.equal(built.body.game.roads[index], 0);
  assert.equal(built.body.game.players[0].resources.wood, next.game.players[0].resources.wood - 1);
  assert.equal((await action(clients[0], built.body, 'road', { index })).status, 400);
});

test('game and browser seats survive a server restart', async t => {
  const f = await fixture(t);
  const { clients, room } = await createParty(f, 3);
  const before = (await action(clients[0], room, 'roll')).body;
  await f.restart();
  const after = (await clients[0].request(`/api/rooms/${room.id}`)).body;
  assert.deepEqual(after, before);
  const guest = (await clients[2].request(`/api/rooms/${room.id}`)).body;
  assert.equal(guest.me, 2); assert.ok(guest.game.players[2].resources); assert.equal(guest.game.players[0].resources, null);
});

test('event stream delivers joins and game updates to another browser', async t => {
  const f = await fixture(t);
  const host = f.client(), guest = f.client();
  const room = (await host.request('/api/rooms', { name: 'Host' })).body;
  const snapshots = [];
  const listeners = new Set();
  const stream = get(`${f.origin}/api/rooms/${room.id}/events`, { headers: { Cookie: host.cookie } }, response => {
    assert.equal(response.statusCode, 200);
    let buffer = '';
    response.setEncoding('utf8');
    response.on('data', chunk => {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = event.split('\n').find(line => line.startsWith('data: '));
        if (data) { snapshots.push(JSON.parse(data.slice(6))); for (const listener of listeners) listener(); }
      }
    });
  });
  t.after(() => stream.destroy());
  function waitFor(predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error('No event received')); }, 3000);
      function check() { const found = snapshots.find(predicate); if (found) { clearTimeout(timer); listeners.delete(check); resolve(found); } }
      listeners.add(check); check();
    });
  }
  const initial = await waitFor(snapshot => snapshot.members[0].online);
  assert.equal(initial.me, 0);
  await guest.request(`/api/rooms/${room.id}/join`, { name: 'Guest' });
  const joined = await waitFor(snapshot => snapshot.members.length === 2);
  await action(host, joined, 'start');
  const started = await waitFor(snapshot => snapshot.game?.phase === 'setup');
  assert.equal(started.game.players[1].resources, null);
  stream.destroy();
});

test('cross-site writes and private server files are denied', async t => {
  const f = await fixture(t);
  const client = f.client();
  assert.equal((await client.request('/api/rooms', { name: 'Alice' }, { Origin: 'https://another-site.example' })).status, 403);
  const hotseatModule = await fetch(`${f.origin}/hotseat.js`);
  assert.equal(hotseatModule.status, 200);
  assert.match(hotseatModule.headers.get('content-type'), /javascript/);
  for (const path of ['/server.js', '/package.json', '/data/test.json', '/assets/../server.js']) assert.equal((await client.request(path)).status, 404);
  const name = '<img src=x onerror=alert(1)>';
  assert.equal((await client.request('/api/rooms', { name })).status, 400, 'Names over 24 characters are rejected');
});

test('resource production, city costs and victory use authoritative rules', () => {
  let game = freshGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  game = applyAction(game, 0, { type: 'settlement', index: 0 });
  const other = board.vertices.findIndex((_, index) => canSettle(game, index));
  game = applyAction(game, 1, { type: 'settlement', index: other });
  const tileIndex = boardFor(game).tiles.findIndex(tile => tile.corners.includes(0) && tile.number);
  const tile = boardFor(game).tiles[tileIndex];
  const dice = tile.number <= 7 ? [1, tile.number - 1] : [6, tile.number - 6];
  const before = game.players[0].resources[tile.type];
  game = applyAction(game, 0, { type: 'roll' }, () => dice.shift());
  assert.ok(game.players[0].resources[tile.type] > before);
  assert.deepEqual(game.lastProduction.find(item => item.tileIndex === tileIndex && item.player === 0),
    { tileIndex, player: 0, resource: tile.type, amount: 1 });
  game.players[0].resources.ore = 3; game.players[0].resources.wheat = 2;
  game.owner[10] = 0; game.city[10] = true; game.owner[20] = 0;
  assert.equal(score(game, 0), 4);
  game = applyAction(game, 0, { type: 'city', index: 0 });
  assert.equal(game.winner, null); assert.equal(game.players[0].resources.ore, 0);
  for (const index of [30, 31, 32, 33, 34]) game.owner[index] = 0;
  game.players[0].resources.wood = 4;
  game = applyAction(game, 0, { type: 'trade', from: 'wood', to: 'brick' });
  assert.equal(game.winner, 0);
  assert.throws(() => applyAction(game, 0, { type: 'end' }), /завершена/);
});

test('production reports the source field, recipient and doubled city yield', () => {
  let game = freshGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const tileIndex = boardFor(game).tiles.findIndex(tile => tile.number && tile.type !== 'desert');
  const tile = boardFor(game).tiles[tileIndex];
  game.phase = 'turn';
  game.owner[tile.corners[0]] = 0;
  game.city[tile.corners[0]] = true;
  game.owner[tile.corners[1]] = 1;
  const before = game.players.map(player => ({ ...player.resources }));
  const dice = tile.number <= 7 ? [1, tile.number - 1] : [6, tile.number - 6];
  game = applyAction(game, 0, { type: 'roll' }, () => dice.shift());
  assert.deepEqual(game.lastProduction.filter(item => item.tileIndex === tileIndex), [
    { tileIndex, player: 0, resource: tile.type, amount: 2 },
    { tileIndex, player: 1, resource: tile.type, amount: 1 },
  ]);
  const rollStep = game.history.length - 1;
  assert.deepEqual(game.history[rollStep].production.filter(item => item.tileIndex === tileIndex), [
    { tileIndex, vertex: tile.corners[0], player: 0, resource: tile.type, amount: 2 },
    { tileIndex, vertex: tile.corners[1], player: 1, resource: tile.type, amount: 1 },
  ]);
  assert.deepEqual(replayBoardAt(game, rollStep).production, game.history[rollStep].production);
  for (const [playerIndex, participant] of game.players.entries()) {
    for (const resource of Object.keys(participant.resources)) {
      const reported = game.lastProduction.filter(item => item.player === playerIndex && item.resource === resource)
        .reduce((total, item) => total + item.amount, 0);
      assert.equal(participant.resources[resource] - before[playerIndex][resource], reported);
    }
  }
  game = applyAction(game, 0, { type: 'end' });
  assert.deepEqual(game.lastProduction, []);
  assert.deepEqual(replayBoardAt(game, game.history.length - 1).production, []);
});

test('seven requires discards, moves robber, steals a random card and blocks production', () => {
  let game = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }]);
  game.phase = 'turn';
  const target = board.tiles.findIndex(tile => tile.type !== 'desert' && tile.number === 6);
  game.owner[board.tiles[target].corners[0]] = 1;
  game = applyAction(game, 0, { type: 'roll' }, (() => { const values = [3, 4]; return () => values.shift(); })());
  assert.equal(game.phase, 'robber-discard');
  assert.deepEqual(game.robberDiscards, [4, 4]);
  assert.throws(() => applyAction(game, 0, { type: 'end' }), /Сначала/);
  assert.throws(() => applyAction(game, 1, { type: 'discard', resources: { wood: 1 } }), /4 карт/);
  game = applyAction(game, 1, { type: 'discard', resources: { wood: 2, brick: 2 } });
  game = applyAction(game, 0, { type: 'discard', resources: { wood: 2, brick: 2 } });
  assert.equal(game.phase, 'robber-move');
  game = applyAction(game, 0, { type: 'move-robber', index: target });
  assert.equal(game.phase, 'robber-steal');
  const before = game.players[0].resources.wheat;
  game = applyAction(game, 0, { type: 'steal', victim: 1 }, undefined, () => 0);
  assert.equal(game.players[0].resources.wheat, before + 1);
  assert.deepEqual(game.lastSteal, { id: 1, from: 1, to: 0, resource: 'wheat' });
  assert.equal(game.phase, 'turn');
  game = applyAction(game, 0, { type: 'end' });
  game = applyAction(game, 1, { type: 'roll' }, () => 3);
  assert.equal(game.lastProduction.some(item => item.tileIndex === target), false);
});

test('player trade needs a proposal and recipient approval, and preserves private hands', () => {
  let game = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }]);
  game.phase = 'turn'; game.rolled = true;
  const start = structuredClone(game.players.map(player => player.resources));
  game = applyAction(game, 0, { type: 'offer-trade', to: 1, give: { wood: 2 }, want: { ore: 1 } });
  assert.equal(game.phase, 'trade-offer');
  assert.throws(() => applyAction(game, 0, { type: 'end' }), /Сначала/);
  assert.throws(() => applyAction(game, 0, { type: 'accept-trade' }), /не предложен/);
  game = applyAction(game, 1, { type: 'accept-trade' });
  assert.equal(game.phase, 'turn');
  assert.equal(game.players[0].resources.wood, start[0].wood - 2);
  assert.equal(game.players[0].resources.ore, start[0].ore + 1);
  assert.equal(game.players[1].resources.wood, start[1].wood + 2);
  assert.equal(game.players[1].resources.ore, start[1].ore - 1);
  game = applyAction(game, 0, { type: 'offer-trade', to: 1, give: { ore: 1 }, want: { wheat: 1 } });
  game = applyAction(game, 1, { type: 'reject-trade' });
  assert.equal(game.tradeOffer, null);
});

test('trade recipient can counteroffer and the original proposer can accept', () => {
  let game = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }]);
  game.phase = 'turn'; game.rolled = true;
  game.players[0].resources = { wood: 3, brick: 1, wheat: 0, sheep: 0, ore: 0 };
  game.players[1].resources = { wood: 0, brick: 0, wheat: 2, sheep: 0, ore: 2 };
  game = applyAction(game, 0, { type: 'offer-trade', to: 1, give: { wood: 2 }, want: { ore: 2 } });
  assert.throws(() => applyAction(game, 0, { type: 'counter-trade', give: { ore: 1 }, want: { wood: 1 } }), /не предложен/);
  assert.throws(() => applyAction(game, 1, { type: 'counter-trade', give: { brick: 1 }, want: { wood: 1 } }), /Недостаточно ресурсов/);
  game = applyAction(game, 1, { type: 'counter-trade', give: { ore: 1, wheat: 1 }, want: { wood: 1, brick: 1 } });
  assert.deepEqual([game.tradeOffer.from, game.tradeOffer.to, game.player], [1, 0, 0]);
  assert.throws(() => applyAction(game, 1, { type: 'accept-trade' }), /не предложен/);
  game = applyAction(game, 0, { type: 'accept-trade' });
  assert.equal(game.phase, 'turn');
  assert.equal(game.tradeOffer, null);
  assert.deepEqual(game.players[0].resources, { wood: 2, brick: 0, wheat: 1, sheep: 0, ore: 1 });
  assert.deepEqual(game.players[1].resources, { wood: 1, brick: 1, wheat: 1, sheep: 0, ore: 1 });
});

test('player offers and counteroffers may contain resources on only one side', () => {
  let game = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }]);
  game.phase = 'turn'; game.rolled = true;
  game.players[0].resources = { wood: 2, brick: 0, wheat: 0, sheep: 0, ore: 0 };
  game.players[1].resources = { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 2 };
  assert.throws(() => applyAction(game, 0, { type: 'offer-trade', to: 1, give: {}, want: {} }), /хотя бы один ресурс/);
  game = applyAction(game, 0, { type: 'offer-trade', to: 1, give: {}, want: { ore: 1 } });
  game = applyAction(game, 1, { type: 'accept-trade' });
  assert.equal(game.players[0].resources.ore, 1);
  assert.equal(game.players[1].resources.ore, 1);
  game = applyAction(game, 0, { type: 'offer-trade', to: 1, give: { wood: 1 }, want: {} });
  game = applyAction(game, 1, { type: 'accept-trade' });
  assert.equal(game.players[0].resources.wood, 1);
  assert.equal(game.players[1].resources.wood, 1);
  game = applyAction(game, 0, { type: 'offer-trade', to: 1, give: { wood: 1 }, want: { ore: 1 } });
  assert.throws(() => applyAction(game, 1, { type: 'counter-trade', give: {}, want: {} }), /хотя бы один ресурс/);
  game = applyAction(game, 1, { type: 'counter-trade', give: {}, want: { wood: 1 } });
  game = applyAction(game, 0, { type: 'accept-trade' });
  assert.equal(game.players[0].resources.wood, 0);
  assert.equal(game.players[1].resources.wood, 2);

  let unaffordable = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }]);
  unaffordable.phase = 'turn'; unaffordable.rolled = true;
  unaffordable.players[0].resources.wood = 1;
  unaffordable.players[1].resources.brick = 0;
  unaffordable = applyAction(unaffordable, 0, { type: 'offer-trade', to: 1, give: { wood: 1 }, want: { brick: 1 } });
  unaffordable = applyAction(unaffordable, 1, { type: 'counter-trade', give: {}, want: { wood: 1 } });
  unaffordable = applyAction(unaffordable, 0, { type: 'accept-trade' });
  assert.equal(unaffordable.players[1].resources.wood, 3);
});

test('development purchase hides the deck, waits one turn, and can win with a victory point', () => {
  let game = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }], () => 0);
  assert.equal(game.devDeck.length, 25);
  game.phase = 'turn'; game.rolled = true; game.devDeck = ['knight', 'victory'];
  game.players[0].resources.ore = 2;
  const before = { ...game.players[0].resources };
  game = applyAction(game, 0, { type: 'buy-dev' });
  assert.equal(game.players[0].devCards[0].type, 'victory');
  assert.equal(game.players[0].resources.ore, before.ore - 1);
  assert.equal(game.players[0].resources.wheat, before.wheat - 1);
  assert.equal(game.players[0].resources.sheep, before.sheep - 1);
  assert.equal(game.devDeck.length, 1);
  game = applyAction(game, 0, { type: 'buy-dev' });
  assert.throws(() => applyAction(game, 0, { type: 'play-dev', card: 'knight' }), /текущий ход/);
  game = applyAction(game, 0, { type: 'end' });
  game = applyAction(game, 1, { type: 'roll' }, () => 3);
  game = applyAction(game, 1, { type: 'end' });
  game = applyAction(game, 0, { type: 'play-dev', card: 'knight' });
  assert.equal(game.phase, 'robber-move');
  assert.equal(game.rolled, false);
  assert.equal(game.players[0].knightsPlayed, 0);
  assert.equal(game.players[0].devCards.length, 2);
  assert.throws(() => applyAction(game, 0, { type: 'roll' }, () => 3), /подготовка|брошены/);
  const target = board.tiles.findIndex((tile, index) => index !== game.robberTile && !tile.corners.some(vertex => game.owner[vertex] === 1));
  game = applyAction(game, 0, { type: 'move-robber', index: target });
  assert.equal(game.phase, 'turn');
  assert.equal(game.players[0].knightsPlayed, 1);
  assert.equal(game.players[0].devCards.length, 1);
  game = applyAction(game, 0, { type: 'roll' }, () => 3);
  assert.equal(game.rolled, true);
  assert.throws(() => applyAction(game, 0, { type: 'play-dev', card: 'knight' }), /нельзя/);

  let victory = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }]);
  victory.phase = 'turn'; victory.rolled = true; victory.devDeck = ['victory'];
  for (const index of [0, 10, 20, 30, 31, 32, 33, 34, 35]) victory.owner[index] = 0;
  victory = applyAction(victory, 0, { type: 'buy-dev' });
  assert.equal(victory.winner, 0);
  assert.equal(victory.players[0].revealedVictoryPoints, 1);
});

test('development actions grant free roads, resources, monopoly, and largest army', () => {
  const base = () => { const game = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }]); game.phase = 'turn'; game.turnNumber = 2; return game; };
  let roads = base(); roads.owner[0] = 0; roads.players[0].devCards = [{ type: 'roads', boughtOn: 0 }];
  const before = { ...roads.players[0].resources };
  roads = applyAction(roads, 0, { type: 'play-dev', card: 'roads' });
  assert.equal(roads.phase, 'dev-road');
  const edge = board.vertices[0].edges[0];
  roads = applyAction(roads, 0, { type: 'road', index: edge });
  assert.equal(roads.roads[edge], 0);
  assert.deepEqual(roads.players[0].resources, before);
  if (roads.phase === 'dev-road') roads = applyAction(roads, 0, { type: 'finish-dev-road' });
  assert.equal(roads.phase, 'turn');

  let plenty = base(); plenty.players[0].devCards = [{ type: 'plenty', boughtOn: 0 }];
  plenty = applyAction(plenty, 0, { type: 'play-dev', card: 'plenty', first: 'ore', second: 'ore' });
  assert.equal(plenty.players[0].resources.ore, 3);
  assert.equal(plenty.devPlayed, true);

  let monopoly = base(); monopoly.players[0].devCards = [{ type: 'monopoly', boughtOn: 0 }];
  monopoly = applyAction(monopoly, 0, { type: 'play-dev', card: 'monopoly', resource: 'wood' });
  assert.equal(monopoly.players[0].resources.wood, 4);
  assert.equal(monopoly.players[1].resources.wood, 0);

  let army = base(); army.players[0].devCards = [{ type: 'knight', boughtOn: 0 }]; army.players[0].knightsPlayed = 2;
  army = applyAction(army, 0, { type: 'play-dev', card: 'knight' });
  assert.equal(army.largestArmy, null);
  const target = board.tiles.findIndex((_, index) => index !== army.robberTile);
  army = applyAction(army, 0, { type: 'move-robber', index: target });
  assert.equal(army.largestArmy, 0);
  assert.equal(score(army, 0), 2);
});

test('room snapshots reveal only the owner’s development hand and never the deck order', async t => {
  const f = await fixture(t);
  const party = await createParty(f);
  let room = (await action(party.clients[0], party.room, 'roll')).body;
  room = (await action(party.clients[0], room, 'buy-dev')).body;
  assert.equal(room.game.players[0].devCards.length, 1);
  assert.equal(room.game.devDeck, undefined);
  assert.equal(room.game.devDeckCount, 24);
  const other = (await party.clients[1].request(`/api/rooms/${room.id}`)).body;
  assert.equal(other.game.players[0].devCards, null);
  assert.equal(other.game.players[0].devCardCount, 1);
  assert.equal(other.game.devDeck, undefined);
});

test('coastal harbors unlock 3:1 or resource-specific 2:1 maritime trade', () => {
  assert.equal(board.coastalEdges.length, 30);
  assert.equal(board.coastVertices.length, 30);
  assert.equal(board.ports.length, 9);
  assert.deepEqual(board.ports.map(port => port.type).sort(), ['brick', 'generic', 'generic', 'generic', 'generic', 'ore', 'sheep', 'wheat', 'wood'].sort());
  const game = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }]);
  game.phase = 'turn'; game.rolled = true;
  assert.equal(harborRate(game, 0, 'wood'), 4);
  const generic = boardFor(game).ports.find(port => port.type === 'generic');
  assert.ok(board.coastalEdges.includes(generic.edge));
  game.owner[board.edges[generic.edge].a] = 0;
  assert.equal(harborRate(game, 0, 'wood'), 3);
  assert.equal(harborRate(game, 0, 'ore'), 3);
  game.players[0].resources.wood = 3;
  let traded = applyAction(game, 0, { type: 'trade', from: 'wood', to: 'ore' });
  assert.equal(traded.players[0].resources.wood, 0);
  assert.equal(traded.players[0].resources.ore, 2);
  assert.match(traded.log[0], /3:1/);

  const specificGame = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }]);
  const special = boardFor(specificGame).ports.find(port => port.type === 'sheep');
  specificGame.phase = 'turn'; specificGame.rolled = true;
  specificGame.owner[board.edges[special.edge].b] = 0;
  assert.equal(harborRate(specificGame, 0, 'sheep'), 2);
  assert.equal(harborRate(specificGame, 0, 'wood'), 4);
  const exchanged = applyAction(specificGame, 0, { type: 'trade', from: 'sheep', to: 'ore' });
  assert.equal(exchanged.players[0].resources.sheep, 0);
  assert.equal(exchanged.players[0].resources.ore, 2);
  assert.match(exchanged.log[0], /2:1/);
});

test('bank trade accepts several resource bundles atomically at their harbor rates', () => {
  const game = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }]);
  game.phase = 'turn'; game.rolled = true;
  game.players[0].resources.wood = 8;
  game.players[0].resources.sheep = 4;
  const action = { type: 'trade', give: { wood: 8, sheep: 4 }, want: { brick: 1, ore: 2 } };
  assert.throws(() => applyAction(game, 0, { ...action, want: { brick: 1, ore: 1 } }), /курсу/);
  assert.throws(() => applyAction(game, 0, { ...action, give: { wood: 7, sheep: 4 } }), /группы/);
  const traded = applyAction(game, 0, action);
  assert.equal(traded.players[0].resources.wood, 0);
  assert.equal(traded.players[0].resources.sheep, 0);
  assert.equal(traded.players[0].resources.brick, 3);
  assert.equal(traded.players[0].resources.ore, 3);
  assert.equal(game.players[0].resources.wood, 8);
});

test('classic bank trade respects the number of cards left in the bank', () => {
  const game = freshGame([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Борис' }, { id: 'c', name: 'Вера' }], () => 0, 'classic');
  game.phase = 'turn'; game.rolled = true;
  game.players[0].resources.wood = 8;
  game.players[1].resources.ore = 18;
  assert.throws(() => applyAction(game, 0, { type: 'trade', give: { wood: 8 }, want: { ore: 2 } }), /не хватает/);
  const traded = applyAction(game, 0, { type: 'trade', give: { wood: 8 }, want: { ore: 1, brick: 1 } });
  assert.equal(traded.players[0].resources.wood, 0);
  assert.equal(traded.players[0].resources.ore, 1);
  assert.equal(traded.players[0].resources.brick, 1);
});
