import * as rules from './game.js?v=supply1';
import { hotseatSeat, hotseatRoom } from './hotseat.js?v=bots1';
import { parseLocalFile, serializeLocalFile } from './local-save.js?v=classic-opening1';
import { loadLocalLibrary, saveLocalLibrarySession, selectLocalLibrarySession, deleteLocalLibrarySession } from './local-saves.js?v=classic-opening1';
import { chooseBotAction, applyBotChoice, nextBotSeat } from './bot.js?v=classic-opening1';
import { loadVictoryFanfare, playVictoryFanfare } from './victory-sound.js?v=3';
const { SIZE, CENTER, TYPES, RESOURCE_KEYS, COSTS, ruForm } = rules;
let board = rules.board;
const BUILD = {
  road: { title: 'Дорога', purpose: 'Соединяет ваши постройки и открывает новые места для поселений.', cost: '1 дерево, 1 кирпич' },
  settlement: { title: 'Поселение', purpose: 'Приносит 1 очко и по одному ресурсу с соседних полей.', cost: '1 дерево, 1 кирпич, 1 пшеница, 1 шерсть' },
  city: { title: 'Город', purpose: 'Улучшает поселение: приносит 2 очка и вдвое больше ресурсов.', cost: '2 пшеницы, 3 камня' },
};
const PALETTE = ['#e9aa73', '#72b7b6', '#bb9bd7', '#e3cd69', '#cf7470', '#699bce', '#8caf72', '#87949d'];
const COLOR_NAMES = ['оранжевый', 'бирюзовый', 'фиолетовый', 'жёлтый', 'красный', 'синий', 'зелёный', 'серый'];
let localColorOrder = [0, 1, 2, 3];
let localVisiblePlayers = 2;
let localNewExpanded = false;
let selectedColorSeat = null;
const localColorPicker = document.createElement('div');
localColorPicker.className = 'local-color-picker';
localColorPicker.setAttribute('role', 'group');
localColorPicker.setAttribute('aria-label', 'Выберите цвет игрока');
localColorPicker.innerHTML = PALETTE.map((color, index) => `<button type="button" data-color-index="${index}" style="--player-color:${color}" aria-label="${COLOR_NAMES[index]}" title="${COLOR_NAMES[index]}"></button>`).join('');
localColorPicker.hidden = true;
document.querySelector('#local-form').append(localColorPicker);
function renderLocalSwatches() {
  document.querySelectorAll('.local-player-swatch').forEach((swatch, index) => {
    const color = localColorOrder[index];
    swatch.style.setProperty('--player-color', PALETTE[color]);
    swatch.setAttribute('aria-label', `Игрок ${index + 1}: ${COLOR_NAMES[color]}. Нажмите, чтобы выбрать цвет, или перетащите на другой кружок для обмена`);
    swatch.classList.toggle('is-selected', selectedColorSeat === index);
    swatch.setAttribute('aria-pressed', String(selectedColorSeat === index));
  });
  localColorPicker.querySelectorAll('[data-color-index]').forEach(button => {
    const color = Number(button.dataset.colorIndex);
    button.classList.toggle('is-current', selectedColorSeat !== null && localColorOrder[selectedColorSeat] === color);
    button.classList.toggle('is-used', selectedColorSeat !== null && localColorOrder.slice(0, localVisiblePlayers).includes(color) && localColorOrder[selectedColorSeat] !== color);
    button.setAttribute('aria-pressed', String(selectedColorSeat !== null && localColorOrder[selectedColorSeat] === color));
  });
}
function swapLocalColors(first, second) {
  [localColorOrder[first], localColorOrder[second]] = [localColorOrder[second], localColorOrder[first]];
  selectedColorSeat = null;
  localColorPicker.hidden = true;
  renderLocalSwatches();
}
renderLocalSwatches();
function renderLocalPlayerFields() {
  for (const number of [3, 4]) document.querySelector(`#local-player-${number}`).hidden = number > localVisiblePlayers;
  for (let number = 1; number <= 4; number++) {
    const bot = document.querySelector(`.local-seat-kind[data-seat-index="${number - 1}"]`).value === 'bot';
    const name = document.querySelector(`#local-name-${number}`);
    name.hidden = bot;
    name.disabled = bot || number > localVisiblePlayers;
    name.required = !bot && number <= localVisiblePlayers;
    document.querySelector(`#local-bot-level-${number}`).hidden = !bot;
    document.querySelector(`#local-bot-level-${number}`).disabled = !bot || number > localVisiblePlayers;
  }
  const addButton = document.querySelector('#local-add-player');
  addButton.hidden = localVisiblePlayers >= 4;
  addButton.setAttribute('aria-expanded', String(localVisiblePlayers > 2));
}
renderLocalPlayerFields();
const NUMBER_PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const ROBBER_TOKEN = { offsetX: 34, offsetY: -10, width: 38, height: 53 };
const iconUrl = key => `./assets/optimized/icons/${key}.webp?v=1`;
const RESOURCE_AMOUNT_FORMS = {
  wood: ['дерево', 'дерева', 'деревьев'],
  brick: ['кирпич', 'кирпича', 'кирпичей'],
  wheat: ['пшеница', 'пшеницы', 'пшениц'],
  sheep: ['шерсть', 'шерсти', 'шерстей'],
  ore: ['камень', 'камня', 'камней'],
};
const resourceQuantity = (key, amount) => `${amount} ${ruForm(amount, ...(RESOURCE_AMOUNT_FORMS[key] || ['ресурс', 'ресурса', 'ресурсов']))}`;
const resourceGain = (key, amount) => `+${resourceQuantity(key, amount)}`;
const $ = selector => document.querySelector(selector);
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function mountRulesetPicker(container, name) {
  container.innerHTML = `<fieldset class="ruleset-picker"><legend>Набор правил</legend><div class="ruleset-choices">${Object.values(rules.RULESETS).map(item =>
    `<label class="ruleset-choice"><input type="radio" name="${name}" value="${item.id}" ${item.id === 'new' ? 'checked' : ''}><span><strong>${item.name}</strong><small>${item.minPlayers}–${item.maxPlayers} игрока · ${item.description}</small></span></label>`).join('')}</div></fieldset>`;
}
mountRulesetPicker($('#online-ruleset-picker'), 'online-ruleset');
mountRulesetPicker($('#local-ruleset-picker'), 'local-ruleset');
const selectedRuleset = mode => $(`input[name="${mode}-ruleset"]:checked`).value;
const activeRuleset = () => rules.RULESETS[room?.ruleset || (localMode ? selectedRuleset('local') : selectedRuleset('online'))] || rules.RULESETS.new;
function mountMapPicker(container, name) {
  container.innerHTML = `<fieldset class="ruleset-picker map-picker"><legend>Генерация карты</legend><div class="ruleset-choices">${Object.values(rules.MAP_GENERATIONS).map(item =>
    `<label class="ruleset-choice"><input type="radio" name="${name}" value="${item.id}" ${item.id === 'fixed' ? 'checked' : ''}><span><strong>${item.name}</strong><small>${item.description}</small></span></label>`).join('')}</div></fieldset>`;
}
mountMapPicker($('#online-map-picker'), 'online-map');
mountMapPicker($('#local-map-picker'), 'local-map');
const selectedMapGeneration = mode => $(`input[name="${mode}-map"]:checked`).value;
const activeMapGeneration = () => rules.MAP_GENERATIONS[room?.mapGeneration || (localMode ? selectedMapGeneration('local') : selectedMapGeneration('online'))] || rules.MAP_GENERATIONS.fixed;
const tooltip = document.createElement('div');
tooltip.className = 'game-tooltip';
tooltip.id = 'game-tooltip';
tooltip.setAttribute('role', 'tooltip');
tooltip.hidden = true;
document.body.append(tooltip);
let tooltipTarget = null;
let tooltipTimer = null;
function hideTooltip() {
  clearTimeout(tooltipTimer);
  tooltipTarget?.removeAttribute('aria-describedby');
  tooltipTarget = null;
  tooltip.hidden = true;
}
function positionTooltip() {
  if (tooltip.hidden || !tooltipTarget) return;
  if (tooltipTarget.dataset.tooltipRobber) {
    const tile = tooltipTarget.closest('.tile');
    if (tile) {
      const rect = tile.getBoundingClientRect();
      const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
      const centered = Math.max(10, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 10));
      const below = rect.bottom + 12;
      if (below + height <= innerHeight - 10) {
        tooltip.style.left = `${centered}px`;
        tooltip.style.top = `${below}px`;
        return;
      }
      const right = rect.right + 12;
      const left = rect.left - width - 12;
      if (right + width <= innerWidth - 10 || left >= 10) {
        tooltip.style.left = `${right + width <= innerWidth - 10 ? right : left}px`;
        tooltip.style.top = `${Math.max(10, Math.min(rect.top + rect.height / 2 - height / 2, innerHeight - height - 10))}px`;
        return;
      }
    }
  }
  const anchor = tooltipTarget.matches('.port') ? tooltipTarget.querySelector('.port-ship') : tooltipTarget;
  const rect = (anchor || tooltipTarget).getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  tooltip.style.left = `${Math.max(10, Math.min(x - width / 2, innerWidth - width - 10))}px`;
  const above = rect.top - height - 12;
  const below = rect.bottom + 12;
  tooltip.style.top = `${above >= 10 ? above : Math.max(10, Math.min(below, innerHeight - height - 10))}px`;
}
function renderBuildTooltip(key) {
  const item = BUILD[key];
  const showAvailability = !!state && !handoff && myTurn() && state.phase === 'turn' && state.rolled;
  const title = document.createElement('strong');
  title.className = 'game-tooltip-title';
  title.textContent = item.title;
  const description = document.createElement('p');
  description.className = 'game-tooltip-description';
  description.textContent = item.purpose;
  const cost = document.createElement('div');
  cost.className = 'game-tooltip-cost';
  for (const resource of RESOURCE_KEYS) {
    const amount = COSTS[key][resource] || 0;
    if (!amount) continue;
    const entry = document.createElement('span');
    if (showAvailability) {
      const owned = state.players[room.me].resources[resource];
      if (owned === 0) entry.classList.add('is-absent');
      else if (owned < amount) entry.classList.add('is-short');
    }
    const icon = document.createElement('img');
    icon.src = iconUrl(resource);
    icon.alt = '';
    entry.append(icon, document.createTextNode(resourceQuantity(resource, amount)));
    cost.append(entry);
  }
  tooltip.replaceChildren(title, description, cost);
}
function renderOwnedPieceTooltip(target) {
  const owner = Number(target.dataset.owned);
  const player = state?.players[owner];
  if (!player) { tooltip.textContent = target.dataset.tooltip; return; }
  const name = document.createElement('span');
  name.className = 'game-tooltip-player';
  name.style.setProperty('--tooltip-player-color', playerColor(owner));
  name.textContent = player.name;
  tooltip.replaceChildren(document.createTextNode(`${target.dataset.tooltipLabel} · `), name);
  if (target.dataset.tooltipAction) tooltip.append(document.createTextNode(` · ${target.dataset.tooltipAction}`));
}
function renderRobberTileTooltip(target) {
  const detail = document.createElement('div');
  detail.className = 'game-tooltip-robber-detail';
  const resource = target.dataset.tooltipResource;
  if (RESOURCE_KEYS.includes(resource)) {
    const icon = document.createElement('img');
    icon.src = iconUrl(resource);
    icon.alt = '';
    detail.append(icon);
  }
  detail.append(document.createTextNode(TYPES[resource]?.name || 'Пустыня'));
  tooltip.replaceChildren(detail);
}
function renderNumberTileTooltip(target) {
  const resource = target.dataset.tooltipResource;
  if (!RESOURCE_KEYS.includes(resource)) { tooltip.textContent = target.dataset.tooltip; return; }
  const detail = document.createElement('span');
  detail.className = 'game-tooltip-tile';
  if (target.dataset.tooltipSource) detail.append(document.createTextNode('Источник добычи · '));
  const icon = document.createElement('img');
  icon.src = iconUrl(resource);
  icon.alt = '';
  detail.append(icon, document.createTextNode(TYPES[resource].name));
  tooltip.replaceChildren(detail);
}
function renderTradeMissingTooltip(target) {
  const title = document.createElement('span');
  title.className = 'game-tooltip-missing-title';
  title.textContent = 'У вас не хватает запрашиваемых ресурсов:';
  const list = document.createElement('span');
  list.className = 'game-tooltip-missing-list';
  for (const entry of target.dataset.tooltipMissing.split(',')) {
    const [key, amount] = entry.split(':');
    if (!RESOURCE_KEYS.includes(key) || !Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) continue;
    const item = document.createElement('span');
    const icon = document.createElement('img');
    icon.src = iconUrl(key);
    icon.alt = '';
    item.append(icon, document.createTextNode(resourceQuantity(key, Number(amount))));
    list.append(item);
  }
  tooltip.replaceChildren(title, list);
}
function showTooltip(target) {
  if (target === tooltipTarget) { positionTooltip(); return; }
  hideTooltip();
  if (!target || !target.dataset.tooltip) return;
  tooltipTarget = target;
  tooltipTimer = setTimeout(() => {
    if (!tooltipTarget?.isConnected) { hideTooltip(); return; }
    const buildKey = tooltipTarget.dataset.tooltipBuild;
    tooltip.classList.toggle('is-build', !!buildKey);
    tooltip.classList.toggle('is-robber', !!tooltipTarget.dataset.tooltipRobber);
    tooltip.classList.toggle('is-trade-missing', !!tooltipTarget.dataset.tooltipMissing);
    if (tooltipTarget.dataset.tooltipRobber) renderRobberTileTooltip(tooltipTarget);
    else if (tooltipTarget.dataset.tooltipResource) renderNumberTileTooltip(tooltipTarget);
    else if (tooltipTarget.dataset.tooltipMissing) renderTradeMissingTooltip(tooltipTarget);
    else if (buildKey && BUILD[buildKey]) renderBuildTooltip(buildKey);
    else if (tooltipTarget.dataset.tooltipLabel) renderOwnedPieceTooltip(tooltipTarget);
    else tooltip.textContent = tooltipTarget.dataset.tooltip;
    tooltip.hidden = false;
    tooltipTarget.setAttribute('aria-describedby', tooltip.id);
    positionTooltip();
  }, 80);
}
document.addEventListener('pointerover', event => {
  if (event.pointerType === 'touch') return;
  showTooltip(event.target.closest?.('[data-tooltip]'));
});
document.addEventListener('pointerout', event => {
  if (tooltipTarget && !tooltipTarget.contains(event.relatedTarget)) hideTooltip();
});
document.addEventListener('focusin', event => showTooltip(event.target.closest?.('[data-tooltip]')));
document.addEventListener('focusout', event => {
  if (tooltipTarget && !tooltipTarget.contains(event.relatedTarget)) hideTooltip();
});
document.addEventListener('scroll', hideTooltip, true);
let roomCode = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';
let localMode = !roomCode && new URLSearchParams(location.search).get('local') === '1';
let localSession = null;
let localSessionId = null;
let localBotTimer = null;
let handoff = false;
let room = null;
const TURN_DURATION_MS = 60_000;
let turnTimer = { key: null, startedAt: 0, pausedAt: null };
const playerColorIndex = index => room?.local ? (localSession?.colorOrder?.[index] ?? index) : (room?.members?.[index]?.colorIndex ?? index);
const playerColor = index => PALETTE[playerColorIndex(index)];
let state = null;
let replay = { active: false, index: 0, playing: false, timer: null };
let connected = false;
let pending = false;
let previewBuildKey = null;
let editingPlayer = null;
let selectedProfileColor = null;
let loading = !!roomCode;
let entryUnavailable = '';
let events = null;
let rollVisual = { entering: false, rolling: false, settling: false, revealing: false, flying: false, fading: false, highlightTotal: null, sourceTile: null };
let diceQuestionVisible = false;
let diceEntranceToken = 0;
let hoveredRollTotal = null;
let rollAnimationId = 0;
let rollPresentationPending = false;
let rollProductionPending = false;
let sourceTimer = null;
let robberFlight = null;
let robberPreviewTile = null;
let achievementTimer = null;
const achievementQueue = [];
let victoryFireworkTimer = null;
let victoryFireworkStopTimer = null;
let victoryBurstIndex = 0;
let discardDraft = Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0]));
const emptyTradeVector = () => Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0]));
const freshTradeDraft = () => ({ mode: 'player', to: 1,
  player: { give: emptyTradeVector(), want: emptyTradeVector() },
  bank: { give: emptyTradeVector(), want: emptyTradeVector() } });
