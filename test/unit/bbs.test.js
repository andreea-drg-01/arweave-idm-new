import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIssuerKeys } from '../../src/bbs.js';
import { issueCredential, createPresentation, verifyPresentation } from '../../src/credential.js';

const issuerDid = 'did:arweave:TEST_WALLET_ADDRESS';
const subject = { id: 'did:key:z6MkAliceEphemeral', name: 'Alice', age: '25' };

async function setup() {
  const issuerKeys = await generateIssuerKeys();
  const credential = await issueCredential({ issuerDid, issuerKeys, subject, credentialId: 'urn:uuid:1' });
  return { issuerKeys, credential };
}

test('selective disclosure: reveal only age, verifier accepts', async () => {
  const { issuerKeys, credential } = await setup();
  const presentation = await createPresentation({
    credential, issuerPublicKey: issuerKeys.publicKey, revealKeys: ['age'], nonce: 'n-1'
  });
  assert.deepEqual(presentation.revealed, { age: '25' });
  assert.equal(presentation.revealed.name, undefined);
  assert.equal(await verifyPresentation({ presentation, issuerPublicKey: issuerKeys.publicKey, nonce: 'n-1' }), true);
});

test('reveal multiple attributes', async () => {
  const { issuerKeys, credential } = await setup();
  const presentation = await createPresentation({
    credential, issuerPublicKey: issuerKeys.publicKey, revealKeys: ['name', 'age'], nonce: 'n-2'
  });
  assert.equal(await verifyPresentation({ presentation, issuerPublicKey: issuerKeys.publicKey, nonce: 'n-2' }), true);
});

test('negative: wrong nonce (replay) is rejected', async () => {
  const { issuerKeys, credential } = await setup();
  const presentation = await createPresentation({
    credential, issuerPublicKey: issuerKeys.publicKey, revealKeys: ['age'], nonce: 'n-3'
  });
  assert.equal(await verifyPresentation({ presentation, issuerPublicKey: issuerKeys.publicKey, nonce: 'other' }), false);
});

test('negative: tampered revealed value is rejected', async () => {
  const { issuerKeys, credential } = await setup();
  const presentation = await createPresentation({
    credential, issuerPublicKey: issuerKeys.publicKey, revealKeys: ['age'], nonce: 'n-4'
  });
  presentation.revealed.age = '99';
  assert.equal(await verifyPresentation({ presentation, issuerPublicKey: issuerKeys.publicKey, nonce: 'n-4' }), false);
});

test('negative: different issuer key is rejected (replaced DID document)', async () => {
  const { issuerKeys, credential } = await setup();
  const attacker = await generateIssuerKeys();
  const presentation = await createPresentation({
    credential, issuerPublicKey: issuerKeys.publicKey, revealKeys: ['age'], nonce: 'n-5'
  });
  assert.equal(await verifyPresentation({ presentation, issuerPublicKey: attacker.publicKey, nonce: 'n-5' }), false);
});

test('negative: forged issuer field in presentation is rejected', async () => {
  const { issuerKeys, credential } = await setup();
  const presentation = await createPresentation({
    credential, issuerPublicKey: issuerKeys.publicKey, revealKeys: ['age'], nonce: 'n-6'
  });
  presentation.issuer = 'did:arweave:SOMEONE_ELSE';
  assert.equal(await verifyPresentation({ presentation, issuerPublicKey: issuerKeys.publicKey, nonce: 'n-6' }), false);
});

test('unlinkability smoke test: two presentations of one credential share no proof bytes', async () => {
  const { issuerKeys, credential } = await setup();
  const mk = (nonce) => createPresentation({ credential, issuerPublicKey: issuerKeys.publicKey, revealKeys: ['age'], nonce });
  const [a, b] = await Promise.all([mk('x'), mk('x')]);
  assert.notEqual(a.proofValue, b.proofValue); // proofs are randomized
});

test('unknown attribute name throws', async () => {
  const { issuerKeys, credential } = await setup();
  await assert.rejects(createPresentation({
    credential, issuerPublicKey: issuerKeys.publicKey, revealKeys: ['ssn'], nonce: 'n'
  }));
});
