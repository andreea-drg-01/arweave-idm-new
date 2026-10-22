// Publishes ONE issuer DID document to Arweave mainnet and measures confirmation timing.
// SPENDS AR (a few cents at most for ~1 KB). Dry-run by default.
//   WALLET_PATH=./wallet.json node scripts/mainnet/03-publish-did.js [--execute] [--timeout-min 40]
// Also writes results/issuer-keys.json (BBS secret key, git-ignored) for scripts/mainnet/05-e2e-verify.js.
import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { requireExecute, loadWallet, gatewaysFrom, ms } from './_common.js';
import { makeClient, publishJson, winstonToAr } from '../../src/arweave.js';
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
const gateways = gatewaysFrom(values.gateways);
const arweave = makeClient();

const issuerKeys = await generateIssuerKeys();
const jwk = process.env.WALLET_PATH ? loadWallet() : null;
const address = jwk ? await arweave.wallets.jwkToAddress(jwk) : 'DRYRUN_NO_WALLET'.padEnd(43, 'x');
const doc = buildDidDocument({ walletAddress: address, publicKey: issuerKeys.publicKey, serviceEndpoint: 'https://wallet.example.org/vcs' });
const size = Buffer.byteLength(JSON.stringify(doc));
const price = await arweave.transactions.getPrice(size);
console.log(`DID document: ${size} bytes; price ${winstonToAr(price)} AR (${price} winston)`);
if (jwk) console.log('Wallet balance (AR):', arweave.ar.winstonToAr(await arweave.wallets.getBalance(address)));

if (!requireExecute(values, `Would publish did:arweave:${address} (${size} bytes) and poll ${gateways.join(', ')}`)) process.exit(0);
if (!jwk) throw new Error('--execute needs WALLET_PATH');

const t0 = performance.now();
const { id: txId, rewardWinston } = await publishJson(arweave, jwk, doc, { contentType: 'application/did+json' });
const tPost = performance.now() - t0;
console.log('Posted tx', txId, `(${ms(tPost)} ms)`);

// persist keys for later steps (secret key! file is git-ignored)
mkdirSync('results', { recursive: true });
writeFileSync('results/issuer-keys.json', JSON.stringify({
  did: doc.id, txId, publicKey: b64(issuerKeys.publicKey), secretKey: b64(issuerKeys.secretKey)
}, null, 2));

const deadline = performance.now() + Number(values['timeout-min']) * 60_000;
const marks = { seenPending: null, confirmed1: null, fetchable: {} };
while (performance.now() < deadline && (marks.confirmed1 === null || gateways.some((g) => marks.fetchable[g] === undefined))) {
  const elapsed = performance.now() - t0;
  const st = await arweave.transactions.getStatus(txId).catch(() => null);
  if (st && marks.seenPending === null && (st.status === 200 || st.status === 202)) marks.seenPending = elapsed;
  if (st?.status === 200 && st.confirmed?.number_of_confirmations >= 1 && marks.confirmed1 === null) marks.confirmed1 = elapsed;
  for (const g of gateways) {
    if (marks.fetchable[g] !== undefined) continue;
    try {
      const res = await fetch(`https://${g}/${txId}`, { signal: AbortSignal.timeout(10000) });
      if (res.ok && JSON.parse(await res.text()).id === doc.id) marks.fetchable[g] = performance.now() - t0;
    } catch { /* not yet */ }
  }
  console.log(`t=${(elapsed / 1000).toFixed(0)}s status=${st?.status} conf=${st?.confirmed?.number_of_confirmations ?? '-'}`);
  await sleep(Number(values['poll-s']) * 1000);
}

const row = {
  txId, bytes: size, rewardAR: winstonToAr(rewardWinston), post_ms: ms(tPost),
  first_seen_ms: marks.seenPending && ms(marks.seenPending),
  first_confirmation_ms: marks.confirmed1 && ms(marks.confirmed1),
  ...Object.fromEntries(gateways.map((g) => [`fetchable_${g}_ms`, marks.fetchable[g] !== undefined ? ms(marks.fetchable[g]) : '']))
};
console.table([row]);
console.log('Saved:', writeResults('publish-did', [row], { gateways }) + '.csv');
console.log('\nNext: map an ArNS name to this txId (04-arns-update.js), then run 05-e2e-verify.js.');
