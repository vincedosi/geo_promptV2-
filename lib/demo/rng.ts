/**
 * PRNG seedé déterministe (mulberry32) — tout l'aléatoire de la démo passe par ici,
 * jamais Math.random(). Même seed → même démo (reproductible sur scène).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a d'une chaîne → uint32, pour dériver un flux stable par clé. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Une valeur [0,1) déterministe pour un couple (seed, clé) — ex. résistance d'un CP. */
export function rngFor(seed: number, key: string): number {
  return mulberry32((seed ^ hashStr(key)) >>> 0)();
}
