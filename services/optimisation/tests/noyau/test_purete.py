"""Le noyau est PUR : ni base, ni réseau, ni horloge, ni hasard, ni fichier, ni `sum`.

C'est la condition pour rejouer un cycle depuis son instantané et retrouver la même empreinte
(plan § 4.5), et pour la parité bit à bit avec le TS (plan § 5.1 : `sum()` est compensée depuis
Python 3.12, le `reduce` JS ne l'est pas — passer par `somme_gauche`).

LISTE BLANCHE (relecture A, I2) : une liste noire laissait passer la voie la plus probable —
`from optimisation.base import …` (qui importe psycopg) — et `statistics`, `os`, `subprocess`,
`importlib`… Le noyau n'importe donc QUE la bibliothèque standard de calcul et lui-même. Les noms
interdits le sont partout, pas seulement à l'appel : `s = sum; s(x)` et `from math import fsum as f`
échouent aussi.

L'analyse se fait sur l'AST et non sur le texte : une docstring qui EXPLIQUE pourquoi `sum()` est
interdit ne doit pas faire échouer le test.
"""

import ast
from pathlib import Path

import pytest

NOYAU = Path(__file__).resolve().parents[2] / "src" / "optimisation" / "noyau"

MODULES_PERMIS = frozenset(
    {
        "__future__",
        "math",
        "dataclasses",
        "typing",
        "collections.abc",
        "enum",
        "decimal",
        "fractions",
        "functools",
        "itertools",
        "operator",
    }
)
PREFIXE_PERMIS = "optimisation.noyau"

NOMS_INTERDITS = frozenset(
    {
        "sum",
        "fsum",
        "open",
        "__import__",
        "eval",
        "exec",
        "compile",
        "getattr",
        "globals",
        "vars",
        "breakpoint",
        "input",
    }
)


def _module_permis(nom: str) -> bool:
    return nom in MODULES_PERMIS or nom == PREFIXE_PERMIS or nom.startswith(PREFIXE_PERMIS + ".")


def violations(source: str, nom: str) -> list[str]:
    """Liste les imports hors liste blanche et les usages de noms interdits d'un fichier source du noyau."""
    trouvees: list[str] = []
    for noeud in ast.walk(ast.parse(source, filename=nom)):
        if isinstance(noeud, ast.Import):
            for alias in noeud.names:
                if not _module_permis(alias.name):
                    trouvees.append(f"{nom}:{noeud.lineno} import {alias.name} (hors liste blanche)")
        elif isinstance(noeud, ast.ImportFrom):
            # Import relatif (`from .nombres import …`) : il reste dans le noyau.
            if noeud.level == 0 and not _module_permis(noeud.module or ""):
                trouvees.append(f"{nom}:{noeud.lineno} from {noeud.module} import … (hors liste blanche)")
            for alias in noeud.names:
                if alias.name in NOMS_INTERDITS or alias.name == "*":
                    trouvees.append(f"{nom}:{noeud.lineno} from {noeud.module} import {alias.name}")
        elif isinstance(noeud, ast.Name) and noeud.id in NOMS_INTERDITS:
            trouvees.append(f"{nom}:{noeud.lineno} nom {noeud.id}")
        elif isinstance(noeud, ast.Attribute) and noeud.attr in NOMS_INTERDITS:
            trouvees.append(f"{nom}:{noeud.lineno} attribut .{noeud.attr}")
    return trouvees


def fichiers_du_noyau() -> list[Path]:
    return sorted(NOYAU.rglob("*.py"))


def test_le_noyau_existe_et_porte_des_fichiers() -> None:
    # Un dossier vide ou déplacé rendrait le test suivant vert sans rien vérifier.
    assert (NOYAU / "__init__.py").is_file()
    assert (NOYAU / "nombres.py").is_file()


def test_aucun_fichier_du_noyau_ne_sort_de_la_liste_blanche() -> None:
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
        "import os",
        "import os.path, math",
        "import subprocess",
        "import uuid",
        "import zoneinfo",
        "import statistics",
        "from statistics import fmean",
        "import importlib\nimportlib.import_module('time')",
        "from optimisation.base import sonder_base",
        "from optimisation import config",
        "import optimisation.api.app",
        "import collections",
        "x = sum([1.0, 2.0])",
        "s = sum\ns([1.0])",
        "import math\nx = math.fsum([1.0])",
        "from math import fsum as f\nf([1.0])",
        "from math import fsum",
        "from math import *",
        "f = open('x')",
        "m = __import__('time')",
        "eval('1')",
        "exec('x = 1')",
        "import math\ng = getattr(math, 'fs' + 'um')",
        "import builtins\nbuiltins.sum([1.0])",
    ],
)
def test_le_detecteur_voit_chaque_forme_interdite(source: str) -> None:
    assert violations(source, "essai.py") != []


@pytest.mark.parametrize(
    "source",
    [
        '"""On n\'appelle jamais sum() ici, ni time."""\nsomme = 1\nresume_sum = somme\n',
        "import math\nfrom dataclasses import dataclass\nfrom collections.abc import Sequence\n",
        "from typing import Literal\nfrom enum import Enum\n",
        "from optimisation.noyau.nombres import somme_gauche\nfrom .nombres import arrondi_js\n",
        "import optimisation.noyau.nombres as n\n",
    ],
)
def test_le_detecteur_laisse_passer_le_permis(source: str) -> None:
    assert violations(source, "essai.py") == []
