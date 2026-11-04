"""`lib/demo/rng.ts` porté bit à bit : mulberry32 et FNV-1a, en arithmétique 32 bits explicite (plan § 11).

Le JS mêle `| 0`, `>>> 0`, `^` (ToInt32) et `Math.imul` ; tous ne diffèrent que par l'INTERPRÉTATION signée ou non du
même mot de 32 bits. On garde donc tout en non signé, modulo 2³² : une addition JS de deux int32 suivie d'un `^`
(qui tronque à 32 bits) vaut l'addition modulo 2³². La division finale lit le mot non signé, comme `>>> 0`.
"""

import math
from collections.abc import Callable

_MASQUE = 0xFFFFFFFF


def vers_uint32(x: float) -> int:
    """`ToUint32` (ECMA-262 7.1.7) : NaN et ±∞ → 0, troncature vers zéro, modulo 2³²."""
    if isinstance(x, int):
        return x & _MASQUE
    if math.isnan(x) or math.isinf(x):
        return 0
    return math.trunc(x) & _MASQUE


def imul(a: int, b: int) -> int:
    """`Math.imul(a, b) >>> 0` sur deux mots non signés."""
    return (a * b) & _MASQUE


def mulberry32(graine: float) -> Callable[[], float]:
    """`mulberry32(seed)` : un générateur de flottants dans [0, 1)."""
    a = vers_uint32(graine)

    def suivant() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & _MASQUE
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & _MASQUE) ^ t
        return ((t ^ (t >> 14)) & _MASQUE) / 4294967296

    return suivant


def hash_str(s: str) -> int:
    """`hashStr(s)` : FNV-1a sur les UNITÉS UTF-16 (`charCodeAt`), pas sur les points de code."""
    unites = s.encode("utf-16-le", "surrogatepass")
    h = 2166136261
    for i in range(0, len(unites), 2):
        h ^= unites[i] | (unites[i + 1] << 8)
        h = imul(h, 16777619)
    return h


def rng_for(graine: float, cle: str) -> float:
    """`rngFor(seed, key)` = `mulberry32((seed ^ hashStr(key)) >>> 0)()`."""
    return mulberry32(vers_uint32(graine) ^ hash_str(cle))()
