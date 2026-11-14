// Self-check script for token-radar-01: runs main.ts twice into fresh temp directories,
// validates all 7 locally checkable gate rows plus determinism, prints PASS/FAIL per row,
// and exits non-zero if any row fails.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from '../vendor/makefun-board.ts';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultInput = '/home/hatch/workspace/makefun/token-radar-01-kit-fresh-kit/input/snapshot.json';

function readArg(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline === undefined ? fallback : inline.slice(flag.length + 1);
}

const inputArg = readArg('input', existsSync('/input/snapshot.json') ? '/input/snapshot.json' : defaultInput);
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');

/** Walk a directory recursively, returning relative paths and sizes of all regular files. */
function walkFiles(dir, relPrefix = '') {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, rel));
    } else if (entry.isFile()) {
      results.push({ path: rel, fullPath: full, size: statSync(full).size });
    }
  }
  return results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Parse PNG (IHDR) or JPEG (SOF) dimensions from a Buffer. */
function parseImageDimensions(buf) {
  // PNG: 89 50 4E 47 0D 0A 1A 0A, then 4-byte length, 4-byte "IHDR", 4-byte width, 4-byte height
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a &&
    buf.toString('ascii', 12, 16) === 'IHDR'
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { format: 'PNG', width, height };
  }

  // JPEG: FF D8 ... SOF markers
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 1 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (offset < buf.length && buf[offset] === 0xff) offset++;
      if (offset >= buf.length) break;
      const marker = buf[offset];
      offset++;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        continue;
      }
      if (offset + 1 >= buf.length) break;
      const segLen = buf.readUInt16BE(offset);
      if (segLen < 2 || offset + segLen > buf.length) break;
      if (sofMarkers.has(marker)) {
        if (segLen < 7) break;
        const height = buf.readUInt16BE(offset + 3);
        const width = buf.readUInt16BE(offset + 5);
        return { format: 'JPEG', width, height };
      }
      offset += segLen;
    }
  }

  return null;
}

/** Run main.ts into `outDir`. */
function runEntry(outDir) {
  return spawnSync(process.execPath, [join(repoRoot, 'main.ts'), '--input', snapshotPath, '--output', outDir], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, MAKEFUN_OUTPUT_DIR: outDir },
  });
}

const out1 = mkdtempSync(join(tmpdir(), 'token-radar-gate1-'));
const out2 = mkdtempSync(join(tmpdir(), 'token-radar-gate2-'));

let failed = 0;
function report(rowName, ok, detail) {
  const status = ok ? 'PASS' : 'FAIL';
  if (!ok) failed++;
  process.stdout.write(`${status}  ${rowName.padEnd(18)} ${detail}\n`);
}

