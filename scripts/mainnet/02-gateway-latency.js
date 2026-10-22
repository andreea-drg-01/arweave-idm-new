// READ-ONLY. Measures fetch latency of a stored document from several AR.IO / Arweave gateways,
// by transaction id and (optionally) through an ArNS name.
//   node scripts/mainnet/02-gateway-latency.js --tx <TXID> [--name <ARNS_NAME>] [--runs 30] [--gateways a,b,c]
import { parseArgs } from 'node:util';
import { gatewaysFrom, ms } from './_common.js';
import { dataUrl, arnsUrl } from '../../src/resolve.js';
import { summarize, writeResults, sleep } from '../../src/measure.js';

const { values } = parseArgs({
  options: {
    tx: { type: 'string' }, name: { type: 'string' },
    runs: { type: 'string', default: '30' }, gateways: { type: 'string' }, pause: { type: 'string', default: '300' }
  }
});
if (!values.tx && !values.name) throw new Error('Provide --tx and/or --name');
const gateways = gatewaysFrom(values.gateways);
const runs = Number(values.runs);

async function timed(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const body = await res.arrayBuffer();
    return { ok: res.ok, status: res.status, ms: performance.now() - t0, bytes: body.byteLength };
  } catch (e) {
    return { ok: false, status: String(e.name), ms: performance.now() - t0, bytes: 0 };
  }
}

const targets = [];
for (const g of gateways) {
  if (values.tx) targets.push({ kind: 'txid', gateway: g, url: dataUrl(g, values.tx) });
  if (values.name) targets.push({ kind: 'arns', gateway: g, url: arnsUrl(g, values.name) });
}

const raw = [];
for (let i = 0; i < runs; i++) {
  for (const t of targets) {
    const r = await timed(t.url);
    raw.push({ run: i + 1, kind: t.kind, gateway: t.gateway, ...r, ms: ms(r.ms) });
  }
  await sleep(Number(values.pause));
}

const summary = [];
for (const t of targets) {
  const sample = raw.filter((r) => r.kind === t.kind && r.gateway === t.gateway);
  const okTimes = sample.filter((r) => r.ok).map((r) => r.ms);
  const st = okTimes.length ? summarize(okTimes) : null;
  summary.push({
    kind: t.kind, gateway: t.gateway, runs, success: okTimes.length,
    median_ms: st ? ms(st.median) : '', p95_ms: st ? ms(st.p95) : '', mean_ms: st ? ms(st.mean) : '', sd_ms: st ? ms(st.sd) : ''
  });
}
console.table(summary);
console.log('Raw + summary saved:', writeResults('gateway-latency', raw, { gateways, summary }) + '.csv');
