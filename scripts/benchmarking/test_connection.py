"""Test de connexion DB préalable au benchmark.

Usage :
    python test_connection.py

Vérifie 3 choses :
  1. Connexion DB de base (SELECT 1)
  2. Tables A4.1 accessibles (bidding_algorithms)
  3. Dataset démo lisible (4078 lignes)

Si un test échoue, le message pointe vers la section Troubleshooting du README.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from data_loader import get_conn  # noqa: E402


def main() -> int:
    print("[test] Connexion à Supabase...")
    try:
        conn = get_conn()
    except (FileNotFoundError, EnvironmentError, ConnectionError) as exc:
        print(f"\n❌ Connexion DB échouée\n{exc}\n")
        print("→ Voir scripts/benchmarking/README.md section 7 (Troubleshooting)")
        return 1

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1;")
            cur.fetchone()
            print("✅ Connexion DB OK")

            cur.execute("SELECT COUNT(*) FROM bidding_algorithms WHERE is_enabled = true;")
            n_algos = cur.fetchone()[0]
            if n_algos < 1:
                print(f"⚠ {n_algos} algos enabled — attendu ≥ 1. Vérifie les seeds A4.1.")
                return 1
            print(f"✅ {n_algos} algos enabled en base")

            cur.execute(
                """
                SELECT COUNT(*)
                FROM dsp_campaign_data
                WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE is_demo = true)
                """
            )
            n_rows = cur.fetchone()[0]
            if n_rows < 1:
                print(f"⚠ {n_rows} lignes dans le dataset démo — attendu ~4078. Vérifie les seeds A4.1.")
                return 1
            print(f"✅ {n_rows} lignes de dataset démo accessibles")
    finally:
        conn.close()

    print("\n→ Tu peux lancer : python benchmark_bidding_algos.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
