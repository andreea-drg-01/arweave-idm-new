import Arweave from 'arweave';

export function makeClient({ host = 'arweave.net', port = 443, protocol = 'https' } = {}) {
  return Arweave.init({ host, port, protocol });
}

/** Store a JSON document as a permanent Arweave transaction. Returns { id, bytes, reward }. */
export async function publishJson(arweave, jwk, obj, { contentType = 'application/json', tags = {} } = {}) {
  const data = JSON.stringify(obj);
  const tx = await arweave.createTransaction({ data }, jwk);
  tx.addTag('Content-Type', contentType);
  tx.addTag('App-Name', 'arweave-idm');
  for (const [k, v] of Object.entries(tags)) tx.addTag(k, v);
  await arweave.transactions.sign(tx, jwk);
  const res = await arweave.transactions.post(tx);
  if (res.status !== 200) throw new Error(`Upload failed: HTTP ${res.status} ${res.statusText ?? ''}`);
  return { id: tx.id, bytes: Number(tx.data_size), rewardWinston: tx.reward };
}

export async function fetchJsonByTxId(arweave, txId) {
  const text = await arweave.transactions.getData(txId, { decode: true, string: true });
  return JSON.parse(text);
}

/** AR has 12 decimals; Number precision is sufficient for reporting small fees. */
export const winstonToAr = (w) => Number(BigInt(w)) / 1e12;
