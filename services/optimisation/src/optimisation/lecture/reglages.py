"""Les RÉGLAGES d'optimisation d'une campagne (tâche 2.3) : `optimisation_reglages` (sql/345).

Une ligne par campagne, facultative : sans ligne, ou sans une clé, la valeur d'avant s'applique (défauts = les
littéraux de `get_campaign_suivi` et le comportement de la phase 1). `parametres` est validé ici par Pydantic ET en base
par le CHECK `optimisation_parametres_valides` ; les deux listes de clés doivent rester égales
(`tests/lecture/test_reglages.py` les compare).

CLOISONNEMENT (plan § 6 et § 9.3) : `optimisation_service` est BYPASSRLS, la barrière est donc ICI. La lecture exige
l'espace (`X-Espace`) et ne rend la campagne que si elle appartient à cet espace (`dsp_campaigns.organization_id`) ; le
réglage n'est joint que s'il porte le même `workspace_id`. Une campagne d'un autre espace → `CampagneHorsEspace` (que
l'API traduira en 404, sans dire si la campagne existe).

EXPLAIN ANALYZE (local, 05/11) : 4 tampons, 0,9 ms — `dsp_campaigns` en parcours séquentiel (11 lignes : le
planificateur préfère le parcours à la clé primaire tant que la table est minuscule), `optimisation_reglages` par sa
clé primaire.
"""

import json
from decimal import Decimal
from typing import Any, Literal

import psycopg
from pydantic import BaseModel, ConfigDict, Field, model_validator

from optimisation.noyau.mesures import (
    CP_SOUS_PLAN_PCT,
    CPM_DEPASSEMENT,
    FUITE_PCT,
    RYTHME_AVANCE,
    RYTHME_AVANCE_GRAVE,
    RYTHME_RETARD,
    RYTHME_RETARD_GRAVE,
    SeuilsSuivi,
)

ALGO_DEFAUT = "uniformiser_global"
# ± 20 % des constats (`lib/campagne/constats.ts:76`, `SEUIL_ECART_SIGNALE_PCT`) : validé et stocké, lu par personne
# aujourd'hui (le calcul des constats reste TS, affichage React gelé).
ECART_SIGNALE_PCT = Decimal(20)

UniversMethodeA = Literal["fige", "referentiel"]


class Seuils(BaseModel):
    """`parametres.seuils` : chaque seuil est facultatif et strictement positif ; défaut = la valeur d'avant."""

    # Strict : un nombre écrit en texte ("0.85") est refusé, comme par le CHECK (`jsonb_typeof = 'number'`).
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    rythme_retard: Decimal = Field(default=RYTHME_RETARD, gt=0)
    rythme_retard_grave: Decimal = Field(default=RYTHME_RETARD_GRAVE, gt=0)
    rythme_avance: Decimal = Field(default=RYTHME_AVANCE, gt=0)
    rythme_avance_grave: Decimal = Field(default=RYTHME_AVANCE_GRAVE, gt=0)
    cpm_depassement: Decimal = Field(default=CPM_DEPASSEMENT, gt=0)
    cp_sous_plan_pct: Decimal = Field(default=CP_SOUS_PLAN_PCT, gt=0)
    fuite_pct: Decimal = Field(default=FUITE_PCT, gt=0)
    ecart_signale_pct: Decimal = Field(default=ECART_SIGNALE_PCT, gt=0)

    @model_validator(mode="after")
    def _ordonnes(self) -> "Seuils":
        if self.rythme_retard_grave > self.rythme_retard:
            raise ValueError("le retard grave doit être sous le retard (rythme_retard_grave ≤ rythme_retard)")
        if self.rythme_avance_grave < self.rythme_avance:
            raise ValueError("l'avance grave doit être au-dessus de l'avance (rythme_avance_grave ≥ rythme_avance)")
        if self.rythme_retard >= self.rythme_avance:
            raise ValueError("le seuil de retard doit être sous celui d'avance (rythme_retard < rythme_avance)")
        return self

    def du_suivi(self) -> SeuilsSuivi:
        return SeuilsSuivi(
            rythme_retard=self.rythme_retard,
            rythme_retard_grave=self.rythme_retard_grave,
            rythme_avance=self.rythme_avance,
            rythme_avance_grave=self.rythme_avance_grave,
            cpm_depassement=self.cpm_depassement,
            cp_sous_plan_pct=self.cp_sous_plan_pct,
            fuite_pct=self.fuite_pct,
        )


class ParametresOptimisation(BaseModel):
    """`optimisation_reglages.parametres`. Une clé inconnue est REFUSÉE (une faute de frappe ne doit pas passer pour
    un réglage appliqué) ; une phase qui ajoute une clé l'ajoute ici ET dans `optimisation_parametres_valides`."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    seuils: Seuils = Seuils()
    # Tâche 2.1 : tableaux par CP construits DEPUIS LE PLAN (CP jamais servis compris). Défaut : comme avant.
    tableaux_depuis_plan: bool = False
    # Tâche 2.2 : univers du plan méthode A. 'fige' = les codes du plan écrit (phase 1, défaut) ; 'referentiel' =
    # `ref_codes_postaux` complet.
    univers_methode_a: UniversMethodeA = "fige"


class Reglages(BaseModel):
    model_config = ConfigDict(frozen=True)

    campagne_id: str
    workspace_id: str
    algo_id: str = ALGO_DEFAUT
    parametres: ParametresOptimisation = ParametresOptimisation()
    enregistre: bool = False  # une ligne existe en base (sinon : tous les défauts)


class CampagneHorsEspace(Exception):
    """La campagne n'existe pas, ou n'appartient pas à l'espace demandé (indiscernables à dessein)."""


class ReglagesIllisibles(Exception):
    """`parametres` en base ne passe pas la validation (le CHECK aurait dû l'empêcher)."""


def parametres_depuis_json(texte: str) -> ParametresOptimisation:
    """Le JSON de `parametres`, nombres relus en `Decimal` (pas de flottant : `0.85` reste `0.85`)."""
    brut: Any = json.loads(texte, parse_float=Decimal, parse_int=Decimal)
    try:
        return ParametresOptimisation.model_validate(brut)
    except ValueError as erreur:
        raise ReglagesIllisibles(str(erreur)) from erreur


_REQUETE = """
select c.organization_id::text, r.algo_id, r.parametres::text
  from public.dsp_campaigns c
  left join public.optimisation_reglages r on r.campagne_id = c.id and r.workspace_id = c.organization_id
 where c.id = %(campagne)s and c.organization_id = %(espace)s
"""


def lire_reglages(connexion: psycopg.Connection[Any], campagne: str, espace: str) -> Reglages:
    """Les réglages de la campagne dans l'espace donné ; tous les défauts s'il n'y a pas de ligne."""
    with connexion.cursor() as cur:
        cur.execute(_REQUETE, {"campagne": campagne, "espace": espace})
        ligne = cur.fetchone()
    if ligne is None:
        raise CampagneHorsEspace(campagne)
    espace_lu, algo, parametres = ligne
    if algo is None:
        return Reglages(campagne_id=campagne, workspace_id=str(espace_lu))
    return Reglages(
        campagne_id=campagne,
        workspace_id=str(espace_lu),
        algo_id=str(algo),
        parametres=parametres_depuis_json(str(parametres)),
        enregistre=True,
    )
