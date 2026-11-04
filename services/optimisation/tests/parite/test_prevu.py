"""PARITÉ 1.2 — part du plan, impressions prévues, attendu à date.

- part du plan : `parts_du_plan` contre le CTE `plan` de `refresh_campaign_rollups` évalué sur les 11 435 lignes, et
  contre `campaign_cp_rollup` tel que la fonction l'a écrit (2 041 codes livrés × acteurs) ;
- impressions prévues : port de `impressions.ts` contre les appels TS enregistrés (dont la démo, 10 000 000 répartis
  sur 11 435 codes) ;
- attendu à date : `get_campaign_expected` (4 920 000, échelle comprise).
"""

from datetime import date
from decimal import Decimal
from typing import Any

from optimisation.noyau.impressions import (
    CpExtraction,
    PrevisionPlateforme,
    impressions_prevues,
    previsions,
    repartition_par_cp,
    totaux_prevus,
)
from optimisation.noyau.numeric_pg import texte
from optimisation.noyau.prevu import LignePlan, StrategiePrevue, attendu_a_date, par_code, parts_du_plan
from tests.parite.demo_sql import cas_ts, dec, entrees, json_decimal, meme_nombre, sorties


def lignes_plan() -> list[LignePlan]:
    return [
        LignePlan(cp, Decimal(m), dec(part), bool(actif))
        for cp, _pays, m, part, actif in entrees()["bidding_zone_configs"]
    ]


def mode_hors_zone() -> str | None:
    mode = json_decimal(entrees()["strategie"]["out_zone_weights"]).get("mode")
    return mode if isinstance(mode, str) else None


def test_part_du_plan_identique_au_cte_sql() -> None:
    parts = parts_du_plan(lignes_plan(), mode_hors_zone())
    attendu = sorties()["plan_cte"]
    assert len(parts) == len(attendu) == 11_435
    ecarts = [
        (p.code_postal, a)
        for p, a in zip(parts, attendu, strict=True)
        if [p.code_postal, None if p.part is None else texte(p.part), p.en_cible] != a
    ]
    assert ecarts == []


def test_part_du_plan_identique_au_rollup_ecrit() -> None:
    plan = par_code(parts_du_plan(lignes_plan(), mode_hors_zone()))
    ecarts = []
    for cp, _acteur, _dept, _imp, _sp, _i7, _p7, en_cible, part in entrees()["campaign_cp_rollup"]:
        p = plan.get(cp)
        obtenu = (None, False) if p is None else (None if p.part is None else texte(p.part), p.en_cible)
        if obtenu != (part, en_cible):
            ecarts.append((cp, obtenu, (part, en_cible)))
    assert ecarts == []
    assert texte(plan["13001"].part or Decimal(0)) == "0.00085284071829701618"
    assert len([p for p in plan.values() if p.en_cible]) == 1_641


def _jour(texte_date: str | None) -> int | None:
    return None if texte_date is None else date.fromisoformat(texte_date).toordinal()


def test_attendu_a_date_identique_a_get_campaign_expected() -> None:
    s = entrees()["strategie"]
    strategie = StrategiePrevue(
        total_budget=dec(s["total_budget"]),
        forecast_cpm=dec(s["forecast_cpm"]),
        jour_debut=_jour(s["start_date"]),
        jour_fin=_jour(s["end_date"]),
        kpi_target=dec(s["kpi_target"]),
        objective_code=s["objective_code"],
    )
    au = max(ligne[0] for ligne in entrees()["campaign_daily_rollup"])
    obtenu = attendu_a_date(strategie, _jour(au))
    assert obtenu is not None
    assert texte(obtenu) == sorties()["get_campaign_expected"] == "4920000.0000000000000000000000"


