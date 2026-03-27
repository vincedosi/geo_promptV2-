# -*- coding: utf-8 -*-
"""
Import IRIS INSEE depuis fichiers locaux (millésime 2022, format P22_/C22_).
Lit data/iris/ et met à jour la table iris (géométrie + démographie complète).

Pour chaque fichier démographique absent localement, télécharge automatiquement
le fichier INSEE correspondant (millésime 2020, URLs stables).

Usage :
    python -X utf8 scripts/import_iris_local.py
    python -X utf8 scripts/import_iris_local.py --dry-run
    python -X utf8 scripts/import_iris_local.py --dept 29
    python -X utf8 scripts/import_iris_local.py --no-download   # local uniquement
"""

import argparse
import csv
import io
import os
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

BATCH = 500

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "iris")

# Fichiers locaux 2022
POP_FILE = "base-ic-evol-struct-pop-2022.CSV"
MEN_FILE = "base-ic-couples-familles-menages-2022.CSV"
DIP_FILE = "base-ic-diplomes-formation-2022.CSV"
LOG_FILE = "base-ic-logement-2022.CSV"
ACT_FILE = "base-ic-activite-residents-2022.CSV"

# URLs INSEE millésime 2020 (fallback si fichier local absent)
INSEE_FALLBACK_URLS = {
    "men": "https://www.insee.fr/fr/statistiques/fichier/7704086/base-ic-couples-familles-menages-2020_csv.zip",
    "dip": "https://www.insee.fr/fr/statistiques/fichier/7704080/base-ic-diplomes-formation-2020_csv.zip",
    "log": "https://www.insee.fr/fr/statistiques/fichier/7704078/base-ic-logement-2020_csv.zip",
    "act": "https://www.insee.fr/fr/statistiques/fichier/7704089/base-ic-activite-residents-2020_csv.zip",
}


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def safe_int(val: str) -> int | None:
    v = val.strip().replace(",", ".")
    if not v or v in ("s", "ns", "NS", "nd", "ND", ""):
        return None
    try:
        return round(float(v))
    except (ValueError, TypeError):
        return None


def safe_float(val: str) -> float | None:
    v = val.strip().replace(",", ".")
    if not v or v in ("s", "ns", "NS", "nd", "ND", ""):
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def dept_from_commune(com: str) -> str:
    if com.startswith("97"):
        return com[:3]
    return com[:2]