let tradeDraft = freshTradeDraft();
let counterDraft = null;
let devDraft = { first: 'wood', second: 'brick', monopoly: 'wood' };
const DEV_CARDS = {
  knight: { name: 'Рыцарь', icon: '♞', description: 'Переместить разбойника' },
  roads: { name: 'Строительство дорог', icon: '⇢', description: 'До двух бесплатных дорог' },
  plenty: { name: 'Год изобилия', icon: '✦', description: 'Получить два ресурса' },
  monopoly: { name: 'Монополия', icon: '◎', description: 'Забрать один вид ресурса' },
  victory: { name: 'Победное очко', icon: '★', description: '+1 скрытое очко' },
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SETTINGS_KEY = 'catan-display-settings-v1';
const gameSettings = { sound: true, diceAnimation: 'full' };
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
  if (typeof saved?.sound === 'boolean') gameSettings.sound = saved.sound;
  if (saved?.diceAnimation === 'simple') gameSettings.diceAnimation = 'simple';
} catch { /* Private browsing may block stored settings. */ }
const saveGameSettings = () => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(gameSettings)); } catch { /* Settings still work until reload. */ }
};
const DICE_ENTRY_MS = 950;
const DICE_SPIN_MS = 650;
let gameAudioContext;
let gameAudioOutput;
function unlockGameAudio() {
  if (!gameSettings.sound) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    if (!gameAudioContext || gameAudioContext.state === 'closed') gameAudioContext = new AudioContextClass();
    if (!gameAudioOutput || gameAudioOutput.context !== gameAudioContext) {
      gameAudioOutput = gameAudioContext.createGain();
      gameAudioOutput.gain.value = gameSettings.sound ? 1 : 0;
      gameAudioOutput.connect(gameAudioContext.destination);
    }
    if (gameAudioContext.state === 'suspended') void gameAudioContext.resume().catch(() => {});
    void loadVictoryFanfare(gameAudioContext);
  } catch { /* Sound is optional. */ }
}
function playDiceRollSound() {
  if (!gameSettings.sound || gameAudioContext?.state !== 'running') return;
  try {
    const context = gameAudioContext;
    const start = context.currentTime + .02;
    const pace = reducedMotion.matches ? .5 : 1;
    const hits = [0, .065, .15, .25, .37, .51, .68, .9];
    hits.forEach((delay, index) => {
      const at = start + delay * pace;
      const duration = .047;
      const buffer = context.createBuffer(1, Math.ceil(duration * context.sampleRate), context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / context.sampleRate * 80);
      const rattle = context.createBufferSource();
      rattle.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1450 * [ .85, 1.12, 1 ][index % 3];
      filter.Q.value = .85;
      const gain = context.createGain();
      const strength = .16 * (index === hits.length - 1 ? 1.4 : 1 - index * .025) * .9;
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(strength, at + .002);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      rattle.connect(filter).connect(gain).connect(gameAudioOutput);
      rattle.start(at);
      rattle.stop(at + duration);
      const body = context.createOscillator();
      const bodyGain = context.createGain();
      body.type = 'sine';
      body.frequency.setValueAtTime(320, at);
      body.frequency.exponentialRampToValueAtTime(208, at + duration);
      bodyGain.gain.setValueAtTime(.0001, at);
      bodyGain.gain.exponentialRampToValueAtTime(strength * .24, at + .003);
      bodyGain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      body.connect(bodyGain).connect(gameAudioOutput);
      body.start(at);
      body.stop(at + duration);
    });
  } catch { /* Browsers without audio support still roll the dice. */ }
}
function playTurnChangeSound() {
  if (!gameSettings.sound || gameAudioContext?.state !== 'running') return;
  try {
    const context = gameAudioContext;
    const start = context.currentTime + .02;
    for (const [frequency, offset, volume, duration] of [[523.25, 0, .045, .52], [659.25, .13, .045, .48], [783.99, .28, .04, .42]]) {
      const note = context.createOscillator();
      const gain = context.createGain();
      const at = start + offset;
      note.type = 'sine';
      note.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume, at + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      note.connect(gain).connect(gameAudioOutput);
      note.start(at);
      note.stop(at + duration + .01);
    }
  } catch { /* Browsers without audio support still change turns. */ }
}
function playGameVictoryFanfare() {
  if (!gameSettings.sound || gameAudioContext?.state !== 'running') return;
  const context = gameAudioContext;
  void loadVictoryFanfare(context).then(buffer => {
    if (gameSettings.sound && context.state === 'running' && context === gameAudioContext) {
      playVictoryFanfare(context, gameAudioOutput, buffer);
    }
  }).catch(() => { /* Victory remains visible without audio support. */ });
}
function playTradeSound(variant = 1, output = gameAudioOutput) {
  if (!gameSettings.sound || gameAudioContext?.state !== 'running') return;
  try {
    const context = gameAudioContext;
    const start = context.currentTime + .02;
    const piles = [
      { times: [0, .028, .061, .098, .135, .171, .225, .258, .317, .389, .468, .56], base: 1650, volume: .105, decay: .048, cutoff: 6500 },
      { times: [0, .039, .083, .117, .16, .218, .265, .314, .388, .48], base: 1250, volume: .12, decay: .036, cutoff: 3500 },
      { times: [0, .023, .047, .08, .107, .135, .18, .207, .236, .28, .327, .38, .448, .525], base: 1850, volume: .072, decay: .033, cutoff: 4400 },
      { times: [0, .02, .046, .072, .103, .13, .159, .197, .24, .275, .317, .366, .425, .489, .559], base: 1450, volume: .095, decay: .056, cutoff: 5900 },
    ];
    const pile = piles[variant - 1] || piles[0];
    const pitchSteps = [1, 1.18, .87, 1.37, 1.07, .74, 1.25, .92];
    const velocities = [1, .66, .92, .54, .83, .72, 1.06, .62, .76, .58];
    pile.times.forEach((offset, index) => {
      const frequency = pile.base * pitchSteps[index % pitchSteps.length];
      const duration = pile.decay * 3.1;
      const buffer = context.createBuffer(1, Math.ceil(duration * context.sampleRate), context.sampleRate);
      const samples = buffer.getChannelData(0);
      const strength = pile.volume * velocities[index % velocities.length] * (index >= pile.times.length - 2 ? .72 : 1);
      for (let i = 0; i < samples.length; i++) {
        const t = i / context.sampleRate;
        const ring = Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t / pile.decay)
          + .47 * Math.sin(2 * Math.PI * frequency * 1.63 * t) * Math.exp(-t / (pile.decay * .65))
          + .21 * Math.sin(2 * Math.PI * frequency * 2.37 * t) * Math.exp(-t / (pile.decay * .4));
        const click = (Math.random() * 2 - 1) * .55 * Math.exp(-t * 210);
        samples[i] = strength * (ring * .58 + click);
      }
      const coin = context.createBufferSource();
      const filter = context.createBiquadFilter();
      coin.buffer = buffer;
      filter.type = 'lowpass';
      filter.frequency.value = pile.cutoff;
      coin.connect(filter).connect(output);
      coin.start(start + offset);
    });
  } catch { /* Trading remains available without sound. */ }
}
function playRobberMoveSound() {
  if (!gameSettings.sound || gameAudioContext?.state !== 'running') return;
  try {
    const context = gameAudioContext;
    const start = context.currentTime + .02;
    const duration = .48;
    const buffer = context.createBuffer(1, Math.ceil(duration * context.sampleRate), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const rustle = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    rustle.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(230, start);
    filter.frequency.exponentialRampToValueAtTime(1400, start + duration);
    filter.Q.value = .7;
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.linearRampToValueAtTime(.17, start + duration * .38);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    rustle.connect(filter).connect(gain).connect(gameAudioOutput);
    rustle.start(start);
    rustle.stop(start + duration);
    const at = start + .45;
    const stopLength = .14;
    const stopBuffer = context.createBuffer(1, Math.ceil(stopLength * context.sampleRate), context.sampleRate);
    const stopSamples = stopBuffer.getChannelData(0);
    for (let i = 0; i < stopSamples.length; i++) stopSamples[i] = (Math.random() * 2 - 1) * Math.exp(-i / context.sampleRate * 75);
    const stop = context.createBufferSource();
    const stopFilter = context.createBiquadFilter();
    const stopGain = context.createGain();
    stop.buffer = stopBuffer;
    stopFilter.type = 'bandpass';
    stopFilter.frequency.value = 380;
    stopFilter.Q.value = .85;
    stopGain.gain.setValueAtTime(.0001, at);
    stopGain.gain.exponentialRampToValueAtTime(.19, at + .002);
    stopGain.gain.exponentialRampToValueAtTime(.0001, at + stopLength);
    stop.connect(stopFilter).connect(stopGain).connect(gameAudioOutput);
    stop.start(at);
    stop.stop(at + stopLength);
    const body = context.createOscillator();
    const bodyGain = context.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(95, at);
    body.frequency.exponentialRampToValueAtTime(95 * .65, at + .09);
    bodyGain.gain.setValueAtTime(.0001, at);
    bodyGain.gain.exponentialRampToValueAtTime(.19 * .24, at + .003);
    bodyGain.gain.exponentialRampToValueAtTime(.0001, at + stopLength);
    body.connect(bodyGain).connect(gameAudioOutput);
    body.start(at);
    body.stop(at + stopLength);
  } catch { /* Robber movement remains available without sound. */ }
}
const roadHitDownload = fetch('/assets/audio/road-brick-hit.mp3?v=road-brick1')
  .then(response => response.ok ? response.arrayBuffer() : null).catch(() => null);
let roadHitBufferPromise;
function playRoadConstructionSound(context) {
  roadHitBufferPromise ||= roadHitDownload.then(bytes => bytes ? context.decodeAudioData(bytes.slice(0)) : null).catch(() => null);
  void roadHitBufferPromise.then(buffer => {
    if (!gameSettings.sound || context.state !== 'running') return;
    if (!buffer) return;
    const start = context.currentTime + .02;
    [0, .24, .49].forEach((offset, index) => {
      const hit = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      hit.buffer = buffer;
      hit.playbackRate.value = [.98, 1, 1.03][index];
      filter.type = 'lowpass';
      filter.frequency.value = 3000;
      gain.gain.value = .52 * (index === 2 ? 1.15 : 1);
      hit.connect(filter).connect(gain).connect(gameAudioOutput);
      hit.start(start + offset);
    });
  });
}
function playConstructionSound(kind) {
  if (!gameSettings.sound || gameAudioContext?.state !== 'running') return;
  try {
    const context = gameAudioContext;
    if (kind === 'road') {
      playRoadConstructionSound(context);
      return;
    }
    const hits = kind === 'city' ? [0, .15, .34, .55] : [0, .21, .42];
    hits.forEach((offset, index) => {
      const at = context.currentTime + .02 + offset;
      const duration = .15;
      const buffer = context.createBuffer(1, Math.ceil(duration * context.sampleRate), context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 2;
      const strike = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      strike.buffer = buffer;
      filter.type = 'bandpass';
      filter.frequency.value = (kind === 'city' ? 620 : 510) + index * 60;
      filter.Q.value = .8;
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(kind === 'city' ? .36 + index * .015 : .32, at + .003);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      strike.connect(filter).connect(gain).connect(gameAudioOutput);
      strike.start(at);
      strike.stop(at + duration);
      const body = context.createOscillator();
      const bodyGain = context.createGain();
      body.type = 'sine';
      body.frequency.setValueAtTime(165, at);
      body.frequency.exponentialRampToValueAtTime(85, at + .09);
      bodyGain.gain.setValueAtTime(.0001, at);
      bodyGain.gain.exponentialRampToValueAtTime(kind === 'city' ? .105 : .085, at + .004);
      bodyGain.gain.exponentialRampToValueAtTime(.0001, at + .13);
      body.connect(bodyGain).connect(gameAudioOutput);
      body.start(at);
      body.stop(at + .14);
    });
  } catch { /* Construction remains available without sound. */ }
}
const resourcePopDownload = fetch('/assets/audio/resource-pop.mp3?v=pop-sample1')
  .then(response => response.ok ? response.arrayBuffer() : null).catch(() => null);
let resourcePopBufferPromise;
let resourcePopOffset;
function playResourcePop() {
  if (!gameSettings.sound || gameAudioContext?.state !== 'running') return;
  const context = gameAudioContext;
  resourcePopBufferPromise ||= resourcePopDownload.then(bytes => bytes ? context.decodeAudioData(bytes.slice(0)) : null).catch(() => null);
  void resourcePopBufferPromise.then(buffer => {
    if (!gameSettings.sound || !buffer || context.state !== 'running') return;
    if (resourcePopOffset === undefined) {
      const samples = buffer.getChannelData(0);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      const threshold = peak * .18;
      let onset = 0;
      while (onset < samples.length && Math.abs(samples[onset]) < threshold) onset++;
      resourcePopOffset = Math.max(0, onset / buffer.sampleRate - .012);
    }
    const duration = Math.min(.22, buffer.duration - resourcePopOffset);
    if (duration <= 0) return;
    const at = context.currentTime + .005;
    const pop = context.createBufferSource();
    const gain = context.createGain();
    pop.buffer = buffer;
    gain.gain.setValueAtTime(.18, at);
    gain.gain.setValueAtTime(.18, at + Math.max(0, duration - .035));
    gain.gain.linearRampToValueAtTime(0, at + duration);
    pop.connect(gain).connect(gameAudioOutput);
    pop.start(at, resourcePopOffset, duration);
  });
}
document.addEventListener('pointerdown', unlockGameAudio, { passive: true });
document.addEventListener('keydown', unlockGameAudio);
const DIE_POSITIONS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const DIE_FACE_SLOTS = [1, 6, 3, 4, 2, 5]; // Front, back, right, left, top, bottom.
const DIE_FACE_VALUES = [1, 6, 3, 4, 2, 5];
const DIE_FINAL_ROTATION = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(-90deg) rotateY(0deg)',
  3: 'rotateX(0deg) rotateY(-90deg)',
  4: 'rotateX(0deg) rotateY(90deg)',
  5: 'rotateX(90deg) rotateY(0deg)',
  6: 'rotateX(0deg) rotateY(180deg)',
};
const DIE_FINAL_ANGLES = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
const diePips = value => Array.from({ length: 9 }, (_, index) => DIE_POSITIONS[value].includes(index) ? `<i class="die-pip" style="grid-area:${Math.floor(index / 3) + 1}/${index % 3 + 1}"></i>` : '').join('');
let simpleDiceTimer = null;
let simpleDiceFaces = [1, 1];
function startSimpleDiceRoll() {
  clearInterval(simpleDiceTimer);
  const tick = () => {
    simpleDiceFaces = simpleDiceFaces.map(() => 1 + Math.floor(Math.random() * 6));
    renderDice();
  };
  tick();
  simpleDiceTimer = setInterval(tick, 95);
}
function stopSimpleDiceRoll() {
  clearInterval(simpleDiceTimer);
  simpleDiceTimer = null;
}
async function finishSimpleRoll() {
  const id = ++rollAnimationId;
  stopSimpleDiceRoll();
  if (!state?.rolled) return;
  rollVisual.rolling = false;
  rollVisual.settling = true;
  renderDice();
  await new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? 0 : 280));
  if (id !== rollAnimationId || !state?.rolled) return;
  rollVisual.settling = false;
  rollVisual.highlightTotal = state.dice[0] + state.dice[1];
  rollPresentationPending = false;
  rollProductionPending = !reducedMotion.matches && (state.lastProduction || []).some(item => item.amount > 0) && !!$('#board').getScreenCTM();
  render();
  const duration = animateProduction(state.lastProduction || [], id);
  await new Promise(resolve => setTimeout(resolve, Math.max(2400, duration)));
  if (id !== rollAnimationId) return;
  rollProductionPending = false;
  rollVisual.highlightTotal = null;
  render();
}
async function animateIncomingSimpleRoll() {
  const id = ++rollAnimationId;
  startSimpleDiceRoll();
  playDiceRollSound();
  await new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? 0 : 750));
  if (id !== rollAnimationId || !state?.rolled) { stopSimpleDiceRoll(); return; }
  finishSimpleRoll();
}
for (const scene of [$('#throw-die-one'), $('#throw-die-two')]) {
  scene.querySelector('.dice-cube').innerHTML = DIE_FACE_SLOTS.map(face => `<div class="dice-face-core" data-face="${face}"></div>`).join('')
    + DIE_FACE_SLOTS.map(face => `<div class="dice-face" data-face="${face}"></div>`).join('');
}
const joined = () => room && room.me !== null;
const myTurn = () => !!state && joined() && state.player === room.me;
const canAct = () => myTurn() && connected && !pending && !handoff && !replay.active && !rollPresentationPending && !rollProductionPending && state.winner === null;
const score = player => rules.score(state, player);
const canPay = cost => rules.canPay(state?.players[room.me]?.resources, cost);
const canSettle = index => canAct() && rules.canSettle(state, index);
const canRoad = index => canAct() && rules.canRoad(state, index);
const canCity = index => canAct() && rules.canCity(state, index);
const hasBuildLocation = key => key === 'road'
  ? board.edges.some((_, index) => rules.canRoad(state, index))
  : board.vertices.some((_, index) => key === 'city' ? rules.canCity(state, index) : rules.canSettle(state, index));

function readLocalSaves() {
  try { return loadLocalLibrary(localStorage); }
  catch { return { activeId: null, saves: [] }; }
}
function saveLocalSession() {
  try { localSessionId = saveLocalLibrarySession(localStorage, localSession, localSessionId || undefined).id; }
  catch { notice('Не удалось сохранить локальную партию в браузере.', true); }
}
function secureRandomIndex(count) {
  const ceiling = Math.floor(0x100000000 / count) * count;
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= ceiling);
  return value[0] % count;
}
function openLocalSession(saved, id) {
  clearTimeout(localBotTimer);
  rollAnimationId++;
  diceEntranceToken++;
  rollVisual = { entering: false, rolling: false, settling: false, revealing: false, flying: false, fading: false, highlightTotal: null, sourceTile: null };
  diceQuestionVisible = false;
  hoveredRollTotal = null;
  robberFlight = null;
  clearTimeout(sourceTimer);
  discardDraft = Object.fromEntries(RESOURCE_KEYS.map(key => [key, 0]));
  $('#resource-effects').replaceChildren();
  $('#steal-effects').replaceChildren();
  $('#robber-effects').replaceChildren();
  clearAchievements();
  room = null;
  state = null;
  roomCode = '';
  localMode = true;
  history.replaceState(null, '', '/?local=1');
  localSession = saved;
  localSessionId = id;
  connected = true;
  const botActing = nextBotSeat(saved.game) !== null;
  handoff = !botActing;
  const seat = botActing ? saved.game.players.findIndex(player => !player.botLevel) : hotseatSeat(saved.game);
  accept(hotseatRoom(saved.game, saved.names, seat, saved.revision));
  queueLocalBot();
}

function queueLocalBot() {
  clearTimeout(localBotTimer);
  if (!room?.local || !localSession || handoff || replay.active || nextBotSeat(localSession.game) === null) return;
  localBotTimer = setTimeout(runLocalBotStep, 460);
}

function runLocalBotStep() {
  localBotTimer = null;
  if (!room?.local || !localSession || handoff || replay.active) return;
  if (pending || rollPresentationPending || rollProductionPending || robberFlight) { queueLocalBot(); return; }
  const choice = chooseBotAction(localSession.game);
  if (!choice) return;
  try {
    pending = true;
    const previousSeat = room.me;
    localSession.game = applyBotChoice(localSession.game, choice, () => secureRandomIndex(6) + 1, secureRandomIndex);
    localSession.revision++;
    const nextBot = nextBotSeat(localSession.game) !== null;
    const seat = nextBot ? previousSeat : hotseatSeat(localSession.game);
    handoff = !nextBot && seat !== previousSeat;
    saveLocalSession();
    accept(hotseatRoom(localSession.game, localSession.names, seat, localSession.revision));
  } catch (error) { notice(`Бот остановился: ${error.message}`, true); return; }
  finally { pending = false; render(); }
  queueLocalBot();
}

