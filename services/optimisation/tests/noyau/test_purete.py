"""Le noyau est PUR : ni base, ni réseau, ni horloge, ni hasard, ni fichier, ni `sum`.

C'est la condition pour rejouer un cycle depuis son instantané et retrouver la même empreinte
(plan § 4.5), et pour la parité bit à bit avec le TS (plan § 5.1 : `sum()` est compensée depuis
Python 3.12, le `reduce` JS ne l'est pas — passer par `somme_gauche`).

LISTE BLANCHE (relecture A, I2) : une liste noire laissait passer la voie la plus probable —
`from optimisation.base import …` (qui importe psycopg) — et `statistics`, `os`, `subprocess`,
`importlib`… Le noyau n'importe donc QUE la bibliothèque standard de calcul et lui-même. Les noms
interdits le sont partout, pas seulement à l'appel : `s = sum; s(x)` et `from math import fsum as f`
échouent aussi.

IMPORTS RELATIFS (relecture B, I2) : le noyau est un paquet PLAT. Un import relatif de niveau 1
(`from .nombres import …`) reste dedans ; un niveau ≥ 2 (`from ..base import …`, `from .. import
config`) en sort — vers le service, qui importe psycopg. Le relatif est donc résolu en absolu
(`optimisation.noyau` + module) et soumis à la même liste blanche que l'absolu.

`__builtins__` et `__dict__` sont interdits aussi : `__builtins__["sum"]` et
`math.__dict__["fs" + "um"]` contournaient la liste des noms (relecture B, M8).

L'analyse se fait sur l'AST et non sur le texte : une docstring qui EXPLIQUE pourquoi `sum()` est
interdit ne doit pas faire échouer le test.

CATALOGUE (`algos/`, phase 2.5, plan § 16.1) : pur comme le noyau, même liste blanche. Il peut importer le noyau (il
en référence les ports) ; le noyau, lui, n'importe jamais le catalogue. Ses imports sont absolus.
"""

import ast
from pathlib import Path

import pytest

NOYAU = Path(__file__).resolve().parents[2] / "src" / "optimisation" / "noyau"
ALGOS = NOYAU.parent / "algos"

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
PREFIXE_ALGOS = "optimisation.algos"

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
        "__builtins__",
        "__dict__",
    }
)


def _module_permis(nom: str, prefixes: tuple[str, ...] = (PREFIXE_PERMIS,)) -> bool:
    return nom in MODULES_PERMIS or any(nom == p or nom.startswith(p + ".") for p in prefixes)


def _module_absolu(noeud: ast.ImportFrom, paquet: str = PREFIXE_PERMIS) -> str:
    """Le module visé par un `from … import`, relatif résolu depuis `paquet` (paquet plat)."""
    if noeud.level == 0:
        return noeud.module or ""
    if noeud.level >= 2:
        # Remonte au-dessus du noyau : `optimisation`, `optimisation.base`… — jamais permis.
        parent = "optimisation" if noeud.level == 2 else ""
        return ".".join(x for x in (parent, noeud.module or "") if x) or "<au-dessus d'optimisation>"
    return paquet + ("." + noeud.module if noeud.module else "")


def violations(source: str, nom: str, paquet: str = PREFIXE_PERMIS) -> list[str]:
    """Liste les imports hors liste blanche et les usages de noms interdits d'un fichier source de `paquet`.

    Le noyau ne peut importer que lui-même ; le catalogue (`optimisation.algos`), lui-même et le noyau."""
    prefixes = (PREFIXE_PERMIS,) if paquet == PREFIXE_PERMIS else (PREFIXE_PERMIS, paquet)
    trouvees: list[str] = []
    for noeud in ast.walk(ast.parse(source, filename=nom)):
        if isinstance(noeud, ast.Import):
            for alias in noeud.names:
                if not _module_permis(alias.name, prefixes):
                    trouvees.append(f"{nom}:{noeud.lineno} import {alias.name} (hors liste blanche)")
        elif isinstance(noeud, ast.ImportFrom):
            module = _module_absolu(noeud, paquet)
            if not _module_permis(module, prefixes):
                trouvees.append(
                    f"{nom}:{noeud.lineno} from {'.' * noeud.level}{noeud.module or ''} → {module} (hors liste blanche)"
                )
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


def test_le_catalogue_existe_et_porte_des_fichiers() -> None:
    assert (ALGOS / "__init__.py").is_file()
    assert (ALGOS / "registre.py").is_file()
    assert (ALGOS / "contrat.py").is_file()


def test_aucun_fichier_du_catalogue_ne_sort_de_la_liste_blanche() -> None:
    toutes = [
        v for f in sorted(ALGOS.rglob("*.py")) for v in violations(f.read_text(encoding="utf-8"), f.name, PREFIXE_ALGOS)
    ]
    assert toutes == [], "Le catalogue doit rester pur, comme le noyau :\n" + "\n".join(toutes)


@pytest.mark.parametrize(
    "source",
    [
        "from optimisation.api.algos import routeur",
        "from optimisation.lecture.registre import lire_poids",
        "from optimisation import base",
        "from ..base import connexion",
        "import time",
        "x = sum([1.0])",
    ],
)
def test_le_detecteur_du_catalogue_voit_chaque_forme_interdite(source: str) -> None:
    assert violations(source, "essai.py", PREFIXE_ALGOS) != []


def test_le_catalogue_peut_importer_le_noyau_mais_pas_l_inverse() -> None:
    source = (
        "from optimisation.noyau.pression import multiplicateurs_methode_a\nfrom optimisation.algos import contrat\n"
    )
    assert violations(source, "essai.py", PREFIXE_ALGOS) == []
    assert violations("from optimisation.algos.registre import REGISTRE\n", "essai.py") != []


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
