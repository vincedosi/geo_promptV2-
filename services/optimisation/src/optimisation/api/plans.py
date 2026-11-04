"""`POST /v1/plans/zone` et `POST /v1/plans/risque` : le plan initial (T4, plan § 2.2).

Next (T5) envoie ce que le découpage a figé — couverture CP, choix des plateformes au CP et leur seuil, groupes de
codes indiscernables, liste exacte, type de recette, mode du plan — et reçoit le plan commun, le plan de chaque
plateforme, ses sorties de poids et `algo`. Python lit lui-même le REGISTRE (`plateformes_poids`) et les VOLUMES
(`volumes_attendus_cp_univers`) : ce sont des entrées de l'algorithme, pas du découpage.

`algo = {moteur, version, entrees_sha256}` : l'empreinte sha256 du JSON canonique de TOUT ce qui a servi au calcul
(requête, registre lu, volumes lus) — rejouer ces entrées rend le même plan. Rendu à la racine et dans
`commun.resume.algo` (`resume_plan.algo`, plan § 2.3). ⚠ `creer_extraction_jeu_zone` ne fige aujourd'hui que
`multiplicateur` et `part_prevue` du résumé : persister `algo` demande d'amender la fonction quand Next l'enverra (T5).

Aucune écriture : la base n'est que lue, l'écriture de l'extraction reste SQL.
"""

import hashlib
import json
from collections.abc import Iterator
from dataclasses import asdict
from typing import Annotated, Any, Literal, Protocol

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from optimisation import __version__, config
from optimisation.api.json_js import ReponseJson, normaliser
from optimisation.base import BaseIndisponible, connexion
from optimisation.lecture.registre import RegistreIllisible, lire_poids
from optimisation.lecture.volumes import VolumesIllisibles, lire_volumes
from optimisation.noyau.part_prevue import univers_de_zone
from optimisation.noyau.plan_risque import generer_plan_cp
from optimisation.noyau.plan_zone import plan_cp_de_zone
from optimisation.noyau.reglage import plans_par_plateforme, reglage_du_plan, sorties_poids
from optimisation.noyau.types import (
    ChoixPlateforme,
    CpZone,
    Jeu,
    LigneCouverture,
    PlateformePoids,
    RefusReglage,
    ReglagePlan,
    Univers,
    VolumesAttendus,
)

# Bornes des entrées : un plan national compte ≈ 6 100 unités CP ; `zone_set_cp` est plafonné à 8 000 par les routes
# risque (PLAFOND_CP). Au-delà, ce n'est plus un plan mais une erreur de l'appelant.
MAX_UNITES = 10_000
MAX_CODES_EXACTS = 10_000
MAX_GROUPES = 2_000
MAX_LIGNES_RISQUE = 20_000

MESSAGE_INDISPONIBLE = "Le calcul du plan est indisponible, réessayez dans une minute."

Plateforme = Literal["dv360", "ttd", "meta", "tiktok"]
Code = Annotated[str, Field(min_length=1, max_length=16)]


# ── Entrées ──────────────────────────────────────────────────────────────────────────────────────────────────────────


class LigneCouvertureEntree(BaseModel):
    """Une unité de `couverture_zone` (maille CP). Les champs d'affichage (`nom`, `commune`…) sont ignorés."""

    model_config = ConfigDict(extra="ignore")
    code: Code
    pop_en_zone: float | None
    pop_totale: float | None
    part: float | None
    part_brute: float | None
    membres: list[Code] | None = Field(default=None, max_length=50)
    incluse: bool | None = None


