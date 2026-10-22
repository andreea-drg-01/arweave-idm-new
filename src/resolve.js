import { createHash } from 'node:crypto';
import { issuerKeyFromDoc } from './did.js';
import { verifyPresentation } from './credential.js';

export const dataUrl = (gateway, txId) => `https://${gateway}/${txId}`;
export const arnsUrl = (gateway, name) => `https://${name}.${gateway}`;

export async function fetchText(url, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Query several gateways and require `minAgree` of them to return the same document.
 * Mitigates a single malicious/stale gateway (the paper's code trusted one gateway).
 */
export async function resolveQuorum({ urls, minAgree = 2, timeoutMs = 10000, fetchImpl = fetch }) {
  const settled = await Promise.allSettled(urls.map((u) => fetchText(u, { timeoutMs, fetchImpl })));
  const groups = new Map();
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      errors.push({ url: urls[i], error: String(r.reason?.message ?? r.reason) });
      return;
    }
    let canon;
    try {
      canon = JSON.stringify(JSON.parse(r.value));
    } catch {
      errors.push({ url: urls[i], error: 'invalid JSON' });
      return;
    }
    const hash = createHash('sha256').update(canon).digest('hex');
    const g = groups.get(hash) ?? { canon, urls: [] };
    g.urls.push(urls[i]);
    groups.set(hash, g);
  });
  let best = null;
  for (const [hash, g] of groups) if (!best || g.urls.length > best.urls.length) best = { hash, ...g };
  if (!best || best.urls.length < minAgree) {
    throw new Error(`No quorum (need ${minAgree}); groups=${groups.size}; errors=${JSON.stringify(errors)}`);
  }
  return {
    doc: JSON.parse(best.canon),
    hash: best.hash,
    agreeing: best.urls,
    disagreeing: [...groups.values()].flatMap((g) => g.urls).filter((u) => !best.urls.includes(u)),
    errors
  };
}

/**
 * Full verifier read path: resolve issuer DID document (ArNS name or tx id) through a
 * gateway quorum, bind it to presentation.issuer, extract the key, verify the proof.
 * `target` is { arnsName } or { txId }. Returns { verified, timingsMs, resolution }.
 */
export async function verifyViaArweave({ presentation, nonce, target, gateways, minAgree = 2, fetchImpl = fetch }) {
  const t0 = performance.now();
  const urls = gateways.map((g) => (target.arnsName ? arnsUrl(g, target.arnsName) : dataUrl(g, target.txId)));
  const resolution = await resolveQuorum({ urls, minAgree, fetchImpl });
  const t1 = performance.now();

  const doc = resolution.doc;
  if (doc.id !== presentation.issuer) throw new Error(`DID mismatch: document ${doc.id} vs presentation ${presentation.issuer}`);
  const issuerPublicKey = issuerKeyFromDoc(doc);
  const verified = await verifyPresentation({ presentation, issuerPublicKey, nonce });
  const t2 = performance.now();
  return { verified, timingsMs: { resolve: t1 - t0, verify: t2 - t1, total: t2 - t0 }, resolution };
}
