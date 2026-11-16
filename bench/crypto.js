// Micro-benchmark of the BBS operations used by the solution (INTERLEAVED version).
//   node bench/crypto.js [--iters 100] [--warmup 10] [--sizes 2,4,8,16,32,64]
// Output: results/crypto-<timestamp>.csv / .json  (+ summary table on stdout)
//
// Why interleaved: on a laptop the CPU frequency drifts with temperature and power state.
// Running all iterations of one configuration back to back lets that drift bias whole
// configurations (e.g. every "4 messages" row slow, every "8 messages" row fast).
// Here each round runs every configuration once, in random order, so drift hits all of
// them equally and the medians are comparable across sizes.
import { parseArgs } from 'node:util';
import { generateIssuerKeys, toBytes, sign, deriveProof, verifyProof, CIPHERSUITE } from '../src/bbs.js';
import { summarize, writeResults } from '../src/measure.js';

const { values } = parseArgs({
  options: {
    iters: { type: 'string', default: '100' },
    warmup: { type: 'string', default: '10' },
    sizes: { type: 'string', default: '2,4,8,16,32,64' }
  }
});
const ITERS = Number(values.iters);
const WARMUP = Number(values.warmup);
const SIZES = values.sizes.split(',').map(Number);

const keys = await generateIssuerKeys();
const header = toBytes('did:arweave:BENCH|attrs');
const ph = toBytes('verifier-nonce');
const isOk = (r) => r === true || r?.verified === true;

// ---- build the list of configurations ("tasks") ----
const tasks = [];
for (const L of SIZES) {
  const messages = Array.from({ length: L }, (_, i) => toBytes(`attr${i}:value-${i}`));
  const reveals = [...new Set([1, Math.max(1, Math.floor(L / 2)), L])].filter((d) => d <= L);

  const signature = await sign({ keys, header, messages });
  tasks.push({ op: 'sign', messages: L, disclosed: '', bytes: signature.length, times: [], fn: () => sign({ keys, header, messages }) });

  for (const d of reveals) {
    const idx = Array.from({ length: d }, (_, i) => i);
    const disclosed = idx.map((i) => messages[i]);
    const derive = () => deriveProof({
      publicKey: keys.publicKey, signature, header, messages, presentationHeader: ph, disclosedMessageIndexes: idx
    });
    const proof = await derive();
    const verify = () => verifyProof({
      publicKey: keys.publicKey, proof, header, presentationHeader: ph, messages: disclosed, disclosedMessageIndexes: idx
    });
    // sanity: never benchmark a failing verification
    if (!isOk(await verify())) throw new Error(`verifyProof returned false for ${L} messages / ${d} disclosed`);
    tasks.push({ op: 'deriveProof', messages: L, disclosed: d, bytes: proof.length, times: [], fn: derive });
    tasks.push({ op: 'verifyProof', messages: L, disclosed: d, bytes: proof.length, times: [], fn: verify });
  }
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- rounds: every task once per round, random order ----
const total = WARMUP + ITERS;
const tStart = performance.now();
console.log(`${tasks.length} configurations x ${total} rounds (${WARMUP} warm-up). Progress every 5 rounds.`);
for (let round = 0; round < total; round++) {
  for (const t of shuffled(tasks)) {
    const t0 = performance.now();
    await t.fn();
    const ms = performance.now() - t0;
    if (round >= WARMUP) t.times.push(ms);
  }
  if ((round + 1) % 5 === 0 || round + 1 === total) {
    const el = (performance.now() - tStart) / 1000;
    const eta = (el / (round + 1)) * (total - round - 1);
    console.log(`round ${round + 1}/${total}  elapsed ${(el / 60).toFixed(1)} min  ETA ${(eta / 60).toFixed(1)} min`);
  }
}

const r3 = (x) => +x.toFixed(3);
const rows = tasks.map((t) => {
  const s = summarize(t.times);
  return {
    op: t.op, messages: t.messages, disclosed: t.disclosed, n: s.n,
    mean_ms: r3(s.mean), median_ms: r3(s.median), p95_ms: r3(s.p95), sd_ms: r3(s.sd), min_ms: r3(s.min), max_ms: r3(s.max),
    bytes: t.bytes
  };
}).sort((a, b) => a.messages - b.messages || ['sign', 'deriveProof', 'verifyProof'].indexOf(a.op) - ['sign', 'deriveProof', 'verifyProof'].indexOf(b.op) || Number(a.disclosed || 0) - Number(b.disclosed || 0));

const base = writeResults('crypto', rows, { ciphersuite: CIPHERSUITE, iters: ITERS, warmup: WARMUP, order: 'interleaved-random' });
console.table(rows.map(({ op, messages, disclosed, median_ms, p95_ms, min_ms, bytes }) => ({ op, messages, disclosed, median_ms, p95_ms, min_ms, bytes })));
console.log(`Saved: ${base}.csv / .json`);
