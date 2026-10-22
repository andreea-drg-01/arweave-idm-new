# `did:arweave` method — working draft

Status: draft for discussion, not a registered DID method.

## Syntax
```
did:arweave:<wallet-address>
```
`<wallet-address>` is the 43-character base64url Arweave address of the controller wallet.
(The DID cannot embed the document's transaction id: it is unknown before the document is stored.)

## Operations

**Create.** The controller builds a DID document (see `src/did.js`), uploads it as an Arweave
transaction with tags `Content-Type: application/did+json`, `App-Name: arweave-idm`, signed by the
controller wallet. The authoritative document is the one **referenced by the controller's ArNS name**.

**Read (resolve).** Input: an ArNS name (or a transaction id) and a list of gateways.
1. Fetch `https://<name>.<gateway>` (or `/<txid>`) from ≥ N gateways.
2. Require ≥ `minAgree` identical documents (`resolveQuorum`).
3. Check `doc.id` equals the DID being resolved.
4. For transaction-id resolution, additionally check the transaction's owner address equals the
   wallet address in the DID.

**Update.** Upload the new document as a new transaction, then update the ArNS record to the new
tx id (`setBaseNameRecord`). Previous versions remain retrievable by transaction id but are no
longer referenced. Key rotation = update.

**Deactivate.** Upload a document with `"deactivated": true` and point the name at it.

## Security considerations
* **ANT key = DID control for resolution.** Whoever controls the ANT decides what the name resolves to.
  Protect it like the controller key; consider separating roles and documenting recovery.
* **Permanence.** Documents cannot be erased. They MUST contain only public data and MUST NOT contain
  identifying attributes; holders SHOULD use separate keys/DIDs per context. A persistent identifier may
  still be pseudonymous personal data under GDPR.
* **Gateway trust.** Use multiple gateways and a quorum; verify DID binding (steps 3–4).
* **Name squatting.** ArNS names are leased/purchased; an expired lease may be re-registered by someone else.
  Verifiers SHOULD pin the expected owner address.

## Open questions
* Authenticating the tx owner ↔ DID binding without trusting a gateway (verify the transaction signature locally).
* Whether to publish a status list under the same name (`status.<name>`) via ArNS undernames.
