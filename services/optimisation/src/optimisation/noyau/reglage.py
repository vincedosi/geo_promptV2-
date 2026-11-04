"""Le réglage d'un plan CP lu dans le registre des mécanismes (`plateformes_poids`, sql/305), les plans par plateforme
(B12) et ce que chaque plateforme reçoit par mécanisme — port de `reglageDuPlan`, `plansParPlateforme` et
`sortiesPoids` (`lib/zones/plan-jeu-zone.ts`).
"""

import math

from optimisation.noyau.plan_zone import MULT_MAX, MULT_MIN_NON_NUL, plan_cp_de_zone
from optimisation.noyau.types import (
    Ajustement,
    AVerifier,
    AvertissementPoids,
    Bornes,
    ChoixPlateforme,
    LigneCouverture,
    MembresParCanonique,
    ModePlan,
    PlanPlateforme,
    PlateformePoids,
    RefusReglage,
    ReglagePlan,
    RegleGroupe,
    SortiePoids,
    VolumesAttendus,
)

LIBELLE_GROUPE: dict[str, str] = {"meme": "le même multiplicateur", "divise": "le multiplicateur divisé"}


def reglage_du_plan(poids: list[PlateformePoids], plateformes_au_cp: list[str]) -> ReglagePlan | RefusReglage:
    """`reglageDuPlan` : la plage la plus étroite des mécanismes `multiplicateur`, la règle de groupe UNIQUE, et un
    refus nommé si une plateforme au CP n'a aucune ligne au registre (on ne devine pas son mécanisme)."""
    sans_ligne = [
        p for p in plateformes_au_cp if not any(ligne.plateforme == p and ligne.maille == "cp" for ligne in poids)
    ]
    if sans_ligne:
        return RefusReglage(
            message=f"{', '.join(sans_ligne)} — aucun mécanisme de poids au CP dans le registre (plateformes_poids) : "
            "le plan ne peut pas être borné."
        )
    lignes = [ligne for ligne in poids if ligne.maille == "cp" and ligne.plateforme in plateformes_au_cp]
    regles: dict[RegleGroupe, list[str]] = {}
    for ligne in lignes:
        regle: RegleGroupe = ligne.poids_groupe_cp or "meme"
        regles[regle] = [*regles.get(regle, []), f"{ligne.plateforme} ({ligne.mecanisme})"]
    if len(regles) > 1:
        detail = " ; ".join(f"{', '.join(qui)} : {LIBELLE_GROUPE[r]}" for r, qui in regles.items())
        return RefusReglage(
            message=f"Règle d'un groupe de codes postaux divergente entre les plateformes au CP ({detail}) : le plan "
            "CP est commun à ces plateformes, choisissez-les dans deux jeux."
        )
    minimum, maximum = MULT_MIN_NON_NUL, MULT_MAX
    min_a_verifier = max_a_verifier = False
    for ligne in lignes:
        if ligne.mecanisme != "multiplicateur" or ligne.valeur_min is None or ligne.valeur_max is None:
            continue
        if ligne.valeur_min > minimum:
            minimum = ligne.valeur_min
            min_a_verifier = "valeur_min" in ligne.parametres_a_verifier
        if ligne.valeur_max < maximum:
            maximum = ligne.valeur_max
            max_a_verifier = "valeur_max" in ligne.parametres_a_verifier
    return ReglagePlan(
        bornes=Bornes(min=minimum, max=maximum),
        poids_groupe_cp=next(iter(regles), "meme"),
        a_verifier=AVerifier(min=min_a_verifier, max=max_a_verifier),
    )


def plans_par_plateforme(
    lignes: list[LigneCouverture],
    choix: list[ChoixPlateforme],
    mode_plan: ModePlan,
    groupes: MembresParCanonique,
    poids: list[PlateformePoids],
    codes_exacts: list[str] | None = None,
    volumes: VolumesAttendus | None = None,
) -> list[PlanPlateforme] | RefusReglage:
    """`plansParPlateforme` (B12) : un plan CP PAR plateforme, à son seuil et borné par SES mécanismes."""
    plans: list[PlanPlateforme] = []
    for c in choix:
        r = reglage_du_plan(poids, [c.plateforme])
        if isinstance(r, RefusReglage):
            return r
        plans.append(
            PlanPlateforme(
                plateforme=c.plateforme,
                seuil=c.seuil,
                reglage=r,
                plan=plan_cp_de_zone(lignes, c.seuil, mode_plan, groupes, codes_exacts, r, volumes),
            )
        )
    return plans


def sorties_poids(
    poids: list[PlateformePoids], plateforme: str, n_codes: int, ajustements: list[Ajustement]
) -> tuple[list[SortiePoids], list[AvertissementPoids]]:
    """`sortiesPoids` : une sortie par mécanisme de la plateforme au CP, et les avertissements qui en découlent.

    Un écrêtage n'est dit que chez une plateforme dont un mécanisme `multiplicateur` porte la borne franchie ; au-delà
    de `nb_max_entrees`, le plan part en `ceil(n_codes ÷ limite)` envois (comptés en CODES).
    """
    lignes = [ligne for ligne in poids if ligne.plateforme == plateforme and ligne.maille == "cp"]
    avertissements: list[AvertissementPoids] = []
    for a in ajustements:
        est_min = a["code"] == "multiplicateur_min"
        m = next(
            (
                ligne
                for ligne in lignes
                if ligne.mecanisme == "multiplicateur"
                and (ligne.valeur_min if est_min else ligne.valeur_max) == a["limite"]
            ),
            None,
        )
        if m is None:
            continue
        avertissement: AvertissementPoids = {
            "code": a["code"],
            "limite": a["limite"],
            "valeur": a["valeur"],
            "n": a["n"],
        }
        if ("valeur_min" if est_min else "valeur_max") in m.parametres_a_verifier:
            avertissement["a_verifier"] = True
        avertissements.append(avertissement)

    sorties: list[SortiePoids] = []
    for ligne in lignes:
        s: SortiePoids = {
            "mecanisme": ligne.mecanisme,
            "branche": ligne.branche,
            "poids_groupe_cp": ligne.poids_groupe_cp,
            "parametres_a_verifier": list(ligne.parametres_a_verifier),
            "n_codes": n_codes,
        }
        if ligne.valeur_min is not None and ligne.valeur_max is not None:
            s["valeur_min"] = ligne.valeur_min
            s["valeur_max"] = ligne.valeur_max
        if ligne.nb_max_entrees is not None:
            n_envois = max(1, math.ceil(n_codes / ligne.nb_max_entrees))
            s["nb_max_entrees"] = ligne.nb_max_entrees
            s["n_envois"] = n_envois
            if n_codes > ligne.nb_max_entrees:
                avertissement_entrees: AvertissementPoids = {
                    "code": "nb_max_entrees",
                    "limite": ligne.nb_max_entrees,
                    "valeur": n_codes,
                    "n": n_envois,
                    "mecanisme": ligne.mecanisme,
                }
                if "nb_max_entrees" in ligne.parametres_a_verifier:
                    avertissement_entrees["a_verifier"] = True
                avertissements.append(avertissement_entrees)
        sorties.append(s)
    return sorties, avertissements
