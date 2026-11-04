"""`POST /v1/historique/recaler` : le recalage amorti v1 → v2 (`recaler`, `lib/simulation/recalage.ts`), tâche 1.6.

Appelé par la route Next `simulation/recaler` sous le drapeau `OPTIMISATION_CORRECTION_SOURCE` (ombre ou python). Le
calcul est celui de `noyau/historique/recalage_amorti.py`, porté au bit près (lot 2). Aucune lecture, aucune écriture :
Next envoie ce qu'il a lu (codes postaux de la v1, impressions utiles observées par bassin, cible par bassin,
paramètres de la simulation) et écrit lui-même l'extraction v2.

ORDRE. Les `Map` du TS (`utilesObservees`, `cible`, et en sortie `multiplicateurs`, `corrections`) voyagent en LISTES DE
PAIRES : l'ordre d'insertion fait partie du calcul (la somme des observées est une somme gauche, les corrections suivent
l'ordre de `cible`), et un objet JSON relu par JavaScript déplace en tête toute clé « numérique » — un code postal.
"""

from typing import Annotated

from fastapi import APIRouter
from pydantic import ConfigDict, Field

from optimisation.api.json_js import ReponseJson
from optimisation.api.plans import Code, Entree, empreinte_entrees, verrou_calcul
from optimisation.api.sorties import SortieRecaler
from optimisation.noyau.historique.recalage_amorti import CpRecalage, ParamsRecalage, recaler

# Une extraction risque est plafonnée à 8 000 codes postaux (PLAFOND_CP des routes Next) ; un bassin par grappe.
MAX_CPS = 10_000
MAX_ZONES = 10_000
# `multiplicateur` est un `numeric(6,3)` borné à [0 ; 999,999] à l'écriture (sql/231).
MULT_MAX = 999.999
# Des impressions utiles d'un bassin sur deux semaines : 10¹² laisse toute somme finie (10 000 × 10¹² ≪ 1,8·10³⁰⁸).
UTILES_MAX = 1e12

Zone = Annotated[str, Field(min_length=1, max_length=64)]
Fini = Annotated[float, Field(ge=0)]


class CpRecalageEntree(Entree):
    model_config = ConfigDict(extra="ignore")
    code_postal: Code
    cluster_id: Zone | None
    multiplicateur: float = Field(ge=0, le=MULT_MAX)
    # Pourcentage (0 à 100) ; `Number(null)` du TS vaut 0.
    part_en_zone: float = Field(ge=0, le=100.0 + 1e-6)


class ParamsRecalageEntree(Entree):
    """Les trois paramètres lus par `recaler`, sous les noms du TS (`ParamsSimulation`)."""

    model_config = ConfigDict(extra="ignore")
    # Bornes de la route Next de simulation (`amortissement` 0-1) ; seuil en pourcentage ; baisse : un facteur.
    amortissement: float = Field(ge=0, le=1)
    seuilDilution: float = Field(ge=0, le=100)  # noqa: N815 — nom du TS, tel quel
    baisseDilues: float = Field(ge=0, le=1)  # noqa: N815


class RecalerEntree(Entree):
    model_config = ConfigDict(extra="forbid")
    cps: list[CpRecalageEntree] = Field(max_length=MAX_CPS)
    utiles_observees: list[tuple[Zone, Annotated[float, Field(ge=0, le=UTILES_MAX)]]] = Field(max_length=MAX_ZONES)
    cible: list[tuple[Zone, Annotated[float, Field(ge=0, le=1.0 + 1e-9)]]] = Field(max_length=MAX_ZONES)
    params: ParamsRecalageEntree


routeur = APIRouter(prefix="/v1/historique", default_response_class=ReponseJson)


@routeur.post("/recaler", responses={200: {"model": SortieRecaler}})
def route_recaler(entree: RecalerEntree) -> ReponseJson:
    """`recaler(cps, utilesObservees, cible, P)` — formule historique, comparée en ombre avant toute bascule."""
    cps = [
        CpRecalage(
            code_postal=c.code_postal,
            cluster_id=c.cluster_id,
            multiplicateur=float(c.multiplicateur),
            part_en_zone=float(c.part_en_zone),
        )
        for c in entree.cps
    ]
    # `dict` garde l'ordre d'insertion ; une clé répétée garde sa place et prend la dernière valeur, comme `Map.set`.
    observees = {z: float(v) for z, v in entree.utiles_observees}
    cible = {z: float(v) for z, v in entree.cible}
    p = ParamsRecalage(
        amortissement=float(entree.params.amortissement),
        seuil_dilution=float(entree.params.seuilDilution),
        baisse_dilues=float(entree.params.baisseDilues),
    )
    with verrou_calcul():
        rc = recaler(cps, observees, cible, p)
    return ReponseJson(
        {
            "multiplicateurs": [[k, v] for k, v in rc.multiplicateurs.items()],
            "corrections": [[k, v] for k, v in rc.corrections.items()],
            "dilues": list(rc.dilues),
            "algo": empreinte_entrees("/v1/historique/recaler", {"requete": entree.model_dump(mode="json")}),
        }
    )
