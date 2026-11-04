"""`Math.pow`, `Math.min`, `Math.max` de V8, bit pour bit (phase 1.4, plan § 11).

**`Math.pow` n'est pas `**`.** Mesuré le 04/11 sur 200 000 couples (base ∈ [1/3, 3], exposants 0,3 à 0,9 et
aléatoires) : Python (`**` comme `math.pow`, la libm MSVC) diffère de Node sur **13 711** résultats, d'un ulp. V8 ne
délègue pas à la libm du système : il embarque le `__ieee754_pow` de fdlibm (`src/base/ieee754.cc`), qui n'est pas
correctement arrondi (13 772 écarts à l'arrondi correct), là où la libm MSVC l'est presque (77). Le recalage amorti
élève sa correction à la puissance `amortissement` : sans ce portage, un multiplicateur sur quatorze changerait de
dernier bit — puis, après la moyenne et l'arrondi au millième, parfois de millième.

`puissance_js` est donc un portage ligne à ligne de `pow` de `src/base/ieee754.cc` **à la version de V8 de Node 20
(11.3.244.8)**, mots hauts et bas compris. Ce n'est PAS exactement fdlibm 5.3 `e_pow.c` : V8 écrit
`r = (z·t1) / ((t1 − 2) − (w + z·w))` là où fdlibm écrit `r = (z·t1)/(t1 − 2) − (w + z·w)`. Le fdlibm d'origine
laissait 12 138 écarts sur 300 676 couples ; la forme V8 n'en laisse aucun (04/11, Node v20.20.2).

⚠ **Lié à la version de Node.** La branche principale de V8 a remplacé ce code par le `pow` de la libc LLVM
(`LIBC_NAMESPACE::shared::pow`) : un passage à un Node dont le V8 l'embarque changera des derniers bits côté TS. Le
test de parité `tests/noyau/test_math_js.py` (vecteurs générés par Node) le dira.

Les mots d'un double sont lus par `math.frexp` / `math.ldexp` (exacts), pas par `struct` : le noyau n'importe que la
liste blanche de `test_purete.py`.

`Math.min` / `Math.max` : un NaN l'emporte (Python rend l'un ou l'autre selon l'ordre des arguments), et `-0 < +0`
(Python les tient pour égaux et rend le premier).
"""

import math

_DEUX_32 = 1 << 32
_MASQUE_32 = _DEUX_32 - 1
_DEUX_52 = 1 << 52


def _bits(x: float) -> int:
    """Les 64 bits IEEE 754 de `x` (non signés)."""
    if math.isnan(x):
        return 0x7FF8000000000000
    signe = 1 << 63 if math.copysign(1.0, x) < 0 else 0
    a = abs(x)
    if math.isinf(a):
        return signe | 0x7FF0000000000000
    if a == 0.0:
        return signe
    m, e = math.frexp(a)  # a = m × 2^e, m ∈ [0,5 ; 1)
    if e >= -1021:  # normal : exposant biaisé = e − 1 + 1023
        return signe | ((e + 1022) << 52) | (int(m * 2.0**53) - _DEUX_52)
    return signe | int(math.ldexp(a, 1074))  # sous-normal : mantisse = a × 2^1074, exacte


def _flottant(bits: int) -> float:
    """Le double dont les 64 bits sont `bits`."""
    signe = -1.0 if bits >> 63 else 1.0
    exposant = (bits >> 52) & 0x7FF
    mantisse = bits & (_DEUX_52 - 1)
    if exposant == 0x7FF:
        return math.nan if mantisse else signe * math.inf
    if exposant == 0:
        return math.copysign(math.ldexp(float(mantisse), -1074), signe)
    return math.copysign(math.ldexp(float(mantisse + _DEUX_52), exposant - 1075), signe)


def _haut(x: float) -> int:
    """`__HI(x)`, entier SIGNÉ sur 32 bits comme en C."""
    h = _bits(x) >> 32
    return h - _DEUX_32 if h >= 1 << 31 else h


def _bas(x: float) -> int:
    """`__LO(x)`, non signé."""
    return _bits(x) & _MASQUE_32


def _avec_haut(x: float, haut: int) -> float:
    """`__HI(x) = haut`."""
    return _flottant(((haut & _MASQUE_32) << 32) | _bas(x))


def _bas_a_zero(x: float) -> float:
    """`__LO(x) = 0`."""
    return _flottant(_bits(x) & ~_MASQUE_32 & 0xFFFFFFFFFFFFFFFF)


