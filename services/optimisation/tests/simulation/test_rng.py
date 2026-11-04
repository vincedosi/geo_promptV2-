"""`rng.py` = `lib/demo/rng.ts` au bit près (vecteurs de Node), et les propriétés de `tests/unit/demo/rng.test.ts`."""

from tests.parite.historique import contenu, decoder, identique
from tests.simulation.rng import hash_str, mulberry32, rng_for
from tests.simulation.simulateur import texte_nombre_js


def test_mulberry32_vecteurs_de_node() -> None:
    vecteurs = decoder(contenu()["vecteurs"]["mulberry32"])
    assert len(vecteurs) == 16
    for graine, suite in vecteurs:
        r = mulberry32(graine)
        assert identique([r() for _ in suite], suite), graine


def test_hash_str_vecteurs_de_node() -> None:
    vecteurs = contenu()["vecteurs"]["hash_str"]
    assert len(vecteurs) == 311
    for cle, h in vecteurs:
        assert hash_str(cle) == h, cle


def test_rng_for_vecteurs_de_node() -> None:
    vecteurs = decoder(contenu()["vecteurs"]["rng_for"])
    assert len(vecteurs) == 16 * 40
    for graine, cle, valeur in vecteurs:
        assert identique(rng_for(graine, cle), valeur), (graine, cle)


def test_texte_nombre_comme_string_de_js() -> None:
    vecteurs = decoder(contenu()["vecteurs"]["texte_nombre"])
    assert len(vecteurs) == 524
    for n, texte in vecteurs:
        assert texte_nombre_js(n) == texte, n


# ── rng.test.ts ──────────────────────────────────────────────────────────────────────────────────────────────────────


def test_mulberry32_deterministe() -> None:
    a, b = mulberry32(42), mulberry32(42)
    sa, sb = [a(), a(), a()], [b(), b(), b()]
    assert sa == sb
    assert 0 <= sa[0] < 1


def test_graines_differentes_divergent() -> None:
    assert mulberry32(1)() != mulberry32(2)()


def test_rng_for_stable_et_varie_selon_la_cle() -> None:
    assert rng_for(42, "75001") == rng_for(42, "75001")
    assert rng_for(42, "75001") != rng_for(42, "75002")
