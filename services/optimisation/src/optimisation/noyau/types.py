"""Types du noyau du plan initial : entrées en dataclasses figées, sorties en `TypedDict` (des `dict` JSON).

Les sorties sont des dictionnaires plutôt que des dataclasses parce qu'elles partent telles quelles en JSON (vers Next,
puis `creer_extraction_jeu_zone`) et se comparent clé par clé aux sorties du TS (plan § 5.1). Leurs clés et leur ordre
sont ceux des objets TS de `lib/zones/plan.ts`, `plan-jeu-zone.ts` et `part-prevue.ts`.

Tous les nombres sont des `float` : c'est le seul type numérique de JavaScript, et la parité au dernier bit en dépend
(un `int` Python ne déborde jamais, un nombre JS si). Les adaptateurs (API, tests) convertissent à l'entrée.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, NotRequired, TypedDict

ModePlan = Literal["exclusif", "pondere"]
Univers = Literal["METRO", "FR"]
RegleGroupe = Literal["meme", "divise"]
CodeAjustement = Literal["multiplicateur_min", "multiplicateur_max"]

# Les codes postaux indiscernables (sql/228) : canonique → ses codes, le canonique compris.
MembresParCanonique = Mapping[str, Sequence[str]]


# ── Entrées ──────────────────────────────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CpZone:
    """Un code postal vu par le plan : une ligne de `zone_set_cp` (une par grappe), ou une unité CP d'un jeu de zone."""

    code_postal: str
    classe: str
    pop_en_zone: float
    pop_totale: float
    retenu: bool


@dataclass(frozen=True)
class Jeu:
    """Ce que le plan lit d'un jeu : son mode et ses poids de classe (`Pick<JeuDeZones, 'mode_plan' | 'poids'>`)."""

    mode_plan: ModePlan
    poids: Mapping[str, float]


@dataclass(frozen=True)
class LigneCouverture:
    """Une unité de la couverture CP (`couverture_zone`, `lib/zones/couverture.ts`), champs lus par le plan."""

    code: str
    pop_en_zone: float | None
    pop_totale: float | None
    part: float | None
    part_brute: float | None
    membres: tuple[str, ...] | None = None
    incluse: bool | None = None


@dataclass(frozen=True)
class Bornes:
    min: float
    max: float


@dataclass(frozen=True)
class AVerifier:
    min: bool
    max: bool


@dataclass(frozen=True)
class ReglagePlan:
    """Ce que le registre des mécanismes impose à un plan CP. Champs absents = `None` (le TS les omet)."""

    bornes: Bornes | None = None
    poids_groupe_cp: RegleGroupe | None = None
    a_verifier: AVerifier | None = None


@dataclass(frozen=True)
class PlateformePoids:
    """Une ligne de `plateformes_poids` (sql/305) : un mécanisme par lequel les poids partent chez une plateforme."""

    plateforme: str
    maille: str
    mecanisme: str
    valeur_min: float | None
    valeur_max: float | None
    nb_max_entrees: int | None
    poids_groupe_cp: RegleGroupe | None
    branche: bool
    parametres_a_verifier: tuple[str, ...]


@dataclass(frozen=True)
class VolumesAttendus:
    """`volumes_attendus_cp_univers` (sql/337) : volume de chaque code demandé et total des CP peuplés de l'univers."""

    par_code: Mapping[str, float]
    total: float
    univers: Univers | None = None


@dataclass(frozen=True)
class ChoixPlateforme:
    plateforme: str
    seuil: float


@dataclass(frozen=True)
class UnitePrevue:
    code: str
    membres: tuple[str, ...]
    part: float | None
    volume: float | None
    classe: float


@dataclass(frozen=True)
class HorsZonePrevue:
    part: float
    volume: float | None
    classe: float


# ── Sorties ──────────────────────────────────────────────────────────────────────────────────────────────────────────


class BornesJson(TypedDict):
    min: float
    max: float


class Ajustement(TypedDict):
    code: CodeAjustement
    limite: float
    valeur: float
    n: int


class LigneHorsZone(TypedDict):
    code: Literal["HORS_ZONE"]
    mode: Literal["strict", "national"]
    multiplicateur: float
    part: int
    classe: float
    volume: NotRequired[float | None]
    univers: NotRequired[Univers | None]
    part_prevue: NotRequired[float | None]


class BilanMultiplicateur(TypedDict):
    normalisation: Literal["non_ponderee"]
    bornes: BornesJson
    moyenne_avant_ecretage: float | None
    moyenne_apres_ecretage: float | None
    n_ecretes: int
    ajustements: list[Ajustement]
    hors_zone: LigneHorsZone


class LignePlan(TypedDict):
    code_postal: str
    part_plan: float
    multiplicateur: float
    multiplicateur_calcule: NotRequired[float]
    classe: str
    retenu: bool


class Plan(TypedDict):
    lignes: list[LignePlan]
    part_plan_en_zone: float | None
    taux_utile: float | None
    n_retenus: int
    multiplicateur: NotRequired[BilanMultiplicateur]


class LignePlanZone(TypedDict):
    code_postal: str
    code_canonique: str
    classe: str
    retenu: bool
    multiplicateur: float
    pop_en_zone: float | None
    pop_totale: float | None
    part_en_zone: float | None
    part_prevue: float | None


class BilanMultiplicateurZone(BilanMultiplicateur):
    unite_de_compte: Literal["unite_cp"]
    poids_groupe_cp: RegleGroupe


class ResumePartPrevue(TypedDict):
    volume_attendu: Literal["population_totale"]
    unite_de_somme: Literal["unite_cp"]
    repartition_groupe: Literal["egale"]
    hors_zone: float | None
    unites_sans_part: int


class ResumePlanZone(TypedDict):
    n_cp: int
    n_retenus: int
    n_codes: int
    taux_utile: float | None
    part_plan_en_zone: float | None
    population_exposee: float
    multiplicateur: BilanMultiplicateurZone
    part_prevue: ResumePartPrevue


class PlanZone(TypedDict):
    lignes: list[LignePlanZone]
    resume: ResumePlanZone


class AvertissementPoids(TypedDict):
    code: str
    limite: float
    valeur: float
    n: int
    mecanisme: NotRequired[str]
    a_verifier: NotRequired[Literal[True]]


class SortiePoids(TypedDict):
    mecanisme: str
    branche: bool
    poids_groupe_cp: RegleGroupe | None
    parametres_a_verifier: list[str]
    n_codes: int
    valeur_min: NotRequired[float]
    valeur_max: NotRequired[float]
    nb_max_entrees: NotRequired[int]
    n_envois: NotRequired[int]


@dataclass(frozen=True)
class PlanPlateforme:
    plateforme: str
    seuil: float
    reglage: ReglagePlan
    plan: PlanZone


@dataclass(frozen=True)
class RefusReglage:
    """Le refus nommé du registre : une phrase, prête pour un 422."""

    message: str


@dataclass(frozen=True)
class PartsPrevues:
    par_unite: dict[str, float | None]
    par_code: dict[str, float | None]
    hors_zone: float | None
    somme: float | None