function notice(message = '', error = false) {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
  $('#notice').classList.toggle('error', error);
}
function showDevelopmentCard(type, replay = false) {
  const card = DEV_CARDS[type];
  if (!card) return;
  const held = state?.players?.[room.me]?.devCards?.filter(item => item.type === type) || [];
  if (replay && !held.length) return;
  $('#reveal-kicker').textContent = replay ? 'Карта развития' : 'Новая карта развития';
  $('#reveal-symbol').textContent = card.icon;
  $('#reveal-title').textContent = card.name;
  $('#reveal-description').textContent = card.description;
  $('#reveal-availability').textContent = type === 'victory' ? 'Скрытое победное очко'
    : replay && held.some(item => item.boughtOn < (state.turnNumber ?? 0)) ? 'Можно сыграть в свой ход' : 'Можно сыграть со следующего хода';
  const dialog = $('#development-reveal');
  if (!dialog.open) dialog.showModal();
}
async function request(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', signal: controller.signal,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось выполнить действие.');
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function showNextAchievement() {
  if (achievementTimer || !achievementQueue.length) return;
  const { kind, player } = achievementQueue.shift();
  const overlay = $('#achievement-overlay');
  overlay.dataset.kind = kind;
  overlay.style.setProperty('--award-player-color', playerColor(player));
  const icon = document.createElement('img');
  icon.src = kind === 'army'
    ? './assets/optimized/icons/achievement-army-riders.webp?v=1'
    : './assets/optimized/icons/achievement-road-realistic.webp?v=1';
  icon.alt = '';
  $('#achievement-icon').replaceChildren(icon);
  $('#achievement-title').textContent = kind === 'road' ? 'Самый длинный тракт' : 'Самое большое войско';
  $('#achievement-player').textContent = state.players[player].name;
  overlay.hidden = false;
  achievementTimer = setTimeout(() => {
    overlay.hidden = true;
    achievementTimer = null;
    if (achievementQueue.length) setTimeout(showNextAchievement, 60);
  }, 4000);
}
function clearAchievements() {
  clearTimeout(achievementTimer);
  achievementTimer = null;
  achievementQueue.length = 0;
  $('#achievement-overlay').hidden = true;
}
function hideVictoryOverlay() {
  $('#victory-overlay').hidden = true;
}
function stopVictoryFireworks() {
  clearInterval(victoryFireworkTimer);
  clearTimeout(victoryFireworkStopTimer);
  victoryFireworkTimer = null;
  victoryFireworkStopTimer = null;
  $('#victory-fireworks').replaceChildren();
}
function launchVictoryFirework() {
  if (!state || state.winner === null || replay.active || reducedMotion.matches) return;
  const buildings = board.vertices.filter((_, index) => state.owner[index] === state.winner);
  const matrix = $('#board').getScreenCTM();
  if (!buildings.length || !matrix) return;
  const vertex = buildings[victoryBurstIndex++ % buildings.length];
  const point = new DOMPoint(vertex.x, vertex.y - 17).matrixTransform(matrix);
  const burst = document.createElement('span');
  burst.className = 'victory-firework';
  burst.style.left = `${point.x}px`;
  burst.style.top = `${point.y}px`;
  burst.style.setProperty('--spark-color', victoryBurstIndex % 2 ? '#ffe49c' : '#a9e9e5');
  burst.innerHTML = Array.from({ length: 10 }, (_, index) => `<i style="--ray:${index * 36}deg"></i>`).join('');
  $('#victory-fireworks').append(burst);
  setTimeout(() => burst.remove(), 1000);
}
function startVictoryFireworks() {
  stopVictoryFireworks();
  launchVictoryFirework();
  victoryFireworkTimer = setInterval(launchVictoryFirework, 550);
  victoryFireworkStopTimer = setTimeout(stopVictoryFireworks, 12000);
}
function showVictoryOverlay() {
  if (!state || state.winner === null) return;
  clearAchievements();
  const winner = state.players[state.winner];
  const overlay = $('#victory-overlay');
  overlay.style.setProperty('--victory-color', playerColor(state.winner));
  $('#victory-title').textContent = 'Победа!';
  $('#victory-name').textContent = winner.name;
  $('#victory-replay').disabled = historyFrames().length < 2;
  overlay.hidden = false;
  $('#victory-close').focus();
  playGameVictoryFanfare();
  startVictoryFireworks();
}
function accept(next) {
  if (room?.id === next.id && room.revision > next.revision) return;
  const previousRoom = room;
  const previousState = state;
  if (previousRoom?.id !== next.id || !next.game || (previousState && previousState.winner !== null && next.game?.winner === null)) {
    stopReplayPlayback();
    replay.active = false;
    hideVictoryOverlay();
    stopVictoryFireworks();
  }
  if (previousRoom?.id !== next.id || previousRoom.me !== next.me) tradeDraft = freshTradeDraft();
  const previousRobberTile = state?.robberTile;
  const robberMoved = room?.id === next.id && next.revision > room.revision && state && next.game
    && previousRobberTile !== next.game.robberTile && board.tiles[previousRobberTile] && board.tiles[next.game.robberTile]
    && !handoff && !reducedMotion.matches;
  if (robberFlight && (room?.id !== next.id || !next.game || robberMoved || next.game.robberTile !== robberFlight.to)) {
    robberFlight = null;
    $('#robber-effects').replaceChildren();
  }
  if (robberMoved) robberFlight = { from: previousRobberTile, to: next.game.robberTile };
  const previousRoad = state?.longestRoad;
  const previousArmy = state?.largestArmy;
  const previousPlayer = state?.player;
  const previousStealId = state?.lastSteal?.id;
  const completedTrade = previousRoom?.id === next.id && next.revision > previousRoom.revision
    && previousState?.log?.[0] !== next.game?.log?.[0]
    && /(?:морской обмен|принял обмен от)/.test(next.game?.log?.[0] || '');
  const rolledNow = room?.id === next.id && state?.phase === 'turn' && !state.rolled && next.game?.rolled;
  const simpleRoll = rolledNow && (rollVisual.simple || gameSettings.diceAnimation === 'simple');
  const animateIncoming = rolledNow && !simpleRoll && !rollVisual.entering && !rollVisual.rolling && !reducedMotion.matches;
  const turnEnded = room?.id !== next.id || (state?.rolled && !next.game?.rolled) || !next.game;
  if (turnEnded) {
    stopSimpleDiceRoll();
    rollAnimationId++;
    rollPresentationPending = false;
    rollProductionPending = false;
    rollVisual = { entering: false, rolling: false, settling: false, revealing: false, flying: false, fading: false, highlightTotal: null, sourceTile: null };
    hoveredRollTotal = null;
    clearTimeout(sourceTimer);
    $('#resource-effects').replaceChildren();
  }
  if (previousRoom?.id !== next.id || !next.game) { clearAchievements(); $('#steal-effects').replaceChildren(); }
  const mode = room?.revision === next.revision ? state?.mode : null;
  room = next; roomCode = next.id; state = next.game;
  board = rules.boardFor(state);
  if (state && state.longestRoad === undefined) rules.refreshLongestRoad(state);
  if (state) state.mode = myTurn() && state.phase === 'setup' ? 'settlement' : myTurn() && (state.phase === 'setup-road' || state.phase === 'dev-road') ? 'road' : mode;
  document.title = next.local ? 'Catan · игра на одном устройстве' : `Catan · ${roomCode}`;
  if (rolledNow && !simpleRoll && !animateIncoming && rollVisual.rolling) captureDiceSettleStart();
  if (rolledNow) { rollVisual.simple = simpleRoll; rollVisual.entering = animateIncoming; rollVisual.rolling = simpleRoll; rollVisual.settling = !simpleRoll && !animateIncoming; rollVisual.revealing = false; rollVisual.flying = false; rollVisual.fading = false; }
  if (rolledNow) rollPresentationPending = !reducedMotion.matches;
  render();
  if (robberMoved) animateRobberFlight(robberFlight);
  if (previousRoom?.id === next.id && next.revision > previousRoom.revision && state) {
    if (completedTrade) playTradeSound();
    if (previousState?.city?.some((built, index) => !built && state.city[index])) playConstructionSound('city');
    else if (previousState?.owner?.some((owner, index) => owner === null && state.owner[index] !== null)) playConstructionSound('settlement');
    else if (previousState?.roads?.some((owner, index) => owner === null && state.roads[index] !== null)) playConstructionSound('road');
    if (state.lastSteal?.id !== previousStealId && state.lastSteal?.resource) animateSteal(state.lastSteal);
    if (previousRoom.status === 'playing' && previousPlayer != null && state.player !== previousPlayer && state.winner === null) playTurnChangeSound();
    if (state.longestRoad != null && state.longestRoad !== previousRoad) achievementQueue.push({ kind: 'road', player: state.longestRoad });
    if (state.largestArmy != null && state.largestArmy !== previousArmy) achievementQueue.push({ kind: 'army', player: state.largestArmy });
    showNextAchievement();
  }
  if (rolledNow) {
    if (simpleRoll && simpleDiceTimer) finishSimpleRoll();
    else if (simpleRoll) animateIncomingSimpleRoll();
    else if (animateIncoming) animateIncomingRoll();
    else finishRoll();
  }
  if (previousRoom?.id === next.id && previousState?.winner === null && state?.winner !== null) showVictoryOverlay();
}
function robberArc(fromIndex, toIndex) {
  const point = index => ({ x: board.tiles[index].x + ROBBER_TOKEN.offsetX, y: board.tiles[index].y + ROBBER_TOKEN.offsetY });
  const from = point(fromIndex), to = point(toIndex);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const lift = Math.min(70, Math.max(25, distance * .12));
  return { from, to, control: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - lift * 2 }, distance };
}
function pointOnRobberArc(arc, t) {
  const u = 1 - t;
  return { x: u * u * arc.from.x + 2 * u * t * arc.control.x + t * t * arc.to.x,
    y: u * u * arc.from.y + 2 * u * t * arc.control.y + t * t * arc.to.y };
}
function robberPreviewArc(fromIndex, toIndex) {
  const from = robberArc(fromIndex, toIndex).from;
  const tile = board.tiles[toIndex];
  const to = { x: tile.x, y: tile.y };
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const lift = Math.min(70, Math.max(25, distance * .12));
  const arc = { from, to, control: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - lift * 2 } };
  const rim = 23;
  let outside = 0, inside = 1;
  for (let step = 0; step < 18; step++) {
    const middle = (outside + inside) / 2;
    const point = pointOnRobberArc(arc, middle);
    if (Math.hypot(point.x - arc.to.x, point.y - arc.to.y) > rim) outside = middle;
    else inside = middle;
  }
  const t = (outside + inside) / 2;
  return { from: arc.from, to: pointOnRobberArc(arc, t),
    control: { x: arc.from.x + (arc.control.x - arc.from.x) * t,
      y: arc.from.y + (arc.control.y - arc.from.y) * t } };
}
function animateRobberFlight(flight) {
  const matrix = $('#board').getScreenCTM();
  if (!matrix || !flight) { robberFlight = null; renderBoard(); return; }
  playRobberMoveSound();
  const arc = robberArc(flight.from, flight.to);
  const scale = Math.hypot(matrix.a, matrix.b);
  const token = document.createElement('img');
  token.className = 'robber-flight';
  token.src = './assets/optimized/pieces/robber-06.webp?v=1';
  token.alt = '';
  token.style.width = `${ROBBER_TOKEN.width * scale}px`;
  token.style.height = `${ROBBER_TOKEN.height * scale}px`;
  $('#robber-effects').replaceChildren(token);
  const position = (x, y, size = 1) => `translate(${x}px,${y}px) translate(-50%,-50%) scale(${size})`;
  const keyframes = Array.from({ length: 25 }, (_, index) => {
    const t = index / 24;
    const point = pointOnRobberArc(arc, t);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { transform: position(screen.x, screen.y, 1 + .08 * Math.sin(Math.PI * t)), offset: t };
  });
  token.animate(keyframes, { duration: Math.min(1050, 700 + arc.distance * .45), easing: 'ease-in-out', fill: 'forwards' })
    .finished.catch(() => {}).then(() => {
      if (robberFlight !== flight) return;
      robberFlight = null;
      $('#robber-effects').replaceChildren();
      renderBoard();
    });
}
function animateSteal(event) {
  if (handoff || !RESOURCE_KEYS.includes(event.resource)) return;
  const source = document.querySelector(`.player-card[data-player="${event.from}"]`);
  const target = document.querySelector(`.player-card[data-player="${event.to}"]`);
  if (!source || !target) return;
  const sourceRect = source.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const fromX = sourceRect.left + sourceRect.width / 2;
  const fromY = sourceRect.top + sourceRect.height / 2;
  const toX = targetRect.left + targetRect.width / 2;
  const toY = targetRect.top + targetRect.height / 2;
  const resource = TYPES[event.resource].name.toLowerCase();
  const message = room.me === event.from ? `У вас украли: ${resource}` : `Украдено у ${state.players[event.from].name}: ${resource}`;
  const badge = document.createElement('div');
  badge.className = 'steal-flight';
  badge.style.setProperty('--player-color', playerColor(event.to));
  badge.innerHTML = `<img src="${iconUrl(event.resource)}" alt=""><span>${escape(message)}</span>`;
  const layer = $('#steal-effects');
  layer.replaceChildren(badge);
  const position = (x, y, scale = 1) => `translate(${x}px,${y}px) translate(-50%,-50%) scale(${scale})`;
  badge.style.transform = position(reducedMotion.matches ? toX : fromX, reducedMotion.matches ? toY : fromY);
  if (reducedMotion.matches) {
    setTimeout(() => badge.remove(), 2400);
    return;
  }
  badge.style.opacity = '0';
  const dx = toX - fromX;
  const dy = toY - fromY;
  const frames = [
    { transform: position(fromX, fromY, .8), opacity: 0, offset: 0 },
    { transform: position(fromX, fromY - 24, 1), opacity: 1, offset: .16 },
    { transform: position(fromX + dx * .5, fromY + dy * .5 - 50, 1), opacity: 1, offset: .52 },
    { transform: position(toX, toY, 1), opacity: 1, offset: .78 },
    { transform: position(toX, toY, 1), opacity: 1, offset: 1 },
  ];
  badge.animate(frames, { duration: 1250, easing: 'ease-in-out', fill: 'forwards' }).finished.catch(() => {}).then(() => {
    if (!badge.isConnected) return;
    target.style.setProperty('--player-color', playerColor(event.to));
    target.classList.remove('resource-received'); void target.offsetWidth;
    target.classList.add('resource-received');
    setTimeout(() => badge.remove(), 1500);
  });
}
async function animateIncomingRoll() {
  const id = ++rollAnimationId;
  beginDiceEntrance();
  await new Promise(resolve => setTimeout(resolve, DICE_ENTRY_MS));
  if (id !== rollAnimationId || !state?.rolled) return;
  playDiceRollSound();
  rollVisual.entering = false;
  rollVisual.rolling = true;
  renderDice();
  await new Promise(resolve => setTimeout(resolve, DICE_SPIN_MS));
  if (id !== rollAnimationId || !state?.rolled) return;
  captureDiceSettleStart();
  rollVisual.rolling = false;
  rollVisual.settling = true;
  renderDice();
  finishRoll();
}
function captureDiceSettleStart() {
  for (const [index, sceneId] of ['#throw-die-one', '#throw-die-two'].entries()) {
    const cube = $(sceneId).querySelector('.dice-cube');
    const animationName = index === 0 ? 'dice-tumble-first' : 'dice-tumble-second';
    const spin = cube.getAnimations().find(animation => animation.animationName === animationName);
    const progress = spin?.effect?.getComputedTiming().progress;
    if (!Number.isFinite(progress)) {
      cube.style.setProperty('--settle-from', getComputedStyle(cube).transform);
      cube.style.setProperty('--settle-to', DIE_FINAL_ROTATION[state.dice[index]]);
      continue;
    }
    const zDirection = index === 0 ? 1 : -1;
    const from = [-58 - 360 * progress, -23 + 360 * progress, zDirection * 360 * progress];
    const final = [...DIE_FINAL_ANGLES[state.dice[index]], 0];
    const directions = [-1, 1, zDirection];
    const to = final.map((angle, axis) => {
      const direction = directions[axis];
      let destination = angle + 360 * Math.round((from[axis] + direction * 360 - angle) / 360);
      if (direction * (destination - from[axis]) < 0) destination += direction * 360;
      return destination;
    });
    const rotation = angles => `rotateX(${angles[0]}deg) rotateY(${angles[1]}deg) rotateZ(${angles[2]}deg)`;
    cube.style.setProperty('--settle-from', rotation(from));
    cube.style.setProperty('--settle-to', rotation(to));
  }
}
function beginDiceEntrance() {
  rollVisual.entering = true;
  diceQuestionVisible = true;
  const entranceToken = ++diceEntranceToken;
  renderDice();
  const overlay = $('#dice-overlay');
  overlay.classList.remove('is-entering');
  for (const [previewId, throwId] of [['#preview-one', '#throw-die-one'], ['#preview-two', '#throw-die-two']]) {
    const from = $(previewId).getBoundingClientRect();
    const scene = $(throwId);
    const to = scene.getBoundingClientRect();
    const startX = from.left + from.width / 2;
    const startY = from.top + from.height / 2;
    const targetX = to.left + to.width / 2;
    const targetY = to.top + to.height / 2;
    const dx = startX - targetX;
    const dy = startY - targetY;
    const lift = Math.min(320, Math.max(140, Math.abs(dx) * .38), Math.max(0, (startY + targetY) / 2 - 50));
    scene.style.setProperty('--entry-x', `${dx}px`);
    scene.style.setProperty('--entry-y', `${dy}px`);
    for (const step of [125, 250, 375, 500, 625, 750, 875]) {
      const progress = step / 1000;
      const travel = Math.sin(progress * Math.PI / 2);
      scene.style.setProperty(`--entry-x${step}`, `${dx * (1 - travel)}px`);
      scene.style.setProperty(`--entry-y${step}`, `${dy * (1 - travel) - 4 * lift * travel * (1 - travel)}px`);
    }
  }
  void overlay.offsetWidth;
  overlay.classList.add('is-entering');
  setTimeout(() => {
    if (entranceToken !== diceEntranceToken || !rollVisual.entering) return;
    diceQuestionVisible = false;
    renderDice();
  }, Math.round(DICE_ENTRY_MS / 2));
}
function beginDiceFly() {
  for (const [throwId, resultId] of [['#throw-die-one', '#die-one'], ['#throw-die-two', '#die-two']]) {
    const scene = $(throwId);
    const from = scene.getBoundingClientRect();
    const to = $(resultId).getBoundingClientRect();
    scene.style.setProperty('--fly-x', `${to.left + to.width / 2 - from.left - from.width / 2}px`);
    scene.style.setProperty('--fly-y', `${to.top + to.height / 2 - from.top - from.height / 2}px`);
  }
  const equation = $('#dice-equation');
  const from = equation.getBoundingClientRect();
  const to = $('#dice-total-target').getBoundingClientRect();
  equation.style.setProperty('--eq-fly-x', `${to.left + to.width / 2 - from.left - from.width / 2}px`);
  equation.style.setProperty('--eq-fly-y', `${to.top + to.height / 2 - from.top - from.height / 2}px`);
  equation.style.setProperty('--eq-scale-x', String(to.width / from.width));
  equation.style.setProperty('--eq-scale-y', String(to.height / from.height));
  rollVisual.revealing = false;
  rollVisual.settling = false;
  rollVisual.flying = true;
  rollVisual.fading = true;
  rollVisual.highlightTotal = state.dice[0] + state.dice[1];
  render();
}
async function finishRoll() {
  const id = ++rollAnimationId;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const current = () => id === rollAnimationId && state?.rolled;
  const animate = !reducedMotion.matches;
  await pause(animate ? 1150 : 0);
  if (!current()) return;
  rollVisual.revealing = true;
  renderDice();
  await pause(animate ? 1450 : 0);
  if (!current()) return;
  if (animate) beginDiceFly();
  else {
    rollVisual.settling = false;
    rollVisual.revealing = false;
    rollVisual.highlightTotal = state.dice[0] + state.dice[1];
    render();
  }
  await pause(animate ? 820 : 0);
  if (!current()) return;
  rollVisual.flying = false;
  rollVisual.fading = false;
  rollPresentationPending = false;
  rollProductionPending = animate && (state.lastProduction || []).some(item => item.amount > 0) && !!$('#board').getScreenCTM();
  renderDice();
  render();
  const productionDuration = animateProduction(state.lastProduction || [], id);
  await pause(Math.max(2400, productionDuration));
  if (id !== rollAnimationId) return;
  rollProductionPending = false;
  rollVisual.highlightTotal = null;
  render();
}
function animateProduction(production, id, replay = false) {
  if (!production.length) return 0;
  const boardElement = $('#board');
  const matrix = boardElement.getScreenCTM();
  if (!matrix) return 0;
  if (replay) $('#resource-effects').querySelectorAll('.resource-flight[data-replay="true"]').forEach(previous => previous.remove());
  const units = production.flatMap(item => Number.isInteger(item.amount) && item.amount > 0
    ? Array.from({ length: item.amount }, () => item) : []);
  const gap = reducedMotion.matches ? 160 : 190;
  units.forEach((item, index) => {
    const tile = board.tiles[item.tileIndex];
    const target = document.querySelector(`.player-card[data-player="${item.player}"]`);
    if (!tile || !target || !RESOURCE_KEYS.includes(item.resource)) return;
    const source = new DOMPoint(tile.x, tile.y).matrixTransform(matrix);
    const targetRect = target.getBoundingClientRect();
    const x = source.x, y = source.y;
    const badge = document.createElement('div');
    badge.className = 'resource-flight';
    if (replay) badge.dataset.replay = 'true';
    badge.style.cssText = `--player-color:${playerColor(item.player)};opacity:0;transform:translate(${x}px,${y}px) translate(-50%,-50%)`;
    badge.innerHTML = `<img src="${iconUrl(item.resource)}" alt=""><span>${resourceGain(item.resource, 1)}</span><span class="flight-player">→ ${escape(state.players[item.player]?.name || '')}</span>`;
    $('#resource-effects').append(badge);
    const badgeHeight = badge.getBoundingClientRect().height;
    const hoverY = y - 20 * Math.hypot(matrix.a, matrix.b) - badgeHeight / 2 - 8;
    const endX = targetRect.left + targetRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2;
    const distance = Math.hypot(endX - x, endY - hoverY);
    const arcHeight = Math.min(150, Math.max(70, distance * .17));
    const controlX = (x + endX) / 2;
    const controlY = (hoverY + endY) / 2 - 2 * arcHeight;
    const transformAt = (pointX, pointY, scale) => `translate(${pointX}px,${pointY}px) translate(-50%,-50%) scale(${scale})`;
    badge.style.transform = transformAt(x, hoverY + 12, .85);
    const delay = index * gap;
    if (reducedMotion.matches) {
      setTimeout(() => {
        if (id !== rollAnimationId || !badge.isConnected) { badge.remove(); return; }
        playResourcePop();
        badge.style.opacity = '1';
        badge.style.transform = transformAt(x, hoverY, 1);
        setTimeout(() => badge.remove(), 750);
      }, delay);
      return;
    }
    setTimeout(() => {
      if (id !== rollAnimationId || !badge.isConnected) { badge.remove(); return; }
      playResourcePop();
      const frames = [
        { transform: transformAt(x, hoverY + 12, .85), opacity: 0, offset: 0 },
        { transform: transformAt(x, hoverY, 1.05), opacity: 1, offset: .16 },
        { transform: transformAt(x, hoverY, 1), opacity: 1, offset: .38 },
      ];
      for (let step = 1; step <= 10; step++) {
        const progress = step / 10;
        const travel = progress * progress * (3 - 2 * progress);
        const reverse = 1 - travel;
        const pointX = reverse * reverse * x + 2 * reverse * travel * controlX + travel * travel * endX;
        const pointY = reverse * reverse * hoverY + 2 * reverse * travel * controlY + travel * travel * endY;
        frames.push({ transform: transformAt(pointX, pointY, 1 - .18 * travel), opacity: 1, offset: .38 + .52 * progress });
      }
      frames.push({ transform: transformAt(endX, endY, .45), opacity: 0, offset: 1 });
      const animation = badge.animate(frames, { duration: 2100, easing: 'linear', fill: 'forwards' });
      animation.finished.catch(() => {}).finally(() => {
        const arrived = badge.isConnected && id === rollAnimationId;
        badge.remove();
        const card = document.querySelector(`.player-card[data-player="${item.player}"]`);
        if (card && arrived) {
          card.style.setProperty('--player-color', playerColor(item.player));
          card.classList.remove('resource-received'); void card.offsetWidth;
          card.classList.add('resource-received');
        }
      });
    }, delay);
  });
  return (units.length - 1) * gap + (reducedMotion.matches ? 750 : 2100);
}
async function refreshRoom() { accept(await request(`/api/rooms/${roomCode}`)); }
function connect() {
  events?.close(); connected = false;
  events = new EventSource(`/api/rooms/${roomCode}/events`);
  events.onopen = () => { connected = true; render(); };
  events.addEventListener('state', event => { connected = true; accept(JSON.parse(event.data)); });
  events.onerror = () => { connected = false; render(); };
}
async function sendAction(type, details = {}) {
  if (!joined() || pending || !connected || handoff || replay.active) return;
  previewBuildKey = null;
  pending = true; notice(); render();
  if (room.local) {
    try {
      const previousSeat = room.me;
      if (type === 'restart') {
        if (localSession.game.winner === null) throw new Error('Сначала завершите текущую партию.');
        localSession.game = rules.freshGame(localSession.names.map((name, index) => ({ id: `local-${index}`, name,
          ...(localSession.game.players[index].botLevel ? { botLevel: localSession.game.players[index].botLevel } : {}) })), secureRandomIndex, localSession.game.ruleset || 'new', localSession.game.mapGeneration || (localSession.game.layout ? 'random' : 'fixed'));
      } else {
        localSession.game = rules.applyAction(localSession.game, previousSeat, { type, ...details }, () => secureRandomIndex(6) + 1, secureRandomIndex);
      }
      localSession.revision++;
      const nextBot = nextBotSeat(localSession.game) !== null;
      const seat = nextBot ? previousSeat : hotseatSeat(localSession.game);
      handoff = (type === 'restart' && !nextBot) || (!nextBot && seat !== previousSeat);
      if (handoff) {
        robberFlight = null;
        $('#robber-effects').replaceChildren();
        if (type !== 'roll') {
          rollAnimationId++;
          rollVisual = { entering: false, rolling: false, settling: false, revealing: false, flying: false, fading: false, highlightTotal: null, sourceTile: null };
          hoveredRollTotal = null;
        }
        $('#resource-effects').replaceChildren();
        $('#steal-effects').replaceChildren();
      }
      saveLocalSession();
      accept(hotseatRoom(localSession.game, localSession.names, seat, localSession.revision));
      if (type === 'offer-trade') tradeDraft.player = { give: emptyTradeVector(), want: emptyTradeVector() };
      if (type === 'trade' && details.give) { tradeDraft.bank = { give: emptyTradeVector(), want: emptyTradeVector() }; renderTradePanel(); }
      if (type === 'buy-dev') {
        const card = state.players[room.me].devCards.at(-1);
        if (card) showDevelopmentCard(card.type);
      }
    } catch (error) { notice(error.message, true); }
    finally { pending = false; render(); queueLocalBot(); }
    return;
  }
  try {
    accept(await request(`/api/rooms/${roomCode}/actions`, { type, ...details, revision: room.revision }));
    if (type === 'offer-trade') tradeDraft.player = { give: emptyTradeVector(), want: emptyTradeVector() };
    if (type === 'trade' && details.give) { tradeDraft.bank = { give: emptyTradeVector(), want: emptyTradeVector() }; renderTradePanel(); }
    if (type === 'buy-dev') {
      const card = state.players[room.me].devCards.at(-1);
      if (card) showDevelopmentCard(card.type);
    }
  }
  catch (error) {
    notice(error.message, true);
    try { await refreshRoom(); } catch { /* EventSource will reconnect and refresh the state. */ }
  } finally { pending = false; render(); }
}

