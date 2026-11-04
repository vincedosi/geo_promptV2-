"""Contrat commun du catalogue (plan § 16.1) : ce qu'est un algorithme, ses paramètres, et les refus en français.

Deux familles :

- `plan` : l'entrée et la sortie des plans déjà portés en phase 1 (méthode A, méthode B), SANS changement. Leur
  `calculer` est la fonction portée elle-même, pas une copie : une enveloppe qui retraduirait l'entrée pourrait
  dériver, une référence ne le peut pas (`tests/algos/test_registre.py` le vérifie par identité et par les fixtures
  de parité).
- `correction` : `EntreeCorrection` → `SortieCorrection` ci-dessous, le contrat des deux algorithmes à venir
  (« uniformiser au global », « uniformiser par régie », phases 3-4). Les deux formules HISTORIQUES (rebid plafonné,
  recalage amorti) gardent l'entrée et la sortie de leur port de phase 1 : elles ne servent qu'au simulateur, pour
  comparer, et les faire passer par ce contrat changerait ce qu'elles calculent.

Un algorithme « à venir » est DÉCLARÉ (identifiant, paramètres, description) sans calcul : l'appeler lève
`AlgoAVenir`, que l'API rend en 422 — jamais un calcul de remplacement.
"""

import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

Famille = Literal["plan", "correction"]
Etat = Literal["disponible", "a_venir"]
FAMILLES: tuple[Famille, ...] = ("plan", "correction")


# --- Refus ---------------------------------------------------------------------------------------------------------


class RefusAlgo(Exception):
    """Refus d'une demande au catalogue. `refus` : code stable pour le journal et pour Next ; `message` : français."""

    refus = "algo"

    def __init__(self, message: str, algo_id: str | None = None) -> None:
        self.message = message
        self.algo_id = algo_id
        super().__init__(message)


class AlgoInconnu(RefusAlgo):
    refus = "algo_inconnu"

    def __init__(self, algo_id: str) -> None:
        super().__init__(f"Algorithme inconnu : « {algo_id} ». Il n'est pas au catalogue.", algo_id)


class AlgoAVenir(RefusAlgo):
    refus = "algo_a_venir"

    def __init__(self, algo_id: str, libelle: str) -> None:
        super().__init__(
            f"L'algorithme « {libelle} » est déclaré mais pas encore calculé (à venir) : il ne peut pas être appelé.",
            algo_id,
        )


class ParametreInvalide(RefusAlgo):
    refus = "parametre_invalide"


class AlgoAutreFamille(RefusAlgo):
    """Choix d'un algorithme qui n'est pas de la famille attendue (un plan proposé comme correction, tâche 2.7)."""

    refus = "algo_autre_famille"

    def __init__(self, algo_id: str, libelle: str, attendue: Famille) -> None:
        super().__init__(
            f"L'algorithme « {libelle} » n'est pas de la famille « {attendue} » : il ne peut pas être choisi ici.",
            algo_id,
        )


class AlgoNonProposable(RefusAlgo):
    """Choix d'une formule réservée au simulateur (`proposable = False`, plan § 16.4)."""

    refus = "algo_non_proposable"

    def __init__(self, algo_id: str, libelle: str) -> None:
        super().__init__(
            f"L'algorithme « {libelle} » est réservé au simulateur : il ne peut pas être choisi pour une campagne.",
            algo_id,
        )


# --- Description d'un algorithme -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Parametre:
    """Un paramètre réglable par campagne. `minimum` ≤ `defaut` ≤ `maximum`, bornes comprises."""

    nom: str
    libelle: str
    defaut: float
    minimum: float
    maximum: float
    unite: str
    entier: bool = False


@dataclass(frozen=True)
class Algorithme:
    """Une entrée du catalogue (plan § 16.1).

    - `version` monte quand la sortie change pour une même entrée ; un cycle l'écrit avec `id` (rejeu).
    - `proposable` : `True` si l'écran ⑦ peut le proposer ; `False` pour une formule réservée au simulateur, ou un plan
      (dans le catalogue pour la traçabilité, pas choisi dans ⑦, § 16.6 point 4).
    - `etat` : `a_venir` ⇔ `calculer is None`.
    - `ordres` : couples `(a, b)` de paramètres tels que `a ≤ b` (bornes basse/haute d'un même réglage).
    """

    id: str
    version: int
    libelle: str
    description: str
    familles: tuple[Famille, ...]
    proposable: bool
    etat: Etat
    parametres: tuple[Parametre, ...] = ()
    ordres: tuple[tuple[str, str], ...] = ()
    calculer: Callable[..., Any] | None = field(default=None, repr=False, compare=False)

    def parametre(self, nom: str) -> Parametre:
        for p in self.parametres:
            if p.nom == nom:
                return p
        raise ParametreInvalide(f"Paramètre inconnu pour « {self.libelle} » : « {nom} ».", self.id)

    def defauts(self) -> dict[str, float]:
        return {p.nom: p.defaut for p in self.parametres}