try {
  const run1 = runEntry(out1);
  const run2 = runEntry(out2);

  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));

  // 1. dashboard_files
  const dashDir = join(out1, 'dashboard');
  const dashFiles = walkFiles(dashDir);
  const dashTotalBytes = dashFiles.reduce((acc, f) => acc + f.size, 0);
  {
    const issues = [];
    if (!existsSync(dashDir) || dashFiles.length === 0) {
      issues.push('dashboard/ directory missing or empty in output');
    } else {
      const names = dashFiles.map((f) => f.path);
      if (!names.includes('index.html')) issues.push('missing index.html');
      if (!names.some((n) => n.endsWith('.css'))) issues.push('missing at least one .css file');
      if (!names.some((n) => n.endsWith('.js'))) issues.push('missing at least one .js file');
      if (dashFiles.length > 400) issues.push(`file count ${dashFiles.length} > 400`);
      if (dashTotalBytes > 4 * 1024 * 1024) issues.push(`total bytes ${dashTotalBytes} > 4 MiB`);

      for (const f of dashFiles) {
        const text = readFileSync(f.fullPath, 'utf8');
        if (f.path.endsWith('.css')) {
          if (/https?:/i.test(text)) issues.push(`${f.path} contains http:/https: URL`);
        } else if (f.path.endsWith('.html')) {
          // Flag http: or https: inside HTML attribute values
          if (/=\s*(?:"[^"]*https?:|'[^']*https?:|[^\s>"']*https?:)/i.test(text)) {
            issues.push(`${f.path} contains http:/https: in an HTML attribute value`);
          }
        } else if (f.path.endsWith('.js') || f.path.endsWith('.mjs')) {
          const importExportRe = /\b(?:import|export)\b[^;]*?\bfrom\s*['"`][^'"`]*https?:|\bimport\s*\(\s*['"`][^'"`]*https?:|\bimport\s*['"`][^'"`]*https?:|\brequire\s*\(\s*['"`][^'"`]*https?:/i;
          if (importExportRe.test(text)) {
            issues.push(`${f.path} contains http:/https: in a JS import/export/require specifier`);
          }
        }
      }
    }
    report(
      '1. dashboard_files',
      issues.length === 0,
      issues.length === 0
        ? `${dashFiles.length} files, ${dashTotalBytes} bytes total, no external URLs`
        : issues.join('; '),
    );
  }

  // Load board.json for checks 2..5
  const boardPath = join(out1, 'board.json');
  let boardRows = null;
  let boardBytes = 0;
  let boardParseErr = null;
  if (existsSync(boardPath)) {
    boardBytes = statSync(boardPath).size;
    try {
      const parsed = JSON.parse(readFileSync(boardPath, 'utf8'));
      if (parsed && Array.isArray(parsed.rows)) {
        boardRows = parsed.rows;
      } else {
        boardParseErr = 'board.json has no rows array';
      }
    } catch (e) {
      boardParseErr = `invalid JSON: ${e.message}`;
    }
  } else {
    boardParseErr = 'board.json not written';
  }

  // 2. board_file
  {
    const issues = [];
    if (boardParseErr) {
      issues.push(boardParseErr);
    } else {
      if (boardBytes > 8 * 1024 * 1024) issues.push(`board.json size ${boardBytes} > 8 MiB`);
      if (boardRows.length < 100 || boardRows.length > 4000) {
        issues.push(`row count ${boardRows.length} outside 100..4000`);
      }
      for (let i = 0; i < boardRows.length; i++) {
        const r = boardRows[i];
        if (!snapshotSlugs.has(r.slug)) {
          issues.push(`row ${i + 1} slug "${r.slug}" not in snapshot`);
          break;
        }
        if (typeof r.name !== 'string' || r.name.trim().length === 0) {
          issues.push(`row ${i + 1} (${r.slug}) has empty name`);
          break;
        }
        if (!Number.isSafeInteger(r.rank) || r.rank < 1) {
          issues.push(`row ${i + 1} (${r.slug}) has invalid rank ${r.rank}`);
          break;
        }
        if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) {
          issues.push(`row ${i + 1} (${r.slug}) has invalid implied_value_usd ${r.implied_value_usd}`);
          break;
        }
      }
    }
    report(
      '2. board_file',
      issues.length === 0,
      issues.length === 0
        ? `${boardRows.length} rows, ${boardBytes} bytes (<= 8 MiB), all slugs/names/ranks/values valid`
        : issues.join('; '),
    );
  }

  // 3. sorted_by_value
  {
    const issues = [];
    if (!boardRows) {
      issues.push('board.json unavailable');
    } else {
      for (let i = 0; i < boardRows.length; i++) {
        if (boardRows[i].rank !== i + 1) {
          issues.push(`row ${i + 1} has rank ${boardRows[i].rank}, expected ${i + 1}`);
          break;
        }
      }
      for (let i = 1; i < boardRows.length; i++) {
        if (boardRows[i].implied_value_usd > boardRows[i - 1].implied_value_usd) {
          issues.push(
            `rank ${i + 1} ($${boardRows[i].implied_value_usd}) > rank ${i} ($${boardRows[i - 1].implied_value_usd})`,
          );
          break;
        }
      }
      if (
        boardRows.length >= 2 &&
        boardRows[0].implied_value_usd === boardRows[boardRows.length - 1].implied_value_usd
      ) {
        issues.push(`all rows share identical implied_value_usd $${boardRows[0].implied_value_usd}`);
      }
    }
    report(
      '3. sorted_by_value',
      issues.length === 0,
      issues.length === 0
        ? `ranks 1..${boardRows.length} monotonic ($${boardRows[0].implied_value_usd.toLocaleString('en-US')} -> $${boardRows[boardRows.length - 1].implied_value_usd.toLocaleString('en-US')})`
        : issues.join('; '),
    );
  }

  // 4. coverage
  {
    const issues = [];
    if (!boardRows) {
      issues.push('board.json unavailable');
    } else {
      const rowSlugs = new Set(boardRows.map((r) => r.slug));
      const missing = snapshot.watchlist.filter((s) => !rowSlugs.has(s));
      if (missing.length > 0) {
        issues.push(`missing ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`);
      }
    }
    report(
      '4. coverage',
      issues.length === 0,
      issues.length === 0
        ? `${snapshot.watchlist.length}/${snapshot.watchlist.length} watchlist slugs present`
        : issues.join('; '),
    );
  }

  // 5. farm_steps
  {
    const issues = [];
    let minLen = Infinity;
    let maxLen = 0;
    if (!boardRows) {
      issues.push('board.json unavailable');
    } else {
      for (const r of boardRows) {
        if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
          issues.push(`${r.slug} has ${Array.isArray(r.farm_steps) ? r.farm_steps.length : 0} steps (expected 3..12)`);
          break;
        }
        for (let j = 0; j < r.farm_steps.length; j++) {
          const s = r.farm_steps[j];
          const trimmedLen = typeof s === 'string' ? s.trim().length : -1;
          if (trimmedLen < 20 || trimmedLen > 600) {
            issues.push(`${r.slug} step ${j + 1} trimmed length ${trimmedLen} outside 20..600`);
            break;
          }
          minLen = Math.min(minLen, trimmedLen);
          maxLen = Math.max(maxLen, trimmedLen);
        }
        if (issues.length > 0) break;
      }
    }
    report(
      '5. farm_steps',
      issues.length === 0,
      issues.length === 0
        ? `all ${boardRows.length} rows have 6 steps, trimmed lengths ${minLen}..${maxLen} chars`
        : issues.join('; '),
    );
  }

  // 6. screenshots
  {
    const shotsDir = join(out1, 'screenshots');
    const issues = [];
    const shotSummaries = [];
    if (!existsSync(shotsDir)) {
      issues.push('screenshots/ directory does not exist in output');
    } else {
      const files = readdirSync(shotsDir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
      if (files.length < 3 || files.length > 4) {
        issues.push(`found ${files.length} screenshots (expected 3..4)`);
      }
      for (const name of files) {
        const p = join(shotsDir, name);
        const buf = readFileSync(p);
        if (buf.length > 524_288) {
          issues.push(`${name} is ${buf.length} bytes (> 512 KiB)`);
        }
        const dims = parseImageDimensions(buf);
        if (!dims) {
          issues.push(`${name} is not a valid PNG or JPEG`);
        } else {
          const longSide = Math.max(dims.width, dims.height);
          const shortSide = Math.min(dims.width, dims.height);
          if (longSide > 1440 || shortSide < 800) {
            issues.push(`${name} dimensions ${dims.width}x${dims.height} violate long<=1440, short>=800`);
          }
          shotSummaries.push(`${name} (${dims.format} ${dims.width}x${dims.height}, ${buf.length}B)`);
        }
      }
    }
    report(
      '6. screenshots',
      issues.length === 0,
      issues.length === 0 ? shotSummaries.join(', ') : issues.join('; '),
    );
  }

  // 7. dossier_matches
  {
    const dossierPath = join(out1, 'dossier.json');
    const issues = [];
    let dossierSize = 0;
    if (!existsSync(dossierPath)) {
      issues.push(`dossier.json not present (dashboard source bytes=${dashTotalBytes})`);
    } else {
      const actualBytes = readFileSync(dossierPath);
      dossierSize = actualBytes.length;
      if (dossierSize > 1_572_864) {
        issues.push(`dossier.json size ${dossierSize} > 1.5 MiB (1572864 bytes)`);
      }
      try {
        const expectedBytes = Buffer.from(
          buildDossier(out1, {
            text_max_bytes: 65_536,
            screenshots: { max: 4, max_bytes: 524_288 },
            dashboard: { max_files: 400, max_bytes: 4_194_304 },
          }),
        );
        if (!actualBytes.equals(expectedBytes)) {
          issues.push(`dossier.json (${actualBytes.length}B) does not byte-equal fresh buildDossier (${expectedBytes.length}B)`);
        }
      } catch (e) {
        issues.push(`buildDossier threw: ${e.message}`);
      }
    }
    report(
      '7. dossier_matches',
      issues.length === 0,
      issues.length === 0
        ? `byte-identical (${dossierSize} bytes <= 1.5 MiB), dashboard source total=${dashTotalBytes} bytes (cap 65536)`
        : issues.join('; '),
    );
  }

  // 8. determinism
  {
    const issues = [];
    for (const rel of ['board.json', 'data.js', 'dossier.json']) {
      const p1 = join(out1, rel);
      const p2 = join(out2, rel);
      const e1 = existsSync(p1);
      const e2 = existsSync(p2);
      if (e1 !== e2) {
        issues.push(`${rel} existence differs between run 1 (${e1}) and run 2 (${e2})`);
      } else if (e1 && e2) {
        const b1 = readFileSync(p1);
        const b2 = readFileSync(p2);
        if (!b1.equals(b2)) {
          issues.push(`${rel} bytes differ between run 1 (${b1.length}B) and run 2 (${b2.length}B)`);
        }
      } else if (rel !== 'dossier.json') {
        issues.push(`${rel} missing in both runs`);
      }
    }
    const compared = ['board.json', 'data.js', ...(existsSync(join(out1, 'dossier.json')) ? ['dossier.json'] : [])];
    report(
      '8. determinism',
      issues.length === 0,
      issues.length === 0
        ? `run 1 and run 2 byte-identical across ${compared.join(', ')} (run1 exit=${run1.status}, run2 exit=${run2.status})`
        : issues.join('; '),
    );
  }
} finally {
  rmSync(out1, { recursive: true, force: true });
  rmSync(out2, { recursive: true, force: true });
}

if (failed > 0) {
  process.stderr.write(`gate-check: ${failed} check${failed === 1 ? '' : 's'} failed\n`);
  process.exit(1);
}
process.stdout.write('gate-check: all checks passed\n');
