"""Test de connexion Supabase via le JS Client (HTTPS) préalable au benchmark.

Usage :
    python test_connection.py

Vérifie 3 choses :
  1. Création du client Supabase (URL + service_role_key)
  2. Tables A4.1 accessibles (bidding_algorithms, ≥ 1 row)
  3. Dataset démo lisible (paginé, ~4078 lignes attendues)

Si un test échoue, le message pointe vers la section Troubleshooting du README.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from data_loader import get_client, paginate_select  # noqa: E402


def main() -> int:
    print("[test] Connexion à Supabase via HTTPS...")

    try:
        client = get_client()
    except (FileNotFoundError, EnvironmentError) as exc:
        print(f"\n❌ Création du client Supabase échouée\n{exc}\n")
        print("→ Voir scripts/benchmarking/README.md section 7 (Troubleshooting)")
        return 1

    # Check 1 : connexion + auth via lecture bidding_algorithms
    try:
        algos_resp = (
            client.table("bidding_algorithms")
            .select("code")
            .eq("is_enabled", True)
            .execute()
        )
        n_algos = len(algos_resp.data or [])
        print("✅ Connexion DB OK")
        if n_algos < 1:
            print(f"⚠ {n_algos} algos enabled — attendu ≥ 1. Vérifie les seeds A4.1.")
            return 1
        print(f"✅ {n_algos} algos enabled en base")
    except Exception as exc:  # noqa: BLE001
        print(f"\n❌ Erreur lecture bidding_algorithms : {exc!r}")
        print("→ Voir scripts/benchmarking/README.md section 7 (Troubleshooting)")
        return 1

    # Check 2 : dataset démo accessible (paginé, > 1000 lignes)
    try:
        demo_resp = (
            client.table("dsp_campaigns")
            .select("id")
            .eq("is_demo", True)
            .limit(1)
            .execute()
        )
        if not demo_resp.data:
            print("❌ Aucune campagne démo trouvée (is_demo=true). Vérifie les seeds A4.1.")
            return 1
        demo_id = demo_resp.data[0]["id"]

        rows = paginate_select(
            client.table("dsp_campaign_data")
            .select("date")
            .eq("campaign_id", demo_id)
        )
        n_rows = len(rows)
        if n_rows < 1:
            print(f"⚠ {n_rows} lignes dans le dataset démo — attendu ~4078. Vérifie les seeds A4.1.")
            return 1
        print(f"✅ {n_rows} lignes de dataset démo accessibles")
    except Exception as exc:  # noqa: BLE001
        print(f"\n❌ Erreur lecture dataset démo : {exc!r}")
        print("→ Voir scripts/benchmarking/README.md section 7 (Troubleshooting)")
        return 1

    print("\n→ Tu peux lancer : python benchmark_bidding_algos.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
