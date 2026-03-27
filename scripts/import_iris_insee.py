# -*- coding: utf-8 -*-
"""
Import INSEE IRIS demographic data → table iris (colonnes démographiques)

Télécharge les fichiers CSV de profils des IRIS depuis l'INSEE et met à jour
la table iris avec les données démographiques.

Sources INSEE (base 2020, publiée 2022) :
  - Évolution et structure de la population : P20_ (âges, CSP)
  - Diplômes – formation : D20_ (niveaux de diplôme)
  - Logement : L20_ (statut d'occupation)
  - Activité des résidents : R20_ (chômage)

Usage :
    python -X utf8 scripts/import_iris_insee.py --dept 29
    python -X utf8 scripts/import_iris_insee.py  # tous les IRIS en base
    python -X utf8 scripts/import_iris_insee.py --dry-run

Options :
    --dept CODE     Filtre sur code_dept (ex: 29, 75, 69)
    --dry-run       Parse et affiche un aperçu sans écrire en base
    --year YYYY     Millésime INSEE (défaut: 2020)
"""

import argparse
import csv
import io
import sys
import time
import urllib.request
import zipfile

from supabase import create_client

SUPABASE_URL = "https://vkkdbygwbrxyogqosten.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZra2RieWd3YnJ4eW9ncW9zdGVuIiwicm9sZSI"
    "6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTE4OTk2MCwiZXhwIjoyMDg2NzY1OTYwfQ"
    ".hZQcgjx8AbkDF6o1oETQYURnQB9hHi7p0nuXKFjyFrU"
)

BATCH = 200

# URLs des fichiers INSEE IRIS (millésime 2020)
# Page IDs corrects (un par fichier) + suffixe _csv.zip
INSEE_IRIS_URLS = {
    "pop": "https://www.insee.fr/fr/statistiques/fichier/7704076/base-ic-evol-struct-pop-2020_csv.zip",
    "men": "https://www.insee.fr/fr/statistiques/fichier/7704086/base-ic-couples-familles-menages-2020_csv.zip",
    "dip": "https://www.insee.fr/fr/statistiques/fichier/7704080/base-ic-diplomes-formation-2020_csv.zip",
    "log": "https://www.insee.fr/fr/statistiques/fichier/7704078/base-ic-logement-2020_csv.zip",
    "act": "https://www.insee.fr/fr/statistiques/fichier/7704089/base-ic-activite-residents-2020_csv.zip",
}