const pieceUrl = name => `./assets/optimized/pieces/${name}.webp?v=1`;
const cityPlacementCursor = document.createElement('img');
cityPlacementCursor.className = 'city-placement-cursor';
cityPlacementCursor.alt = '';
cityPlacementCursor.setAttribute('aria-hidden', 'true');
cityPlacementCursor.hidden = true;
document.body.append(cityPlacementCursor);
function hideCityPlacementCursor() { cityPlacementCursor.hidden = true; }
function syncCityPlacementCursor(view) {
  const active = view.mode === 'city' && canAct() && view.phase === 'turn' && view.rolled;
  $('.board-frame').classList.toggle('is-placing-city', active);
  if (!active) { hideCityPlacementCursor(); return; }
  const url = pieceUrl(`city-p${playerColorIndex(room.me)}`);
  if (cityPlacementCursor.getAttribute('src') !== url) cityPlacementCursor.src = url;
}
function roadPiece(a, b, owner, size = 94) {
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 180) % 180;
  const orientation = [30, 90, 150].reduce((closest, candidate) => Math.abs(candidate - angle) < Math.abs(closest - angle) ? candidate : closest, 30);
  const x = (a.x + b.x - size) / 2;
  const y = (a.y + b.y - size) / 2;
  return `<g class='raster-piece raster-road'>
    <image class='piece-raster' href='${pieceUrl('road-' + orientation + '-p' + playerColorIndex(owner))}' x='${x}' y='${y}' width='${size}' height='${size}'/>
  </g>`;
}
function buildingPiece(vertex, owner, city) {
  const size = city ? 56 : 46;
  const imageY = city ? -34 : -28;
  const kind = city ? 'city' : 'settlement';
  return `<g class='raster-piece raster-building' transform='translate(${vertex.x} ${vertex.y})'>
    <image class='piece-raster' href='${pieceUrl(kind + '-p' + playerColorIndex(owner))}' x='${-size / 2}' y='${imageY}' width='${size}' height='${size}'/>
  </g>`;
}
function buildIcon(type) {
  const piece = type === 'road'
    ? roadPiece({ x: -30, y: 17 }, { x: 30, y: -17 }, room.me, 76)
    : buildingPiece({ x: 0, y: 4 }, room.me, type === 'city');
  return `<svg viewBox="-34 -34 68 68" focusable="false" aria-hidden="true">${piece}</svg>`;
}
const SURF_SOURCE = { width: 1536, height: 1024, centerX: 384, centerY: 505, radiusX: 285, radiusY: 345 };
const SURF_IMAGE = './assets/optimized/beach/beach-hex-v2-surf.webp?v=1';
const coastPoints = scale => board.coastVertices.map(index => {
  const vertex = board.vertices[index];
  return `${(CENTER.x + (vertex.x - CENTER.x) * scale).toFixed(2)},${(CENTER.y + (vertex.y - CENTER.y) * scale).toFixed(2)}`;
}).join(' ');
const SURF_SHORE = `<g class="coast-raster" aria-hidden="true"><polygon class="coast-water-base" points="${coastPoints(1.09)}"/><polygon class="coast-sand-base" points="${coastPoints(1.045)}"/>${board.coastalEdges.map((edgeIndex, index) => {
  const edge = board.edges[edgeIndex];
  const a = board.vertices[edge.a], b = board.vertices[edge.b];
  const tile = board.tiles.find(candidate => candidate.corners.includes(edge.a) && candidate.corners.includes(edge.b));
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const distance = Math.hypot(midpoint.x - CENTER.x, midpoint.y - CENTER.y);
  const normal = { x: (midpoint.x - CENTER.x) / distance, y: (midpoint.y - CENTER.y) / distance };
  const point = (vertex, scale) => `${(CENTER.x + (vertex.x - CENTER.x) * scale).toFixed(2)},${(CENTER.y + (vertex.y - CENTER.y) * scale).toFixed(2)}`;
  const corners = [point(a, .99), point(b, .99), point(b, 1.075), point(a, 1.075)].join(' ');
  const sx = (Math.sqrt(3) * SIZE / 2) / SURF_SOURCE.radiusX;
  const sy = SIZE / SURF_SOURCE.radiusY;
  const x = tile.x - SURF_SOURCE.centerX * sx + normal.x * 12;
  const y = tile.y - SURF_SOURCE.centerY * sy + normal.y * 12;
  const width = SURF_SOURCE.width / 2 * sx;
  const height = SURF_SOURCE.height * sy;
  const endX = midpoint.x + normal.x * 28;
  const endY = midpoint.y + normal.y * 28;
  return `<defs><linearGradient id="shore-fade-${index}" gradientUnits="userSpaceOnUse" x1="${midpoint.x.toFixed(2)}" y1="${midpoint.y.toFixed(2)}" x2="${endX.toFixed(2)}" y2="${endY.toFixed(2)}"><stop offset="0" stop-color="white"/><stop offset=".72" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient><mask id="shore-mask-${index}" maskUnits="userSpaceOnUse" x="-40" y="-45" width="850" height="780"><polygon points="${corners}" fill="url(#shore-fade-${index})"/></mask></defs><g mask="url(#shore-mask-${index})"><svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="0 0 ${SURF_SOURCE.width / 2} ${SURF_SOURCE.height}" preserveAspectRatio="none"><image href="${SURF_IMAGE}" x="0" y="0" width="${SURF_SOURCE.width}" height="${SURF_SOURCE.height}"/></svg></g>`;
}).join('')}${board.coastVertices.map((vertexIndex, index) => {
  const vertex = board.vertices[vertexIndex];
  const previous = board.vertices[board.coastVertices[(index - 1 + board.coastVertices.length) % board.coastVertices.length]];
  const next = board.vertices[board.coastVertices[(index + 1) % board.coastVertices.length]];
  const cross = (vertex.x - previous.x) * (next.y - vertex.y) - (vertex.y - previous.y) * (next.x - vertex.x);
  if (cross < 0) {
    const inward = { x: vertex.x - (previous.x + next.x) / 2, y: vertex.y - (previous.y + next.y) / 2 };
    const length = Math.hypot(inward.x, inward.y);
    const tip = { x: vertex.x - inward.x / length * 8, y: vertex.y - inward.y / length * 8 };
    const rotation = Math.atan2(inward.y, inward.x) * 180 / Math.PI - 90;
    const scale = SIZE / SURF_SOURCE.radiusY;
    return `<defs><radialGradient id="shore-vertex-fade-${index}"><stop offset="0" stop-color="white"/><stop offset=".3" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient><mask id="shore-vertex-mask-${index}" maskUnits="userSpaceOnUse" x="-40" y="-45" width="850" height="780"><circle cx="${vertex.x.toFixed(2)}" cy="${vertex.y.toFixed(2)}" r="32" fill="url(#shore-vertex-fade-${index})"/></mask></defs><g mask="url(#shore-vertex-mask-${index})"><g transform="translate(${tip.x.toFixed(2)} ${tip.y.toFixed(2)}) rotate(${rotation.toFixed(2)}) scale(${scale.toFixed(4)})"><image href="${SURF_IMAGE}" x="${-SURF_SOURCE.width * .75}" y="${-SURF_SOURCE.height * .85}" width="${SURF_SOURCE.width}" height="${SURF_SOURCE.height}"/></g></g>`;
  }
  const edgeIndex = board.coastalEdges.find(candidate => {
    const edge = board.edges[candidate];
    return edge.a === vertexIndex || edge.b === vertexIndex;
  });
  const edge = board.edges[edgeIndex];
  const a = board.vertices[edge.a], b = board.vertices[edge.b];
  const tile = board.tiles.find(candidate => candidate.corners.includes(edge.a) && candidate.corners.includes(edge.b));
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const distance = Math.hypot(midpoint.x - CENTER.x, midpoint.y - CENTER.y);
  const sx = (Math.sqrt(3) * SIZE / 2) / SURF_SOURCE.radiusX;
  const sy = SIZE / SURF_SOURCE.radiusY;
  const x = tile.x - SURF_SOURCE.centerX * sx + (midpoint.x - CENTER.x) / distance * 12;
  const y = tile.y - SURF_SOURCE.centerY * sy + (midpoint.y - CENTER.y) / distance * 12;
  return `<defs><radialGradient id="shore-vertex-fade-${index}"><stop offset="0" stop-color="white"/><stop offset=".35" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient><mask id="shore-vertex-mask-${index}" maskUnits="userSpaceOnUse" x="-40" y="-45" width="850" height="780"><circle cx="${vertex.x.toFixed(2)}" cy="${vertex.y.toFixed(2)}" r="23" fill="url(#shore-vertex-fade-${index})"/></mask></defs><g mask="url(#shore-vertex-mask-${index})"><svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(SURF_SOURCE.width / 2 * sx).toFixed(2)}" height="${(SURF_SOURCE.height * sy).toFixed(2)}" viewBox="0 0 ${SURF_SOURCE.width / 2} ${SURF_SOURCE.height}" preserveAspectRatio="none"><image href="${SURF_IMAGE}" x="0" y="0" width="${SURF_SOURCE.width}" height="${SURF_SOURCE.height}"/></svg></g>`;
}).join('')}</g>`;
function replaceBoardMarkup(svg, markup) {
  const images = new Map();
  for (const image of svg.querySelectorAll('image')) {
    const key = image.outerHTML;
    if (!images.has(key)) images.set(key, []);
    images.get(key).push(image);
  }
  const next = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  next.innerHTML = markup;
  for (const image of next.querySelectorAll('image')) {
    const previous = images.get(image.outerHTML)?.pop();
    if (previous) image.replaceWith(previous);
  }
  svg.replaceChildren(...Array.from(next.childNodes));
}
const historyFrames = () => Array.isArray(state?.history) ? state.history : [];
function replayBoardState() {
  if (!replay.active) return state;
  const frame = rules.replayBoardAt(state, replay.index);
  return frame ? { ...state, ...frame, phase: 'replay', mode: null } : state;
}
function renderBoard() {
  const view = replayBoardState();
  syncCityPlacementCursor(view);
  const sourceTile = replay.active ? null : rollVisual.sourceTile;
  const robberTile = view.robberTile ?? board.tiles.findIndex(tile => tile.type === 'desert');
  const highlightedTotal = replay.active ? (view.dice?.every(Number.isInteger) ? view.dice[0] + view.dice[1] : null) : hoveredRollTotal ?? rollVisual.highlightTotal;
  const terrainFade = '<defs><filter id="terrain-edge-feather" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3"/></filter></defs>';
  const tileMarkup = board.tiles.map((tile, tileIndex) => {
    const selectable = canAct() && view.phase === 'robber-move' && tileIndex !== robberTile;
    const points = tile.corners.map(index => `${board.vertices[index].x.toFixed(2)},${board.vertices[index].y.toFixed(2)}`).join(' ');
    const innerPoints = tile.corners.map(index => {
      const vertex = board.vertices[index];
      return `${(tile.x + (vertex.x - tile.x) * 0.91).toFixed(2)},${(tile.y + (vertex.y - tile.y) * 0.91).toFixed(2)}`;
    }).join(' ');
    const fadePoints = tile.corners.map(index => {
      const vertex = board.vertices[index];
      return `${(tile.x + (vertex.x - tile.x) * 0.94).toFixed(2)},${(tile.y + (vertex.y - tile.y) * 0.94).toFixed(2)}`;
    }).join(' ');
    const art = `<image class="tile-art" href="./assets/optimized/terrain/${tile.type}.webp?v=1" x="${tile.x - SIZE}" y="${tile.y - SIZE}" width="${SIZE * 2}" height="${SIZE * 2}" preserveAspectRatio="none" mask="url(#tile-fade-${tileIndex})"/>`;
    const pipCount = NUMBER_PIPS[tile.number] || 0;
    const numberTone = pipCount === 5 ? 'hot' : pipCount === 4 ? 'warm' : '';
    const dots = Array.from({ length: pipCount }, (_, i) => `<circle class="number-pip ${numberTone}" cx="${tile.x + (i - (pipCount - 1) / 2) * 4.2}" cy="${tile.y + 10}" r="1.6"/>`).join('');
    return `<g class="tile tile-${tile.type} ${selectable ? 'robber-choice' : ''} ${highlightedTotal !== null && tile.number === highlightedTotal ? 'result-match' : ''} ${sourceTile === tileIndex ? 'source-reference' : ''}" data-tile-index="${tileIndex}" ${selectable ? `data-robber-tile="${tileIndex}" role="button" tabindex="0"` : ''} aria-label="${selectable ? 'Переместить разбойника: ' : ''}${TYPES[tile.type].name}${tile.number ? `, число ${tile.number}` : ''}"><defs><mask id="tile-fade-${tileIndex}" maskUnits="userSpaceOnUse" x="${tile.x - SIZE}" y="${tile.y - SIZE}" width="${SIZE * 2}" height="${SIZE * 2}"><polygon points="${fadePoints}" fill="white" filter="url(#terrain-edge-feather)"/></mask></defs><polygon class="tile-frame" points="${points}"/>${art}<polygon class="tile-hover-glow" points="${innerPoints}"/><polygon class="tile-hover-outline" points="${innerPoints}"/>${tile.number ? `<circle class="number-disc-shadow" cx="${tile.x}" cy="${tile.y + 4}" r="21"/><circle class="number-disc" data-tooltip="${sourceTile === tileIndex ? 'Источник добычи · ' : ''}${selectable ? 'Переместить разбойника · ' : ''}${TYPES[tile.type].name} · число ${tile.number}" data-tooltip-resource="${tile.type}" data-tooltip-number="${tile.number}" ${sourceTile === tileIndex ? 'data-tooltip-source="true"' : ''} ${selectable ? 'data-tooltip-robber="true"' : ''} cx="${tile.x}" cy="${tile.y}" r="20"/><text class="tile-number ${numberTone}" x="${tile.x}" y="${tile.y - 2}">${tile.number}</text>${dots}` : ''}${robberTile === tileIndex ? `<image class="robber-token ${view.phase === 'robber-move' ? 'is-moving' : ''}" data-tooltip="Разбойник · это поле не приносит ресурсы" href="./assets/optimized/pieces/robber-06.webp?v=1" x="${tile.x + ROBBER_TOKEN.offsetX - ROBBER_TOKEN.width / 2}" y="${tile.y + ROBBER_TOKEN.offsetY - ROBBER_TOKEN.height / 2}" width="${ROBBER_TOKEN.width}" height="${ROBBER_TOKEN.height}" preserveAspectRatio="xMidYMid meet" aria-label="Разбойник"/>` : ''}</g>`;
  }).join('');
  const coastalEdges = new Set(board.coastalEdges);
  const tileSeams = board.edges.map((edge, index) => {
    if (coastalEdges.has(index)) return '';
    const a = board.vertices[edge.a], b = board.vertices[edge.b];
    return `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}"/>`;
  }).join('');
  const resultHighlightMarkup = highlightedTotal === null ? '' : board.tiles
    .filter(tile => tile.number === highlightedTotal)
    .map(tile => `<polygon points="${tile.corners.map(index => {
      const vertex = board.vertices[index];
      return `${(tile.x + (vertex.x - tile.x) * .96).toFixed(2)},${(tile.y + (vertex.y - tile.y) * .96).toFixed(2)}`;
    }).join(' ')}"/>`)
    .join('');
  const replayGainMarkup = replay.active && Array.isArray(view.production) ? view.production.map(item => {
    const tile = board.tiles[item.tileIndex];
    const vertex = board.vertices[item.vertex];
    if (!tile?.corners.includes(item.vertex) || !vertex || !RESOURCE_KEYS.includes(item.resource) || !view.players[item.player]) return '';
    const x = (tile.x + (vertex.x - tile.x) * .5).toFixed(2);
    const y = (tile.y + (vertex.y - tile.y) * .5).toFixed(2);
    const label = `${view.players[item.player].name}: +${item.amount} ${TYPES[item.resource].genitive}`;
    const fresh = historyFrames()[replay.index]?.type === 'roll' ? ' is-new' : '';
    return `<g class="replay-gain" transform="translate(${x} ${y})" role="img" aria-label="${escape(label)}" style="--gain-color:${playerColor(item.player)}"><g class="replay-gain-inner${fresh}"><circle r="14.5"/><image href="${iconUrl(item.resource)}" x="-8" y="-11.5" width="16" height="16"/><text y="10">+${item.amount}</text></g></g>`;
  }).join('') : '';
  const edgeMarkup = board.edges.map((edge, index) => {
    const a = board.vertices[edge.a], b = board.vertices[edge.b];
    const owner = view.roads[index];
    const active = view.mode === 'road' && canRoad(index);
    return `<g class="edge ${active ? 'available' : ''}" data-edge="${index}" ${owner !== null ? `data-owned="${owner}" data-tooltip-label="Дорога" data-tooltip="Дорога · ${escape(view.players[owner].name)}"` : active ? 'data-tooltip="Построить дорогу"' : ''} ${active ? 'role="button" tabindex="0" aria-label="Построить дорогу"' : ''}><line class="edge-hit" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>${owner === null ? `<line class="edge-visible" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>` : roadPiece(a, b, owner)}</g>`;
  }).join('');
  const portMarkup = board.ports.map((port, portIndex) => {
    const edge = board.edges[port.edge], a = board.vertices[edge.a], b = board.vertices[edge.b];
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const edgeLength = Math.hypot(b.x - a.x, b.y - a.y);
    const normal = { x: -(b.y - a.y) / edgeLength, y: (b.x - a.x) / edgeLength };
    if (normal.x * (port.x - midpoint.x) + normal.y * (port.y - midpoint.y) < 0) {
      normal.x *= -1;
      normal.y *= -1;
    }
    const label = { x: midpoint.x + normal.x * 80, y: midpoint.y + normal.y * 80 };
    const dockAngle = Math.atan2(normal.y, normal.x) * 180 / Math.PI + 90;
    const dockDirection = ((Math.round((dockAngle - 30) / 60) * 60 + 30) % 360 + 360) % 360;
    const seaCenter = { x: midpoint.x + normal.x * edgeLength * Math.sqrt(3) / 2,
      y: midpoint.y + normal.y * edgeLength * Math.sqrt(3) / 2 };
    const docks = [a, b].map(vertex => {
      const distance = Math.hypot(seaCenter.x - vertex.x, seaCenter.y - vertex.y);
      const direction = { x: (seaCenter.x - vertex.x) / distance, y: (seaCenter.y - vertex.y) / distance };
      const center = { x: vertex.x + direction.x * 29, y: vertex.y + direction.y * 29 };
      const turn = Math.atan2(normal.x * direction.y - normal.y * direction.x,
        normal.x * direction.x + normal.y * direction.y) * 180 / Math.PI;
      return `<image class="port-dock" href="./assets/optimized/pieces/harbor-pier-${dockDirection}.webp?v=1" x="${(center.x - 36).toFixed(2)}" y="${(center.y - 36).toFixed(2)}" width="72" height="72" transform="rotate(${turn.toFixed(2)} ${center.x.toFixed(2)} ${center.y.toFixed(2)})"/>`;
    }).join('');
    const mine = view.owner[edge.a] === room.me || view.owner[edge.b] === room.me;
    const owners = [...new Set([view.owner[edge.a], view.owner[edge.b]].filter(owner => owner !== null))];
    const flagFill = owners.length === 2 ? `url(#port-flag-${portIndex})` : owners.length === 1 ? playerColor(owners[0]) : null;
    const flagGradient = owners.length === 2 ? `<defs><linearGradient id="port-flag-${portIndex}" x1="0" x2="1"><stop offset="50%" stop-color="${playerColor(owners[0])}"/><stop offset="50%" stop-color="${playerColor(owners[1])}"/></linearGradient></defs>` : '';
    const flag = flagFill ? `<svg class="port-flag-overlay" x="-36" y="-33" width="72" height="66" viewBox="0 0 1312 1199" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${flagGradient}<path class="port-sail-tint" d="M382 279 C412 338 441 430 445 529 C451 655 428 754 409 802 C548 773 675 778 791 791 C883 799 955 806 992 812 C1028 722 1042 628 1032 522 C1022 421 991 350 968 324 C769 286 557 276 382 279 Z" fill="${flagFill}"/><path d="M674 72 C707 70 735 88 765 101 C815 125 856 153 893 172 C909 181 921 189 927 195 C899 185 879 177 855 178 C829 180 806 171 782 158 C748 142 716 136 674 141 Z" fill="${flagFill}"/></svg>` : '';
    const shipOnLeft = label.x < CENTER.x;
    const shipFlip = shipOnLeft ? ' transform="scale(-1 1)"' : '';
    const name = port.type === 'generic' ? 'Гавань: любой ресурс 3 к 1' : `Гавань: ${TYPES[port.type].name.toLowerCase()} 2 к 1`;
    const sailInfo = port.type === 'generic'
      ? '<text class="port-ratio port-question-mark" x="2" y="-6">?</text><text class="port-ratio" x="0" y="5">3:1</text>'
      : `<image class="port-resource" href="${iconUrl(port.type)}" x="-8" y="-16" width="16" height="16"/><text class="port-ratio specific" x="0" y="5">2:1</text>`;
    return `<g class="port ${mine ? 'port-mine' : ''}" aria-label="${name}" data-tooltip="${name}">${docks}<g transform="translate(${label.x.toFixed(2)} ${label.y.toFixed(2)})"><rect class="port-hit" x="-36" y="-33" width="72" height="66"/><g${shipFlip}><image class="port-ship" href="./assets/optimized/pieces/harbor-sailboat-v2.webp?v=1" x="-36" y="-33" width="72" height="66"/>${flag}</g><g class="port-sail-info" transform="translate(${shipOnLeft ? -5 : 2} -1)">${sailInfo}</g></g></g>`;
  }).join('');
  const vertexMarkup = board.vertices.map((vertex, index) => {
    const owner = view.owner[index];
    const active = view.mode === 'settlement' ? canSettle(index) : view.mode === 'city' ? canCity(index) : false;
    if (owner === null && !active) return '';
    if (owner !== null) {
      const city = view.city[index];
      return `<g class="building ${active ? 'available' : ''}" data-vertex="${index}" data-owned="${owner}" data-tooltip-label="${city ? 'Город' : 'Поселение'}" ${active ? 'data-tooltip-action="улучшить до города"' : ''} data-tooltip="${city ? 'Город' : 'Поселение'} · ${escape(view.players[owner].name)}${active ? ' · улучшить до города' : ''}" ${active ? 'role="button" tabindex="0" aria-label="Улучшить поселение до города"' : ''}>${active ? `<circle class="city-upgrade-target" cx="${vertex.x}" cy="${vertex.y - 4}" r="23"/>` : ''}${buildingPiece(vertex, owner, city)}<circle class="building-hit" cx="${vertex.x}" cy="${vertex.y - 4}" r="${city ? 20 : 17}"/></g>`;
    }
    return `<g class="spot available" data-vertex="${index}" data-tooltip="Построить поселение" role="button" tabindex="0" aria-label="Построить поселение"><circle cx="${vertex.x}" cy="${vertex.y}" r="11"/><circle cx="${vertex.x}" cy="${vertex.y}" r="4"/></g>`;
  }).join('');
  const boardSvg = $('#board');
  replaceBoardMarkup(boardSvg, `${terrainFade}${SURF_SHORE}<g class="board-shadow">${tileMarkup}</g><g class="tile-seams" aria-hidden="true">${tileSeams}</g><g class="result-highlights" aria-hidden="true">${resultHighlightMarkup}</g><g class="ports">${portMarkup}</g><g class="roads">${edgeMarkup}</g><g class="buildings">${vertexMarkup}</g><g class="replay-gains">${replayGainMarkup}</g>`);
  const robberToken = boardSvg.querySelector('.robber-token');
  if (robberToken) {
    if (robberFlight && !replay.active) robberToken.remove();
    else boardSvg.append(robberToken);
  }
  renderRobberPreview();
}

