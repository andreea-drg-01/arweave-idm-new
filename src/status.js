import { gzipSync, gunzipSync } from 'node:zlib';

/**
 * Minimal bitstring status list (revocation), modelled on the W3C Bitstring Status List.
 * The list is published on Arweave and referenced through ArNS; a verifier checks one bit.
 * Default size is 131072 bits (16 KiB raw), the W3C-recommended minimum for herd privacy.
 *
 * CAVEAT: a BBS presentation hides the credential, so to check the bit the holder must
 * additionally prove which index it occupies without revealing it (not implemented here).
 * This module provides the data structure and lets us MEASURE its size and cost.
 */
export class StatusList {
  constructor(sizeBits = 131072, bytes) {
    this.sizeBits = sizeBits;
    this.bytes = bytes ?? new Uint8Array(Math.ceil(sizeBits / 8));
  }
  #check(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.sizeBits) throw new RangeError(`index ${i} out of range`);
  }
  set(i, value = true) {
    this.#check(i);
    if (value) this.bytes[i >> 3] |= 0x80 >> (i & 7);
    else this.bytes[i >> 3] &= ~(0x80 >> (i & 7));
  }
  get(i) {
    this.#check(i);
    return (this.bytes[i >> 3] & (0x80 >> (i & 7))) !== 0;
  }
  encode() {
    return gzipSync(Buffer.from(this.bytes)).toString('base64');
  }
  static decode(encoded, sizeBits = 131072) {
    return new StatusList(sizeBits, new Uint8Array(gunzipSync(Buffer.from(encoded, 'base64'))));
  }
  toDocument({ id, issuer, purpose = 'revocation' }) {
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential', 'BitstringStatusListCredential'],
      id,
      issuer,
      credentialSubject: { type: 'BitstringStatusList', statusPurpose: purpose, encodedList: this.encode() }
    };
  }
}
