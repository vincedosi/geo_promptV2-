"""Une déclinaison des zones de référence (fixtures T2), remise en forme de REQUÊTE `/v1/plans/zone` et de réponse
attendue : ce que le TS a reçu et rendu pour la même extraction."""

from dataclasses import dataclass
from functools import cache
from typing import Any

from optimisation.noyau.types import PlateformePoids, VolumesAttendus
from tests.parite.adaptation import INDEFINI, Carte, charger, decoder, plateforme_poids, volumes


@dataclass(frozen=True)
class Declinaison:
    requete: dict[str, Any]
    poids: list[PlateformePoids]
    volumes: VolumesAttendus
    univers: str
    commun: Any
    plans: Any
    # `sortiesPoids` dans l'ordre du générateur : pour chaque plateforme, sur le plan commun puis sur son plan.
    sorties: list[Any]


def _json(v: Any) -> Any:
    if v is INDEFINI:
        return None
    if isinstance(v, Carte):
        return {k: _json(x) for k, x in v.items()}
    if isinstance(v, dict):
        return {k: _json(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_json(x) for x in v]
    return v


@cache
def _zones() -> list[dict[str, Any]]:
    return list(charger("zones-reference.json.gz")["cas"])


def declinaison(zone: str, nom: str) -> Declinaison:
    test = f"zones de référence > {zone} > {nom}"
    appels = [c for c in _zones() if c["test"] == test]
    par = {c["fonction"]: c for c in appels}
    propres = decoder(par["plansParPlateforme"]["entree"]["args"])
    commun = decoder(par["planCpDeZone"]["entree"]["args"])
    univers = decoder(par["universDeZone"]["entree"]["args"])
    recette = univers[1] if len(univers) > 1 else None
    sortie_commun = decoder(par["planCpDeZone"]["sortie"])
    # `n_codes_conversion` est obligatoire (relecture B, M5) : le générateur appelle `sortiesPoids` du plan commun avec
    # `commun.resume.n_codes` (`generer-fixtures.ts`), c'est donc ce que Next aurait envoyé pour ces cas.
    choix = [{**c, "n_codes_conversion": sortie_commun["resume"]["n_codes"]} for c in _json(propres[1])]
    requete = {
        "couverture": _json(propres[0]),
        "choix": choix,
        "mode_plan": propres[2],
        "groupes": _json(propres[3]),
        "codes_exacts": _json(propres[5]) if len(propres) > 5 else None,
        "recette": None if recette in (None, INDEFINI) else {"type": recette["type"], "code": recette.get("code")},
    }
    vols = volumes(commun[6])
    assert vols is not None
    return Declinaison(
        requete=requete,
        poids=[plateforme_poids(x) for x in propres[4]],
        volumes=vols,
        univers=decoder(par["universDeZone"]["sortie"]),
        commun=sortie_commun,
        plans=decoder(par["plansParPlateforme"]["sortie"]),
        sorties=[decoder(c["sortie"]) for c in appels if c["fonction"] == "sortiesPoids"],
    )
