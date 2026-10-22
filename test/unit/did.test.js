import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIssuerKeys } from '../../src/bbs.js';
import { buildDidDocument, issuerKeyFromDoc, publicKeyToMultibase, multibaseToPublicKey } from '../../src/did.js';

test('multibase round-trip of a BLS12-381 G2 public key', async () => {
  const { publicKey } = await generateIssuerKeys();
  assert.equal(publicKey.length, 96);
  const mb = publicKeyToMultibase(publicKey);
  assert.ok(mb.startsWith('z'));
  assert.deepEqual(multibaseToPublicKey(mb), publicKey);
});

test('DID document contains only public data and the key can be recovered', async () => {
  const { publicKey } = await generateIssuerKeys();
  const doc = buildDidDocument({ walletAddress: 'ABC123', publicKey, serviceEndpoint: 'https://example.org/vcs' });
  assert.equal(doc.id, 'did:arweave:ABC123');
  assert.deepEqual(issuerKeyFromDoc(doc), publicKey);
  assert.equal(JSON.stringify(doc).includes('secretKey'), false);
});

test('key not listed in assertionMethod is refused', async () => {
  const { publicKey } = await generateIssuerKeys();
  const doc = buildDidDocument({ walletAddress: 'ABC123', publicKey });
  doc.assertionMethod = [];
  assert.throws(() => issuerKeyFromDoc(doc));
});

test('non-BLS multikey is refused', () => {
  assert.throws(() => multibaseToPublicKey('z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK')); // ed25519 multikey
});
