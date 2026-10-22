import { readFileSync, existsSync } from 'node:fs';

export const DEFAULT_GATEWAYS = ['arweave.net', 'ar-io.dev']; // override with --gateways a,b,c

export function gatewaysFrom(arg) {
  return (arg ? arg.split(',') : DEFAULT_GATEWAYS).map((s) => s.trim()).filter(Boolean);
}

/** Wallet JWK is read from a file path given by env WALLET_PATH. It is never printed or logged. */
export function loadWallet() {
  const p = process.env.WALLET_PATH;
  if (!p) throw new Error('Set WALLET_PATH=/path/to/wallet.json (Arweave JWK). Use a dedicated low-balance wallet.');
  if (!existsSync(p)) throw new Error(`WALLET_PATH does not exist: ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function requireExecute(values, what) {
  if (!values.execute) {
    console.log(`\n[DRY RUN] ${what}\nNothing was sent and nothing was spent. Re-run with --execute to do it for real.`);
    return false;
  }
  return true;
}

export const ms = (x) => +x.toFixed(2);
