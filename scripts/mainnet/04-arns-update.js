// Points an ArNS name at a DID-document transaction (setBaseNameRecord) and measures how long
// each gateway takes to resolve the NEW document (propagation / cache TTL effect).
// Requires an ArNS name you already own (its ANT process id) and ARIO/fees as per docs.ar.io.
//   WALLET_PATH=./wallet.json node scripts/mainnet/04-arns-update.js \
//        --name myissuer --process <ANT_PROCESS_ID> --tx <NEW_DID_DOC_TXID> [--execute] [--ttl 60]
//
// VERIFY BEFORE RUNNING: the ar.io docs now describe Solana-based wallets/ANTs for some flows.
// The signer below is the legacy ArweaveSigner(jwk). If your ANT is Solana-based, replace
// `makeSigner()` following docs.ar.io (https://docs.ar.io/sdks/ar-io-sdk/records/). Dry-run is default.
import { parseArgs } from 'node:util';
import { requireExecute, loadWallet, gatewaysFrom, ms } from './_common.js';
import { setBaseNameRecord } from '../../src/arns.js';
import { arnsUrl } from '../../src/resolve.js';
import { writeResults, sleep } from '../../src/measure.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' }, process: { type: 'string' }, tx: { type: 'string' },
    ttl: { type: 'string', default: '60' }, execute: { type: 'boolean', default: false },
    gateways: { type: 'string' }, 'timeout-min': { type: 'string', default: '20' }, 'poll-s': { type: 'string', default: '5' }
  }
});
for (const k of ['name', 'process', 'tx']) if (!values[k]) throw new Error(`Missing --${k}`);
const gateways = gatewaysFrom(values.gateways);

async function makeSigner() {
  const { ArweaveSigner } = await import('@ar.io/sdk');
  return new ArweaveSigner(loadWallet());
}

if (!requireExecute(values, `Would set ${values.name} -> ${values.tx} (ttl ${values.ttl}s) on ANT ${values.process}, then poll ${gateways.join(', ')}`)) process.exit(0);

const expected = await (async () => {
  // fetch the target document by tx id from the first gateway to know what "new" looks like
  const res = await fetch(`https://${gateways[0]}/${values.tx}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Target tx not yet fetchable from ${gateways[0]} (HTTP ${res.status}); wait for confirmation first.`);
  return JSON.stringify(JSON.parse(await res.text()));
})();

const t0 = performance.now();
const result = await setBaseNameRecord({ processId: values.process, signer: await makeSigner(), txId: values.tx, ttlSeconds: Number(values.ttl) });
const tSet = performance.now() - t0;
console.log('Record update submitted:', result?.id ?? result, `(${ms(tSet)} ms)`);

const seen = {};
const deadline = performance.now() + Number(values['timeout-min']) * 60_000;
while (performance.now() < deadline && gateways.some((g) => seen[g] === undefined)) {
  for (const g of gateways) {
    if (seen[g] !== undefined) continue;
    try {
      const res = await fetch(arnsUrl(g, values.name), { signal: AbortSignal.timeout(10000), cache: 'no-store' });
      if (res.ok && JSON.stringify(JSON.parse(await res.text())) === expected) seen[g] = performance.now() - t0;
    } catch { /* keep polling */ }
  }
  console.log(`t=${((performance.now() - t0) / 1000).toFixed(0)}s resolved on: ${Object.keys(seen).join(', ') || '-'}`);
  await sleep(Number(values['poll-s']) * 1000);
}

const row = {
  name: values.name, tx: values.tx, ttl_s: values.ttl, setRecord_ms: ms(tSet),
  ...Object.fromEntries(gateways.map((g) => [`resolves_new_${g}_ms`, seen[g] !== undefined ? ms(seen[g]) : '']))
};
console.table([row]);
console.log('Saved:', writeResults('arns-update', [row], { gateways }) + '.csv');
