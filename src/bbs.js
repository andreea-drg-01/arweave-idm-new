// Thin wrapper over @digitalbazaar/bbs-signatures (IETF CFRG BBS draft implementation).
// Replaces the legacy @mattrglobal/bbs-signatures (Ursa-based BBS+, pre-standard).
import * as bbs from '@digitalbazaar/bbs-signatures';

export const CIPHERSUITE = bbs.CIPHERSUITES?.BLS12381_SHA256 ?? 'BLS12-381-SHA-256';

const enc = new TextEncoder();
export const toBytes = (s) => enc.encode(s);
export const b64 = (u8) => Buffer.from(u8).toString('base64');
export const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

/** Only the ISSUER needs a BBS key pair. Holders and verifiers do not. */
export async function generateIssuerKeys() {
  return bbs.generateKeyPair({ ciphersuite: CIPHERSUITE }); // { secretKey, publicKey }
}

export async function sign({ keys, header, messages }) {
  return bbs.sign({
    secretKey: keys.secretKey,
    publicKey: keys.publicKey,
    header,
    messages,
    ciphersuite: CIPHERSUITE
  });
}

export async function deriveProof({ publicKey, signature, header, messages, presentationHeader, disclosedMessageIndexes }) {
  return bbs.deriveProof({
    publicKey,
    signature,
    header,
    messages,
    presentationHeader,
    disclosedMessageIndexes,
    ciphersuite: CIPHERSUITE
  });
}

/** `messages` must contain ONLY the disclosed messages, in index order. */
export async function verifyProof({ publicKey, proof, header, presentationHeader, messages, disclosedMessageIndexes }) {
  return bbs.verifyProof({
    publicKey,
    proof,
    header,
    presentationHeader,
    disclosedMessages: messages,
    disclosedMessageIndexes,
    ciphersuite: CIPHERSUITE
  }); // { verified: boolean, error? }
}
