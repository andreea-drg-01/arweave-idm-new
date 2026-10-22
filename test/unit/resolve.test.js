import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuorum, verifyViaArweave } from '../../src/resolve.js';
import { generateIssuerKeys } from '../../src/bbs.js';
import { buildDidDocument } from '../../src/did.js';
import { issueCredential, createPresentation } from '../../src/credential.js';

// Fake gateways: map url -> body (string) or Error
const stubFetch = (table) => async (url) => {
  const v = table[url];
  if (v === undefined || v instanceof Error) {
    if (v instanceof Error) throw v;
    return { ok: false, status: 404, text: async () => '' };
  }
  return { ok: true, status: 200, text: async () => v };
};

test('quorum: 2 of 3 agree, malicious gateway is outvoted', async () => {
  const urls = ['https://a/x', 'https://b/x', 'https://c/x'];
  const r = await resolveQuorum({
    urls, minAgree: 2,
    fetchImpl: stubFetch({ 'https://a/x': '{"v":1}', 'https://b/x': '{"v": 1}', 'https://c/x': '{"v":2}' })
  });
  assert.deepEqual(r.doc, { v: 1 });
  assert.deepEqual(r.disagreeing, ['https://c/x']);
});

test('quorum: fails when gateways disagree or are down', async () => {
  const urls = ['https://a/x', 'https://b/x', 'https://c/x'];
  await assert.rejects(resolveQuorum({
    urls, minAgree: 2,
    fetchImpl: stubFetch({ 'https://a/x': '{"v":1}', 'https://b/x': '{"v":2}', 'https://c/x': new Error('down') })
  }), /No quorum/);
});

test('verifyViaArweave: end-to-end with stub gateways; rejects substituted DID document', async () => {
  const keys = await generateIssuerKeys();
  const issuerDid = 'did:arweave:WALLET';
  const doc = buildDidDocument({ walletAddress: 'WALLET', publicKey: keys.publicKey });
  const credential = await issueCredential({
    issuerDid, issuerKeys: keys, subject: { id: 'did:key:z1', name: 'Alice', age: '25' }, credentialId: 'urn:uuid:1'
  });
  const presentation = await createPresentation({ credential, issuerPublicKey: keys.publicKey, revealKeys: ['age'], nonce: 'N' });
  const gateways = ['g1', 'g2', 'g3'];
  const target = { arnsName: 'issuer' };
  const good = Object.fromEntries(gateways.map((g) => [`https://issuer.${g}`, JSON.stringify(doc)]));

  const ok = await verifyViaArweave({ presentation, nonce: 'N', target, gateways, fetchImpl: stubFetch(good) });
  assert.equal(ok.verified, true);

  // attacker controls ALL gateways and serves a document with their own key -> proof must fail
  const attacker = await generateIssuerKeys();
  const evilDoc = buildDidDocument({ walletAddress: 'WALLET', publicKey: attacker.publicKey });
  const evil = Object.fromEntries(gateways.map((g) => [`https://issuer.${g}`, JSON.stringify(evilDoc)]));
  const bad = await verifyViaArweave({ presentation, nonce: 'N', target, gateways, fetchImpl: stubFetch(evil) });
  assert.equal(bad.verified, false);

  // document for a different DID -> explicit mismatch error
  const otherDoc = buildDidDocument({ walletAddress: 'OTHER', publicKey: keys.publicKey });
  const other = Object.fromEntries(gateways.map((g) => [`https://issuer.${g}`, JSON.stringify(otherDoc)]));
  await assert.rejects(verifyViaArweave({ presentation, nonce: 'N', target, gateways, fetchImpl: stubFetch(other) }), /DID mismatch/);
});
