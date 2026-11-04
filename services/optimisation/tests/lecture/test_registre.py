"""`lire_poids` sans base : une connexion factice qui rend des lignes du registre."""

from typing import Any

import pytest

from optimisation.lecture.registre import RegistreIllisible, lire_poids


class _Curseur:
    def __init__(self, lignes: list[tuple[Any, ...]]) -> None:
        self._lignes = lignes

    def __enter__(self) -> "_Curseur":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, _requete: str, _params: dict[str, Any]) -> None:
        return None

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._lignes


class _Connexion:
    def __init__(self, lignes: list[tuple[Any, ...]]) -> None:
        self._lignes = lignes

    def cursor(self) -> _Curseur:
        return _Curseur(self._lignes)


def _ligne(nb_max: int | None) -> tuple[Any, ...]:
    return ("ttd", "cp", "bid_list", 0.1, 10.0, nb_max, None, True, [])


def test_nb_max_entrees_positif_ou_absent_passe() -> None:
    assert lire_poids(_Connexion([_ligne(10_000)]), ["ttd"])[0].nb_max_entrees == 10_000  # type: ignore[arg-type]
    assert lire_poids(_Connexion([_ligne(None)]), ["ttd"])[0].nb_max_entrees is None  # type: ignore[arg-type]


@pytest.mark.parametrize("nb_max", [0, -3])
def test_nb_max_entrees_nul_ou_negatif_refuse_avant_le_calcul(nb_max: int) -> None:
    # Relecture B : `CHECK nb_max_entrees > 0` (sql/305) l'interdit ; s'il passait, ceil(n ÷ 0) lèverait en calcul.
    with pytest.raises(RegistreIllisible, match="nb_max_entrees doit être > 0"):
        lire_poids(_Connexion([_ligne(nb_max)]), ["ttd"])  # type: ignore[arg-type]
