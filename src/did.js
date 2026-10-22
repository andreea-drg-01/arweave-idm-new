import bs58 from 'bs58';

// multicodec varint for bls12_381-g2-pub (0xeb) is 0xeb 0x01
const BLS12381_G2_PUB_PREFIX = Uint8Array.of(0xeb, 0x01);

export function publicKeyToMultibase(publicKey) {
  const out = new Uint8Array(BLS12381_G2_PUB_PREFIX.length + publicKey.length);
  out.set(BLS12381_G2_PUB_PREFIX, 0);
  out.set(publicKey, BLS12381_G2_PUB_PREFIX.length);
  return 'z' + bs58.encode(out);
}

export function multibaseToPublicKey(mb) {
  if (!mb.startsWith('z')) throw new Error('Expected base58btc multibase (z...)');
  const raw = bs58.decode(mb.slice(1));
  if (raw[0] !== BLS12381_G2_PUB_PREFIX[0] || raw[1] !== BLS12381_G2_PUB_PREFIX[1]) {
    throw new Error('Not a BLS12-381 G2 multikey');
  }
  return raw.slice(2);
}

/**
 * DID document for an ISSUER. Contains only public data (public key + optional service).
 * The DID is derived from the controller's Arweave wallet address because the
 * document's transaction id is unknown before it is stored (see docs/did-arweave-spec.md).
 */
export function buildDidDocument({ walletAddress, publicKey, serviceEndpoint }) {
  const did = `did:arweave:${walletAddress}`;
  const keyId = `${did}#keys-1`;
  const doc = {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    id: did,
    verificationMethod: [
      { id: keyId, type: 'Multikey', controller: did, publicKeyMultibase: publicKeyToMultibase(publicKey) }
    ],
    assertionMethod: [keyId]
  };
  if (serviceEndpoint) {
    doc.service = [{ id: `${did}#vcs`, type: 'VerifiableCredentialService', serviceEndpoint }];
  }
  return doc;
}

/** Extract the BBS public key used for assertions; checks it is listed in assertionMethod. */
export function issuerKeyFromDoc(doc, keyId) {
  const id = keyId ?? doc.assertionMethod?.[0];
  if (!id || !doc.assertionMethod?.includes(id)) throw new Error('Key is not an assertionMethod');
  const vm = doc.verificationMethod?.find((v) => v.id === id);
  if (!vm) throw new Error(`verificationMethod ${id} not found`);
  return multibaseToPublicKey(vm.publicKeyMultibase);
}
