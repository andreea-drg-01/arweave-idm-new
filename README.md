# arweave-idm

Research prototype accompanying *"Towards an Identity Management Solution on Arweave"*
(Dragnoiu & Olimid). It implements the paper's three-phase flow with an up-to-date BBS library
and adds tests and measurement tooling.

| Phase | What | Where |
|---|---|---|
| 1 Setup | Issuer BBS key pair, DID document, store on Arweave, ArNS mapping | `src/bbs.js`, `src/did.js`, `src/arweave.js`, `src/arns.js` |
| 2 Credentials | BBS-signed attribute credential, zero-knowledge selective disclosure | `src/credential.js` |
| 3 Verification | ArNS → gateway **quorum** → DID doc → key → proof check | `src/resolve.js` |
| Extra | Revocation status list (bitstring) | `src/status.js` |

## Status

| Component | State |
|---|---|
| Unit tests (BBS, DID document, status list, gateway quorum) | 18/18 pass (Node v24.22.1, Windows 11) |
| End-to-end test on ArLocal (`npm run test:e2e`) | **fails** on Node v24.22.1 / Windows 11 (x64): ArLocal cannot start, its native `sqlite3` binding is missing (`Could not locate the bindings file`); not resolved, see point 4 |
| Cryptographic benchmark | done; results in `results/published/`, figures in `figures/` |
| Mainnet scripts (`scripts/mainnet/`) | written, **not yet run** |

Known points:
1. `@digitalbazaar/bbs-signatures` **3.1.0** uses `disclosedMessages` (not `messages`) in `verifyProof`; this is handled in `src/bbs.js`, the single place to adapt to library changes.
2. **ArNS signer.** The ar.io docs now describe Solana-based wallets/ANTs for some flows and mark `setRecord` as deprecated. `scripts/mainnet/04-arns-update.js` uses the legacy `ArweaveSigner(jwk)` and must be adapted to the network/ANT you actually own. `src/arns.js` already prefers `setBaseNameRecord`.
3. `@ar.io/sdk` is **not** listed in `package.json`: it pulls a dependency from a git URL (`avsc`) that npm may refuse (`EALLOWGIT`). It is only needed by `scripts/mainnet/04-arns-update.js` and `src/arns.js`; install it separately if you use ArNS (`npm install @ar.io/sdk --allow-git=all`, after reviewing what it fetches).
4. `arlocal` has the same git-dependency issue (`npm install -D arlocal --allow-git=all`). After installing it, all three e2e tests fail at start-up with
   `Error: Knex: run $ npm install sqlite3 --save  Could not locate the bindings file` (Node v24.22.1, Windows 11 x64, bindings searched under `node_modules\sqlite3\...`, including `lib\binding\node-v137-win32-x64`).
   The unit tests do not depend on ArLocal and pass. Untested ideas: `npm rebuild sqlite3`, or running the e2e tests under a Node LTS release (note that the published benchmark ran on Node v24.22.1).
   Consequence: publishing, **key rotation** and status-list publication are implemented but **not validated end to end**.

## Setup

```bash
node -v        # >= 20
npm install
npm test       # unit tests + e2e on ArLocal (starts a local Arweave-like node on :1985)
npm run bench:crypto
```

## Library change vs. the paper

| Paper | This repo |
|---|---|
| `@mattrglobal/bbs-signatures` (BBS+ over Ursa, pre-standard) | `@digitalbazaar/bbs-signatures` 3.1.0 (IETF CFRG BBS draft, ciphersuite `BLS12-381-SHA-256`) |
| `Bls12381G2Key2020`, `BbsBlsSignature2020` | `Multikey` (multibase, multicodec `0xeb01`) + a plain attribute-level BBS proof |
| every participant generates BBS keys | **only the issuer** has a BBS key pair |
| presentation reveals via `blsCreateProof` | `deriveProof` with the verifier nonce as *presentation header* |
| single gateway (`ar-io.dev`) | N gateways, `minAgree` quorum on the returned document |

## Tests

* `test/unit/` — BBS round-trip, selective disclosure, negative cases (wrong nonce, tampered value,
  other issuer key, forged issuer field), DID document/multikey, status list, gateway quorum with
  stubbed gateways (including an attacker-controlled gateway set).
* `test/e2e/arlocal.test.js` — publish DID doc to ArLocal, resolve, verify, **key rotation**
  (new tx + pointer update; old tx remains retrievable), status list round-trip.
  ArLocal has no ArNS layer: a `Map` stands in for the name → tx pointer.

## Measurements

All scripts write `results/<name>-<timestamp>.csv` and `.json` (with Node/CPU/OS metadata).

