import { ANT } from '@ar.io/sdk';

/**
 * Point an ArNS base name (the "@" record of its ANT) at a new transaction id.
 *
 * IMPORTANT - verify before mainnet use: `setRecord` is deprecated in the current
 * @ar.io/sdk docs in favour of `setBaseNameRecord` / `setUndernameRecord`, and the ar.io
 * docs now describe Solana-based wallets/ANTs for some flows. `signer` is therefore passed
 * in by the caller: build it according to docs.ar.io for the network you target
 * (e.g. `new ArweaveSigner(jwk)` for legacy AO-based ANTs).
 */
export async function setBaseNameRecord({ processId, signer, txId, ttlSeconds = 900 }) {
  const ant = ANT.init({ processId, signer });
  if (typeof ant.setBaseNameRecord === 'function') {
    return ant.setBaseNameRecord({ transactionId: txId, ttlSeconds });
  }
  return ant.setRecord({ undername: '@', transactionId: txId, ttlSeconds }); // older SDKs
}
