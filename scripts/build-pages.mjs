import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'dist');
const apiOrigin = process.env.CATAN_API_ORIGIN || 'https://api.catan.ya-erm.ru';
if (new URL(apiOrigin).protocol !== 'https:') throw new Error('Pages API origin must use HTTPS');

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of [
  'app.js', 'bot.js', 'favicon.svg', 'game.js', 'hotseat.js', 'local-save.js',
  'local-saves.js', 'style.css', 'victory-sound.js',
]) cpSync(join(root, name), join(output, name));
for (const name of ['optimized', 'audio']) {
  cpSync(join(root, 'assets', name), join(output, 'assets', name), { recursive: true });
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
if (!html.includes('</head>')) throw new Error('Missing closing head tag');
writeFileSync(join(output, 'index.html'), html.replace('</head>',
  `    <meta name="catan-api-origin" content="${apiOrigin}">\n  </head>`));
writeFileSync(join(output, '.nojekyll'), '');
