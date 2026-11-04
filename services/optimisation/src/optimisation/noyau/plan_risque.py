"""Le plan d'un jeu RISQUE en sémantique `repartition` — port de `genererPlanCp` (`lib/zones/plan.ts`).

**Exclusif** : seuls les codes postaux retenus reçoivent une part, au prorata de `population en zone × poids de la
classe` ; hors zone, exactement zéro. **Pondéré** : tous les codes postaux, au prorata de `population totale × poids` ;
un non-retenu pèse comme un hors-zone. Les multiplicateurs sont centrés sur 1 (`part × n`), arrondis au millième et
bornés à `numeric(6,3)` ; un groupe de codes indiscernables reçoit le multiplicateur DIVISÉ par son nombre de membres
(`etendreAuxGroupes`, chemin risque seulement).

Avec `semantique="multiplicateur"`, la séquence E4 des jeux de zone (`plan_zone.plan_multiplicateur`).
"""

from typing import Literal

from optimisation.noyau.nombres import math_round, somme_gauche
from optimisation.noyau.plan_zone import BORNES_TECHNIQUES, MULT_MAX, MULT_MIN_NON_NUL, plan_multiplicateur
from optimisation.noyau.regroupement import CLASSE_HORS, poids_de_classe, regrouper_par_code_postal, taux_utile
from optimisation.noyau.types import Bornes, CpZone, Jeu, LignePlan, MembresParCanonique, Plan


def generer_plan_cp(
    entrees: list[CpZone],
    jeu: Jeu,
    membres: MembresParCanonique | None = None,
    semantique: Literal["repartition", "multiplicateur"] = "repartition",
    bornes: Bornes | None = None,
) -> Plan:
    """`genererPlanCp`. Replié par code postal AVANT tout calcul (une ligne par grappe depuis sql/225)."""
    exclusif = jeu.mode_plan == "exclusif"
    cps = regrouper_par_code_postal(entrees, jeu)

    if semantique == "multiplicateur":
        return plan_multiplicateur(cps, exclusif, bornes or BORNES_TECHNIQUES)

    bruts: list[float] = []
    for cp in cps:
        # Un code postal non retenu est traité comme hors zone, dans les DEUX modes.
        classe_effective = cp.classe if cp.retenu else CLASSE_HORS
        poids = cp.poids if cp.retenu else poids_de_classe(jeu, classe_effective)
        if exclusif:
            bruts.append(cp.pop_en_zone * poids if cp.retenu and classe_effective != CLASSE_HORS else 0.0)
        else:
            bruts.append(cp.pop_totale * poids)
    total = somme_gauche(bruts)
    n_retenus = len([c for c in cps if c.retenu])

    # Aucun poids : pas de plan. Surtout PAS de repli uniforme.
    if total <= 0:
        vides: list[LignePlan] = [
            {
                "code_postal": cp.code_postal,
                "part_plan": 0.0,
                "multiplicateur": 0.0,
                "classe": cp.classe,
                "retenu": cp.retenu,
            }
            for cp in cps
        ]
        return {
            "lignes": etendre_aux_groupes(vides, membres),
            "part_plan_en_zone": None,
            "taux_utile": taux_utile(cps),
            "n_retenus": n_retenus,
        }

    n = len(cps)
    lignes: list[LignePlan] = []
    for cp, brut_cp in zip(cps, bruts, strict=True):
        part = brut_cp / total
        # Centré sur 1 : la moyenne des multiplicateurs vaut 1, la valeur neutre.
        arrondi = math_round(part * n * 1000) / 1000
        multiplicateur = min(MULT_MAX, max(MULT_MIN_NON_NUL, arrondi)) if part > 0 else 0.0
        lignes.append(
            {
                "code_postal": cp.code_postal,
                "part_plan": part,
                "multiplicateur": multiplicateur,
                "classe": cp.classe,
                "retenu": cp.retenu,
            }
        )

    en_zone = 0.0
    for cp, ligne in zip(cps, lignes, strict=True):
        en_zone = en_zone + (ligne["part_plan"] if cp.retenu and cp.classe != CLASSE_HORS else 0.0)

    return {
        "lignes": etendre_aux_groupes(lignes, membres),
        "part_plan_en_zone": math_round(en_zone * 1000) / 10,
        "taux_utile": taux_utile(cps),
        # Compté sur les codes postaux CANONIQUES, avant l'étalement.
        "n_retenus": n_retenus,
    }


def etendre_aux_groupes(lignes: list[LignePlan], membres: MembresParCanonique | None) -> list[LignePlan]:
    """`etendreAuxGroupes` : chaque ligne étalée sur son groupe, multiplicateur DIVISÉ par le nombre de membres,
    plancher `MULT_MIN_NON_NUL` ré-appliqué après la division."""
    if not membres:
        return lignes
    sortie: list[LignePlan] = []
    for ligne in lignes:
        groupe = membres.get(ligne["code_postal"])
        if not groupe or len(groupe) <= 1:
            sortie.append(ligne)
            continue
        n = len(groupe)
        part = ligne["part_plan"] / n
        brut = math_round((ligne["multiplicateur"] / n) * 1000) / 1000
        multiplicateur = min(MULT_MAX, max(MULT_MIN_NON_NUL, brut)) if ligne["multiplicateur"] > 0 else 0.0
        for code_postal in groupe:
            sortie.append({**ligne, "code_postal": code_postal, "part_plan": part, "multiplicateur": multiplicateur})
    return sortie
