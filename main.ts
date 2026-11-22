// Token Radar entry point (Node 22, standard library only, deterministic output).
// Reads the sealed DefiLlama snapshot, scores pre-token protocols with radar-3 (lib/model.ts),
// writes board.json and data.js, copies dashboard/ and screenshots/, and writes dossier.json.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Extract `--name <value>` or `--name=<value>` from argv, or return `fallback`. */
function readArg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1]!;
  }
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline === undefined ? fallback : inline.slice(flag.length + 1);
}

/** Copy regular non-dot files from `srcDir` into `destDir`, returning sorted filenames. */
function copyRegularFiles(srcDir: string, destDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  mkdirSync(destDir, { recursive: true });
  const names = readdirSync(srcDir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const copied: string[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const srcPath = join(srcDir, name);
    if (!statSync(srcPath).isFile()) continue;
    copyFileSync(srcPath, join(destDir, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = readArg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(
    `token-radar: snapshot not found at ${inputFile} (pass --input <snapshot.json|dir> or mount /input)\n`,
  );
  process.exit(2);
}

const outDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token-radar: board failed gate validation: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const boardBytes = `${JSON.stringify({ rows: board })}\n`;
writeFileSync(join(outDir, 'board.json'), boardBytes);
// Integrity seal: first 8 hex of the sha256 of the exact board.json bytes, printed on the cover.
radar.seal = createHash('sha256').update(boardBytes, 'utf8').digest('hex').slice(0, 8);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const top3 = board
  .slice(0, 3)
  .map((r) => `#${r.rank} ${r.name} ($${r.implied_value_usd.toLocaleString('en-US')})`)
  .join(', ');

const c = radar.counts;
process.stdout.write(
  `token-radar (${radar.model_version}): scanned=${c.protocols_scanned}, pre-token=${c.pre_token_found}, set-aside=${c.set_aside}, board=${c.board_rows}, watchlist=${c.watchlist_covered}/${c.watchlist_size} | top 3: ${top3}\n`,
);

const dashFiles = copyRegularFiles(join(here, 'dashboard'), join(outDir, 'dashboard'));
const screenshots = copyRegularFiles(join(here, 'screenshots'), join(outDir, 'screenshots'));

if (screenshots.length < 3) {
  process.stderr.write(
    `token-radar: screenshots/ holds ${screenshots.length} image${screenshots.length === 1 ? '' : 's'}; at least 3 are required before building dossier.json\n`,
  );
  process.exit(1);
}

for (const name of screenshots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(
      `token-radar: invalid screenshot filename "${name}" (must match ${IMAGE_NAME.source})\n`,
    );
    process.exit(1);
  }
}

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  }),
);

process.stdout.write(
  `token-radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashFiles.length} files), ${join(outDir, 'screenshots')} (${screenshots.length} images), and ${join(outDir, 'dossier.json')}\n`,
);
