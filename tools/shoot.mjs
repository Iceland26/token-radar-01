// Captures the three Token Radar dashboard screenshots into screenshots/ using headless Chromium
// driven over the DevTools protocol (the VM's Chromium build requires its WebGL domain-policy
// switches at startup and no-ops the plain --screenshot mode). Plain Node 22+ standard library only.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal CDP client over the browser WebSocket (flatten session mode). */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(`CDP error: ${msg.error.message}`));
        else res(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify(payload));
    });
  }

  onEvent(fn) {
    this.listeners.push(fn);
  }
}

async function connectCdp(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  const info = await res.json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res2, rej) => {
    ws.addEventListener('open', res2, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  return new Cdp(ws);
}

async function capturePage(cdp, url, width, height) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    const loaded = new Promise((res) => {
      const timer = setTimeout(res, 9000);
      cdp.onEvent((msg) => {
        if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
          clearTimeout(timer);
          res();
        }
      });
    });
    await cdp.send('Page.navigate', { url }, sessionId);
    await loaded;
    await sleep(700);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    return Buffer.from(shot.data, 'base64');
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
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
  { name: '1-board.png', url: baseUrl, width: 1440, height: 1440 },
  { name: '2-detail.png', url: `${baseUrl}#p=${encodeURIComponent(wlRow.slug)}`, width: 1440, height: 900 },
  { name: '3-filtered.png', url: `${baseUrl}#cat=${encodeURIComponent(chosenCat)}`, width: 1440, height: 900 },
];

// 3. Launch Chromium with its required WebGL domain policy and capture over CDP.
const profileDir = mkdtempSync(join(tmpdir(), 'token-radar-chrome-'));
const policyPath = join(profileDir, 'webgl-domains.txt');
writeFileSync(policyPath, 'hatch-webgl-all-origins-v1\n');
const policySha = createHash('sha256').update(readFileSync(policyPath)).digest('hex');

const chrome = spawn(CHROME_BIN, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--hatch-webgl-allowed-domains-file=${policyPath}`,
  `--hatch-webgl-allowed-domains-sha256=${policySha}`,
  `--user-data-dir=${profileDir}`,
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

try {
  // DevToolsActivePort is written into the profile dir once the browser is up.
  const portFile = join(profileDir, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 100 && port === 0; i++) {
    if (existsSync(portFile)) {
      port = parseInt(readFileSync(portFile, 'utf8').split('\n')[0], 10) || 0;
    }
    if (port === 0) await sleep(150);
  }
  if (port === 0) throw new Error('Chromium did not publish a DevTools port');

  const cdp = await connectCdp(port);
  for (const t of targets) {
    const outFile = join(shotsDir, t.name);
    const png = await capturePage(cdp, t.url, t.width, t.height);
    writeFileSync(outFile, png);
    const size = statSync(outFile).size;
    const { width, height } = parsePngDimensions(png);
    process.stdout.write(`screenshots/${t.name}: ${size} bytes, ${width}x${height} (${t.url})\n`);
  }
  cdp.ws.close();
} finally {
  chrome.kill('SIGKILL');
  rmSync(profileDir, { recursive: true, force: true });
}
