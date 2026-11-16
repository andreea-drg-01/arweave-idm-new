import { toBytes, b64, fromB64, sign, deriveProof, verifyProof } from './bbs.js';

// One BBS message per attribute. The order fixes the indexes used for selective disclosure.
export const DEFAULT_SCHEMA = ['id', 'name', 'age'];

const messageFor = (key, value) => toBytes(`${key}:${value}`);
export const subjectToMessages = (subject, schema = DEFAULT_SCHEMA) =>
  schema.map((k) => messageFor(k, subject[k]));

// The BBS "header" is revealed to the verifier, so it must NOT contain per-credential
// identifiers (that would link presentations). Only issuer + schema are bound.
export const headerFor = (issuerDid, schema = DEFAULT_SCHEMA) => toBytes(`${issuerDid}|${schema.join(',')}`);

/**
 * NOTE: this signs raw attribute messages with BBS. It is NOT the W3C `bbs-2023`
 * Data Integrity cryptosuite (which canonicalizes RDF). See README "Limitations".
 */
export async function issueCredential({ issuerDid, issuerKeys, subject, schema = DEFAULT_SCHEMA, credentialId }) {
  const signature = await sign({
    keys: issuerKeys,
    header: headerFor(issuerDid, schema),
    messages: subjectToMessages(subject, schema)
  });
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential'],
    id: credentialId,
    issuer: issuerDid,
    credentialSubject: subject,
    proof: {
      type: 'BbsAttributeSignature',
      created: new Date().toISOString(),
      verificationMethod: `${issuerDid}#keys-1`,
      proofPurpose: 'assertionMethod',
      schema,
      proofValue: b64(signature)
    }
  };
}

/** Holder side: derive a zero-knowledge presentation revealing only `revealKeys`. */
export async function createPresentation({ credential, issuerPublicKey, revealKeys, nonce }) {
  const schema = credential.proof.schema;
  const indexes = revealKeys.map((k) => {
    const i = schema.indexOf(k);
    if (i < 0) throw new Error(`Unknown attribute: ${k}`);
    return i;
  }).sort((a, b) => a - b);

  const proof = await deriveProof({
    publicKey: issuerPublicKey,
    signature: fromB64(credential.proof.proofValue),
    header: headerFor(credential.issuer, schema),
    messages: subjectToMessages(credential.credentialSubject, schema),
    presentationHeader: toBytes(nonce),
    disclosedMessageIndexes: indexes
  });

  const revealed = {};
  for (const i of indexes) revealed[schema[i]] = credential.credentialSubject[schema[i]];
  return {
    type: 'BbsAttributePresentation',
    issuer: credential.issuer,
    schema,
    revealedIndexes: indexes,
    revealed,
    proofValue: b64(proof)
  };
}

/** Verifier side. `nonce` MUST be the one the verifier sent for this request. */
export async function verifyPresentation({ presentation, issuerPublicKey, nonce }) {
  const { schema, revealedIndexes, revealed } = presentation;
  const messages = revealedIndexes.map((i) => messageFor(schema[i], revealed[schema[i]]));
  try {
    const result = await verifyProof({
      publicKey: issuerPublicKey,
      proof: fromB64(presentation.proofValue),
      header: headerFor(presentation.issuer, schema),
      presentationHeader: toBytes(nonce),
      messages,
      disclosedMessageIndexes: revealedIndexes
    });
    return result === true || result?.verified === true;
  } catch (e) {
    console.error('verifyProof error:', e);
    return false;
  }
}
