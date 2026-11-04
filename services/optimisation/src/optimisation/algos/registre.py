"""Registre unique des algorithmes (plan § 16.1) : `id → Algorithme`, servi tel quel par `GET /v1/algos`.

Six entrées :

| id                      | famille     | état       | proposable | calcul                                      |
|-------------------------|-------------|------------|------------|---------------------------------------------|
| `plan_donnee_insee`     | plan        | disponible | non        | `noyau.pression.multiplicateurs_methode_a`  |
| `plan_jeu_de_zones`     | plan        | disponible | non        | `noyau.plan_zone.plan_cp_de_zone`           |
| `rebid_plafonne`        | correction  | disponible | non        | `noyau.historique.rebid_plafonne`           |
| `recalage_amorti`       | correction  | disponible | non        | `noyau.historique.recalage_amorti.recaler`  |
| `uniformiser_global`    | correction  | à venir    | oui        | — (phase 4) ; DÉFAUT d'une campagne         |
| `uniformiser_par_regie` | correction  | à venir    | oui        | — (phases 3-4)                              |

Les ports de phase 1 sont référencés, pas recopiés : leurs sorties ne peuvent pas changer en passant par ici.

Les deux formules historiques sont `proposable = False` : réservées au simulateur (§ 16.4, PROPOSITION EN ATTENTE de
confirmation du propriétaire). Les plans aussi : ils sont au catalogue pour la traçabilité, ils ne se choisissent pas
dans ⑦ (§ 16.6 point 4).

Les deux algorithmes à venir partagent un jeu de paramètres communs (cahier point 5, plan § 8) ; « au global » ajoute
la tolérance de « le global décide » ; K et la réduction minimale servent aux deux (saturation pour l'un, butée pour
l'autre : § 16.6 points 2 et 3). Bornes min/max : décisions prises seul, à valider (rapport du lot B de la phase 2).
"""

from collections.abc import Mapping
from typing import Any

from optimisation.algos.contrat import (
    AlgoAVenir,
    AlgoInconnu,
    Algorithme,
    Famille,
    Parametre,
)
from optimisation.noyau.historique.rebid_plafonne import compute_rebid_weights
from optimisation.noyau.historique.recalage_amorti import recaler
from optimisation.noyau.plan_zone import plan_cp_de_zone
from optimisation.noyau.pression import PRESSION_MAX, PRESSION_MIN, multiplicateurs_methode_a

ALGO_CORRECTION_DEFAUT = "uniformiser_global"

# --- Paramètres communs aux deux algorithmes de correction à venir (cahier point 5, plan §§ 7-8) --------------------

_COMMUNS: tuple[Parametre, ...] = (
    Parametre("alpha", "Force de la correction (α)", 0.5, 0.1, 1.0, ""),
    Parametre("coefficient_min", "Coefficient minimal par envoi", 0.8, 0.5, 1.0, "×"),
    Parametre("coefficient_max", "Coefficient maximal par envoi", 1.2, 1.0, 2.0, "×"),
    Parametre("fenetre_jours", "Fenêtre de lissage", 7, 3, 14, "jours", entier=True),
    Parametre("fenetre_min_jours", "Fenêtre minimale avant toute correction", 3, 1, 7, "jours", entier=True),
    Parametre("dilution_seuil", "Seuil de dilution d'un code postal", 20.0, 0.0, 100.0, "%"),
    Parametre("dilution_baisse", "Baisse d'un code postal dilué", 0.6, 0.0, 1.0, "×"),
    Parametre("poids_min", "Poids minimal", 0.001, 0.001, 1.0, ""),
    Parametre("poids_max", "Poids maximal", 999.999, 1.0, 999.999, ""),
    Parametre("volume_min", "Volume minimal par zone", 100, 0, 100_000, "impressions", entier=True),
    Parametre("cadence_jours", "Jours entre deux propositions", 5, 3, 7, "jours", entier=True),
    Parametre("seuil_envoi_anticipe", "Baisse du score avant proposition anticipée", 5.0, 1.0, 50.0, "points"),
    Parametre("delai_min_anticipe_jours", "Délai avant proposition anticipée", 3, 1, 7, "jours", entier=True),
    Parametre("plafond_cout_pondere", "Plafond du coût pondéré", 1.25, 1.0, 3.0, "× le coût prévu"),
    Parametre("rythme_depense_min", "Rythme de dépense minimal", 0.5, 0.0, 1.0, "× prévu"),
    Parametre("cycles_butee", "Cycles en butée avant de conclure", 3, 2, 10, "cycles", entier=True),
    Parametre("reduction_ecart_min", "Réduction minimale de l'écart sur ces cycles", 10.0, 0.0, 100.0, "%"),
)
_ORDRES_COMMUNS: tuple[tuple[str, str], ...] = (
    ("coefficient_min", "coefficient_max"),
    ("fenetre_min_jours", "fenetre_jours"),
    ("poids_min", "poids_max"),
    ("delai_min_anticipe_jours", "cadence_jours"),
)
_TOLERANCE_GLOBAL = Parametre("tolerance_global", "Tolérance de l'écart global avant correction", 10.0, 0.0, 50.0, "%")