function stopReplayPlayback() {
  clearInterval(replay.timer);
  replay.timer = null;
  replay.playing = false;
}
function setReplayIndex(index) {
  const frames = historyFrames();
  if (!replay.active || !frames.length) return;
  replay.index = Math.max(0, Math.min(frames.length - 1, index));
  renderBoard();
  renderReplayControls();
}
function renderReplayControls() {
  const frames = historyFrames();
  const available = frames.length > 0 && !rollPresentationPending && !rollProductionPending;
  $('#replay-panel').classList.toggle('is-active', replay.active);
  $('#replay-toggle').disabled = !available;
  $('#replay-toggle').textContent = replay.active ? 'Вернуться к игре' : 'Смотреть историю';
  $('#replay-toggle').setAttribute('aria-expanded', String(replay.active));
  $('#replay-panel .replay-heading small').textContent = frames.length ? 'Просмотр карты без изменения игры' : 'История начнёт записываться со следующего действия';
  $('#replay-controls').hidden = !replay.active;
  if (!replay.active || !frames.length) return;
  replay.index = Math.min(replay.index, frames.length - 1);
  const frame = frames[replay.index];
  $('#replay-range').max = String(frames.length - 1);
  $('#replay-range').value = String(replay.index);
  $('#replay-position').textContent = `Шаг ${replay.index + 1} из ${frames.length}`;
  $('#replay-round').textContent = `Раунд ${frame.round} · ${state.players[frame.player]?.name || 'Игрок'}`;
  $('#replay-description').textContent = frame.label || 'Положение на карте';
  $('#replay-first').disabled = $('#replay-prev').disabled = replay.index === 0;
  $('#replay-next').disabled = $('#replay-last').disabled = replay.index === frames.length - 1;
  $('#replay-play').disabled = frames.length < 2;
  $('#replay-play').textContent = replay.playing ? 'Ⅱ Пауза' : '▶ Воспроизвести';
}
function toggleReplay() {
  if (replay.active) {
    stopReplayPlayback();
    replay.active = false;
  } else if (historyFrames().length) {
    replay.active = true;
    replay.index = 0;
    hideVictoryOverlay();
    stopVictoryFireworks();
  }
  render();
}
function toggleReplayPlayback() {
  if (!replay.active) return;
  if (replay.playing) { stopReplayPlayback(); renderReplayControls(); return; }
  if (replay.index >= historyFrames().length - 1) setReplayIndex(0);
  replay.playing = true;
  replay.timer = setInterval(() => {
    if (!replay.active || replay.index >= historyFrames().length - 1) {
      stopReplayPlayback();
      renderReplayControls();
      return;
    }
    setReplayIndex(replay.index + 1);
  }, 330);
  renderReplayControls();
}

function renderRobberPreview() {
  const svg = $('#board');
  svg.querySelectorAll('.robber-target-preview,.robber-blocked-preview').forEach(element => {
    element.classList.remove('robber-target-preview', 'robber-blocked-preview');
  });
  svg.querySelector('.robber-path-preview')?.remove();
  const fromIndex = state?.robberTile;
  const toIndex = robberPreviewTile;
  if (!canAct() || state.phase !== 'robber-move' || !board.tiles[fromIndex] ||
      !board.tiles[toIndex] || fromIndex === toIndex) return;
  svg.querySelector(`.tile[data-tile-index="${toIndex}"]`)?.classList.add('robber-target-preview');
  for (const vertex of board.tiles[toIndex].corners) {
    if (state.owner[vertex] !== null) {
      svg.querySelector(`.building[data-vertex="${vertex}"]`)?.classList.add('robber-blocked-preview');
    }
  }
  const arc = robberPreviewArc(fromIndex, toIndex);
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'robber-path-preview');
  group.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M ${arc.from.x} ${arc.from.y} Q ${arc.control.x} ${arc.control.y} ${arc.to.x} ${arc.to.y}`);
  path.setAttribute('class', 'robber-path-line');
  group.append(path);
  const angle = Math.atan2(arc.to.y - arc.control.y, arc.to.x - arc.control.x);
  const wing = 8;
  const left = { x: arc.to.x - wing * Math.cos(angle - .6), y: arc.to.y - wing * Math.sin(angle - .6) };
  const right = { x: arc.to.x - wing * Math.cos(angle + .6), y: arc.to.y - wing * Math.sin(angle + .6) };
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('class', 'robber-path-arrow');
  arrow.setAttribute('d', `M ${left.x} ${left.y} L ${arc.to.x} ${arc.to.y} L ${right.x} ${right.y}`);
  group.append(arrow);
  svg.append(group);
}
function setRobberPreview(index) {
  if (robberPreviewTile === index) return;
  robberPreviewTile = index;
  renderRobberPreview();
}
function robberTileAtPointer(event) {
  const svg = $('#board');
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  for (let index = 0; index < board.tiles.length; index++) {
    if (index === state.robberTile) continue;
    const corners = board.tiles[index].corners.map(vertex => board.vertices[vertex]);
    let inside = false;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
      const a = corners[i], b = corners[j];
      if ((a.y > point.y) !== (b.y > point.y) &&
          point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (inside) return index;
  }
  return null;
}


function renderPlayers() {
  const roadIcon = '<svg class="player-road-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M1 47C4 36 11 33 23 29c14-5 21-10 20-15-1-3-5-5-10-7 6-2 13 1 14 6 3 9-8 16-18 20-7 4-1 9 5 14Z" fill="currentColor"/></svg>';
  $('#players').innerHTML = state.players.map((player, index) => {
    const points = score(index);
    const cards = player.devCardCount || 0;
    const editable = room.local || room.me === index;
    const avatar = editable ? `<button class="avatar player-avatar-button" type="button" data-edit-player="${index}" aria-label="Изменить имя и цвет игрока ${escape(player.name)}" style="--player-color:${playerColor(index)}">${index + 1}</button>` : `<span class="avatar" style="--player-color:${playerColor(index)}">${index + 1}</span>`;
    const crown = state.winner === index ? '<span class="winner-crown" aria-label="Победитель"><img src="./assets/optimized/icons/victory-crown.svg?v=1" alt="" aria-hidden="true"></span>' : '';
    const status = player.botLevel ? `${state.player === index ? 'Ходит · ' : ''}Бот ${player.botLevel} ур. · `
      : room.local ? (state.player === index ? 'Ходит · ' : '') : `${room.members[index].online ? (state.player === index ? 'Ходит' : 'На связи') : 'Нет связи'} · `;
    return `<div class="player-card ${state.player === index ? 'active' : ''} ${state.winner === index ? 'winner' : ''}" data-player="${index}" style="--player-color:${playerColor(index)}"><span class="player-avatar-wrap">${crown}${avatar}</span><strong class="player-name" data-tooltip="${escape(player.name)}">${escape(player.name)}${room.me === index ? ' · вы' : ''}</strong><div class="score"><strong>${points}</strong><small>${ruForm(points, 'очко', 'очка', 'очков')}</small></div><small class="player-status">${status}${player.resourceTotal} ${ruForm(player.resourceTotal, 'ресурс', 'ресурса', 'ресурсов')}</small><small class="player-dev">${cards} ${ruForm(cards, 'карта', 'карты', 'карт')} развития</small>${state.longestRoad === index ? `<small class="player-road road-label">${roadIcon}<span>Самый длинный тракт</span><b>· ${rules.longestRoadLength(state, index)}</b></small>` : ''}${state.largestArmy === index ? `<small class="player-army army-label">♞ Самое большое войско · ${player.knightsPlayed}</small>` : ''}</div>`;
  }).join('');
}
function renderProfileColors() {
  $('#player-profile-colors').innerHTML = PALETTE.map((color, index) => {
    const used = state.players.some((_, seat) => seat !== editingPlayer && playerColorIndex(seat) === index);
    return `<button type="button" data-profile-color="${index}" style="--player-color:${color}" aria-label="${COLOR_NAMES[index]}${used ? room.local ? ', поменять местами' : ', занят' : ''}" aria-pressed="${selectedProfileColor === index}" title="${COLOR_NAMES[index]}" class="${selectedProfileColor === index ? 'is-selected' : ''}" ${used && !room.local ? 'disabled' : ''}></button>`;
  }).join('');
}
function openPlayerProfile(index) {
  if (!state?.players[index] || (!room.local && room.me !== index)) return;
  editingPlayer = index;
  selectedProfileColor = playerColorIndex(index);
  $('#player-profile-title').textContent = `Игрок ${index + 1}`;
  $('#player-profile-name').value = state.players[index].name;
  $('#player-profile-error').hidden = true;
  renderProfileColors();
  $('#player-profile-dialog').showModal();
  $('#player-profile-name').focus();
}
function renderDice() {
  const values = state.dice;
  const simple = rollVisual.simple || (gameSettings.diceAnimation === 'simple' && !rollVisual.entering && !rollVisual.rolling && !rollVisual.settling && !rollVisual.flying);
  const showResult = state.rolled && !rollVisual.entering && !rollVisual.rolling && !rollVisual.settling;
  const inOverlay = !showResult || rollVisual.flying || rollVisual.fading;
  for (const [sceneId, slotId] of [['#throw-die-one', '#die-one'], ['#throw-die-two', '#die-two']]) {
    const scene = $(sceneId);
    const parent = simple || inOverlay ? $('#dice-stage') : $(slotId);
    if (scene.parentElement !== parent) parent.append(scene);
  }
  const equation = $('#dice-equation');
  const equationParent = simple || inOverlay ? $('#dice-content') : $('#dice-total-value');
  if (equation.parentElement !== equationParent) equationParent.append(equation);
  $('#dice-preview').hidden = !simple && state.rolled && !rollVisual.entering && !rollVisual.rolling;
  $('.dice-row').classList.toggle('is-launching', !simple && (rollVisual.entering || rollVisual.rolling));
  $('.dice-row').classList.toggle('is-simple', simple);
  $('#dice-results').hidden = simple || !state.rolled || rollVisual.entering || rollVisual.rolling;
  $('#dice-results').classList.toggle('is-awaiting', !showResult);
  $('#roll-button').hidden = showResult;
  $('#roll-button').textContent = rollVisual.entering || rollVisual.rolling || rollVisual.settling ? 'Бросаем кубики…' : 'Бросить кубики';
  $('#roll-button').disabled = !canAct() || state.phase !== 'turn' || state.rolled || rollVisual.entering || rollVisual.rolling || rollVisual.settling;
  $('#dice-total').hidden = !state.rolled || rollVisual.entering || rollVisual.rolling;
  $('#dice-total').classList.toggle('is-awaiting', !showResult);
  $('#target-one').textContent = values[0];
  $('#target-two').textContent = values[1];
  $('#target-total').textContent = values[0] + values[1];
  $('#simple-dice-total').hidden = !simple || !showResult;
  $('#simple-dice-total').textContent = `${values[0]} + ${values[1]} = ${values[0] + values[1]}`;
  $('#dice-total').setAttribute('aria-label', showResult ? `Сумма очков: ${values[0]} + ${values[1]} = ${values[0] + values[1]}. Наведите, чтобы показать поля на карте` : 'Сумма очков');
  for (const [index, selector] of ['#preview-one', '#preview-two'].entries()) {
    const face = $(selector);
    if (simple && (rollVisual.rolling || state.rolled)) {
      const value = rollVisual.rolling ? simpleDiceFaces[index] : values[index];
      face.innerHTML = diePips(value);
      face.setAttribute('aria-label', `${index === 0 ? 'Первый' : 'Второй'} кубик: ${value}`);
    } else {
      face.textContent = '?';
      face.removeAttribute('aria-label');
    }
  }
  const overlay = $('#dice-overlay');
  overlay.hidden = simple || (!rollVisual.entering && !rollVisual.rolling && !rollVisual.settling && !rollVisual.fading);
  overlay.classList.toggle('is-entering', rollVisual.entering);
  overlay.classList.toggle('is-rolling', rollVisual.rolling);
  overlay.classList.toggle('is-settling', rollVisual.settling && !rollVisual.flying);
  overlay.classList.toggle('is-revealing', rollVisual.revealing);
  overlay.classList.toggle('is-flying', rollVisual.flying);
  overlay.classList.toggle('is-fading', rollVisual.fading);
  $('#equation-one').textContent = values[0];
  $('#equation-two').textContent = values[1];
  $('#equation-total').textContent = values[0] + values[1];
  for (const [index, selector] of ['#throw-die-one', '#throw-die-two'].entries()) {
    const scene = $(selector);
    const value = values[index] || 1;
    scene.querySelector('.dice-cube').style.setProperty('--dice-final-rotation', DIE_FINAL_ROTATION[value]);
    const showQuestion = rollVisual.entering && diceQuestionVisible;
    const faceKey = showQuestion ? 'unknown' : 'number';
    if (scene.dataset.faceValue !== faceKey) {
      scene.querySelectorAll('.dice-face').forEach((face, faceIndex) => {
        face.innerHTML = showQuestion && faceIndex === 4 ? '<span class="die-question">?</span>' : diePips(DIE_FACE_VALUES[faceIndex]);
      });
      scene.dataset.faceValue = faceKey;
    }
    $(`#die-${index === 0 ? 'one' : 'two'}`).setAttribute('aria-label', `${index === 0 ? 'Первый' : 'Второй'} кубик: ${value}`);
  }
}
function renderRollStats() {
  const sums = Array.isArray(state.rollCounts) ? state.rollCounts : [];
  const faces = Array.isArray(state.dieCounts) ? state.dieCounts : [];
  const recent = state.rolled && !rollVisual.settling ? state.dice : [];
  const bars = (counts, first, last, kind) => {
    const values = Array.from({ length: last - first + 1 }, (_, index) => Number(counts[index + first]) || 0);
    const maximum = Math.max(1, ...values);
    return values.map((count, index) => {
      const number = index + first;
      const height = count ? Math.max(7, Math.round(count / maximum * 50)) : 3;
      const highlighted = kind === 'Сумма' ? recent.length && recent[0] + recent[1] === number : recent.includes(number);
      return `<li class="roll-stat ${kind === 'Сумма' && (number === 6 || number === 8) ? 'roll-stat-hot' : ''} ${highlighted ? 'roll-stat-recent' : ''}" aria-label="${kind} ${number}: ${count}"><span class="roll-stat-count">${count}</span><span class="roll-stat-bar" style="height:${height}px"></span><span class="roll-stat-number">${number}</span></li>`;
    }).join('');
  };
  $('#roll-stats-total').textContent = `Всего ${sums.slice(2, 13).reduce((sum, count) => sum + (Number(count) || 0), 0)}`;
  $('#roll-stats-note').hidden = !state.rollStatsPartial && Array.isArray(state.rollCounts) && Array.isArray(state.dieCounts);
  $('#roll-stats-chart').innerHTML = bars(sums, 2, 12, 'Сумма');
  $('#die-stats-chart').innerHTML = bars(faces, 1, 6, 'Грань');
}
function renderProduction() {
  const summary = $('#production-summary');
  const events = state.rolled ? (state.lastProduction || []) : [];
  summary.hidden = !state.rolled || rollVisual.settling || state.dice[0] + state.dice[1] === 7;
  if (summary.hidden) return;
  summary.innerHTML = `<div class="production-summary-title">Добыча с полей</div>${events.length ? events.map((item, index) => `<button class="production-item" type="button" data-source-tile="${item.tileIndex}" data-production-index="${index}" aria-label="Повторить анимацию добычи: ${escape(state.players[item.player]?.name || '')}, ${resourceGain(item.resource, item.amount)}"><span class="production-origin"><span class="production-player" style="color:${playerColor(item.player)}">${escape(state.players[item.player]?.name || '')}</span><span class="production-source">· число ${board.tiles[item.tileIndex]?.number || '—'}</span></span><strong class="production-gain"><img src="${iconUrl(RESOURCE_KEYS.includes(item.resource) ? item.resource : 'wood')}" alt=""><span>${resourceGain(item.resource, item.amount)}</span></strong></button>`).join('') : '<div>С этого броска ресурсы никому не достались.</div>'}`;
}
const tradeTotal = vector => RESOURCE_KEYS.reduce((sum, key) => sum + vector[key], 0);
function syncTradeDraftResources() {
  const resources = state.players[room.me].resources;
  for (const key of RESOURCE_KEYS) {
    tradeDraft.player.give[key] = Math.min(tradeDraft.player.give[key], resources[key]);
    const rate = rules.harborRate(state, room.me, key);
    tradeDraft.bank.give[key] = Math.floor(Math.min(tradeDraft.bank.give[key], resources[key]) / rate) * rate;
    if (state.ruleset === 'classic') tradeDraft.bank.want[key] = Math.min(tradeDraft.bank.want[key], state.bank[key]);
  }
}
function syncCounterDraft() {
  const offer = state?.tradeOffer;
  if (!offer || state.phase !== 'trade-offer' || room.me !== offer.to) { counterDraft = null; return; }
  if (counterDraft?.revision === room.revision) return;
  counterDraft = { revision: room.revision, give: { ...offer.want }, want: { ...offer.give } };
}
function tradeEditor(key, group, mode, enabled, draft = tradeDraft[mode], context = '') {
  const value = draft[group][key];
  const owned = state.players[room.me].resources[key];
  const rate = mode === 'bank' ? rules.harborRate(state, room.me, key) : 1;
  const step = mode === 'bank' && group === 'give' ? rate : 1;
  const limit = group === 'give' ? Math.min(100, owned) : mode === 'bank' && state.ruleset === 'classic' ? Math.min(100, state.bank[key]) : 100;
  const opposite = mode === 'bank' ? draft[group === 'give' ? 'want' : 'give'][key] : 0;
  const canAdd = enabled && value + step <= limit && (mode !== 'bank' || !opposite);
  const detail = group === 'give' ? `${mode === 'bank' ? `${rate}:1 · ` : ''}${owned}${value ? ` → ${Math.max(0, owned - value)}` : ' в руке'}`
    : mode === 'bank' && state.ruleset === 'classic' ? `в банке ${state.bank[key]}` : '';
  return `<div class="trade-quantity-row" data-trade-row="${group}-${key}"><img src="${iconUrl(key)}" alt=""><span class="trade-resource-name">${TYPES[key].name}<small>${detail}</small></span><div class="trade-stepper"><button type="button" data-trade-step="-1" data-group="${group}" data-resource="${key}" ${context ? `data-trade-context="${context}"` : ''} aria-label="Уменьшить: ${TYPES[key].name.toLowerCase()}" ${!enabled || value === 0 ? 'disabled' : ''}>−</button><output class="${group === 'give' && value > owned ? 'is-missing' : ''}" aria-label="${group === 'give' ? 'Отдаю' : 'Получаю'}: ${resourceQuantity(key, value)}${group === 'give' && value > owned ? '. Не хватает ресурса' : ''}">${value}</output><button type="button" data-trade-step="1" data-group="${group}" data-resource="${key}" ${context ? `data-trade-context="${context}"` : ''} aria-label="Увеличить: ${TYPES[key].name.toLowerCase()}${step > 1 ? ` на ${step}` : ''}" ${canAdd ? '' : 'disabled'}>+</button></div></div>`;
}
const changeArrow = '<svg viewBox="0 0 20 12" focusable="false"><path d="M1 6h17m-5-5 5 5-5 5"/></svg>';
function discardEditor(key, owned, selected, totalSelected, required) {
  const name = TYPES[key].name;
  return `<div class="quantity-row discard-row" data-discard-resource="${key}"><img src="${iconUrl(key)}" alt=""><span class="discard-name">${name} <small class="discard-inventory">· <span class="discard-owned ${selected ? 'is-discarding' : ''}">${owned}</span><span class="change-arrow discard-arrow" aria-hidden="true" ${selected ? '' : 'hidden'}>${changeArrow}</span><strong class="discard-after" ${selected ? '' : 'hidden'}>${owned - selected}</strong></small></span><div class="discard-controls"><button type="button" data-discard-step="-1" data-resource="${key}" aria-label="Уменьшить сброс: ${name}" ${selected === 0 || pending || !connected ? 'disabled' : ''}>−</button><output class="discard-count" aria-label="Выбрано для сброса: ${selected}">${selected}</output><button type="button" data-discard-step="1" data-resource="${key}" aria-label="Увеличить сброс: ${name}" ${selected >= owned || totalSelected >= required || pending || !connected ? 'disabled' : ''}>+</button></div></div>`;
}
function renderRobber() {
  const panel = $('#robber-panel');
  panel.hidden = !state.phase.startsWith('robber-');
  if (panel.hidden) return;
  if (state.phase === 'robber-discard') {
    const count = state.robberDiscards?.[room.me] || 0;
    const awaiting = state.robberDiscards?.map((amount, index) => amount ? state.players[index].name : null).filter(Boolean).join(', ');
    if (!count) { panel.innerHTML = `<strong>Разбойник · сброс карт</strong><p>Ждём игроков: ${escape(awaiting)}.</p>`; return; }
    const resources = state.players[room.me].resources;
    for (const key of RESOURCE_KEYS) discardDraft[key] = Math.min(discardDraft[key], resources[key]);
    const selected = RESOURCE_KEYS.reduce((sum, key) => sum + discardDraft[key], 0);
    panel.innerHTML = `<strong>Разбойник · сбросьте ${count} ${ruForm(count, 'карту', 'карты', 'карт')}</strong><div class="quantity-list">${RESOURCE_KEYS.map(key => discardEditor(key, resources[key], discardDraft[key], selected, count)).join('')}</div><div class="panel-foot"><span>Выбрано ${selected} из ${count}</span><button type="button" data-robber-action="discard" ${!connected || pending || selected !== count ? 'disabled' : ''}>Сбросить карты</button></div>`;
  } else if (state.phase === 'robber-move') {
    const canCancelKnight = state.pendingKnight === true && state.robberSource === 'knight' && myTurn();
    panel.innerHTML = `<strong>Переместите разбойника на новое поле</strong><p>${myTurn() ? 'Нажмите на любое другое поле острова.' : `Ждём, пока ${escape(state.players[state.player].name)} выберет поле.`}</p>${canCancelKnight ? `<div class="panel-foot"><span>Рыцарь будет сыгран после выбора поля.</span><button type="button" data-robber-action="cancel-knight" ${!canAct() ? 'disabled' : ''}>Отменить</button></div>` : ''}`;
  } else {
    panel.innerHTML = `<strong>Разбойник · украсть карту</strong><p>${myTurn() ? 'Выберите игрока у нового поля. Карта будет выбрана случайно.' : 'Ждём выбора игрока.'}</p>${myTurn() ? `<div class="victim-list">${(state.robberVictims || []).map(index => `<button type="button" data-victim="${index}" ${!connected || pending ? 'disabled' : ''}>${escape(state.players[index].name)} · ${state.players[index].resourceTotal} ${ruForm(state.players[index].resourceTotal, 'карта', 'карты', 'карт')}</button>`).join('')}</div>` : ''}`;
  }
}
function renderDevelopment() {
  const details = $('#development-section');
  if (state.phase === 'dev-road') details.open = true;
  const cards = state.players[room.me].devCards || [];
  $('#development-count').textContent = `${cards.length} ${ruForm(cards.length, 'карта', 'карты', 'карт')}`;
  const enabled = canAct() && state.phase === 'turn';
  const options = selected => RESOURCE_KEYS.map(key => `<option value="${key}" ${key === selected ? 'selected' : ''}>${TYPES[key].name}</option>`).join('');
  const hand = Object.entries(DEV_CARDS).map(([type, meta]) => {
    const held = cards.filter(card => card.type === type);
    if (!held.length) return '';
    const playable = held.filter(card => card.boughtOn < (state.turnNumber ?? 0)).length;
    const mayPlay = enabled && !state.devPlayed && playable > 0 && type !== 'victory';
    const controls = type === 'plenty' ? `<div class="dev-selects"><select data-dev-select="first" aria-label="Первый ресурс">${options(devDraft.first)}</select><select data-dev-select="second" aria-label="Второй ресурс">${options(devDraft.second)}</select></div>`
      : type === 'monopoly' ? `<div class="dev-selects"><select data-dev-select="monopoly" aria-label="Ресурс для монополии">${options(devDraft.monopoly)}</select></div>` : '';
    return `<div class="development-card" data-preview-dev="${type}"><button type="button" class="dev-symbol" data-preview-dev="${type}" aria-label="Посмотреть карту ${meta.name}">${meta.icon}</button><div class="dev-card-info"><strong>${meta.name} <span>×${held.length}</span></strong><small>${meta.description}${type !== 'victory' && playable < held.length ? ` · ${held.length - playable} новая` : ''}</small>${controls}</div>${type !== 'victory' ? `<button type="button" data-play-dev="${type}" ${mayPlay ? '' : 'disabled'}>Сыграть</button>` : ''}</div>`;
  }).join('');
  const roadPrompt = state.phase === 'dev-road' ? `<div class="dev-road-prompt"><strong>Бесплатные дороги: ${state.freeRoads}</strong><span>${myTurn() ? 'Выберите подсвеченную грань острова.' : 'Игрок строит дороги.'}</span>${myTurn() && state.freeRoads === 1 ? `<button type="button" data-finish-dev-road ${pending || !connected ? 'disabled' : ''}>Завершить</button>` : ''}</div>` : '';
  const cost = ['wheat', 'sheep', 'ore'].map(key => `<span class="development-cost-item"><img src="${iconUrl(key)}" alt="">${key === 'sheep' ? 'Шерсти' : TYPES[key].name}</span>`).join('');
  $('#development-content').innerHTML = `${roadPrompt}<div class="development-buy"><span class="development-cost">${cost}</span><button type="button" id="buy-dev-button" ${enabled && state.rolled && !rollVisual.settling && (state.devDeckCount ?? 25) > 0 && canPay(COSTS.development) ? '' : 'disabled'}>Купить карту</button></div>${hand || '<p class="dev-empty">У вас пока нет карт развития.</p>'}${state.devPlayed ? '<p class="dev-note">Карта развития в этот ход уже сыграна.</p>' : ''}`;
}
function renderTradePanel() {
  const panel = $('#trade-panel');
  const offer = state.tradeOffer;
  if (offer && state.phase === 'trade-offer') {
    syncCounterDraft();
    const offerResources = vector => RESOURCE_KEYS.filter(key => vector[key]).map(key => `<span class="trade-resource"><img src="${iconUrl(key)}" alt=""><span>${resourceQuantity(key, vector[key])}</span></span>`).join('') || '<span class="trade-empty">ничего</span>';
    const recipient = room.me === offer.to;
    const give = recipient ? counterDraft.give : offer.give;
    const want = recipient ? counterDraft.want : offer.want;
    const changed = recipient && RESOURCE_KEYS.some(key => give[key] !== offer.want[key] || want[key] !== offer.give[key]);
    const missingResources = recipient ? RESOURCE_KEYS.filter(key => give[key] > state.players[room.me].resources[key]) : [];
    const lacking = missingResources.length > 0;
    const missingHint = missingResources.length ? `У вас не хватает запрашиваемых ресурсов: ${missingResources.map(key => resourceQuantity(key, give[key] - state.players[room.me].resources[key])).join(', ')}.` : '';
    const signed = `${RESOURCE_KEYS.filter(key => want[key]).map(key => `<span class="trade-signed-gain"><img src="${iconUrl(key)}" alt="">+${resourceQuantity(key, want[key])}</span>`).join(' ')} ${RESOURCE_KEYS.filter(key => give[key]).map(key => `<span class="trade-signed-loss"><img src="${iconUrl(key)}" alt="">−${resourceQuantity(key, give[key])}</span>`).join(' ')}`;
    const terms = recipient ? `<div class="trade-signed-summary">${signed}</div><div class="trade-columns trade-counter-columns"><div><strong>Отдаю</strong><div class="trade-quantity-list">${RESOURCE_KEYS.map(key => tradeEditor(key, 'give', 'player', !pending && connected, counterDraft, 'counter')).join('')}</div></div><div><strong>Получаю</strong><div class="trade-quantity-list">${RESOURCE_KEYS.map(key => tradeEditor(key, 'want', 'player', !pending && connected, counterDraft, 'counter')).join('')}</div></div></div>`
      : `<div class="trade-offer-terms"><div class="trade-offer-row"><small>Отдаёте</small><div class="trade-offer-resources">${offerResources(offer.give)}</div></div><div class="trade-offer-row"><small>Получите</small><div class="trade-offer-resources">${offerResources(offer.want)}</div></div></div>`;
    const buttons = recipient ? `<div class="offer-buttons"><button type="button" class="${lacking && !pending && connected ? 'is-escape-action' : ''}" data-trade-action="reject-trade" ${pending || !connected ? 'disabled' : ''}><span aria-hidden="true">×</span> Отклонить</button><span class="offer-action-wrap" ${missingHint ? `data-tooltip="${escape(missingHint)}" data-tooltip-missing="${missingResources.map(key => `${key}:${give[key] - state.players[room.me].resources[key]}`).join(',')}"` : ''}><button type="button" data-trade-action="${changed ? 'counter-trade' : 'accept-trade'}" ${pending || !connected || lacking || (changed && !tradeTotal(give) && !tradeTotal(want)) ? 'disabled' : ''}><span aria-hidden="true">${changed ? '↗' : '✓'}</span> ${changed ? 'Предложить' : 'Принять'}</button></span>${lacking ? '<p class="trade-shortage" role="status">Не хватает ресурсов для обмена.</p>' : ''}</div>` : room.me === offer.from ? `<button type="button" data-trade-action="cancel-trade" ${pending || !connected ? 'disabled' : ''}>Отменить предложение</button>` : '<small>Ожидаем ответа.</small>';
    panel.innerHTML = `<h4>${recipient ? `${escape(state.players[offer.from].name)} предлагает вам обмен` : `Предложение: ${escape(state.players[offer.from].name)} → ${escape(state.players[offer.to].name)}`}</h4>${terms}${buttons}`;
    return;
  }
  const enabled = canAct() && state.phase === 'turn' && state.rolled && !rollVisual.settling;
  if (tradeDraft.to === room.me || !state.players[tradeDraft.to]) tradeDraft.to = state.players.findIndex((_, index) => index !== room.me);
  syncTradeDraftResources();
  const mode = tradeDraft.mode;
  const draft = tradeDraft[mode];
  const giveTotal = tradeTotal(draft.give);
  const wantTotal = tradeTotal(draft.want);
  const bankCredits = RESOURCE_KEYS.reduce((sum, key) => sum + draft.give[key] / rules.harborRate(state, room.me, key), 0);
  const valid = mode === 'player' ? giveTotal + wantTotal > 0
    : bankCredits > 0 && wantTotal === bankCredits && RESOURCE_KEYS.every(key => !draft.give[key] || !draft.want[key]);
  const target = mode === 'player'
    ? `<label class="trade-target">Кому <select id="trade-target" ${enabled ? '' : 'disabled'}>${state.players.map((person, index) => index === room.me ? '' : `<option value="${index}" ${tradeDraft.to === index ? 'selected' : ''}>${escape(person.name)}</option>`).join('')}</select></label>`
    : '<p class="trade-bank-hint">Банк обменивает сразу. Курс указан у каждого ресурса.</p>';
  const summary = mode === 'player' ? `${giveTotal} → ${wantTotal} ${ruForm(wantTotal, 'карта', 'карты', 'карт')}`
    : `По курсу: ${bankCredits} ${ruForm(bankCredits, 'карта', 'карты', 'карт')} · выбрано ${wantTotal}`;
  panel.innerHTML = `<div class="trade-modes" role="group" aria-label="Вид торговли"><button type="button" data-trade-mode="player" aria-pressed="${mode === 'player'}" class="${mode === 'player' ? 'is-selected' : ''}">С игроком</button><button type="button" data-trade-mode="bank" aria-pressed="${mode === 'bank'}" class="${mode === 'bank' ? 'is-selected' : ''}">Морская</button></div>${target}<div class="trade-columns"><div><strong>Отдаю</strong><div class="trade-quantity-list">${RESOURCE_KEYS.map(key => tradeEditor(key, 'give', mode, enabled)).join('')}</div></div><div><strong>Получаю</strong><div class="trade-quantity-list">${RESOURCE_KEYS.map(key => tradeEditor(key, 'want', mode, enabled)).join('')}</div></div></div><div class="trade-footer"><span>${enabled ? summary : 'Торговля доступна после вашего броска'}</span><div class="trade-footer-actions">${mode === 'player' ? `<button type="button" class="trade-reset-button" data-trade-action="reset-trade" ${!giveTotal && !wantTotal ? 'disabled' : ''}>Сбросить</button>` : ''}<button type="button" class="trade-submit-button" data-trade-action="${mode === 'bank' ? 'trade' : 'offer-trade'}" ${enabled && valid ? '' : 'disabled'}>${mode === 'bank' ? 'Обменять' : 'Предложить обмен'}</button></div></div>`;
}
function pauseTurnTimer() {
  if (room?.local && turnTimer.key !== null && turnTimer.pausedAt === null) turnTimer.pausedAt = Date.now();
}
function resumeTurnTimer() {
  if (turnTimer.pausedAt === null) return;
  turnTimer.startedAt += Date.now() - turnTimer.pausedAt;
  turnTimer.pausedAt = null;
}
function renderTurnTimer() {
  const timer = $('#turn-timer');
  if (!state || !room || state.winner !== null || state.phase === 'setup' || state.phase === 'setup-road') {
    turnTimer = { key: null, startedAt: 0, pausedAt: null };
    timer.hidden = true;
    return;
  }
  if (handoff || !myTurn()) {
    timer.hidden = true;
    return;
  }
  const key = `${room.id}:${state.turnNumber ?? 0}:${state.player}`;
  if (turnTimer.key !== key) turnTimer = { key, startedAt: Date.now(), pausedAt: null };
  const remaining = Math.max(0, Math.ceil((turnTimer.startedAt + TURN_DURATION_MS - (turnTimer.pausedAt ?? Date.now())) / 1000));
  timer.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  timer.classList.toggle('is-urgent', remaining <= 15);
  timer.hidden = false;
}
setInterval(renderTurnTimer, 250);

