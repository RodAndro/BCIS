/**
 * Deterministic pseudo-random generator.
 *
 * ── WHY NOT Math.random ─────────────────────────────────────────────────────
 * Decision A16: the demo dataset must be reproducible, so two runs on two
 * machines produce the same subscribers and the same amounts. ESLint rejects
 * `Math.random` outside a test for exactly this reason, and a seed whose output
 * changes between runs makes a demo screenshot a claim nobody can re-check.
 *
 * mulberry32 is the standard small generator for this: 32 bits of state, a
 * well-distributed output, and identical results everywhere. It is NOT
 * cryptographic and must never be used for anything security-related.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max]. */
  int(min: number, max: number): number;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** True with the given probability. */
  chance(probability: number): boolean;
}

export function createRandom(seed: number): Random {
  const next = createSeededRandom(seed);

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) {
        throw new Error('Picked from an empty list.');
      }
      return item;
    },
    chance: (probability: number): boolean => next() < probability,
  };
}