def parametres_effectifs(algo: Algorithme, surcharges: Mapping[str, float]) -> dict[str, float]:
    """Les défauts de `algo`, remplacés par `surcharges` — chaque valeur vérifiée (connue, finie, dans ses bornes,
    entière s'il le faut), puis les `ordres`. Lève `ParametreInvalide` au premier écart, en français."""
    valeurs = algo.defauts()
    for nom, valeur in surcharges.items():
        p = algo.parametre(nom)
        if isinstance(valeur, bool) or not isinstance(valeur, int | float) or not math.isfinite(valeur):
            raise ParametreInvalide(f"« {p.libelle} » : valeur non numérique ou non finie.", algo.id)
        if not p.minimum <= valeur <= p.maximum:
            raise ParametreInvalide(
                f"« {p.libelle} » : {valeur} hors des bornes [{p.minimum} ; {p.maximum}] {p.unite}.".rstrip(), algo.id
            )
        if p.entier and valeur != math.floor(valeur):
            raise ParametreInvalide(f"« {p.libelle} » : un nombre entier est attendu ({valeur}).", algo.id)
        valeurs[nom] = float(valeur)
    for bas, haut in algo.ordres:
        if valeurs[bas] > valeurs[haut]:
            raise ParametreInvalide(
                f"« {algo.parametre(bas).libelle} » ({valeurs[bas]}) dépasse "
                f"« {algo.parametre(haut).libelle} » ({valeurs[haut]}).",
                algo.id,
            )
    return valeurs


# --- Contrat de la famille « correction » (algorithmes à venir, phases 3-4) ------------------------------------------


@dataclass(frozen=True)
class ZoneCorrection:
    """Une zone (CP ou ad set, opaque) d'une régie. `livraison` : impressions quotidiennes de la fenêtre, du plus ancien
    jour au plus récent. `part_cible` est FIXE (la part du plan figé, cahier point 6). `taux_inclusion` : part de la
    population du CP dans la zone (méthode B), `None` en méthode A (pas de dilution)."""

    zone: str
    poids: float
    part_cible: float
    livraison: tuple[float, ...]
    valeur: float
    taux_inclusion: float | None


@dataclass(frozen=True)
class RegieCorrection:
    """Une régie (plateforme) : ses zones et sa dépense quotidienne sur la même fenêtre."""

    regie: str
    zones: tuple[ZoneCorrection, ...]
    depense: tuple[float, ...]


@dataclass(frozen=True)
class EtatCycle:
    """Ce qu'un cycle transmet au suivant : cycles consécutifs en butée et sens, par (régie, zone), et saturations.
    Un `EtatCycle()` vide est l'état d'une campagne qui n'a jamais été corrigée — ou qui vient de changer
    d'algorithme (§ 16.6 point 1 : les compteurs repartent de zéro)."""

    butees: Mapping[tuple[str, str], tuple[int, int]] = field(default_factory=dict)
    saturations: frozenset[tuple[str, str]] = frozenset()


@dataclass(frozen=True)
class EntreeCorrection:
    regies: tuple[RegieCorrection, ...]
    etat_precedent: EtatCycle
    parametres: Mapping[str, float]


@dataclass(frozen=True)
class ZoneProposee:
    """`indice` peut valoir +∞ (zone jamais servie) ; `coefficient_brut` aussi, écrit tel quel au journal (§ 7.2)."""

    regie: str
    zone: str
    indice: float
    coefficient_brut: float
    coefficient: float
    poids_avant: float
    poids_propose: float
    raison: str


@dataclass(frozen=True)
class Alerte:
    code: str
    message: str
    regie: str | None = None
    zone: str | None = None
    valeur: float | None = None
    seuil: float | None = None


@dataclass(frozen=True)
class SortieCorrection:
    zones: tuple[ZoneProposee, ...]
    alertes: tuple[Alerte, ...]
    scores_par_regie: Mapping[str, float]
    score_global: float
    etat_suivant: EtatCycle


CalculCorrection = Callable[[EntreeCorrection], SortieCorrection]