_BP = (1.0, 1.5)
_DP_H = (0.0, 5.84962487220764160156e-01)
_DP_L = (0.0, 1.35003920212974897128e-08)
_TWO53 = 9007199254740992.0
_HUGE = 1.0e300
_TINY = 1.0e-300
_L1 = 5.99999999999994648725e-01
_L2 = 4.28571428578550184252e-01
_L3 = 3.33333329818377432918e-01
_L4 = 2.72728123808534006489e-01
_L5 = 2.30660745775561754067e-01
_L6 = 2.06975017800338417784e-01
_P1 = 1.66666666666666019037e-01
_P2 = -2.77777777770155933842e-03
_P3 = 6.61375632143793436117e-05
_P4 = -1.65339022054652515390e-06
_P5 = 4.13813679705723846039e-08
_LG2 = 6.93147180559945286227e-01
_LG2_H = 6.93147182464599609375e-01
_LG2_L = -1.90465429995776804525e-09
_OVT = 8.0085662595372944372e-17
_CP = 9.61796693925975554329e-01
_CP_H = 9.61796700954437255859e-01
_CP_L = -7.02846165095275826516e-09
_IVLN2 = 1.44269504088896338700e00
_IVLN2_H = 1.44269502162933349609e00
_IVLN2_L = 1.92596299112661746887e-08


def _deborde(s: float) -> float:
    """`s * huge * huge` : ±∞ (ou NaN si s l'est), sans l'OverflowError que Python ne lève pas ici."""
    return s * _HUGE * _HUGE


def _inverse(x: float) -> float:
    """`1 / x` du C : ±∞ pour ±0 (Python lèverait ZeroDivisionError)."""
    return math.copysign(math.inf, x) if x == 0.0 else 1.0 / x


