const soundUrl = new URL('./assets/audio/victory-fanfare.mp3?v=1', import.meta.url);
let download;
const decoded = new WeakMap();

export function loadVictoryFanfare(context) {
  if (!decoded.has(context)) {
    download ||= fetch(soundUrl).then(response => response.ok ? response.arrayBuffer() : null).catch(() => null);
    decoded.set(context, download.then(bytes => bytes ? context.decodeAudioData(bytes.slice(0)) : null).catch(() => null));
  }
  return decoded.get(context);
}

export function playVictoryFanfare(context, output, buffer) {
  if (!buffer) return;
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = .7;
  source.connect(gain).connect(output);
  source.start(context.currentTime + .02);
}