function renderTurn() {
  const current = state.players[state.player].name;
  const winner = state.winner === null ? null : state.players[state.winner].name;
  $('.turn-card').classList.toggle('is-victory', winner !== null);
  const shownRoll = state.rolled && !rollVisual.settling;
  $('#round-label').textContent = `Раунд ${state.round}`;
  $('#turn-title').textContent = winner ? `Победа: ${winner}!` : state.phase.startsWith('robber-') ? 'Разбойник на острове' : state.phase === 'trade-offer' ? 'Предложение обмена' : myTurn() ? (state.phase === 'setup' ? (state.ruleset === 'classic' ? `Поселение ${state.setupRound} из 2` : 'Ваше первое поселение') : state.phase === 'setup-road' ? `Дорога ${state.setupRound} из 2` : 'Ваш ход') : `Ходит ${current}`;
  $('#turn-hint').textContent = winner ? 'Партия завершена. Создатель комнаты может пригласить всех сыграть ещё раз.'
    : !connected ? 'Связь потеряна. Переподключаемся и сохраняем ваше место…'
    : state.phase.startsWith('robber-') ? (state.robberSource === 'knight' ? 'Рыцарь перемещает разбойника на другое поле и может забрать случайную карту.' : 'При семёрке сначала сбрасывают карты, затем разбойник переходит на новое поле.')
    : state.phase === 'dev-road' ? 'Выберите грани для бесплатных дорог. Можно завершить после первой.'
    : state.phase === 'trade-offer' ? 'Ожидается ответ на предложение обмена.'
    : !myTurn() ? `${current} ${state.phase === 'setup' ? 'выбирает место для поселения' : state.phase === 'setup-road' ? 'ставит начальную дорогу' : 'делает ход'}. Ваши ресурсы могут приходить и в чужой ход.`
    : state.phase === 'setup' ? 'Нажмите на светлую точку между клетками. Вторая постановка даёт ресурсы соседних полей.'
    : state.phase === 'setup-road' ? 'Выберите подсвеченную грань рядом с только что поставленным поселением.'
    : !shownRoll ? 'Сыграйте карту развития или бросьте кубики.'
    : state.mode ? `Выберите место на поле: ${BUILD[state.mode].title.toLowerCase()}.` : 'Стройте, обменивайте ресурсы или завершите ход.';
  renderDice(); renderRollStats(); renderProduction(); renderRobber();
  const endButton = $('#end-button');
  endButton.disabled = !canAct() || state.phase !== 'turn' || !shownRoll;
  const canBuild = Object.keys(BUILD).some(hasBuildLocation);
  const canBuyCard = (state.devDeckCount ?? 25) > 0 && canPay(COSTS.development);
  const canPlayCard = !state.devPlayed && (state.players[room.me].devCards || []).some(card => card.type !== 'victory' && card.boughtOn < (state.turnNumber ?? 0));
  endButton.classList.toggle('suggest-end', !endButton.disabled && !canBuild && !canBuyCard && !canPlayCard);
  const phase = state.phase === 'setup' || state.phase === 'setup-road' ? 'Подготовка' : state.phase.startsWith('robber-') ? 'Разбойник' : state.phase === 'dev-road' ? 'Бесплатные дороги' : state.phase === 'trade-offer' ? 'Обмен' : shownRoll ? 'Строительство' : 'Бросок кубиков';
  $('#phase-label').textContent = pending ? 'Сохраняем ход…' : `Фаза: ${phase}`;
  renderTurnTimer();
}
function renderResources() {
  if (state.phase !== 'turn') previewBuildKey = null;
  const resources = state.players[room.me].resources;
  const total = Object.values(resources).reduce((a,b) => a+b, 0);
  const preview = state.phase === 'robber-discard' && (state.robberDiscards?.[room.me] || 0) > 0;
  const selected = preview ? RESOURCE_KEYS.reduce((sum, key) => sum + discardDraft[key], 0) : 0;
  if (state.phase === 'trade-offer') syncCounterDraft();
  const offer = state.phase === 'trade-offer' ? state.tradeOffer : null;
  const draft = offer && room.me === offer.to ? counterDraft : null;
  const buildCost = state.phase === 'turn' && !pending && !handoff && previewBuildKey ? COSTS[previewBuildKey] : null;
  const editingTrade = state.phase === 'turn' && state.rolled && myTurn() && !pending && !handoff && !rollVisual.settling && !buildCost;
  if (editingTrade) syncTradeDraftResources();
  const editingDraft = editingTrade ? tradeDraft[tradeDraft.mode] : null;
  const tradeChange = key => draft ? draft.want[key] - draft.give[key] : offer && room.me === offer.from ? offer.want[key] - offer.give[key] : editingDraft ? editingDraft.want[key] - editingDraft.give[key] : 0;
  const tradeTotalChange = RESOURCE_KEYS.reduce((sum, key) => sum + tradeChange(key), 0);
  const buildTotal = buildCost ? RESOURCE_KEYS.reduce((sum, key) => sum + (buildCost[key] || 0), 0) : 0;
  const afterTotal = total - selected + tradeTotalChange - buildTotal;
  const totalAvailable = !buildCost || canPay(buildCost);
  $('#resource-total').innerHTML = selected || tradeTotalChange || buildTotal ? `<s>${total}</s> <span class="change-arrow" aria-hidden="true">${changeArrow}</span> ${afterTotal >= 0 && totalAvailable ? afterTotal : '—'} ${afterTotal >= 0 && totalAvailable ? ruForm(afterTotal, 'карта', 'карты', 'карт') : ''}` : `${total} ${ruForm(total, 'карта', 'карты', 'карт')}`;
  $('#resources').innerHTML = RESOURCE_KEYS.map(key => {
    const amount = preview ? discardDraft[key] : 0;
    const change = tradeChange(key) - amount - (buildCost?.[key] || 0);
    const after = resources[key] + change;
    const value = change ? `<s class="${after < 0 ? 'resource-shortage-count' : ''}">${resources[key]}</s><span class="change-arrow" aria-hidden="true">${changeArrow}</span><span class="resource-preview-count ${after < 0 ? 'is-short' : change > 0 ? 'is-gain' : 'is-loss'}">${after >= 0 ? after : '—'}</span>` : resources[key];
    return `<div class="resource-card resource-${key}"><img class="resource-icon" src="${iconUrl(key)}" alt=""/><span class="resource-name">${TYPES[key].name}</span><strong class="resource-count">${value}</strong></div>`;
  }).join('');
}
function renderBuildActions() {
  $('#build-actions').innerHTML = Object.entries(BUILD).map(([key, item]) => {
    const ready = state.phase === 'turn' && state.rolled && !rollVisual.settling;
    const affordable = canPay(COSTS[key]);
    const supply = rules.pieceSupply(state, room.me, key);
    const limitReached = supply.remaining === 0;
    const lacking = !handoff && ready && !limitReached && !affordable;
    const noPlaces = !handoff && ready && myTurn() && !limitReached && affordable && !hasBuildLocation(key);
    const unavailable = limitReached && key === 'settlement' ? 'достигнуто максимальное количество'
      : limitReached && key === 'city' ? 'достигнуто максимальное количество городов'
      : limitReached ? 'достигнуто максимальное количество дорог'
      : lacking ? 'не хватает ресурсов' : noPlaces ? 'нет доступных мест' : '';
    const showUnavailable = !handoff && ready && myTurn() && unavailable;
    const count = key === 'road' ? '' : `<span class="build-piece-count" aria-label="${supply.limit === null ? `${supply.used} построено, без ограничения` : `Построено ${supply.used} из ${supply.limit}`}">${supply.used}/${supply.limit ?? '∞'}</span>`;
    const resources = state.players[room.me].resources;
    const costIcons = RESOURCE_KEYS.flatMap(resource => Array.from({ length: COSTS[key][resource] || 0 }, (_, index) => {
      const missing = !handoff && index >= (resources?.[resource] || 0);
      return `<span class="build-cost-item ${missing ? 'is-missing' : ''}"><img src="${iconUrl(resource)}" alt=""></span>`;
    })).join('');
    return `<div class="build-option" data-tooltip="${item.title}" data-tooltip-build="${key}"><button class="build-button ${state.mode === key ? 'selected' : ''} ${lacking ? 'is-unaffordable' : ''} ${noPlaces || limitReached ? 'is-no-space' : ''}" type="button" data-mode="${key}" aria-pressed="${state.mode === key}" aria-label="${item.title}. ${supply.limit === null ? `${supply.used} построено, без ограничения` : `Построено ${supply.used} из ${supply.limit}`}. ${item.purpose} Стоимость: ${item.cost}${showUnavailable ? `. ${unavailable}` : ''}" ${!canAct() || !ready || !affordable || noPlaces || limitReached ? 'disabled' : ''}><span class="build-icon" aria-hidden="true">${buildIcon(key)}</span><span class="build-title"><strong>${item.title} ${count}</strong>${showUnavailable ? `<span class="build-unavailable"> · ${unavailable}</span>` : ''}</span><span class="build-cost" aria-hidden="true">${costIcons}</span></button></div>`;
  }).join('');
}
function renderActions() {
  if (!rollProductionPending) { renderBuildActions(); renderTradePanel(); }
  $('#log').innerHTML = state.log.map(entry => `<li>${escape(entry)}</li>`).join('');
  $('#reset-button').hidden = !room.host || state.winner === null;
  $('#reset-button').disabled = pending || !connected;
  $('#reset-button').textContent = room.local ? 'Начать новую партию с теми же игроками' : 'Собрать новую партию в этой комнате';
}
function renderLocalSavedList(saves) {
  $('#local-saved-count').textContent = `${saves.length} ${ruForm(saves.length, 'партия', 'партии', 'партий')}`;
  const savedCards = saves.map(({ id, updatedAt, session }) => {
    const players = session.names.join(' · ');
    const game = session.game;
    const ruleset = rules.RULESETS[game.ruleset || 'new'].name;
    const map = rules.MAP_GENERATIONS[game.mapGeneration || (game.layout ? 'random' : 'fixed')].name;
    const details = `${game.winner === null ? `Раунд ${game.round}` : 'Партия завершена'} · ${ruleset} · ${map}`;
    const savedAt = new Date(updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<article class="local-save-item"><div class="local-save-info"><strong>${escape(players)}</strong><small>${escape(details)}</small><time datetime="${new Date(updatedAt).toISOString()}">Сохранено ${escape(savedAt)}</time></div><button class="local-save-delete" type="button" data-delete-local="${escape(id)}" aria-label="Удалить партию ${escape(players)}" title="Удалить сохранение"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6"/></svg></button><button class="primary-button local-save-resume" type="button" data-resume-local="${escape(id)}"><span>Продолжить игру</span><svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg></button></article>`;
  }).join('');
  const emptySlots = Array.from({ length: Math.max(0, 4 - saves.length) }, () =>
    '<div class="local-save-placeholder" aria-hidden="true"><span class="local-save-placeholder-icon">⬡</span><span>Место для новой партии</span></div>').join('');
  $('#local-saved-list').innerHTML = savedCards + emptySlots;
}
function render() {
  if (rollPresentationPending) { renderDice(); return; }
  const member = joined();
  if (!member || !state) { hideCityPlacementCursor(); $('.board-frame').classList.remove('is-placing-city'); }
  const waiting = !!member && !!room.local && !!state && handoff;
  const ruleset = activeRuleset();
  const mapGeneration = activeMapGeneration();
  $('#room-ruleset').textContent = `${ruleset.name} · ${mapGeneration.name}`;
  $('#local-ruleset').textContent = `${ruleset.name} · ${mapGeneration.name}`;
  $('#edition-label').textContent = room?.local || (!member && localMode) ? 'За одним столом · 2–4 игрока' : 'Игра с друзьями · 2–4 игрока';
  $('#edition-label').hidden = !!member;
  $('#local-header').hidden = !member || !room.local;
  $('#entry-panel').hidden = !!member;
  $('#room-bar').hidden = !member || room.local;
  $('#lobby-panel').hidden = !member || !!state;
  $('#game-panel').hidden = !member || !state;
  $('#replay-panel').hidden = !member || !state || waiting;
  $('#turn-card-label').textContent = waiting ? 'Передача хода' : 'Ход игры';
  $('#handoff-panel').hidden = !waiting;
  $('.turn-card').classList.toggle('is-handoff', waiting);
  $('#resources').hidden = waiting;
  $('#resource-total').hidden = waiting;
  $('#resources-covered').hidden = !waiting;
  $('#development-content').hidden = waiting;
  $('#development-count').hidden = waiting;
  $('#development-covered').hidden = !waiting;
  $('#trade-panel').hidden = waiting;
  $('#trade-covered').hidden = !waiting;
  if (!member) {
    $('.entry-stack').classList.toggle('is-mode-switchable', !roomCode);
    $('#mode-picker').hidden = !!roomCode;
    $('#entry-form').hidden = localMode;
    $('#local-form').hidden = !localMode;
    $('#mode-online').classList.toggle('active', !localMode);
    $('#mode-local').classList.toggle('active', localMode);
    $('#mode-online').setAttribute('aria-pressed', String(!localMode));
    $('#mode-local').setAttribute('aria-pressed', String(localMode));
    $('#welcome-title').innerHTML = localMode ? 'Играйте за столом<br>Передавайте один экран' : 'Играйте с друзьями<br>Каждый со своего экрана';
    const saves = !roomCode ? readLocalSaves().saves : [];
    const creatingLocal = !saves.length || localNewExpanded;
    $('#welcome-intro').innerHTML = localMode ? (creatingLocal ? 'Выберите игроков и правила<br>Передавайте устройство после хода' : 'Вернитесь к сохранённой партии<br>И продолжайте играть вместе') : 'Создайте комнату<br>Пригласите друзей по ссылке';
    $('#local-saved-panel').hidden = !saves.length || creatingLocal;
    $('#local-new-content').hidden = !creatingLocal;
    $('#local-new-content').querySelectorAll('input').forEach(input => { input.disabled = !creatingLocal; });
    if (creatingLocal) renderLocalPlayerFields();
    $('#local-new-toggle').hidden = !saves.length;
    $('#local-new-toggle').classList.toggle('is-back', creatingLocal);
    $('#local-new-toggle-label').textContent = creatingLocal ? 'Назад' : 'Новая партия';
    $('#local-form-title').textContent = creatingLocal ? 'Новая партия' : 'Продолжить игру';
    $('#local-form-description').textContent = creatingLocal ? 'Выберите игроков, правила и карту.' : 'Партия сохранена в этом браузере.';
    if (saves.length) renderLocalSavedList(saves);
    $('#entry-title').textContent = roomCode ? 'Присоединиться к друзьям' : 'Создать комнату';
    $('#online-ruleset-picker').hidden = !!roomCode;
    $('#online-map-picker').hidden = !!roomCode;
    $('#entry-kicker').textContent = roomCode ? `Комната ${roomCode}` : 'Новая партия';
    $('#home-link').hidden = !roomCode;
    const unavailable = entryUnavailable || (room?.status !== 'lobby' && room ? 'Партия уже началась. Войти можно перед следующей партией.' : room?.members.length >= 4 ? 'Все четыре места заняты.' : '');
    $('#room-summary').textContent = loading ? 'Проверяем комнату…' : unavailable || (room ? `${ruleset.name}, ${mapGeneration.name.toLowerCase()}. В комнате: ${room.members.map(person => person.name).join(', ')}. Введите своё имя.` : 'Введите имя, под которым вас увидят друзья.');
    $('#entry-submit').textContent = pending ? 'Подключаемся…' : roomCode ? 'Присоединиться →' : 'Создать комнату →';
    $('#entry-submit').disabled = pending || loading || !!unavailable;
    return;
  }
  if (waiting) {
    hideTooltip();
    $('#notice').hidden = true;
    $('#resources').replaceChildren();
    $('#resource-total').textContent = '';
    $('#development-content').replaceChildren();
    $('#development-count').textContent = '';
    $('#development-section').open = true;
    $('#trade-panel').replaceChildren();
    $('#round-label').textContent = `Раунд ${state.round}`;
    const nextPlayer = state.players[room.me].name;
    $('#handoff-title').textContent = `Ход игрока: ${nextPlayer}`;
    $('#handoff-hint').textContent = state.phase === 'robber-discard' ? `Передайте устройство игроку ${nextPlayer} для сброса карт. Его ресурсы откроются после нажатия кнопки.`
      : state.phase === 'trade-offer' ? `Передайте устройство игроку ${nextPlayer}. Он сможет принять, изменить или отклонить обмен.`
      : `Передайте устройство игроку ${nextPlayer}. Его ресурсы и карты откроются только после нажатия кнопки.`;
    renderBoard(); renderPlayers(); renderBuildActions();
    $('#log').innerHTML = state.log.map(entry => `<li>${escape(entry)}</li>`).join('');
    $('#reset-button').hidden = true;
    return;
  }
  $('#room-kind').textContent = room.local ? 'Партия' : 'Комната';
  $('#room-code').textContent = room.local ? 'за одним столом' : room.id;
  $('#connection-status').textContent = room.local ? '● Сохранено на устройстве' : connected ? '● На связи' : '○ Переподключаемся…';
  $('#connection-status').classList.toggle('offline', !connected);
  $('#share-controls').hidden = !!room.local;
  if (!state) {
    $('#lobby-ruleset').textContent = `${ruleset.name} · ${mapGeneration.name} · ${ruleset.minPlayers}–${ruleset.maxPlayers} игрока`;
    $('#lobby-hint').textContent = room.host ? (room.members.length < ruleset.minPlayers ? `Для начала нужны минимум ${ruleset.minPlayers} игрока. Поделитесь ссылкой.` : `Участников: ${room.members.length} из ${ruleset.maxPlayers}. Запустите партию, когда все соберутся.`) : 'Ожидаем, когда создатель комнаты начнёт партию.';
    $('#lobby-members').innerHTML = room.members.map((person, index) => `<div class="lobby-member"><span class="avatar" style="--player-color:${playerColor(index)}">${index + 1}</span><div><strong>${escape(person.name)}${room.me === index ? ' · вы' : ''}</strong><small>${person.botLevel ? `Бот · сложность ${person.botLevel}` : `${person.host ? 'Создатель комнаты · ' : ''}${person.online ? 'На связи' : 'Ожидаем подключения'}`}</small></div>${person.botLevel && room.host ? `<button class="lobby-remove-bot" type="button" data-remove-bot="${escape(person.id)}" aria-label="Убрать ${escape(person.name)}" title="Убрать бота">×</button>` : ''}</div>`).join('');
    $('#lobby-bot-controls').hidden = !room.host || room.members.length >= 4;
    $('#lobby-add-bot').disabled = !connected || pending;
    $('#start-button').hidden = !room.host;
    $('#start-button').disabled = room.members.length < ruleset.minPlayers || !connected || pending;
    return;
  }
  renderBoard();
  if (!rollProductionPending) renderPlayers();
  renderTurn();
  if (!rollProductionPending) renderResources();
  renderDevelopment(); renderActions();
  renderReplayControls();
}

$('#replay-toggle').addEventListener('click', toggleReplay);
$('#replay-first').addEventListener('click', () => { stopReplayPlayback(); setReplayIndex(0); });
$('#replay-prev').addEventListener('click', () => { stopReplayPlayback(); setReplayIndex(replay.index - 1); });
$('#replay-next').addEventListener('click', () => { stopReplayPlayback(); setReplayIndex(replay.index + 1); });
$('#replay-last').addEventListener('click', () => { stopReplayPlayback(); setReplayIndex(historyFrames().length - 1); });
$('#replay-play').addEventListener('click', toggleReplayPlayback);
$('#replay-range').addEventListener('input', event => { stopReplayPlayback(); setReplayIndex(Number(event.target.value)); });
$('#victory-close').addEventListener('click', () => { hideVictoryOverlay(); $('#board').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
$('#victory-replay').addEventListener('click', () => { toggleReplay(); $('#replay-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#victory-overlay').hidden) hideVictoryOverlay();
});

$('#mode-online').addEventListener('click', () => {
  localMode = false; history.replaceState(null, '', '/'); notice(); render();
});
$('#mode-local').addEventListener('click', () => {
  localMode = true; history.replaceState(null, '', '/?local=1'); notice(); render();
});
let colorDrag = null;
let ignoreColorClickUntil = 0;
const colorSwatchAt = (x, y) => document.elementFromPoint(x, y)?.closest('.local-player-swatch');
function finishColorDrag() {
  if (!colorDrag) return;
  colorDrag.source.classList.remove('is-dragging');
  document.querySelectorAll('.local-player-swatch.is-drop-target').forEach(swatch => swatch.classList.remove('is-drop-target'));
  colorDrag.ghost?.remove();
  colorDrag = null;
}
$('#local-form').addEventListener('pointerdown', event => {
  const source = event.target.closest('.local-player-swatch');
  if (!source) return;
  colorDrag = { source, seat: Number(source.dataset.seatIndex), pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, target: null, ghost: null };
  source.setPointerCapture(event.pointerId);
});
$('#local-form').addEventListener('pointermove', event => {
  if (!colorDrag || event.pointerId !== colorDrag.pointerId) return;
  if (!colorDrag.dragging && Math.hypot(event.clientX - colorDrag.x, event.clientY - colorDrag.y) < 6) return;
  if (!colorDrag.dragging) {
    colorDrag.dragging = true;
    colorDrag.source.classList.add('is-dragging');
    colorDrag.ghost = document.createElement('span');
    colorDrag.ghost.className = 'color-drag-ghost';
    colorDrag.ghost.style.setProperty('--player-color', PALETTE[localColorOrder[colorDrag.seat]]);
    document.body.append(colorDrag.ghost);
  }
  colorDrag.ghost.style.left = `${event.clientX}px`;
  colorDrag.ghost.style.top = `${event.clientY - 22}px`;
  const target = colorSwatchAt(event.clientX, event.clientY);
  if (colorDrag.target !== target) {
    colorDrag.target?.classList.remove('is-drop-target');
    colorDrag.target = target && target !== colorDrag.source ? target : null;
    colorDrag.target?.classList.add('is-drop-target');
  }
});
$('#local-form').addEventListener('pointerup', event => {
  if (!colorDrag || event.pointerId !== colorDrag.pointerId) return;
  if (colorDrag.dragging) {
    const target = colorSwatchAt(event.clientX, event.clientY);
    if (target && target !== colorDrag.source) swapLocalColors(colorDrag.seat, Number(target.dataset.seatIndex));
    ignoreColorClickUntil = Date.now() + 350;
  }
  finishColorDrag();
});
$('#local-form').addEventListener('pointercancel', finishColorDrag);
$('#local-add-player').addEventListener('click', () => {
  if (localVisiblePlayers >= 4) return;
  localVisiblePlayers++;
  renderLocalPlayerFields();
  $(`#local-name-${localVisiblePlayers}`).focus();
});
$('#local-form').addEventListener('change', event => {
  if (event.target.matches('.local-seat-kind')) renderLocalPlayerFields();
});
$('#local-ruleset-picker').addEventListener('change', () => {
  if (selectedRuleset('local') === 'classic' && localVisiblePlayers < 3) {
    localVisiblePlayers = 3;
    renderLocalPlayerFields();
  }
  render();
});
$('#local-form').addEventListener('click', event => {
  const swatch = event.target.closest('.local-player-swatch');
  if (!swatch || Date.now() < ignoreColorClickUntil) return;
  const seat = Number(swatch.dataset.seatIndex);
  if (selectedColorSeat === null) selectedColorSeat = seat;
  else if (selectedColorSeat === seat) selectedColorSeat = null;
  else { swapLocalColors(selectedColorSeat, seat); return; }
  localColorPicker.hidden = selectedColorSeat === null;
  if (selectedColorSeat !== null) {
    const formBounds = $('#local-form').getBoundingClientRect();
    const swatchBounds = swatch.getBoundingClientRect();
    localColorPicker.style.left = `${Math.max(10, Math.min(formBounds.width - 182, swatchBounds.left - formBounds.left - 8))}px`;
    localColorPicker.style.top = `${swatchBounds.bottom - formBounds.top + 7}px`;
  }
  renderLocalSwatches();
});
localColorPicker.addEventListener('click', event => {
  const button = event.target.closest('[data-color-index]');
  if (!button || selectedColorSeat === null) return;
  const color = Number(button.dataset.colorIndex);
  const previousSeat = localColorOrder.indexOf(color);
  if (previousSeat !== -1 && previousSeat !== selectedColorSeat) {
    localColorOrder[previousSeat] = localColorOrder[selectedColorSeat];
  }
  localColorOrder[selectedColorSeat] = color;
  selectedColorSeat = null;
  localColorPicker.hidden = true;
  renderLocalSwatches();
});
document.addEventListener('click', event => {
  if (localColorPicker.hidden || event.target.closest('.local-player-swatch, .local-color-picker')) return;
  selectedColorSeat = null;
  localColorPicker.hidden = true;
  renderLocalSwatches();
});
$('#local-form').addEventListener('submit', event => {
  event.preventDefault();
  const seats = Array.from({ length: localVisiblePlayers }, (_, index) => ({
    botLevel: $(`.local-seat-kind[data-seat-index="${index}"]`).value === 'bot' ? Number($(`#local-bot-level-${index + 1}`).value) : null,
    name: $(`#local-name-${index + 1}`).value.trim().replace(/\s+/g, ' '),
  }));
  if (seats.every(seat => seat.botLevel)) { notice('В партии нужен хотя бы один человек.', true); return; }
  const usedNames = new Set(seats.filter(seat => !seat.botLevel).map(seat => seat.name.toLocaleLowerCase()));
  seats.forEach((seat, index) => {
    if (!seat.botLevel) return;
    let number = index + 1;
    while (usedNames.has(`бот ${number}`)) number++;
    seat.name = `Бот ${number}`;
    usedNames.add(seat.name.toLocaleLowerCase());
  });
  const names = seats.map(seat => seat.name);
  const ruleset = rules.RULESETS[selectedRuleset('local')];
  if (names.length < ruleset.minPlayers || names.length > ruleset.maxPlayers || names.some(name => !name || Array.from(name).length > 24 || /[\x00-\x1f\x7f]/.test(name))) { notice(`Для набора «${ruleset.name}» нужны от ${ruleset.minPlayers} до ${ruleset.maxPlayers} игроков; имена не длиннее 24 символов.`, true); return; }
  if (new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) { notice('У каждого игрока должно быть своё имя.', true); return; }
  notice();
  const game = rules.freshGame(seats.map(({ name, botLevel }, index) => ({ id: `local-${index}`, name, ...(botLevel ? { botLevel } : {}) })), secureRandomIndex, ruleset.id, selectedMapGeneration('local'));
  const saved = { names, game, revision: 0, colorOrder: [...localColorOrder] };
  localSessionId = null;
  localSession = saved;
  saveLocalSession();
  openLocalSession(saved, localSessionId);
});
$('#local-saved-list').addEventListener('click', event => {
  const resume = event.target.closest('[data-resume-local]');
  const remove = event.target.closest('[data-delete-local]');
  if (!resume && !remove) return;
  const id = (resume || remove).dataset[resume ? 'resumeLocal' : 'deleteLocal'];
  const entry = readLocalSaves().saves.find(saved => saved.id === id);
  if (!entry) { notice('Сохранённая партия не найдена.', true); render(); return; }
  if (remove) {
    if (!confirm(`Удалить партию «${entry.session.names.join(' · ')}»? Это действие нельзя отменить.`)) return;
    try {
      const library = deleteLocalLibrarySession(localStorage, id);
      if (!library.saves.length) localNewExpanded = false;
      notice(); render();
    } catch { notice('Не удалось удалить сохранение из браузера.', true); }
    return;
  }
  try { selectLocalLibrarySession(localStorage, id); }
  catch { notice('Не удалось выбрать сохранённую партию.', true); return; }
  notice(); openLocalSession(entry.session, id);
});
$('#local-new-toggle').addEventListener('click', () => {
  localNewExpanded = !localNewExpanded;
  selectedColorSeat = null;
  localColorPicker.hidden = true;
  notice();
  render();
});
$('#local-export').addEventListener('click', () => {
  if (!room?.local || !localSession || pending) return;
  try {
    const content = serializeLocalFile(localSession);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `catan-local-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { notice('Не удалось сохранить партию в файл.', true); }
});
$('#local-import').addEventListener('click', () => { if (!pending) $('#local-file-input').click(); });
$('#local-file-input').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Файл партии слишком большой.');
    const saved = parseLocalFile(await file.text());
    localSessionId = null;
    localSession = saved;
    saveLocalSession();
    notice();
    openLocalSession(saved, localSessionId);
  } catch (error) { notice(error.message || 'Не удалось загрузить партию.', true); }
});
$('#handoff-ready').addEventListener('click', () => { resumeTurnTimer(); handoff = false; notice(); render(); queueLocalBot(); });
$('#local-hide').addEventListener('click', () => {
  stopReplayPlayback(); replay.active = false; pauseTurnTimer(); handoff = true; robberFlight = null; $('#robber-effects').replaceChildren(); rollAnimationId++; $('#resource-effects').replaceChildren(); $('#steal-effects').replaceChildren(); render();
});
$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault(); if (pending || loading) return;
  const name = $('#player-name').value.trim();
  if (!name) return;
  pending = true; notice(); render();
  try {
    const next = await request(roomCode ? `/api/rooms/${roomCode}/join` : '/api/rooms', roomCode ? { name } : { name, ruleset: selectedRuleset('online'), mapGeneration: selectedMapGeneration('online') });
    try { localStorage.setItem('catan-name', name); } catch { /* Names are optional browser preferences. */ }
    history.replaceState(null, '', `/?room=${next.id}`);
    accept(next); connect();
  } catch (error) { notice(error.message, true); }
  finally { pending = false; render(); }
});
$('#copy-link').addEventListener('click', async () => {
  const invite = `${location.origin}/?room=${room.id}`;
  try {
    let copied = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(invite); copied = true; } }
    catch { /* Older browser permissions may still allow selection-based copying. */ }
    if (!copied) {
      const field = document.createElement('textarea');
      field.value = invite;
      field.style.cssText = 'position:fixed;left:-9999px';
      document.body.append(field);
      field.select();
      copied = document.execCommand('copy');
      field.remove();
      if (!copied) throw new Error('Копирование недоступно');
    }
    $('#copy-link').textContent = 'Ссылка скопирована ✓';
    setTimeout(() => { $('#copy-link').textContent = 'Скопировать ссылку'; }, 2500);
  } catch { notice(`Не удалось скопировать ссылку. Адрес комнаты: ${invite}`); }
});
$('#start-button').addEventListener('click', () => sendAction('start'));
$('#lobby-add-bot').addEventListener('click', () => sendAction('add-bot', { level: Number($('#lobby-bot-level').value) }));
$('#lobby-members').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-bot]');
  if (button) sendAction('remove-bot', { id: button.dataset.removeBot });
});
function chooseVertex(index) {
  if (state?.mode === 'settlement' && canSettle(index)) sendAction('settlement', { index });
  else if (state?.mode === 'city' && canCity(index)) sendAction('city', { index });
}
function chooseEdge(index) { if (state?.mode === 'road' && canRoad(index)) sendAction('road', { index }); }
$('#board').addEventListener('pointermove', event => {
  if ($('.board-frame').classList.contains('is-placing-city') && event.pointerType !== 'touch') {
    cityPlacementCursor.style.left = `${event.clientX}px`;
    cityPlacementCursor.style.top = `${event.clientY}px`;
    cityPlacementCursor.hidden = false;
  }
  if (event.pointerType === 'touch' || !state || state.phase !== 'robber-move' || !canAct()) {
    setRobberPreview(null);
    return;
  }
  setRobberPreview(robberTileAtPointer(event));
});
$('#board').addEventListener('pointerleave', () => { setRobberPreview(null); hideCityPlacementCursor(); });
$('#board').addEventListener('pointercancel', hideCityPlacementCursor);
window.addEventListener('blur', hideCityPlacementCursor);
$('#board').addEventListener('focusin', event => {
  if (event.target.dataset.robberTile !== undefined) setRobberPreview(Number(event.target.dataset.robberTile));
});
$('#board').addEventListener('focusout', event => {
  if (event.target.dataset.robberTile !== undefined) setRobberPreview(null);
});
$('#board').addEventListener('click', event => {
  if (canAct() && state.phase === 'robber-move') {
    const index = robberTileAtPointer(event);
    if (index !== null) { setRobberPreview(null); sendAction('move-robber', { index }); return; }
  }
  const tile = event.target.closest('[data-robber-tile]');
  if (tile && canAct() && state.phase === 'robber-move') { setRobberPreview(null); sendAction('move-robber', { index: Number(tile.dataset.robberTile) }); return; }
  const vertex = event.target.closest('[data-vertex]'), edge = event.target.closest('[data-edge]');
  if (vertex) chooseVertex(Number(vertex.dataset.vertex)); else if (edge) chooseEdge(Number(edge.dataset.edge));
});
$('#board').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.dataset.vertex !== undefined) { event.preventDefault(); chooseVertex(Number(event.target.dataset.vertex)); }
  if (event.target.dataset.edge !== undefined) { event.preventDefault(); chooseEdge(Number(event.target.dataset.edge)); }
  if (event.target.dataset.robberTile !== undefined && canAct() && state.phase === 'robber-move') { event.preventDefault(); setRobberPreview(null); sendAction('move-robber', { index: Number(event.target.dataset.robberTile) }); }
});
function updateDiscardPreview() {
  const resources = state.players[room.me].resources;
  const count = state.robberDiscards?.[room.me] || 0;
  const selected = RESOURCE_KEYS.reduce((sum, resource) => sum + discardDraft[resource], 0);
  for (const key of RESOURCE_KEYS) {
    const row = $(`#robber-panel [data-discard-resource="${key}"]`);
    const value = discardDraft[key];
    const owned = row.querySelector('.discard-owned');
    const arrow = row.querySelector('.discard-arrow');
    const after = row.querySelector('.discard-after');
    const output = row.querySelector('.discard-count');
    output.textContent = value;
    output.setAttribute('aria-label', `Выбрано для сброса: ${value}`);
    owned.classList.toggle('is-discarding', value > 0);
    arrow.hidden = value === 0;
    after.hidden = value === 0;
    after.textContent = resources[key] - value;
    row.querySelector('[data-discard-step="-1"]').disabled = value === 0 || pending || !connected;
    row.querySelector('[data-discard-step="1"]').disabled = value >= resources[key] || selected >= count || pending || !connected;
  }
  $('#robber-panel .panel-foot span').textContent = `Выбрано ${selected} из ${count}`;
  $('#robber-panel [data-robber-action="discard"]').disabled = selected !== count || !connected || pending;
  renderResources();
}
$('#robber-panel').addEventListener('click', event => {
  const step = event.target.closest('[data-discard-step]');
  if (step && !step.disabled && state.phase === 'robber-discard') {
    const key = step.dataset.resource;
    if (RESOURCE_KEYS.includes(key)) {
      const count = state.robberDiscards?.[room.me] || 0;
      const selected = RESOURCE_KEYS.reduce((sum, resource) => sum + discardDraft[resource], 0);
      const next = discardDraft[key] + Number(step.dataset.discardStep);
      if (next >= 0 && next <= state.players[room.me].resources[key] && (next <= discardDraft[key] || selected < count)) {
        discardDraft[key] = next;
        updateDiscardPreview();
      }
    }
    return;
  }
  const discard = event.target.closest('[data-robber-action="discard"]');
  if (discard && !discard.disabled) sendAction('discard', { resources: { ...discardDraft } });
  const cancelKnight = event.target.closest('[data-robber-action="cancel-knight"]');
  if (cancelKnight && !cancelKnight.disabled) { setRobberPreview(null); sendAction('cancel-knight'); return; }
  const victim = event.target.closest('[data-victim]');
  if (victim && !victim.disabled) sendAction('steal', { victim: Number(victim.dataset.victim) });
});
$('#development-content').addEventListener('change', event => {
  const key = event.target.dataset.devSelect;
  if (key && RESOURCE_KEYS.includes(event.target.value)) devDraft[key] = event.target.value;
});
$('#development-content').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) {
    if (event.target.closest('select')) return;
    const preview = event.target.closest('.development-card[data-preview-dev]');
    if (preview) showDevelopmentCard(preview.dataset.previewDev, true);
    return;
  }
  if (button.disabled) return;
  if (button.dataset.previewDev) { showDevelopmentCard(button.dataset.previewDev, true); return; }
  if (button.id === 'buy-dev-button') { sendAction('buy-dev'); return; }
  if (button.dataset.finishDevRoad !== undefined) { sendAction('finish-dev-road'); return; }
  const card = button.dataset.playDev;
  if (!card) return;
  const details = card === 'plenty' ? { first: devDraft.first, second: devDraft.second }
    : card === 'monopoly' ? { resource: devDraft.monopoly } : {};
  sendAction('play-dev', { card, ...details });
});
$('#players').addEventListener('click', event => {
  const button = event.target.closest('[data-edit-player]');
  if (button) openPlayerProfile(Number(button.dataset.editPlayer));
});
$('#player-profile-colors').addEventListener('click', event => {
  const button = event.target.closest('[data-profile-color]');
  if (!button || button.disabled) return;
  selectedProfileColor = Number(button.dataset.profileColor);
  renderProfileColors();
});
$('#player-profile-close').addEventListener('click', () => $('#player-profile-dialog').close());
$('#player-profile-cancel').addEventListener('click', () => $('#player-profile-dialog').close());
$('#player-profile-dialog').addEventListener('close', () => { editingPlayer = null; });
$('#player-profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (editingPlayer === null || pending) return;
  const name = $('#player-profile-name').value.trim().replace(/\s+/g, ' ');
  const error = $('#player-profile-error');
  const showError = message => { error.textContent = message; error.hidden = false; };
  if (!name || Array.from(name).length > 24) { showError('Имя должно содержать от 1 до 24 символов.'); return; }
  if (state.players.some((player, index) => index !== editingPlayer && player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { showError('Это имя уже занято.'); return; }
  if (room.local) {
    const previousSeat = localSession.colorOrder.indexOf(selectedProfileColor);
    if (previousSeat !== -1 && previousSeat !== editingPlayer) localSession.colorOrder[previousSeat] = localSession.colorOrder[editingPlayer];
    localSession.colorOrder[editingPlayer] = selectedProfileColor;
    localSession.names[editingPlayer] = name;
    localSession.game.players[editingPlayer].name = name;
    localSession.revision++;
    saveLocalSession();
    $('#player-profile-dialog').close();
    accept(hotseatRoom(localSession.game, localSession.names, room.me, localSession.revision));
    return;
  }
  pending = true;
  $('#player-profile-save').disabled = true;
  try {
    const next = await request(`/api/rooms/${roomCode}/actions`, { type: 'update-profile', name, colorIndex: selectedProfileColor, revision: room.revision });
    $('#player-profile-dialog').close();
    accept(next);
  } catch (failure) {
    showError(failure.message);
    try { await refreshRoom(); } catch { /* The live connection will refresh the room. */ }
  } finally {
    pending = false;
    $('#player-profile-save').disabled = false;
    render();
  }
});
$('#trade-panel').addEventListener('change', event => { if (event.target.id === 'trade-target') tradeDraft.to = Number(event.target.value); });
$('#trade-panel').addEventListener('click', event => {
  const modeButton = event.target.closest('[data-trade-mode]');
  if (modeButton) { tradeDraft.mode = modeButton.dataset.tradeMode; renderResources(); renderTradePanel(); return; }
  const stepButton = event.target.closest('[data-trade-step]');
  if (stepButton && !stepButton.disabled) {
    const { group, resource: key } = stepButton.dataset;
    if (!['give', 'want'].includes(group) || !RESOURCE_KEYS.includes(key)) return;
    if (stepButton.dataset.tradeContext === 'counter') {
      syncCounterDraft();
      if (!counterDraft) return;
      counterDraft[group][key] += Number(stepButton.dataset.tradeStep);
      const resources = state.players[room.me].resources;
      for (const resource of RESOURCE_KEYS) counterDraft.give[resource] = Math.min(counterDraft.give[resource], resources[resource]);
      renderResources(); renderTradePanel();
      const replacement = $(`#trade-panel [data-trade-context="counter"][data-trade-step="${stepButton.dataset.tradeStep}"][data-group="${group}"][data-resource="${key}"]`);
      if (replacement && !replacement.disabled) replacement.focus();
      return;
    }
    const mode = tradeDraft.mode;
    const step = mode === 'bank' && group === 'give' ? rules.harborRate(state, room.me, key) : 1;
    tradeDraft[mode][group][key] += Number(stepButton.dataset.tradeStep) * step;
    renderResources(); renderTradePanel();
    const replacement = $(`#trade-panel [data-trade-step="${stepButton.dataset.tradeStep}"][data-group="${group}"][data-resource="${key}"]`);
    if (replacement && !replacement.disabled) replacement.focus();
    return;
  }
  const button = event.target.closest('[data-trade-action]');
  if (!button || button.disabled) return;
  const type = button.dataset.tradeAction;
  if (type === 'reset-trade') {
    tradeDraft.player = { give: emptyTradeVector(), want: emptyTradeVector() };
    renderResources(); renderTradePanel();
    return;
  }
  sendAction(type, type === 'offer-trade' ? { to: tradeDraft.to, give: { ...tradeDraft.player.give }, want: { ...tradeDraft.player.want } }
    : type === 'trade' ? { give: { ...tradeDraft.bank.give }, want: { ...tradeDraft.bank.want } }
    : type === 'counter-trade' ? { give: { ...counterDraft.give }, want: { ...counterDraft.want } } : {});
});
function highlightProductionRow(item) {
  const index = Number(item.dataset.sourceTile);
  if (!board.tiles[index]) return;
  clearTimeout(sourceTimer);
  if (item.classList.contains('is-selected') && rollVisual.sourceTile === index) return;
  $('#production-summary').querySelectorAll('.production-item.is-selected').forEach(row => row.classList.remove('is-selected'));
  item.classList.add('is-selected');
  rollVisual.sourceTile = index;
  renderBoard();
}
function clearProductionHighlight() {
  clearTimeout(sourceTimer);
  $('#production-summary').querySelectorAll('.production-item.is-selected').forEach(row => row.classList.remove('is-selected'));
  if (rollVisual.sourceTile === null) return;
  rollVisual.sourceTile = null;
  renderBoard();
}
$('#production-summary').addEventListener('pointerover', event => {
  if (event.pointerType === 'touch') return;
  const item = event.target.closest('[data-source-tile]');
  if (item) highlightProductionRow(item);
});
$('#production-summary').addEventListener('pointerout', event => {
  if (event.pointerType === 'touch') return;
  const item = event.target.closest('[data-source-tile]');
  if (item && !item.contains(event.relatedTarget)) clearProductionHighlight();
});
$('#production-summary').addEventListener('pointerup', event => {
  if (event.pointerType !== 'touch') return;
  const item = event.target.closest('[data-source-tile]');
  if (!item) return;
  highlightProductionRow(item);
  sourceTimer = setTimeout(clearProductionHighlight, 2200);
});
$('#production-summary').addEventListener('click', event => {
  const item = event.target.closest('[data-production-index]');
  if (!item || !state?.rolled || rollVisual.settling) return;
  const production = state.lastProduction?.[Number(item.dataset.productionIndex)];
  if (!production || production.tileIndex !== Number(item.dataset.sourceTile)) return;
  animateProduction([production], rollAnimationId, true);
});
$('#production-summary').addEventListener('focusin', event => {
  const item = event.target.closest('[data-source-tile]');
  if (item) highlightProductionRow(item);
});
$('#production-summary').addEventListener('focusout', event => {
  const item = event.target.closest('[data-source-tile]');
  if (item && !item.contains(event.relatedTarget)) clearProductionHighlight();
});
function highlightRolledTotal(active) {
  const next = active && state?.rolled && !rollVisual.settling ? state.dice[0] + state.dice[1] : null;
  if (hoveredRollTotal === next) return;
  hoveredRollTotal = next;
  renderBoard();
}
$('#dice-total').addEventListener('mouseenter', () => highlightRolledTotal(true));
$('#dice-total').addEventListener('mouseleave', () => highlightRolledTotal(false));
$('#dice-total').addEventListener('focus', () => highlightRolledTotal(true));
$('#dice-total').addEventListener('blur', () => highlightRolledTotal(false));
$('#roll-button').addEventListener('click', async () => {
  if (!canAct() || state.phase !== 'turn' || state.rolled || rollVisual.entering || rollVisual.rolling) return;
  unlockGameAudio();
  if (gameSettings.diceAnimation === 'simple' || reducedMotion.matches) {
    rollVisual.simple = gameSettings.diceAnimation === 'simple';
    rollVisual.rolling = true;
    if (rollVisual.simple && !reducedMotion.matches) startSimpleDiceRoll();
    else renderDice();
    playDiceRollSound();
    if (!reducedMotion.matches) await new Promise(resolve => setTimeout(resolve, 850));
    if (!rollVisual.rolling || state?.rolled) { stopSimpleDiceRoll(); return; }
    await sendAction('roll');
    if (!state?.rolled) { stopSimpleDiceRoll(); rollVisual.rolling = false; renderDice(); }
    return;
  }
  if (!reducedMotion.matches) {
    beginDiceEntrance();
    await new Promise(resolve => setTimeout(resolve, DICE_ENTRY_MS));
    if (!rollVisual.entering || state?.rolled) return;
    rollVisual.entering = false;
  }
  playDiceRollSound();
  rollVisual.rolling = true;
  renderDice();
  if (!reducedMotion.matches) await new Promise(resolve => setTimeout(resolve, DICE_SPIN_MS));
  if (!rollVisual.rolling || state?.rolled) return;
  await sendAction('roll');
  if (!state?.rolled) { rollVisual.rolling = false; renderDice(); }
});
$('#end-button').addEventListener('click', () => sendAction('end'));
function setBuildPreview(key) {
  const next = state?.phase === 'turn' && !handoff && BUILD[key] ? key : null;
  if (previewBuildKey === next) return;
  previewBuildKey = next;
  if (state && !handoff) renderResources();
}
$('#build-actions').addEventListener('pointerover', event => {
  if (event.pointerType !== 'touch') setBuildPreview(event.target.closest('[data-tooltip-build]')?.dataset.tooltipBuild);
});
$('#build-actions').addEventListener('pointerout', event => {
  const item = event.target.closest('[data-tooltip-build]');
  if (item && !item.contains(event.relatedTarget)) setBuildPreview(null);
});
$('#build-actions').addEventListener('focusin', event => setBuildPreview(event.target.closest('[data-tooltip-build]')?.dataset.tooltipBuild));
$('#build-actions').addEventListener('focusout', event => {
  const item = event.target.closest('[data-tooltip-build]');
  if (item && !item.contains(event.relatedTarget)) setBuildPreview(null);
});
$('#build-actions').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]');
  if (!button || button.disabled || !canAct()) return;
  state.mode = state.mode === button.dataset.mode ? null : button.dataset.mode; render();
});
$('#reset-button').addEventListener('click', () => sendAction('restart'));
$('#setting-sound').checked = gameSettings.sound;
$('#setting-dice-animation').checked = gameSettings.diceAnimation === 'full';
$('#settings-button').addEventListener('click', () => $('#settings-dialog').showModal());
$('#close-settings').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-dialog').addEventListener('click', event => { if (event.target.id === 'settings-dialog') event.target.close(); });
$('#setting-sound').addEventListener('change', event => {
  gameSettings.sound = event.target.checked;
  if (gameAudioOutput) gameAudioOutput.gain.value = gameSettings.sound ? 1 : 0;
  if (gameSettings.sound) unlockGameAudio();
  saveGameSettings();
});
$('#setting-dice-animation').addEventListener('change', event => {
  gameSettings.diceAnimation = event.target.checked ? 'full' : 'simple';
  saveGameSettings();
  if (state && !rollVisual.entering && !rollVisual.rolling && !rollVisual.settling && !rollVisual.flying) renderDice();
});
$('#rules-button').addEventListener('click', () => {
  const classic = activeRuleset().id === 'classic';
  $('#rules-dialog h2').textContent = classic ? 'Классическая игра' : 'Новые правила';
  $('#rules-dialog > p').textContent = classic
    ? 'Играют 3–4 человека. Подготовка идёт в два круга: каждый ставит поселение и примыкающую дорогу; во втором круге порядок обратный. Начальные ресурсы дают только поля у второго поселения. В банке по 19 карт каждого ресурса; у игрока не больше 5 поселений, 4 городов и 15 дорог.'
    : 'Играют 2–4 человека. Каждый начинает с одного бесплатного поселения и готового набора ресурсов. Затем по очереди бросайте кубики, получайте ресурсы с соседних клеток и стройте.';
  $('#rules-dialog').showModal();
});
$('#close-rules').addEventListener('click', () => $('#rules-dialog').close());
$('#rules-dialog').addEventListener('click', event => { if (event.target.id === 'rules-dialog') event.target.close(); });
$('#close-dev-reveal').addEventListener('click', () => $('#development-reveal').close());
$('#reveal-continue').addEventListener('click', () => $('#development-reveal').close());
$('#development-reveal').addEventListener('click', event => { if (event.target.id === 'development-reveal') event.target.close(); });
try { $('#player-name').value = localStorage.getItem('catan-name') || ''; } catch { /* Continue without saved preferences. */ }
if (roomCode) {
  render();
  try {
    if (!/^[A-F0-9]{10}$/.test(roomCode)) throw new Error('Некорректная ссылка комнаты.');
    await refreshRoom(); if (joined()) connect();
  } catch (error) { entryUnavailable = error.message; notice(error.message, true); }
  finally { loading = false; render(); }
} else {
  const library = localMode ? readLocalSaves() : { activeId: null, saves: [] };
  const saved = library.saves.find(entry => entry.id === library.activeId) || library.saves[0];
  if (saved) openLocalSession(saved.session, saved.id);
  else render();
}
