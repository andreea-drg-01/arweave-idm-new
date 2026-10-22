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

## Status: read this first

> **This code has not been executed yet.** It was written in an environment without access to the
> npm registry, so only syntax was checked (`node --check`). Expect to fix small API mismatches on
> the first `npm install && npm test`. Please commit the `package-lock.json` after the first green run.

Things to verify on first run:
1. `@digitalbazaar/bbs-signatures` option names (`generateKeyPair`, `sign`, `deriveProof`, `verifyProof`, `CIPHERSUITES`) — see `src/bbs.js` (single place to adapt).
2. `arlocal` default-export shape and the `/mint`, `/mine` endpoints — see `test/e2e/arlocal.test.js`.
3. **ArNS signer.** The ar.io docs now describe Solana-based wallets/ANTs for some flows and mark `setRecord` as deprecated. `scripts/mainnet/04-arns-update.js` uses the legacy `ArweaveSigner(jwk)` and must be adapted to the network/ANT you actually own. `src/arns.js` already prefers `setBaseNameRecord`.

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
| `@mattrglobal/bbs-signatures` (BBS+ over Ursa, pre-standard) | `@digitalbazaar/bbs-signatures` (IETF CFRG BBS draft, ciphersuite `BLS12-381-SHA-256`) |
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
Columns: sign / deriveProof / verifyProof time (mean, median, p95, sd) vs. number of signed messages
and number of disclosed messages; signature and proof sizes in bytes.

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