def test_attendu_a_date_cas_limites() -> None:
    base = StrategiePrevue(Decimal("1000.00"), Decimal("2.0000"), 0, 9, None, None)
    assert attendu_a_date(None, 5) is None
    assert attendu_a_date(base, None) is None
    assert attendu_a_date(StrategiePrevue(Decimal(1), Decimal(1), 9, 0, None, None), 5) is None
    # Un seul jour (sql/280) : la période d'un jour a un volume attendu.
    un_jour = attendu_a_date(StrategiePrevue(Decimal("10.00"), Decimal("1.0000"), 3, 3, None, None), 3)
    assert un_jour is not None and un_jour == Decimal(10_000)
    # Avant le début : t = 0 ; après la fin : t = 1.
    avant = attendu_a_date(base, -5)
    apres = attendu_a_date(base, 50)
    assert avant == 0 and apres == Decimal(500_000)
    kpi = attendu_a_date(StrategiePrevue(None, None, 0, 9, Decimal(1000), "maximize_impressions"), 4)
    assert kpi is not None and texte(kpi) == "500.00000000000000000000"  # vérifié en Postgres
    assert attendu_a_date(StrategiePrevue(Decimal(1), Decimal(0), 0, 9, None, None), 4) is None


# ── Impressions prévues : parité TS ────────────────────────────────────────────────────────────────────────────────


def _prevision(d: dict[str, Any]) -> PrevisionPlateforme:
    return PrevisionPlateforme(d["code"], d.get("budget"), d.get("cpm"), d.get("impressions"))


def _meme_prevision(p: PrevisionPlateforme, a: dict[str, Any]) -> bool:
    return (
        p.code == a["code"]
        and meme_nombre(p.budget, a.get("budget"))
        and meme_nombre(p.cpm, a.get("cpm"))
        and meme_nombre(p.impressions, a.get("impressions"))
    )


def test_impressions_prevues_identiques_au_ts() -> None:
    cas = cas_ts("impressionsPrevues")
    assert len(cas) == 99
    for c in cas:
        assert meme_nombre(impressions_prevues(*c["args"]), c["sortie"]), c
    assert impressions_prevues(65000, 6.5) == 10_000_000


def test_previsions_et_totaux_identiques_au_ts() -> None:
    for c in cas_ts("previsions"):
        obtenu = previsions(*c["args"])
        assert len(obtenu) == len(c["sortie"])
        assert all(_meme_prevision(p, a) for p, a in zip(obtenu, c["sortie"], strict=True)), c
    for c in cas_ts("totauxPrevus"):
        (lignes,) = c["args"]
        t = totaux_prevus([_prevision(d) for d in lignes])
        a = c["sortie"]
        assert meme_nombre(t.budget, a["budget"]), c
        assert meme_nombre(t.impressions, a["impressions"]), c
        assert meme_nombre(t.cpm_moyen, a["cpmMoyen"]), c
        assert t.cpm_manquants == a["cpmManquants"], c


def test_repartition_par_cp_identique_au_ts() -> None:
    cas = cas_ts("repartitionParCp")
    assert len(cas) == 12
    for c in cas:
        n, cps = c["args"]
        obtenu = repartition_par_cp(n, [CpExtraction(d["code_postal"], d["multiplicateur"]) for d in cps])
        attendu = c["sortie"]
        assert [x.code_postal for x in obtenu] == [a["code_postal"] for a in attendu]
        assert all(
            meme_nombre(x.impressions, a["impressions"]) and meme_nombre(x.multiplicateur, a["multiplicateur"])
            for x, a in zip(obtenu, attendu, strict=True)
        )


def test_repartition_de_la_demo() -> None:
    (demo,) = [c for c in cas_ts("repartitionParCp") if len(c["args"][1]) == 11_435]
    n, cps = demo["args"]
    assert n == 10_000_000
    obtenu = repartition_par_cp(n, [CpExtraction(d["code_postal"], d["multiplicateur"]) for d in cps])
    assert len(obtenu) == 1_641
    total = 0.0
    for x in obtenu:
        total = total + x.impressions
    assert total == 10_000_000
