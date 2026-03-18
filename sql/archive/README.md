# Archive — Scripts SQL supersédés

Ces scripts ont été **appliqués en production** à une époque donnée mais ont été remplacés par des versions ultérieures.

**Ne pas réappliquer** — conservés uniquement pour référence historique et pour comprendre l'évolution de l'algorithme.

## Contenu

| Script | Remplacé par |
|--------|-------------|
| `setup_carreaux.sql` | `003_carreaux_filosofi.sql` |
| `002_get_carreaux_bbox.sql` | `003_carreaux_rpc.sql` |
| `006_import_carreaux_batch.sql` | Log d'import (pas un script SQL) |
| `019_rpc_compute_coverage_per_poi_v2.sql` | `025_rpc_compute_coverage_per_poi_batch_v2.sql` |
| `027_rpc_coverage_colonnes_directes.sql` | Revert `029_revert_coverage_fast_jsonb.sql` |
| `028_rpc_populate_carreaux_columns.sql` | Annulé avec 027 |
| `031_clip_isochrones_france.sql` | `032_fix_battle_artifacts.sql` |
| `032_fix_battle_artifacts.sql` | `033_get_isochrone_battle_v2.sql` |
| `033_get_isochrone_battle_v2.sql` | `042_get_isochrone_battle_v9_outer_fill.sql` |
| `034_calculate_coverage_per_group.sql` | `043_plpgsql_loop_no_temptable.sql` |
| `036` → `041` battle v3→v8 | `042_get_isochrone_battle_v9_outer_fill.sql` |
| `041_optimize_calculate_coverage_per_group.sql` | `043_plpgsql_loop_no_temptable.sql` |
| `042_cte_coverage_per_group.sql` | `043_plpgsql_loop_no_temptable.sql` |
