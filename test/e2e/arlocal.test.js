// End-to-end test against ArLocal (a local Arweave gateway-like server).
// ArLocal has NO ArNS / AR.IO gateway layer, so ArNS is stood in for by a Map
// (name -> txId). Real ArNS behaviour is measured with scripts/mainnet/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, publishJson, fetchJsonByTxId } from '../../src/arweave.js';
import { generateIssuerKeys } from '../../src/bbs.js';
import { buildDidDocument, issuerKeyFromDoc } from '../../src/did.js';
import { issueCredential, createPresentation, verifyPresentation } from '../../src/credential.js';
import { StatusList } from '../../src/status.js';

const PORT = 1985;
let arLocal;
let arweave;
let jwk;
let address;
const arns = new Map(); // stand-in for ArNS: name -> txId (mutable pointer, like setRecord)

const mine = () => arweave.api.get('mine');

before(async () => {
  const mod = await import('arlocal');
  const ArLocal = mod.default?.default ?? mod.default ?? mod.ArLocal;
  arLocal = new ArLocal(PORT, false, '.db-test', false);
  await arLocal.start();
  arweave = makeClient({ host: 'localhost', port: PORT, protocol: 'http' });
  jwk = await arweave.wallets.generate();
  address = await arweave.wallets.jwkToAddress(jwk);
  await arweave.api.get(`mint/${address}/100000000000000`);
});

after(async () => {
  await arLocal?.stop();
});

test('publish issuer DID document, resolve via (simulated) ArNS, verify a presentation', async () => {
  const issuerKeys = await generateIssuerKeys();
  const doc = buildDidDocument({ walletAddress: address, publicKey: issuerKeys.publicKey });
  const { id: txId, bytes } = await publishJson(arweave, jwk, doc, { contentType: 'application/did+json' });
  await mine();
  arns.set('issuer', txId);
  assert.ok(bytes > 0);

  const credential = await issueCredential({
    issuerDid: doc.id, issuerKeys, subject: { id: 'did:key:zHolder', name: 'Alice', age: '25' }, credentialId: 'urn:uuid:42'
  });
  const presentation = await createPresentation({
    credential, issuerPublicKey: issuerKeys.publicKey, revealKeys: ['age'], nonce: 'verifier-nonce'
  });

  // Verifier: resolve name -> tx -> document -> key
  const fetched = await fetchJsonByTxId(arweave, arns.get('issuer'));
  assert.deepEqual(fetched, doc);
  const ok = await verifyPresentation({
    presentation, issuerPublicKey: issuerKeyFromDoc(fetched), nonce: 'verifier-nonce'
  });
  assert.equal(ok, true);
});

test('key rotation: update = new tx + pointer change; old version stays retrievable', async () => {
  const oldKeys = await generateIssuerKeys();
  const newKeys = await generateIssuerKeys();
  const v1 = await publishJson(arweave, jwk, buildDidDocument({ walletAddress: address, publicKey: oldKeys.publicKey }));
  await mine();
  arns.set('rotating', v1.id);

  const issuerDid = `did:arweave:${address}`;
  const credOld = await issueCredential({
    issuerDid, issuerKeys: oldKeys, subject: { id: 'did:key:z1', name: 'Bob', age: '30' }, credentialId: 'urn:uuid:7'
  });
  const presOld = await createPresentation({ credential: credOld, issuerPublicKey: oldKeys.publicKey, revealKeys: ['age'], nonce: 'n' });

  // rotate
  const v2 = await publishJson(arweave, jwk, buildDidDocument({ walletAddress: address, publicKey: newKeys.publicKey }));
  await mine();
  arns.set('rotating', v2.id);
  assert.notEqual(v1.id, v2.id);

  // old tx is immutable and still retrievable by id...
  const oldDoc = await fetchJsonByTxId(arweave, v1.id);
  assert.deepEqual(issuerKeyFromDoc(oldDoc), oldKeys.publicKey);
  // ...but resolution returns the current key, so credentials signed with the old key no longer verify
  const current = await fetchJsonByTxId(arweave, arns.get('rotating'));
  assert.equal(await verifyPresentation({ presentation: presOld, issuerPublicKey: issuerKeyFromDoc(current), nonce: 'n' }), false);
});

test('status list can be published and read back', async () => {
  const list = new StatusList();
  list.set(1234);
  const { id } = await publishJson(arweave, jwk, list.toDocument({ id: 'urn:status:1', issuer: `did:arweave:${address}` }));
  await mine();
  const back = await fetchJsonByTxId(arweave, id);
  const decoded = StatusList.decode(back.credentialSubject.encodedList);
  assert.equal(decoded.get(1234), true);
  assert.equal(decoded.get(1235), false);
});
