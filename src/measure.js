import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'results');

export function summarize(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const q = (p) => s[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  const sd = n > 1 ? Math.sqrt(s.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, median: q(0.5), p95: q(0.95), min: s[0], max: s[n - 1], sd };
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const t = String(v ?? '');
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

export function envInfo() {
  return {
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    totalMemGB: +(os.totalmem() / 2 ** 30).toFixed(1),
    date: new Date().toISOString()
  };
}

/** Writes results/<name>-<timestamp>.csv and .json (with environment metadata). */
export function writeResults(name, rows, meta = {}) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(RESULTS_DIR, `${name}-${stamp}`);
  writeFileSync(`${base}.csv`, toCsv(rows));
  writeFileSync(`${base}.json`, JSON.stringify({ env: envInfo(), meta, rows }, null, 2));
  return base;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
