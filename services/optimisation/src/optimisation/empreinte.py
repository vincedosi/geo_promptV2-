"""Empreintes md5 des extractions, recalculées comme le fait la base — pour PROUVER la parité, jamais pour écrire.

L'écriture (verrou, empreinte, idempotence `deja_extraite`) reste SQL (plan § 2.1). Ce module reproduit les deux
formules pour vérifier qu'un plan Python rend la même empreinte que le plan TS, donc qu'une ré-extraction d'un jeu
inchangé reste `deja_extraite` après la bascule (plan § 2.3, point 3) :

- jeu RISQUE, `creer_zone_set_extraction` (sql/231) :
  `md5(seuil::text || '|' || mode_plan || '|' || string_agg(cp || ':' || round(mult, 3)::text, ',' order by cp))` ;
- jeu de ZONE, `creer_extraction_jeu_zone` (sql/317, inchangée par sql/319 et sql/340) : les segments `cp` (plan
  commun) et `plans:` (plans par plateforme) — `code:round(mult, 3)` et `plateforme:code:round(mult, 3)`, triés en
  collation "C". Les autres segments (choix, unités converties, tolérance) ne viennent pas du plan : ils sont passés
  tels quels par l'appelant.

`round(x::numeric, 3)::text` : arrondi DÉCIMAL de la représentation JSON du nombre (moitié loin de zéro), trois
décimales écrites (`1.000`). Le JSON d'un double Python (`repr`) et celui de JS ont les mêmes chiffres significatifs
(plus court aller-retour), seule la notation de l'exposant diffère — sans effet sur la valeur décimale.
"""

import hashlib
from collections.abc import Iterable, Sequence
from decimal import ROUND_HALF_UP, Decimal

_MILLIEME = Decimal("0.001")


def millieme_numeric(valeur: float | int | None) -> str:
    """`round(coalesce(valeur::numeric, 0), 3)::text`."""
    if valeur is None:
        valeur = 0
    if isinstance(valeur, bool):
        raise TypeError("multiplicateur booléen")
    return str(Decimal(repr(valeur)).quantize(_MILLIEME, rounding=ROUND_HALF_UP))


def _cle_c(texte: str) -> bytes:
    # collation "C" : ordre des octets UTF-8.
    return texte.encode("utf-8")


def segment_cp(lignes: Iterable[tuple[str, float | int | None]]) -> str:
    """Le segment du plan commun : `code:mult` triés en collation "C", joints par `,` ('' si vide)."""
    return ",".join(sorted((f"{code}:{millieme_numeric(m)}" for code, m in lignes), key=_cle_c))


def segment_plans(plans: Iterable[tuple[str, Iterable[tuple[str, float | int | None]]]]) -> str | None:
    """Le segment B12 `plans:plateforme:code:mult,…` ; `None` sans aucune ligne (`concat_ws` l'ignore alors)."""
    cles = [f"{plateforme}:{code}:{millieme_numeric(m)}" for plateforme, lignes in plans for code, m in lignes]
    return "plans:" + ",".join(sorted(cles, key=_cle_c)) if cles else None


def empreinte_jeu_zone(
    mode_plan: str,
    choix: str | None,
    lignes_cp: Iterable[tuple[str, float | int | None]],
    unites: str,
    tolerance: str | None,
    plans: Iterable[tuple[str, Iterable[tuple[str, float | int | None]]]],
) -> str:
    """md5 de `concat_ws('|', mode, choix, cp, unités, tolérance, plans)` — `concat_ws` saute les `NULL`."""
    morceaux: Sequence[str | None] = (mode_plan, choix, segment_cp(lignes_cp), unites, tolerance, segment_plans(plans))
    return hashlib.md5(
        "|".join(m for m in morceaux if m is not None).encode("utf-8"), usedforsecurity=False
    ).hexdigest()


def empreinte_jeu_risque(seuil: str, mode_plan: str, lignes: Iterable[tuple[str, float | int | None]]) -> str:
    """md5 de sql/231. Tri par code postal : collation de la base (en_US.UTF-8), identique à l'ordre "C" sur des codes
    postaux faits de chiffres — vérifié par l'appelant, qui refuse un code non numérique."""
    paires = list(lignes)
    if any(not code.isdigit() for code, _ in paires):
        raise ValueError("code postal non numérique : l'ordre en_US.UTF-8 n'est pas reproduit ici")
    corps = ",".join(f"{code}:{millieme_numeric(m)}" for code, m in sorted(paires, key=lambda p: p[0]))
    return hashlib.md5(f"{seuil}|{mode_plan}|{corps}".encode(), usedforsecurity=False).hexdigest()
