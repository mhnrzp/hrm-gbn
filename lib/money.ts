// Stored unit is IRR (rial) as bigint; Persian UI speaks toman. 1 toman = 10 rial.
// BigInt end to end — no floating point money anywhere.

const RIAL_PER_TOMAN = BigInt(10);

/** Strict integer parse: accepts ASCII digits only (normalise Persian digits first). */
export function parseIntegerString(value: string): bigint {
  if (!/^\d{1,16}$/.test(value)) throw new RangeError("INVALID_AMOUNT");
  return BigInt(value);
}

export function tomanToIrr(toman: string | bigint): bigint {
  const t = typeof toman === "bigint" ? toman : parseIntegerString(toman);
  if (t < BigInt(0)) throw new RangeError("INVALID_AMOUNT");
  return t * RIAL_PER_TOMAN;
}

/** Returns toman as a decimal string; keeps a ".x" fraction if the rial amount isn't a whole toman. */
export function irrToTomanString(irr: string | bigint): string {
  const r = typeof irr === "bigint" ? irr : BigInt(irr);
  const whole = r / RIAL_PER_TOMAN;
  const frac = r % RIAL_PER_TOMAN;
  return frac === BigInt(0) ? whole.toString() : `${whole}.${frac < BigInt(0) ? -frac : frac}`;
}
