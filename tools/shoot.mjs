// Captures the three Token Radar dashboard screenshots into screenshots/ using headless Chromium.
// Plain Node 22 with standard library only.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_INPUT = '/home/hatch/workspace/makefun/token-radar-01-kit-fresh-kit/input/snapshot.json';
const CHROME_BIN = '/opt/meta-chromium/chrome';

function readArg(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline === undefined ? fallback : inline.slice(flag.length + 1);
}

function parsePngDimensions(buf) {
  if (
    buf.length < 24 ||
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47 ||
    buf.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('Invalid PNG file (missing IHDR)');
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

const inputArg = readArg('input', existsSync('/input/snapshot.json') ? '/input/snapshot.json' : DEFAULT_INPUT);
const outTmp = join(repoRoot, 'out-tmp');
const shotsDir = join(repoRoot, 'screenshots');

// 1. Run main.ts into out-tmp (tolerate exit 1 if screenshots/ is still empty as long as dashboard + data.js exist).
const runMain = spawnSync(process.execPath, [join(repoRoot, 'main.ts'), '--input', inputArg], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, MAKEFUN_OUTPUT_DIR: outTmp },
});

const indexPath = join(outTmp, 'dashboard', 'index.html');
const dataPath = join(outTmp, 'data.js');
if (!existsSync(indexPath) || !existsSync(dataPath)) {
  process.stderr.write(runMain.stderr || runMain.stdout || '');
  throw new Error(`main.ts failed (status=${runMain.status}) before writing ${indexPath} and ${dataPath}`);
}

// 2. Parse window.RADAR from out-tmp/data.js to pick detail slug and 12-30 row category.
const ctx = { window: {} };
vm.runInNewContext(readFileSync(dataPath, 'utf8'), ctx);
const radar = ctx.window.RADAR;
if (!radar || !Array.isArray(radar.rows) || radar.rows.length === 0) {
  throw new Error('out-tmp/data.js did not populate window.RADAR.rows');
}

const wlRow = radar.rows.find((r) => r.watchlist) ?? radar.rows[0];
const catCounts = new Map();
for (const r of radar.rows) {
  const cat = r.category ?? 'Uncategorized';
  catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
}
const preferredCats = [...catCounts.entries()].filter(([, n]) => n >= 12 && n <= 30);
const chosenCatEntry =
  preferredCats.find(([c]) => c === 'Lending') ??
  preferredCats[0] ??
  [...catCounts.entries()][0];
const chosenCat = chosenCatEntry[0];

mkdirSync(shotsDir, { recursive: true });
const baseUrl = pathToFileURL(indexPath).href;

const targets = [
  { name: '1-board.png', url: baseUrl },
  { name: '2-detail.png', url: `${baseUrl}#p=${encodeURIComponent(wlRow.slug)}` },
  { name: '3-filtered.png', url: `${baseUrl}#cat=${encodeURIComponent(chosenCat)}` },
];

// 3. Render screenshots via headless Chromium.
const profileDir = mkdtempSync(join(tmpdir(), 'token-radar-chrome-'));
try {
  for (const t of targets) {
    const outFile = join(shotsDir, t.name);
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--window-size=1440,900',
      '--virtual-time-budget=8000',
      `--user-data-dir=${profileDir}`,
      `--screenshot=${outFile}`,
      t.url,
    ];
    const res = spawnSync(CHROME_BIN, args, { encoding: 'utf8' });
    if (res.status !== 0 || !existsSync(outFile)) {
      process.stderr.write(res.stderr || res.stdout || '');
      throw new Error(`Chromium failed for ${t.name} (status=${res.status})`);
    }
    const size = statSync(outFile).size;
    const { width, height } = parsePngDimensions(readFileSync(outFile));
    process.stdout.write(`screenshots/${t.name}: ${size} bytes, ${width}x${height} (${t.url})\n`);
  }
} finally {
  rmSync(profileDir, { recursive: true, force: true });
}
