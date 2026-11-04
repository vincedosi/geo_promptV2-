"""Les fixtures de parité (T2) sont présentes, lisibles et complètes.

Le contrôle de PARITÉ lui-même (sortie Python == sortie TS) arrive avec le noyau (T3). Ici : que les fichiers
produits par `generer-fixtures.ts` existent, se décodent, et couvrent les sources annoncées dans `fixtures/README.md`.
`zones-reference.json.gz` (≈ 4 Mo compressé, ≈ 100 Mo d'objets une fois chargé) n'est que vérifié en tête, pour ne pas
charger la mémoire d'un poste déjà juste à chaque `pytest`.
"""

import gzip
import json
from collections import Counter
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def charger(nom: str) -> dict[str, Any]:
    with gzip.open(FIXTURES / nom, "rt", encoding="utf-8") as flux:
        contenu: dict[str, Any] = json.load(flux)
    return contenu


def verifier_cas(cas: list[dict[str, Any]]) -> None:
    for c in cas:
        assert isinstance(c["entree"]["args"], list), c["id"]
        assert "sortie" in c, c["id"]
        assert "erreur" not in c, c["id"]


def test_tests_unitaires_couvrent_les_trois_fichiers() -> None:
    contenu = charger("tests-unitaires.json.gz")
    assert contenu["format"] == 1
    cas = contenu["cas"]
    verifier_cas(cas)
    tests = Counter(c["source"] for c in {(c["source"], c["test"]): c for c in cas}.values())
    # plan.test.ts : 28 tests à appel propre + 2 appels de collecte (README) ; 26 et 13 pour les deux autres.
    assert tests == Counter({"plan.test.ts": 30, "plan-jeu-zone.test.ts": 26, "part-prevue.test.ts": 13})
    assert len(cas) == 104


def test_extractions_risque_quatre_cas_et_leurs_lignes_stockees() -> None:
    contenu = charger("extractions-risque.json.gz")
    cas = contenu["cas"]
    verifier_cas(cas)
    assert [c["fonction"] for c in cas] == ["genererPlanCp"] * 4
    assert sum(len(c["stocke"]["lignes"]) for c in cas) == 9190
    # Les deux versions 1 (plan initial) sont reproduites exactement par le TS : ce sont les cas de parité.
    initiales = [c for c in cas if c["stocke"]["extraction"]["version"] == 1]
    assert len(initiales) == 2
    for c in initiales:
        assert contenu["ecarts_au_stocke"][c["stocke"]["extraction"]["id"]]["multiplicateurs_differents"] == 0


def test_zones_reference_presente_et_gzip() -> None:
    chemin = FIXTURES / "zones-reference.json.gz"
    assert chemin.stat().st_size > 1_000_000
    with gzip.open(chemin, "rt", encoding="utf-8") as flux:
        assert flux.read(64).startswith('{"format":1,')