class ChoixEntree(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plateforme: Plateforme
    seuil: float = Field(ge=0, le=100)
    # Le nombre de CODES que la conversion de cette plateforme a retenus (`resume.n_codes ?? n_unites`) : c'est lui que
    # comptent ses limites d'entrées sur le plan COMMUN (`sortiesPoids`). Absent : celui du plan commun.
    n_codes_conversion: int | None = Field(default=None, ge=0)


class RecetteEntree(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: str = Field(min_length=1, max_length=40)
    code: str | None = None


class PlanZoneEntree(BaseModel):
    model_config = ConfigDict(extra="forbid")
    couverture: list[LigneCouvertureEntree] = Field(max_length=MAX_UNITES)
    choix: list[ChoixEntree] = Field(min_length=1, max_length=4)
    mode_plan: Literal["exclusif", "pondere"]
    groupes: dict[Code, list[Code]] = Field(default_factory=dict, max_length=MAX_GROUPES)
    codes_exacts: list[Code] | None = Field(default=None, max_length=MAX_CODES_EXACTS)
    recette: RecetteEntree | None = None


class CpZoneEntree(BaseModel):
    """Une ligne de `zone_set_cp` (une par grappe), telle que la route risque la convertit."""

    model_config = ConfigDict(extra="ignore")
    code_postal: Code
    classe: str = Field(min_length=1, max_length=40)
    pop_en_zone: float
    pop_totale: float
    retenu: bool


class JeuEntree(BaseModel):
    model_config = ConfigDict(extra="ignore")
    mode_plan: Literal["exclusif", "pondere"]
    poids: dict[str, float] = Field(default_factory=dict, max_length=200)


class PlanRisqueEntree(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cps: list[CpZoneEntree] = Field(min_length=1, max_length=MAX_LIGNES_RISQUE)
    jeu: JeuEntree
    groupes: dict[Code, list[Code]] = Field(default_factory=dict, max_length=MAX_GROUPES)


# ── Lecteurs (remplaçables en test) ──────────────────────────────────────────────────────────────────────────────────


class Lecteur(Protocol):
    def poids(self, plateformes: list[str]) -> list[PlateformePoids]: ...

    def volumes(self, codes: list[str], univers: Univers) -> VolumesAttendus: ...


class LecteurBase:
    """Les deux lectures sur UNE connexion empruntée au pool, l'une après l'autre (jamais en parallèle)."""

    def __init__(self, conn: Any) -> None:
        self._conn = conn

    def poids(self, plateformes: list[str]) -> list[PlateformePoids]:
        return lire_poids(self._conn, plateformes, "cp")

    def volumes(self, codes: list[str], univers: Univers) -> VolumesAttendus:
        return lire_volumes(self._conn, codes, univers)


def obtenir_lecteur() -> Iterator[Lecteur]:
    """Dépendance : un lecteur sur une connexion du pool, rendue à la fin de la requête."""
    try:
        with connexion(config.url_base()) as conn:
            yield LecteurBase(conn)
    except BaseIndisponible as erreur:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"message": MESSAGE_INDISPONIBLE, "cause": str(erreur)},
        ) from erreur


# ── Sérialisation des objets du noyau ────────────────────────────────────────────────────────────────────────────────


def reglage_en_json(r: ReglagePlan) -> dict[str, Any]:
    """Le réglage tel que le TS l'écrit : clés absentes omises."""
    sortie: dict[str, Any] = {}
    if r.bornes is not None:
        sortie["bornes"] = {"min": r.bornes.min, "max": r.bornes.max}
    if r.poids_groupe_cp is not None:
        sortie["poids_groupe_cp"] = r.poids_groupe_cp
    if r.a_verifier is not None:
        sortie["a_verifier"] = {"min": r.a_verifier.min, "max": r.a_verifier.max}
    return sortie


def empreinte_entrees(route: str, entrees: dict[str, Any]) -> dict[str, str]:
    """`algo` : moteur, version et sha256 du JSON canonique des entrées (clés triées, entiers au format JS)."""
    canonique = json.dumps(
        normaliser({"route": route, **entrees}),
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return {
        "moteur": "python",
        "version": __version__,
        "entrees_sha256": hashlib.sha256(canonique.encode("utf-8")).hexdigest(),
    }


def _refus(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"refus": "registre", "message": message}
    )


def _illisible(erreur: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"message": MESSAGE_INDISPONIBLE, "cause": str(erreur)}
    )


# ── Routes ───────────────────────────────────────────────────────────────────────────────────────────────────────────

routeur = APIRouter(prefix="/v1/plans", default_response_class=ReponseJson)