def download_csv_from_zip(url: str, encoding: str = "latin-1") -> list[dict]:
    """Télécharge un zip INSEE, extrait le CSV et retourne une liste de dict."""
    print(f"  Téléchargement : {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "GENESIS-ETL/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = resp.read()
    print(f"    {len(data):,} octets téléchargés")

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        # Trouver le CSV dans le zip
        csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not csv_names:
            raise FileNotFoundError(f"Aucun CSV trouvé dans {url}")
        csv_name = csv_names[0]
        print(f"    Fichier CSV : {csv_name}")
        with zf.open(csv_name) as f:
            reader = csv.DictReader(
                io.TextIOWrapper(f, encoding=encoding, errors="replace"),
                delimiter=";"
            )
            rows = list(reader)
    print(f"    {len(rows):,} lignes lues")
    return rows


def safe_int(val: str) -> int | None:
    """Convertit une valeur INSEE en int (gère les virgules décimales, NS, NaN)."""
    if not val or val.strip() in ("", "s", "ns", "NS", "nd", "ND"):
        return None
    try:
        return int(float(val.replace(",", ".")))
    except (ValueError, TypeError):
        return None


def safe_float(val: str) -> float | None:
    if not val or val.strip() in ("", "s", "ns", "NS", "nd", "ND"):
        return None
    try:
        return float(val.replace(",", "."))
    except (ValueError, TypeError):
        return None


def build_pop_updates(rows: list[dict]) -> dict[str, dict]:
    """
    Extrait depuis base-ic-evol-struct-pop : âges et CSP.
    Clé = code_iris (9 caractères).
    """
    updates: dict[str, dict] = {}
    for row in rows:
        code = (row.get("IRIS") or row.get("iris") or "").strip()
        if len(code) < 9:
            continue
        updates[code] = {
            "population":   safe_int(row.get("P20_POP", "")),
            "pop_0_14":     safe_int(row.get("P20_POP0014", "")),
            "pop_15_29":    safe_int(row.get("P20_POP1529", "")),
            "pop_30_44":    safe_int(row.get("P20_POP3044", "")),
            "pop_45_59":    safe_int(row.get("P20_POP4559", "")),
            "pop_60_74":    safe_int(row.get("P20_POP6074", "")),
            "pop_75_plus":  safe_int(row.get("P20_POP75P", "")),
            # CSP : préfixe C20_POP15P_ dans le fichier 2020 (population 15 ans+)
            "nb_csp_cadre":   safe_int(row.get("C20_POP15P_CS3", "")),
            "nb_csp_employe": safe_int(row.get("C20_POP15P_CS5", "")),
            "nb_csp_ouvrier": safe_int(row.get("C20_POP15P_CS6", "")),
            # nb_menages est dans le fichier dédié "men" (base-ic-couples-familles-menages)
        }
    return updates


def build_men_updates(rows: list[dict]) -> dict[str, dict]:
    """Extrait depuis base-ic-couples-familles-menages : nombre de ménages."""
    updates: dict[str, dict] = {}
    for row in rows:
        code = (row.get("IRIS") or row.get("iris") or "").strip()
        if len(code) < 9:
            continue
        updates[code] = {
            "nb_menages": safe_int(row.get("C20_MEN", "")),
        }
    return updates


def build_dip_updates(rows: list[dict]) -> dict[str, dict]:
    """Extrait depuis base-ic-diplomes-formation : diplômes."""
    updates: dict[str, dict] = {}
    for row in rows:
        code = (row.get("IRIS") or row.get("iris") or "").strip()
        if len(code) < 9:
            continue
        aucun = safe_int(row.get("P20_NSCOL15P_DIPLMIN", ""))  # DIPL0 renommé DIPLMIN en 2020
        bac   = safe_int(row.get("P20_NSCOL15P_BAC", ""))
        # Diplôme supérieur = tout le supérieur (bac+2 + bac+3/4 + bac+5+)
        sup2   = safe_int(row.get("P20_NSCOL15P_SUP2",  "")) or 0
        sup34  = safe_int(row.get("P20_NSCOL15P_SUP34", "")) or 0
        sup5   = safe_int(row.get("P20_NSCOL15P_SUP5",  "")) or 0
        sup    = sup2 + sup34 + sup5 if (sup2 + sup34 + sup5) > 0 else None
        total  = safe_int(row.get("P20_NSCOL15P", ""))

        taux_sup = None
        if sup is not None and total and total > 0:
            taux_sup = round(sup / total * 100, 1)

        updates[code] = {
            "nb_diplome_aucun": aucun,
            "nb_diplome_bac":   bac,
            "nb_diplome_sup":   sup,
            "taux_diplome_sup": taux_sup,
        }
    return updates


def build_log_updates(rows: list[dict]) -> dict[str, dict]:
    """Extrait depuis base-ic-logement : taux de propriétaires."""
    updates: dict[str, dict] = {}
    for row in rows:
        code = (row.get("IRIS") or row.get("iris") or "").strip()
        if len(code) < 9:
            continue
        proprio = safe_int(row.get("P20_RP_PROP", ""))
        total   = safe_int(row.get("P20_RP", ""))

        taux_proprio = None
        if proprio is not None and total and total > 0:
            taux_proprio = round(proprio / total * 100, 1)

        updates[code] = {
            "taux_proprio": taux_proprio,
        }
    return updates


def build_act_updates(rows: list[dict]) -> dict[str, dict]:
    """Extrait depuis base-ic-activite-residents : taux de chômage."""
    updates: dict[str, dict] = {}
    for row in rows:
        code = (row.get("IRIS") or row.get("iris") or "").strip()
        if len(code) < 9:
            continue
        chom  = safe_int(row.get("P20_CHOM1564", ""))
        act   = safe_int(row.get("P20_ACT1564", ""))

        taux_chomage = None
        if chom is not None and act and act > 0:
            taux_chomage = round(chom / act * 100, 1)

        updates[code] = {
            "taux_chomage": taux_chomage,
        }
    return updates


def merge_updates(*dicts: dict[str, dict]) -> dict[str, dict]:
    """Fusionne plusieurs dicts {code_iris: {colonnes...}}."""
    merged: dict[str, dict] = {}
    for d in dicts:
        for code, vals in d.items():
            if code not in merged:
                merged[code] = {}
            merged[code].update(vals)
    return merged


def upsert_iris(supabase, updates: dict[str, dict], dept_filter: str | None,
                dry_run: bool) -> int:
    """Envoie les mises à jour vers Supabase en batch."""
    # Construire la liste des rows à upsert
    rows = []
    for code_iris, vals in updates.items():
        # Filtre département si demandé
        if dept_filter and not code_iris.startswith(dept_filter):
            continue
        row = {"code_iris": code_iris}
        row.update({k: v for k, v in vals.items() if v is not None})
        rows.append(row)

    print(f"\n{len(rows)} IRIS à mettre à jour (filtre dept={dept_filter or 'tous'})")

    if dry_run:
        print("[DRY RUN] Aperçu des 3 premiers :")
        for r in rows[:3]:
            print(f"  {r['code_iris']} — {list(r.keys())}")
        return len(rows)

    updated = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i: i + BATCH]
        supabase.table("iris").upsert(batch, on_conflict="code_iris").execute()
        updated += len(batch)
        print(f"  Batch {i // BATCH + 1}: {len(batch)} IRIS mis à jour")
        time.sleep(0.05)

    return updated