def puissance_js(x: float, y: float) -> float:
    """`Math.pow(x, y)` de V8 : fdlibm `__ieee754_pow`, bit pour bit."""
    hx, lx = _haut(x), _bas(x)
    hy, ly = _haut(y), _bas(y)
    ix, iy = hx & 0x7FFFFFFF, hy & 0x7FFFFFFF

    if (iy | ly) == 0:  # x ** ±0 = 1, même pour NaN
        return 1.0
    if ix > 0x7FF00000 or (ix == 0x7FF00000 and lx != 0) or iy > 0x7FF00000 or (iy == 0x7FF00000 and ly != 0):
        return x + y  # NaN

    # y entier impair (1), pair (2) ou non entier (0), quand x < 0.
    yisint = 0
    if hx < 0:
        if iy >= 0x43400000:
            yisint = 2
        elif iy >= 0x3FF00000:
            k = (iy >> 20) - 0x3FF
            if k > 20:
                j = ly >> (52 - k)
                if (j << (52 - k)) == ly:
                    yisint = 2 - (j & 1)
            elif ly == 0:
                j = iy >> (20 - k)
                if (j << (20 - k)) == iy:
                    yisint = 2 - (j & 1)

    if ly == 0:
        if iy == 0x7FF00000:  # y = ±∞
            if ((ix - 0x3FF00000) | lx) == 0:
                return y - y  # (±1) ** ±∞ = NaN
            if ix >= 0x3FF00000:
                return y if hy >= 0 else 0.0
            return -y if hy < 0 else 0.0
        if iy == 0x3FF00000:  # y = ±1
            return _inverse(x) if hy < 0 else x
        if hy == 0x40000000:  # y = 2
            return x * x
        if hy == 0x3FE00000 and hx >= 0:  # y = 0,5, x ≥ +0
            return math.sqrt(x)

    ax = abs(x)
    if lx == 0 and (ix == 0x7FF00000 or ix == 0 or ix == 0x3FF00000):  # x = ±0, ±∞, ±1
        z = ax
        if hy < 0:
            z = _inverse(z)
        if hx < 0:
            if ((ix - 0x3FF00000) | yisint) == 0:
                z = math.nan  # (−1) ** non entier
            elif yisint == 1:
                z = -z
        return z

    n = (hx >> 31) + 1
    if (n | yisint) == 0:
        return math.nan  # (x < 0) ** non entier

    s = 1.0
    if (n | (yisint - 1)) == 0:
        s = -1.0

    if iy > 0x41E00000:  # |y| > 2^31
        if iy > 0x43F00000:  # |y| > 2^64
            if ix <= 0x3FEFFFFF:
                return _deborde(1.0) if hy < 0 else _TINY * _TINY
            if ix >= 0x3FF00000:
                return _deborde(1.0) if hy > 0 else _TINY * _TINY
        if ix < 0x3FEFFFFF:
            return _deborde(s) if hy < 0 else s * _TINY * _TINY
        if ix > 0x3FF00000:
            return _deborde(s) if hy > 0 else s * _TINY * _TINY
        t = ax - 1.0
        w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25))
        u = _IVLN2_H * t
        v = t * _IVLN2_L - w * _IVLN2
        t1 = _bas_a_zero(u + v)
        t2 = v - (t1 - u)
    else:
        n = 0
        if ix < 0x00100000:  # sous-normal
            ax *= _TWO53
            n -= 53
            ix = _haut(ax)
        n += (ix >> 20) - 0x3FF
        j = ix & 0x000FFFFF
        ix = j | 0x3FF00000
        if j <= 0x3988E:
            k = 0
        elif j < 0xBB67A:
            k = 1
        else:
            k = 0
            n += 1
            ix -= 0x00100000
        ax = _avec_haut(ax, ix)

        u = ax - _BP[k]
        v = 1.0 / (ax + _BP[k])
        ss = u * v
        s_h = _bas_a_zero(ss)
        t_h = _avec_haut(0.0, ((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18))
        t_l = ax - (t_h - _BP[k])
        s_l = v * ((u - s_h * t_h) - s_h * t_l)
        s2 = ss * ss
        r = s2 * s2 * (_L1 + s2 * (_L2 + s2 * (_L3 + s2 * (_L4 + s2 * (_L5 + s2 * _L6)))))
        r += s_l * (s_h + ss)
        s2 = s_h * s_h
        t_h = _bas_a_zero(3.0 + s2 + r)
        t_l = r - ((t_h - 3.0) - s2)
        u = s_h * t_h
        v = s_l * t_h + t_l * ss
        p_h = _bas_a_zero(u + v)
        p_l = v - (p_h - u)
        z_h = _CP_H * p_h
        z_l = _CP_L * p_h + p_l * _CP + _DP_L[k]
        t = float(n)
        t1 = _bas_a_zero(((z_h + z_l) + _DP_H[k]) + t)
        t2 = z_l - (((t1 - t) - _DP_H[k]) - z_h)

    y1 = _bas_a_zero(y)
    p_l = (y - y1) * t1 + y * t2
    p_h = y1 * t1
    z = p_l + p_h
    j = _haut(z)
    i = _bas(z)
    if j >= 0x40900000:  # z ≥ 1024
        if ((j - 0x40900000) | i) != 0 or p_l + _OVT > z - p_h:
            return _deborde(s)
    elif (j & 0x7FFFFFFF) >= 0x4090CC00:  # z ≤ −1075
        if ((j - (0xC090CC00 - _DEUX_32)) | i) != 0 or p_l <= z - p_h:
            return s * _TINY * _TINY

    i = j & 0x7FFFFFFF
    k = (i >> 20) - 0x3FF
    n = 0
    if i > 0x3FE00000:  # |z| > 0,5 : n = [z + 0,5]
        n = j + (0x00100000 >> (k + 1))
        k = ((n & 0x7FFFFFFF) >> 20) - 0x3FF
        t = _avec_haut(0.0, n & ~(0x000FFFFF >> k))
        n = ((n & 0x000FFFFF) | 0x00100000) >> (20 - k)
        if j < 0:
            n = -n
        p_h -= t
    t = _bas_a_zero(p_l + p_h)
    u = t * _LG2_H
    v = (p_l - (t - p_h)) * _LG2 + t * _LG2_L
    z = u + v
    w = v - (z - u)
    t = z * z
    t1 = z - t * (_P1 + t * (_P2 + t * (_P3 + t * (_P4 + t * _P5))))
    r = (z * t1) / ((t1 - 2.0) - (w + z * w))  # V8 11.3 : UN SEUL quotient — fdlibm écrit (z·t1)/(t1−2) − (w+z·w)
    z = 1.0 - (r - z)
    j = _haut(z) + (n << 20)
    z = math.ldexp(z, n) if (j >> 20) <= 0 else _avec_haut(z, j)
    return s * z


def min_js(*valeurs: float) -> float:
    """`Math.min(...valeurs)` : NaN contagieux, −0 < +0, `Math.min()` = +∞."""
    resultat = math.inf
    for v in valeurs:
        if math.isnan(v):
            return math.nan
        if v < resultat or (v == 0.0 and resultat == 0.0 and math.copysign(1.0, v) < 0):
            resultat = v
    return resultat


def max_js(*valeurs: float) -> float:
    """`Math.max(...valeurs)` : NaN contagieux, +0 > −0, `Math.max()` = −∞."""
    resultat = -math.inf
    for v in valeurs:
        if math.isnan(v):
            return math.nan
        if v > resultat or (v == 0.0 and resultat == 0.0 and math.copysign(1.0, v) > 0):
            resultat = v
    return resultat
