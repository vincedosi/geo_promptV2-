"""EXPORT du schéma OpenAPI (tâche 1.6) : `services/optimisation/openapi.json` est `app.openapi()`, au caractère près.

Le service ne sert pas `/openapi.json` (relecture A, M1) : c'est ce test qui l'exporte, et les types TS
(`lib/optimisation/types-openapi.ts`) sont générés depuis ce fichier par `node scripts/optimisation/generer-types.mjs`.
Un changement d'entrée ou de sortie d'une route fait échouer ce test tant que le fichier n'est pas réécrit :

    OPTIMISATION_ECRIRE_OPENAPI=1 uv run pytest tests/api/test_openapi.py

puis régénérer les types (le test Vitest `tests/unit/optimisation/types-openapi.test.ts` compare l'empreinte).
"""

import json
import os
from pathlib import Path
from typing import Any

from optimisation.api.app import app

FICHIER = Path(__file__).resolve().parents[2] / "openapi.json"


def texte_du_schema() -> str:
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"


def test_openapi_json_est_a_jour() -> None:
    attendu = texte_du_schema()
    if os.environ.get("OPTIMISATION_ECRIRE_OPENAPI") == "1":
        FICHIER.write_text(attendu, encoding="utf-8", newline="\n")
    assert FICHIER.exists(), "openapi.json absent : OPTIMISATION_ECRIRE_OPENAPI=1 uv run pytest (ce fichier)"
    assert FICHIER.read_text(encoding="utf-8") == attendu, (
        "openapi.json ne décrit plus les routes : le réécrire (OPTIMISATION_ECRIRE_OPENAPI=1) puis régénérer "
        "lib/optimisation/types-openapi.ts (node scripts/optimisation/generer-types.mjs)."
    )


def _schema_200(operation: dict[str, Any]) -> dict[str, Any]:
    contenu: dict[str, Any] = operation["responses"]["200"]["content"]["application/json"]["schema"]
    return contenu


def test_chaque_route_de_calcul_decrit_sa_sortie() -> None:
    """Sans `responses`, FastAPI écrit `{}` pour la sortie d'un `ReponseJson` : des types TS en `unknown`."""
    chemins = app.openapi()["paths"]
    attendus = {
        "/v1/plans/zone": "SortiePlanZone",
        "/v1/plans/risque": "SortiePlanRisque",
        "/v1/historique/recaler": "SortieRecaler",
    }
    for chemin, modele in attendus.items():
        assert _schema_200(chemins[chemin]["post"]) == {"$ref": f"#/components/schemas/{modele}"}, chemin


def test_le_resume_commun_declare_algo() -> None:
    schemas = app.openapi()["components"]["schemas"]
    assert "algo" in schemas["ResumeCommun"]["required"]
    assert schemas["Algo"]["properties"]["moteur"] == {"type": "string", "const": "python", "title": "Moteur"}
