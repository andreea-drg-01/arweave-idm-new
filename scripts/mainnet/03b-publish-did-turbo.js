// Publishes ONE issuer DID document to Arweave mainnet through Turbo (an ANS-104 bundler run by ArDrive)
// and measures how long it takes until gateways serve it and until it is bundled/confirmed on layer 1.
// Turbo's free tier covers small uploads (docs.ar.io: "free uploads under 105 KiB"); this DID document is < 1 KiB.
// No AR is spent by this script. Dry-run by default.
//
//   npm install @ardrive/turbo-sdk --no-save           (not listed in package.json on purpose)
//   $env:WALLET_PATH = "./wallet.json"                  (an Arweave JWK; it may hold 0 AR)
//   node scripts/mainnet/03b-publish-did-turbo.js [--execute] [--timeout-min 40] [--poll-s 5] [--gateways a,b,c]
//
// Writes results/issuer-keys.json (BBS secret key, git-ignored) for 05-e2e-verify.js; the "txId" stored there is the
// data-item id, so use `--tx <id>` with 02-gateway-latency.js and 05-e2e-verify.js.
//
// NOT TESTED AGAINST THE REAL SDK: the calls follow the ar.io docs (TurboFactory.authenticated({ privateKey, token }),
// turbo.upload({ data, dataItemOpts: { tags } }), getUploadCosts({ bytes })). Fix small API differences on first run.
import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { requireExecute, loadWallet, gatewaysFrom, DEFAULT_GATEWAYS, ms } from './_common.js';
import { makeClient } from '../../src/arweave.js';
import { generateIssuerKeys, b64 } from '../../src/bbs.js';
import { buildDidDocument } from '../../src/did.js';
import { writeResults, sleep } from '../../src/measure.js';

const { values } = parseArgs({
  options: {
    execute: { type: 'boolean', default: false },
    'timeout-min': { type: 'string', default: '40' },
    'poll-s': { type: 'string', default: '5' },
    gateways: { type: 'string' }
  }
});
const gateways = values.gateways ? gatewaysFrom(values.gateways) : ['turbo-gateway.com', ...DEFAULT_GATEWAYS];

async function loadTurbo() {
  try {
    return await import('@ardrive/turbo-sdk');
  } catch (e) {
    throw new Error(`Install the SDK first: npm install @ardrive/turbo-sdk --no-save  (${e.message})`);
  }
}

// Returns the id of the layer-1 bundle that contains the data item, or null if not indexed yet (best effort).
async function bundleIdOf(itemId) {
  const query = `query { transaction(id: "${itemId}") { bundledIn { id } } }`;
  const res = await fetch('https://arweave.net/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(10000)
  });
  const j = await res.json();
  return j?.data?.transaction?.bundledIn?.id ?? null;
}

const arweave = makeClient();
const issuerKeys = await generateIssuerKeys();
const jwk = process.env.WALLET_PATH ? loadWallet() : null;
const address = jwk ? await arweave.wallets.jwkToAddress(jwk) : 'DRYRUN_NO_WALLET'.padEnd(43, 'x');
const doc = buildDidDocument({ walletAddress: address, publicKey: issuerKeys.publicKey, serviceEndpoint: 'https://wallet.example.org/vcs' });
const payload = JSON.stringify(doc);
const size = Buffer.byteLength(payload);

const { TurboFactory } = await loadTurbo();
let quotedWinc = 'unavailable';
try {
  const costs = await TurboFactory.unauthenticated().getUploadCosts({ bytes: [size] });
  quotedWinc = String(costs[0].winc);
} catch (e) {
  quotedWinc = `unavailable (${String(e.message).slice(0, 80)})`;
}
console.log(`DID document: ${size} bytes; Turbo quoted cost: ${quotedWinc} winc (0 = free tier)`);
console.log(`Gateways to poll: ${gateways.join(', ')}`);

if (!requireExecute(values, `Would upload did:arweave:${address} (${size} bytes) through Turbo and poll the gateways`)) process.exit(0);
if (!jwk) throw new Error('--execute needs WALLET_PATH');

const turbo = await TurboFactory.authenticated({ privateKey: jwk, token: 'arweave' });
const t0 = performance.now();
const result = await turbo.upload({
  data: payload,
  dataItemOpts: {
    tags: [
      { name: 'Content-Type', value: 'application/did+json' },
      { name: 'App-Name', value: 'arweave-idm' }
    ]
  }
});
const tUpload = performance.now() - t0;
const itemId = result.id;
console.log('Uploaded data item', itemId, `(${ms(tUpload)} ms)`);

// persist keys for later steps (secret key! file is git-ignored)
mkdirSync('results', { recursive: true });
writeFileSync('results/issuer-keys.json', JSON.stringify({
  did: doc.id, txId: itemId, publicKey: b64(issuerKeys.publicKey), secretKey: b64(issuerKeys.secretKey)
}, null, 2));

const marks = { fetchable: {}, bundled: null, bundleId: null, bundleConfirmed: null };
const deadline = performance.now() + Number(values['timeout-min']) * 60_000;
while (performance.now() < deadline && (gateways.some((g) => marks.fetchable[g] === undefined) || marks.bundleConfirmed === null)) {
  for (const g of gateways) {
    if (marks.fetchable[g] !== undefined) continue;
    try {
      const res = await fetch(`https://${g}/${itemId}`, { signal: AbortSignal.timeout(10000) });
      if (res.ok && JSON.parse(await res.text()).id === doc.id) marks.fetchable[g] = performance.now() - t0;
    } catch { /* not yet */ }
  }
  if (marks.bundleId === null) {
    try {
      const b = await bundleIdOf(itemId);
      if (b) { marks.bundleId = b; marks.bundled = performance.now() - t0; }
    } catch { /* graphql not ready */ }
  }
  if (marks.bundleId !== null && marks.bundleConfirmed === null) {
    const st = await arweave.transactions.getStatus(marks.bundleId).catch(() => null);
    if (st?.status === 200 && st.confirmed?.number_of_confirmations >= 1) marks.bundleConfirmed = performance.now() - t0;
  }
  console.log(`t=${((performance.now() - t0) / 1000).toFixed(0)}s served by: ${Object.keys(marks.fetchable).join(', ') || '-'}; bundle: ${marks.bundleId ?? '-'}; confirmed: ${marks.bundleConfirmed !== null}`);
  await sleep(Number(values['poll-s']) * 1000);
}

const row = {
  itemId, bytes: size, quotedWinc, upload_ms: ms(tUpload),
  bundled_ms: marks.bundled !== null ? ms(marks.bundled) : '', bundleId: marks.bundleId ?? '',
  bundle_confirmed_ms: marks.bundleConfirmed !== null ? ms(marks.bundleConfirmed) : '',
  ...Object.fromEntries(gateways.map((g) => [`fetchable_${g}_ms`, marks.fetchable[g] !== undefined ? ms(marks.fetchable[g]) : '']))
};
console.table([row]);
console.log('Saved:', writeResults('publish-did-turbo', [row], { gateways, path: 'turbo-ans104' }) + '.csv');
console.log(`\nNext: node scripts/mainnet/02-gateway-latency.js --tx ${itemId} --runs 30`);
console.log(`      node scripts/mainnet/05-e2e-verify.js --tx ${itemId} --runs 30`);