def main():
    parser = argparse.ArgumentParser(
        description="Import INSEE IRIS demographic data → table iris"
    )
    parser.add_argument("--dept", help="Filtre département (ex: 29, 75). Vide = tous.")
    parser.add_argument("--year", default="2020", help="Millésime INSEE (défaut: 2020)")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Parse uniquement, sans écriture en base"
    )
    parser.add_argument(
        "--source", choices=["pop", "men", "dip", "log", "act", "all"], default="all",
        help="Source(s) à importer (défaut: all)"
    )
    args = parser.parse_args()

    print(f"\n=== Import IRIS INSEE {args.year} (dept={args.dept or 'tous'}) ===\n")

    dept_filter = args.dept.zfill(2) if args.dept else None
    all_updates: dict[str, dict] = {}

    sources = ["pop", "men", "dip", "log", "act"] if args.source == "all" else [args.source]

    for src in sources:
        url = INSEE_IRIS_URLS[src]
        print(f"\n--- Source : {src} ---")
        try:
            rows = download_csv_from_zip(url)
        except Exception as e:
            print(f"  ERREUR téléchargement {src}: {e}")
            continue

        if src == "pop":
            updates = build_pop_updates(rows)
        elif src == "men":
            updates = build_men_updates(rows)
        elif src == "dip":
            updates = build_dip_updates(rows)
        elif src == "log":
            updates = build_log_updates(rows)
        elif src == "act":
            updates = build_act_updates(rows)
        else:
            updates = {}

        print(f"  {len(updates)} codes IRIS extraits")
        all_updates = merge_updates(all_updates, updates)

    if not all_updates:
        print("Aucune donnée extraite, arrêt.")
        sys.exit(1)

    print(f"\nTotal : {len(all_updates)} codes IRIS uniques")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    t0 = time.time()
    updated = upsert_iris(supabase, all_updates, dept_filter, args.dry_run)
    elapsed = time.time() - t0

    if not args.dry_run:
        print(f"\nTerminé : {updated} IRIS mis à jour en {elapsed:.1f}s")
    else:
        print(f"\n[DRY RUN] {updated} IRIS seraient mis à jour.")


if __name__ == "__main__":
    main()