@routeur.post("/zone")
def plan_zone(entree: PlanZoneEntree, lecteur: Annotated[Lecteur, Depends(obtenir_lecteur)]) -> ReponseJson:
    """Plan commun (D32, déprécié mais encore écrit) + un plan par plateforme au CP (B12) + sorties de poids."""
    plateformes = [c.plateforme for c in entree.choix]
    if len(set(plateformes)) != len(plateformes):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Plateforme en double dans le choix."
        )
    lignes = [
        LigneCouverture(
            code=x.code,
            pop_en_zone=x.pop_en_zone,
            pop_totale=x.pop_totale,
            part=x.part,
            part_brute=x.part_brute,
            membres=tuple(x.membres) if x.membres is not None else None,
            incluse=x.incluse,
        )
        for x in entree.couverture
    ]
    groupes = {k: list(v) for k, v in entree.groupes.items()}
    liste = list(entree.codes_exacts) if entree.codes_exacts is not None else None
    choix = [ChoixPlateforme(plateforme=c.plateforme, seuil=c.seuil) for c in entree.choix]

    # La séquence de l'extraction (`extraction-jeu-zone.ts`) : registre → réglage commun → univers → volumes → plans.
    try:
        poids = lecteur.poids(list(plateformes))
        reglage = reglage_du_plan(poids, list(plateformes))
        if isinstance(reglage, RefusReglage):
            raise _refus(reglage.message)
        codes = [x.code for x in lignes] + (liste or [])
        univers = univers_de_zone(
            codes, entree.recette.type if entree.recette else None, entree.recette.code if entree.recette else None
        )
        volumes = lecteur.volumes(codes, univers)
    except (RegistreIllisible, VolumesIllisibles) as erreur:
        raise _illisible(erreur) from erreur
    except ValueError as erreur:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(erreur)) from erreur

    propres = plans_par_plateforme(lignes, choix, entree.mode_plan, groupes, poids, liste, volumes)
    if isinstance(propres, RefusReglage):
        raise _refus(propres.message)
    commun = plan_cp_de_zone(lignes, min(c.seuil for c in choix), entree.mode_plan, groupes, liste, reglage, volumes)

    par_plateforme: list[dict[str, Any]] = []
    sorties_commun: list[dict[str, Any]] = []
    for p, c in zip(propres, entree.choix, strict=True):
        n_codes = c.n_codes_conversion if c.n_codes_conversion is not None else commun["resume"]["n_codes"]
        s_commun, a_commun = sorties_poids(
            poids, p.plateforme, n_codes, commun["resume"]["multiplicateur"]["ajustements"]
        )
        sorties_commun.append({"plateforme": p.plateforme, "poids": s_commun, "avertissements": a_commun})
        s_propre, a_propre = sorties_poids(
            poids, p.plateforme, p.plan["resume"]["n_codes"], p.plan["resume"]["multiplicateur"]["ajustements"]
        )
        par_plateforme.append(
            {
                "plateforme": p.plateforme,
                "seuil": p.seuil,
                "reglage": reglage_en_json(p.reglage),
                "plan": p.plan,
                "poids": s_propre,
                "avertissements": a_propre,
            }
        )

    algo = empreinte_entrees(
        "/v1/plans/zone",
        {
            "requete": entree.model_dump(mode="json"),
            "registre": [asdict(x) for x in poids],
            "volumes": {"univers": volumes.univers, "total": volumes.total, "par_code": dict(volumes.par_code)},
        },
    )
    resume_commun: dict[str, Any] = {**commun["resume"], "algo": algo}
    return ReponseJson(
        {
            "commun": {"lignes": commun["lignes"], "resume": resume_commun},
            "reglage": reglage_en_json(reglage),
            "par_plateforme": par_plateforme,
            "sorties_poids": sorties_commun,
            "algo": algo,
        }
    )


@routeur.post("/risque")
def plan_risque(entree: PlanRisqueEntree) -> ReponseJson:
    """Plan d'un jeu RISQUE, sémantique `repartition` (`genererPlanCp` avec les groupes divisés). Aucune lecture."""
    plan = generer_plan_cp(
        [
            CpZone(
                code_postal=x.code_postal,
                classe=x.classe,
                pop_en_zone=x.pop_en_zone,
                pop_totale=x.pop_totale,
                retenu=x.retenu,
            )
            for x in entree.cps
        ],
        Jeu(mode_plan=entree.jeu.mode_plan, poids=dict(entree.jeu.poids)),
        {k: list(v) for k, v in entree.groupes.items()},
    )
    algo = empreinte_entrees("/v1/plans/risque", {"requete": entree.model_dump(mode="json")})
    return ReponseJson({**plan, "algo": algo})