_ENTREES: tuple[Algorithme, ...] = (
    Algorithme(
        id="plan_donnee_insee",
        version=1,
        libelle="Plan par donnée INSEE et pression",
        description=(
            "Le poids de chaque code postal suit une donnée INSEE (par exemple l'abstention) : les codes postaux les "
            "plus proches de la cible reçoivent jusqu'à la pression choisie, les moins proches jusqu'à son inverse. "
            "C'est le plan initial de la méthode A ; il ne se choisit pas dans l'onglet Activation."
        ),
        familles=("plan",),
        proposable=False,
        etat="disponible",
        parametres=(Parametre("pression", "Pression sur la cible", 2.2, PRESSION_MIN, PRESSION_MAX, "×"),),
        calculer=multiplicateurs_methode_a,
    ),
    Algorithme(
        id="plan_jeu_de_zones",
        version=1,
        libelle="Plan par jeu de zones",
        description=(
            "Le poids de chaque code postal suit la part de sa population qui vit dans les zones dessinées, "
            "pondérée par la classe de la zone. C'est le plan initial de la méthode B ; il ne se choisit pas dans "
            "l'onglet Activation."
        ),
        familles=("plan",),
        proposable=False,
        etat="disponible",
        calculer=plan_cp_de_zone,
    ),
    Algorithme(
        id="rebid_plafonne",
        version=1,
        libelle="Rebid plafonné (historique)",
        description=(
            "Ancienne correction : chaque poids est multiplié par le rapport entre la part prévue et la part livrée, "
            "plafonné à plus ou moins 50 %, puis ramené à 100 dans chaque zone. Gardée pour comparer les formules "
            "dans le simulateur ; elle n'est pas proposée à l'écran."
        ),
        familles=("correction",),
        proposable=False,
        etat="disponible",
        calculer=compute_rebid_weights,
    ),
    Algorithme(
        id="recalage_amorti",
        version=1,
        libelle="Recalage amorti (historique)",
        description=(
            "Ancienne correction : chaque bassin est corrigé par le rapport entre sa part prévue et sa part observée, "
            "atténué par l'amortissement ; les codes postaux peu couverts par la zone sont baissés. Gardée pour "
            "comparer les formules dans le simulateur ; elle n'est pas proposée à l'écran."
        ),
        familles=("correction",),
        proposable=False,
        etat="disponible",
        parametres=(
            Parametre("amortissement", "Amortissement", 0.8, 0.0, 1.0, ""),
            Parametre("seuil_dilution", "Seuil de dilution d'un code postal", 20.0, 0.0, 100.0, "%"),
            Parametre("baisse_dilues", "Baisse d'un code postal dilué", 0.6, 0.0, 1.0, "×"),
        ),
        calculer=recaler,
    ),
    Algorithme(
        id="uniformiser_global",
        version=1,
        libelle="Uniformiser au global",
        description=(
            "Le poids de chaque zone est respecté sur la campagne, toutes régies additionnées. Si une régie "
            "sur-diffuse une zone qu'une autre sous-livre et que la somme est conforme au plan, rien ne bouge : on ne "
            "pousse pas une régie contre l'autre. Une régie qui reste en butée sur une zone passe la main aux régies "
            "qui ont de la marge, sans changer aucun budget."
        ),
        familles=("correction",),
        proposable=True,
        etat="a_venir",
        parametres=(*_COMMUNS, _TOLERANCE_GLOBAL),
        ordres=_ORDRES_COMMUNS,
    ),
    Algorithme(
        id="uniformiser_par_regie",
        version=1,
        libelle="Uniformiser par régie",
        description=(
            "Chaque régie respecte le poids de chaque zone pour elle-même, sans transfert entre régies. Une régie qui "
            "reste en butée sur une zone garde son réglage sur cette zone, et une alerte part au trader."
        ),
        familles=("correction",),
        proposable=True,
        etat="a_venir",
        parametres=_COMMUNS,
        ordres=_ORDRES_COMMUNS,
    ),
)

REGISTRE: Mapping[str, Algorithme] = {a.id: a for a in _ENTREES}


def obtenir(algo_id: str) -> Algorithme:
    """L'algorithme `algo_id`, ou `AlgoInconnu`."""
    algo = REGISTRE.get(algo_id)
    if algo is None:
        raise AlgoInconnu(algo_id)
    return algo


def catalogue(famille: Famille | None = None, proposable: bool | None = None) -> list[Algorithme]:
    """Le catalogue, dans l'ordre du registre, filtré par famille et/ou par `proposable`."""
    return [
        a
        for a in _ENTREES
        if (famille is None or famille in a.familles) and (proposable is None or a.proposable is proposable)
    ]


def executer(algo_id: str, *args: Any, **kwargs: Any) -> Any:
    """Appelle l'algorithme `algo_id` avec les arguments de SON contrat. Inconnu → `AlgoInconnu` ; déclaré sans
    calcul → `AlgoAVenir` (l'API rend 422 dans les deux cas)."""
    algo = obtenir(algo_id)
    if algo.calculer is None:
        raise AlgoAVenir(algo.id, algo.libelle)
    return algo.calculer(*args, **kwargs)
