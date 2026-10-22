// READ-ONLY. No wallet, no spending. Asks the Arweave network for the current price of
// storing the artifacts of this solution, in AR (and USD if you pass --ar-usd).
//   node scripts/mainnet/01-cost.js [--ar-usd 5.00] [--host arweave.net]
import { parseArgs } from 'node:util';
import { makeClient, winstonToAr } from '../../src/arweave.js';
import { generateIssuerKeys } from '../../src/bbs.js';
import { buildDidDocument } from '../../src/did.js';
import { StatusList } from '../../src/status.js';
import { writeResults } from '../../src/measure.js';

const { values } = parseArgs({ options: { 'ar-usd': { type: 'string' }, host: { type: 'string', default: 'arweave.net' } } });
const arweave = makeClient({ host: values.host });
const arUsd = values['ar-usd'] ? Number(values['ar-usd']) : null;

const keys = await generateIssuerKeys();
const didDoc = JSON.stringify(buildDidDocument({
  walletAddress: 'A'.repeat(43), publicKey: keys.publicKey, serviceEndpoint: 'https://wallet.example.org/vcs'
}));
const list = new StatusList();
const emptyList = JSON.stringify(list.toDocument({ id: 'urn:s:1', issuer: 'did:arweave:' + 'A'.repeat(43) }));
for (let i = 0; i < 131072; i += 97) list.set(i); // ~1% revoked: realistic worst case for compression
const busyList = JSON.stringify(list.toDocument({ id: 'urn:s:1', issuer: 'did:arweave:' + 'A'.repeat(43) }));

const artifacts = [
  ['DID document (issuer)', Buffer.byteLength(didDoc)],
  ['Status list, empty (gzip+b64)', Buffer.byteLength(emptyList)],
  ['Status list, ~1% revoked', Buffer.byteLength(busyList)],
  ['Reference: 1 KiB', 1024],
  ['Reference: 100 KiB', 100 * 1024],
  ['Reference: 1 MiB', 1024 * 1024]
];

const rows = [];
for (const [name, bytes] of artifacts) {
  const winston = await arweave.transactions.getPrice(bytes);
  const ar = winstonToAr(winston);
  rows.push({ artifact: name, bytes, winston, ar: +ar.toFixed(9), usd: arUsd ? +(ar * arUsd).toFixed(6) : '' });
}
console.table(rows);
console.log('Saved:', writeResults('cost', rows, { host: values.host, arUsd }) + '.csv');