### A. Cryptography (local, no network)
```bash
npm run bench:crypto -- --iters 100 --sizes 2,4,8,16,32,64
```
Columns: sign / deriveProof / verifyProof time (mean, median, p95, sd, min, max) vs. number of signed
messages and number of disclosed messages; signature and proof sizes in bytes.

Every round runs **all** configurations once in random order (interleaved), so slow drift of the CPU
frequency (thermal/power state on a laptop) affects all configurations equally. A first version that
ran each configuration back to back produced size-dependent artefacts and was discarded.

**Reference run** (`results/published/crypto-2026-11-16T13-52-45-278Z.{csv,json}`): Intel Core i7-9750H
@ 2.60 GHz, 15.9 GB RAM, Windows 11 (10.0.26200), Node.js v24.22.1, `@digitalbazaar/bbs-signatures` 3.1.0,
ciphersuite BLS12-381-SHA-256, 100 iterations after 10 warm-up rounds, single thread, pure JavaScript.
Median (p95) in ms, proof with one attribute disclosed:

| Attributes L | Sign | Derive proof | Verify proof | Proof size |
|---:|---:|---:|---:|---:|
| 2 | 28 (33) | 63 (75) | 86 (100) | 304 B |
| 4 | 43 (49) | 85 (100) | 100 (104) | 368 B |
| 8 | 72 (82) | 129 (143) | 130 (136) | 496 B |
| 16 | 131 (136) | 218 (227) | 188 (204) | 752 B |
| 32 | 250 (263) | 397 (434) | 308 (333) | 1264 B |
| 64 | 489 (537) | 755 (805) | 544 (631) | 2288 B |

Observations (least-squares fits on the medians, see `figures/fits.txt`):
* The signature is always **80 bytes**; the proof is **272 + 32·U bytes** (U = undisclosed attributes), exact for all measured points.
* Sign ≈ 12.7 + 7.44·L ms and verify ≈ 70.5 + 7.40·L ms (R² > 0.9999). Verification time depends on L, not on how many attributes are disclosed (spread across disclosure counts ≤ 0.8 %).
* Proof derivation costs ≈ 518 + 3.76·U ms at L = 64: disclosing more attributes makes it cheaper.
* Figures and the LaTeX table are regenerated with
  `python bench/plot_crypto.py results/published/<file>.csv figures/` (needs `matplotlib`, `numpy`, `pandas`).

These numbers are from one machine and one library; the absolute values will differ elsewhere.

### B. Arweave mainnet (run on **your** machine)
Order matters. Everything except 03/04 is read-only.

```bash
# 1. Cost of the artifacts (no wallet). Pass today's AR/USD rate yourself.
npm run mainnet:cost -- --ar-usd 5.00

# 2. Publish one issuer DID document (spends a few cents of AR). Dry-run first:
WALLET_PATH=./wallet.json npm run mainnet:publish-did            # dry run
WALLET_PATH=./wallet.json npm run mainnet:publish-did -- --execute
#    -> post time, first-seen, first confirmation, per-gateway availability; writes results/issuer-keys.json

# 3. Map an ArNS name you own (see the ArNS caveat above):
WALLET_PATH=./wallet.json npm run mainnet:arns -- --name myissuer --process <ANT_ID> --tx <TXID> --execute

# 4. Gateway latency by tx id and by ArNS name:
npm run mainnet:latency -- --tx <TXID> --name myissuer --runs 30

# 5. Full verifier path (resolve via quorum + verify) with per-step timings:
npm run mainnet:verify -- --name myissuer --runs 30
```

Use a **dedicated, low-balance wallet**. Wallet files and `results/issuer-keys.json` are git-ignored;
never commit them. Publishing is **permanent**: the DID document you publish can never be erased.

### Suggested protocol for the paper
Run A on 2–3 machines; run B at different times of day (≥ 30 runs each), report median/p95 and the
environment block from the `.json` files; state the AR/USD rate and date used for cost.

## Limitations (also candidate content for the paper)

* **Not W3C `bbs-2023` Data Integrity.** Attributes are signed as raw BBS messages (`BbsAttributeSignature`),
  without JSON-LD canonicalization. For conformance use a Data Integrity implementation of `bbs-2023`.
* **No holder binding.** The nonce prevents replay but not transfer of a credential to another holder.
  Needs a holder secret or BBS pseudonyms.
* **Exact values only.** BBS reveals `age:25`, not "over 18". Predicates need issuer-defined claims or a zk-SNARK variant.
* **Revocation** is only the data structure (`src/status.js`); privately proving the index is not implemented.
* **ArNS trust.** Control of the ANT decides what a name resolves to; the quorum mitigates gateways, not a compromised ANT key.
* Holder DIDs are intentionally **not** published on Arweave (permanent, linkable); use ephemeral `did:key`.

See `docs/did-arweave-spec.md` for the DID method draft.
