// Micro-benchmark of the BBS operations used by the solution.
//   node bench/crypto.js [--iters 50] [--warmup 5] [--sizes 2,4,8,16,32,64]
// Output: results/crypto-<timestamp>.csv / .json  (+ summary table on stdout)
import { parseArgs } from 'node:util';
import { generateIssuerKeys, toBytes, sign, deriveProof, verifyProof, CIPHERSUITE } from '../src/bbs.js';
import { summarize, writeResults } from '../src/measure.js';

const { values } = parseArgs({
  options: {
    iters: { type: 'string', default: '50' },
    warmup: { type: 'string', default: '5' },
    sizes: { type: 'string', default: '2,4,8,16,32,64' }
  }
});
const ITERS = Number(values.iters);
const WARMUP = Number(values.warmup);
const SIZES = values.sizes.split(',').map(Number);

async function timeIt(fn) {
  const t0 = performance.now();
  const out = await fn();
  return { ms: performance.now() - t0, out };
}

async function repeat(fn) {
  for (let i = 0; i < WARMUP; i++) await fn();
  const times = [];
  let last;
  for (let i = 0; i < ITERS; i++) {
    const { ms, out } = await timeIt(fn);
    times.push(ms);
    last = out;
  }
  return { stats: summarize(times), last };
}

const rows = [];
const keys = await generateIssuerKeys();
const header = toBytes('did:arweave:BENCH|attrs');
const ph = toBytes('verifier-nonce');

for (const L of SIZES) {
  const messages = Array.from({ length: L }, (_, i) => toBytes(`attr${i}:value-${i}`));
  const reveals = [...new Set([1, Math.max(1, Math.floor(L / 2)), L])].filter((d) => d <= L);

  const s = await repeat(() => sign({ keys, header, messages }));
  const signature = s.last;
  rows.push({ op: 'sign', messages: L, disclosed: '', ...fmt(s.stats), bytes: signature.length });

  for (const d of reveals) {
    const idx = Array.from({ length: d }, (_, i) => i);
    const dp = await repeat(() => deriveProof({
      publicKey: keys.publicKey, signature, header, messages, presentationHeader: ph, disclosedMessageIndexes: idx
    }));
    const proof = dp.last;
    rows.push({ op: 'deriveProof', messages: L, disclosed: d, ...fmt(dp.stats), bytes: proof.length });

    const disclosed = idx.map((i) => messages[i]);
    const vp = await repeat(() => verifyProof({
      publicKey: keys.publicKey, proof, header, presentationHeader: ph, messages: disclosed, disclosedMessageIndexes: idx
    }));
    rows.push({ op: 'verifyProof', messages: L, disclosed: d, ...fmt(vp.stats), bytes: proof.length });
  }
}

function fmt(st) {
  const r = (x) => +x.toFixed(3);
  return { n: st.n, mean_ms: r(st.mean), median_ms: r(st.median), p95_ms: r(st.p95), sd_ms: r(st.sd), min_ms: r(st.min), max_ms: r(st.max) };
}

const base = writeResults('crypto', rows, { ciphersuite: CIPHERSUITE, iters: ITERS, warmup: WARMUP });
console.table(rows.map(({ op, messages, disclosed, median_ms, p95_ms, bytes }) => ({ op, messages, disclosed, median_ms, p95_ms, bytes })));
console.log(`Saved: ${base}.csv / .json`);
