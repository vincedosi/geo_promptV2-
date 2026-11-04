"""Le noyau est PUR : ni base, ni réseau, ni horloge, ni hasard, ni `sum(`.

C'est la condition pour rejouer un cycle depuis son instantané et retrouver la même empreinte
(plan § 4.5), et pour la parité bit à bit avec le TS (plan § 5.1 : `sum()` est compensée depuis
Python 3.12, le `reduce` JS ne l'est pas — passer par `somme_gauche`).

L'analyse se fait sur l'AST et non sur le texte : une docstring qui EXPLIQUE pourquoi `sum()` est
interdit ne doit pas faire échouer le test, un `from time import monotonic` doit le faire.
"""

import ast
from pathlib import Path

import pytest

NOYAU = Path(__file__).resolve().parents[2] / "src" / "optimisation" / "noyau"

MODULES_INTERDITS = frozenset(
    {"psycopg", "psycopg_pool", "httpx", "requests", "urllib", "socket", "time", "datetime", "random", "secrets"}
)
APPELS_INTERDITS = frozenset({"sum", "fsum"})


def violations(source: str, nom: str) -> list[str]:
    """Liste les imports et appels interdits d'un fichier source du noyau."""
    trouvees: list[str] = []
    for noeud in ast.walk(ast.parse(source, filename=nom)):
        if isinstance(noeud, ast.Import):
            for alias in noeud.names:
                if alias.name.split(".")[0] in MODULES_INTERDITS:
                    trouvees.append(f"{nom}:{noeud.lineno} import {alias.name}")
        elif isinstance(noeud, ast.ImportFrom):
            racine = (noeud.module or "").split(".")[0]
            if racine in MODULES_INTERDITS:
                trouvees.append(f"{nom}:{noeud.lineno} from {noeud.module} import …")
        elif isinstance(noeud, ast.Call):
            fonction = noeud.func
            appele = (
                fonction.id
                if isinstance(fonction, ast.Name)
                else fonction.attr
                if isinstance(fonction, ast.Attribute)
                else None
            )
            if appele in APPELS_INTERDITS:
                trouvees.append(f"{nom}:{noeud.lineno} appel {appele}(")
    return trouvees


def fichiers_du_noyau() -> list[Path]:
    return sorted(NOYAU.rglob("*.py"))


def test_le_noyau_existe_et_porte_des_fichiers() -> None:
    # Un dossier vide ou déplacé rendrait le test suivant vert sans rien vérifier.
    assert (NOYAU / "__init__.py").is_file()
    assert (NOYAU / "nombres.py").is_file()


def test_aucun_fichier_du_noyau_ne_fait_d_entree_sortie_ni_de_sum() -> None:
    toutes = [v for f in fichiers_du_noyau() for v in violations(f.read_text(encoding="utf-8"), f.name)]
    assert toutes == [], "Le noyau doit rester pur (somme : somme_gauche) :\n" + "\n".join(toutes)


@pytest.mark.parametrize(
    "source",
    [
        "import psycopg",
        "import httpx as h",
        "from time import monotonic",
        "import datetime",
        "from datetime import date",
        "import random",
        "x = sum([1.0, 2.0])",
        "import math\nx = math.fsum([1.0])",
        "import os.path, time",
    ],
)
def test_le_detecteur_voit_chaque_forme_interdite(source: str) -> None:
    assert violations(source, "essai.py") != []


def test_le_detecteur_ignore_les_textes_et_les_noms_voisins() -> None:
    source = '"""On n\'appelle jamais sum() ici, ni time."""\nsomme = 1\nresume_sum = somme\n'
    assert violations(source, "essai.py") == []
