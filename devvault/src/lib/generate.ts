// Password / secret generator using the platform CSPRNG (crypto.getRandomValues),
// with rejection sampling so the character distribution is unbiased.

export interface GenOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
}

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";

export const DEFAULT_GEN: GenOptions = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
};

export function generatePassword(opts: GenOptions): string {
  let pool = "";
  if (opts.lower) pool += LOWER;
  if (opts.upper) pool += UPPER;
  if (opts.digits) pool += DIGITS;
  if (opts.symbols) pool += SYMBOLS;
  if (!pool) pool = LOWER; // never produce an empty alphabet

  const len = Math.max(1, Math.min(opts.length, 256));
  const out: string[] = [];
  // Largest multiple of pool.length that fits in a byte — reject above it to
  // avoid modulo bias.
  const limit = 256 - (256 % pool.length);
  const buf = new Uint8Array(1);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    if (buf[0] >= limit) continue;
    out.push(pool[buf[0] % pool.length]);
  }
  return out.join("");
}