def download_csv_from_zip(url: str, encoding: str = "latin-1") -> list[dict]:
    """Télécharge un zip INSEE, extrait le CSV et retourne une liste de dict."""
    print(f"  Téléchargement : {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "GENESIS-ETL/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = resp.read()
    print(f"    {len(data):,} octets téléchargés")

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
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


def read_local_csv(filepath: str) -> list[dict]:
    """Lit un fichier CSV local INSEE (latin-1, séparateur ;)."""
    with open(filepath, encoding="latin-1", errors="replace", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        return list(reader)


def iris_code(row: dict) -> str:
    return (row.get("IRIS") or row.get("iris") or "").strip()


# ---------------------------------------------------------------------------
# Parseurs par source
# ---------------------------------------------------------------------------

def parse_pop_local(rows: list[dict], dept_filter: str | None) -> dict[str, dict]:
    """
    Fichier pop local 2022 : géométrie + population + tranches d'âge + CSP.
    Colonnes identité incluses (pour INSERT si l'IRIS n'existe pas encore).
    """
    result: dict[str, dict] = {}
    for row in rows:
        code = row.get("IRIS", "").strip()
        if len(code) != 9:
            continue
        com  = row.get("COM", "").strip()
        dept = dept_from_commune(com) if com else ""
        if dept_filter and not dept.startswith(dept_filter):
            continue

        record: dict = {
            "code_iris":    code,
            "code_commune": com,
            "code_dept":    dept,
            "nom_iris":     row.get("LAB_IRIS", "").strip(),
            "type_iris":    row.get("TYP_IRIS", "").strip(),
            "population":   safe_int(row.get("P22_POP", "")),
            "pop_0_14":     safe_int(row.get("P22_POP0014", "")),
            "pop_15_29":    safe_int(row.get("P22_POP1529", "")),
            "pop_30_44":    safe_int(row.get("P22_POP3044", "")),
            "pop_45_59":    safe_int(row.get("P22_POP4559", "")),
            "pop_60_74":    safe_int(row.get("P22_POP6074", "")),
            "pop_75_plus":  safe_int(row.get("P22_POP75P", "")),
            # CSP 2022 : C22_POP15P_STAT_GSEC{gsec}_{cs}
            "nb_csp_cadre":   safe_int(row.get("C22_POP15P_STAT_GSEC13_23", "")),
            "nb_csp_employe": safe_int(row.get("C22_POP15P_STAT_GSEC15_25", "")),
            "nb_csp_ouvrier": safe_int(row.get("C22_POP15P_STAT_GSEC16_26", "")),
        }
        # Filtre les None avant d'insérer
        result[code] = {k: v for k, v in record.items() if v is not None or k in (
            "code_iris", "code_commune", "code_dept", "nom_iris", "type_iris"
        )}
    return result


def parse_men(rows: list[dict], year_prefix: str = "C20") -> dict[str, dict]:
    """Ménages : nb_menages."""
    result: dict[str, dict] = {}
    for row in rows:
        code = iris_code(row)
        if len(code) < 9:
            continue
        nb = safe_int(row.get(f"{year_prefix}_MEN", ""))
        if nb is not None:
            result[code] = {"nb_menages": nb}
    return result


def parse_dip(rows: list[dict], year_prefix: str = "P20") -> dict[str, dict]:
    """Diplômes : aucun, bac, supérieur, taux_diplome_sup."""
    result: dict[str, dict] = {}
    for row in rows:
        code = iris_code(row)
        if len(code) < 9:
            continue
        aucun = safe_int(row.get(f"{year_prefix}_NSCOL15P_DIPLMIN", ""))
        bac   = safe_int(row.get(f"{year_prefix}_NSCOL15P_BAC", ""))
        sup2  = safe_int(row.get(f"{year_prefix}_NSCOL15P_SUP2",  "")) or 0
        sup34 = safe_int(row.get(f"{year_prefix}_NSCOL15P_SUP34", "")) or 0
        sup5  = safe_int(row.get(f"{year_prefix}_NSCOL15P_SUP5",  "")) or 0
        sup   = sup2 + sup34 + sup5 if (sup2 + sup34 + sup5) > 0 else None
        total = safe_int(row.get(f"{year_prefix}_NSCOL15P", ""))

        taux_sup = None
        if sup is not None and total and total > 0:
            taux_sup = round(sup / total * 100, 1)

        entry = {
            "nb_diplome_aucun": aucun,
            "nb_diplome_bac":   bac,
            "nb_diplome_sup":   sup,
            "taux_diplome_sup": taux_sup,
        }
        result[code] = {k: v for k, v in entry.items() if v is not None}
    return result


def parse_log(rows: list[dict], year_prefix: str = "P20") -> dict[str, dict]:
    """Logement : taux_proprio."""
    result: dict[str, dict] = {}
    for row in rows:
        code = iris_code(row)
        if len(code) < 9:
            continue
        proprio = safe_int(row.get(f"{year_prefix}_RP_PROP", ""))
        total   = safe_int(row.get(f"{year_prefix}_RP", ""))
        if proprio is not None and total and total > 0:
            result[code] = {"taux_proprio": round(proprio / total * 100, 1)}
    return result


def parse_act(rows: list[dict], year_prefix: str = "P20") -> dict[str, dict]:
    """Activité : taux_chomage."""
    result: dict[str, dict] = {}
    for row in rows:
        code = iris_code(row)
        if len(code) < 9:
            continue
        chom = safe_int(row.get(f"{year_prefix}_CHOM1564", ""))
        act  = safe_int(row.get(f"{year_prefix}_ACT1564", ""))
        if chom is not None and act and act > 0:
            result[code] = {"taux_chomage": round(chom / act * 100, 1)}
    return result


# ---------------------------------------------------------------------------
# Merge + upsert
# ---------------------------------------------------------------------------

def merge_into(base: dict[str, dict], extra: dict[str, dict]) -> None:
    """Fusionne extra dans base (modification en place)."""
    for code, vals in extra.items():
        if code in base:
            base[code].update(vals)
        # Codes presents dans extra mais absents du local pop → ignorés
        # (on ne crée pas de rows sans géométrie)


def upsert_all(supabase, all_data: dict[str, dict], dry_run: bool) -> int:
    rows = list(all_data.values())

    if dry_run:
        print(f"\n[DRY RUN] {len(rows)} IRIS (non écrits)")
        for r in rows[:3]:
            print(f"  {r.get('code_iris')} — pop={r.get('population')} "
                  f"menages={r.get('nb_menages')} "
                  f"chomage={r.get('taux_chomage')} "
                  f"proprio={r.get('taux_proprio')} "
                  f"dip_sup={r.get('taux_diplome_sup')}")
        return len(rows)

    inserted = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i: i + BATCH]
        supabase.table("iris").upsert(batch, on_conflict="code_iris").execute()
        inserted += len(batch)
        pct = round(inserted / len(rows) * 100)
        print(f"  [{pct:3d}%] {inserted}/{len(rows)} IRIS mis à jour", end="\r")
        time.sleep(0.02)

    print()
    return inserted


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_source(name: str, local_path: str, local_year: str,
                fallback_url: str, allow_download: bool) -> tuple[list[dict], str] | None:
    """
    Charge une source démographique.
    Retourne (rows, year_prefix) ou None si indisponible.
    year_prefix : 'P22'/'C22' pour local 2022, 'P20'/'C20' pour fallback 2020.
    """
    if os.path.exists(local_path):
        print(f"  Local : {os.path.basename(local_path)}")
        rows = read_local_csv(local_path)
        print(f"    {len(rows):,} lignes lues")
        return rows, local_year
    if allow_download:
        print(f"  Fichier local absent, téléchargement INSEE (2020) …")
        try:
            rows = download_csv_from_zip(fallback_url)
            return rows, "2020"  # sentinel → parseurs utilisent P20/C20
        except Exception as e:
            print(f"    ERREUR téléchargement : {e}")
            return None
    print(f"  Fichier local absent et --no-download actif → ignoré")
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Import IRIS INSEE local 2022 → Supabase (démographie complète)"
    )
    parser.add_argument("--dept", help="Filtre département (ex: 29, 75). Vide = tous.")
    parser.add_argument("--dry-run", action="store_true", help="Lecture seule, pas d'écriture")
    parser.add_argument("--no-download", action="store_true",
                        help="Ne pas télécharger les fichiers absents (local uniquement)")
    args = parser.parse_args()

    dept_filter     = args.dept.zfill(2) if args.dept else None
    allow_download  = not args.no_download

    print(f"\n=== Import IRIS INSEE 2022 (dept={dept_filter or 'tous'}) ===\n")

    # 1. Fichier pop local (obligatoire)
    pop_path = os.path.join(DATA_DIR, POP_FILE)
    if not os.path.exists(pop_path):
        print(f"ERREUR : fichier introuvable : {pop_path}")
        sys.exit(1)

    print(f"[pop] {POP_FILE}")
    pop_rows = read_local_csv(pop_path)
    print(f"  {len(pop_rows):,} lignes lues")
    all_data = parse_pop_local(pop_rows, dept_filter)
    print(f"  {len(all_data)} IRIS extraits\n")

    if not all_data:
        print("Aucune donnée pop, arrêt.")
        sys.exit(1)

    # 2. Sources démographiques complémentaires
    extra_sources = [
        ("men", os.path.join(DATA_DIR, MEN_FILE), "C22", INSEE_FALLBACK_URLS["men"]),
        ("dip", os.path.join(DATA_DIR, DIP_FILE), "P22", INSEE_FALLBACK_URLS["dip"]),
        ("log", os.path.join(DATA_DIR, LOG_FILE), "P22", INSEE_FALLBACK_URLS["log"]),
        ("act", os.path.join(DATA_DIR, ACT_FILE), "P22", INSEE_FALLBACK_URLS["act"]),
    ]

    parsers = {
        "men": lambda rows, y: parse_men(rows, "C22" if y == "C22" else "C20"),
        "dip": lambda rows, y: parse_dip(rows, "P22" if y == "P22" else "P20"),
        "log": lambda rows, y: parse_log(rows, "P22" if y == "P22" else "P20"),
        "act": lambda rows, y: parse_act(rows, "P22" if y == "P22" else "P20"),
    }

    for name, local_path, local_year, fallback_url in extra_sources:
        print(f"[{name}]")
        result = load_source(name, local_path, local_year, fallback_url, allow_download)
        if result is None:
            print()
            continue
        rows, year = result
        extra = parsers[name](rows, year)
        before = sum(1 for v in all_data.values() if name == "men" and "nb_menages" in v)
        merge_into(all_data, extra)
        filled = sum(1 for v in all_data.values() if (
            ("nb_menages" in v if name == "men" else
             "taux_diplome_sup" in v if name == "dip" else
             "taux_proprio" in v if name == "log" else
             "taux_chomage" in v)
        ))
        print(f"  {filled}/{len(all_data)} IRIS enrichis\n")

    # 3. Upsert
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    t0 = time.time()
    n = upsert_all(supabase, all_data, args.dry_run)
    elapsed = time.time() - t0

    if not args.dry_run:
        print(f"\nTerminé : {n} IRIS mis à jour en {elapsed:.1f}s")
    else:
        print(f"\n[DRY RUN] {n} IRIS auraient été mis à jour.")


if __name__ == "__main__":
    main()
