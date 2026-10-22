// READ-ONLY on the network. Full verifier path on mainnet, repeated N times, with a per-step breakdown:
//   issue (local) -> derive proof (local) -> resolve issuer DID via gateway quorum -> verify.
// Needs results/issuer-keys.json written by 03-publish-did.js, and either --name (ArNS) or --tx.
//   node scripts/mainnet/05-e2e-verify.js --name myissuer [--runs 30] [--min-agree 2] [--gateways a,b,c]
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { gatewaysFrom, ms } from './_common.js';
import { fromB64 } from '../../src/bbs.js';
import { issueCredential, createPresentation } from '../../src/credential.js';
import { verifyViaArweave } from '../../src/resolve.js';
import { summarize, writeResults } from '../../src/measure.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string' }, tx: { type: 'string' }, runs: { type: 'string', default: '30' },
    'min-agree': { type: 'string', default: '2' }, gateways: { type: 'string' }, keys: { type: 'string', default: 'results/issuer-keys.json' }
  }
});
const gateways = gatewaysFrom(values.gateways);
const k = JSON.parse(readFileSync(values.keys, 'utf8'));
const target = values.name ? { arnsName: values.name } : { txId: values.tx ?? k.txId };
const issuerKeys = { publicKey: fromB64(k.publicKey), secretKey: fromB64(k.secretKey) };

const credential = await issueCredential({
  issuerDid: k.did, issuerKeys, subject: { id: 'did:key:zEphemeralHolder', name: 'Alice', age: '25' }, credentialId: 'urn:uuid:mainnet-test'
});

const rows = [];
for (let i = 0; i < Number(values.runs); i++) {
  const nonce = `nonce-${i}-${Date.now()}`;
  const tp0 = performance.now();
  const presentation = await createPresentation({ credential, issuerPublicKey: issuerKeys.publicKey, revealKeys: ['age'], nonce });
  const prove = performance.now() - tp0;
  try {
    const r = await verifyViaArweave({ presentation, nonce, target, gateways, minAgree: Number(values['min-agree']) });
    rows.push({ run: i + 1, ok: r.verified, prove_ms: ms(prove), resolve_ms: ms(r.timingsMs.resolve), verify_ms: ms(r.timingsMs.verify), total_ms: ms(r.timingsMs.total), agreeing: r.resolution.agreeing.length });
  } catch (e) {
    rows.push({ run: i + 1, ok: false, prove_ms: ms(prove), error: String(e.message).slice(0, 200) });
  }
}
const okRows = rows.filter((r) => r.ok);
const sum = (f) => (okRows.length ? { median: ms(summarize(okRows.map((r) => r[f])).median), p95: ms(summarize(okRows.map((r) => r[f])).p95) } : {});
console.table({ prove_ms: sum('prove_ms'), resolve_ms: sum('resolve_ms'), verify_ms: sum('verify_ms'), total_ms: sum('total_ms') });
console.log(`${okRows.length}/${rows.length} successful. Saved:`, writeResults('e2e-verify', rows, { gateways, target }) + '.csv');
