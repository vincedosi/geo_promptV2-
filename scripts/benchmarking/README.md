# Benchmark Custom Bidding — chantier A4.2

Compare les 5 algos seedés dans `bidding_algorithms` sur le dataset démo
`Renault Captur — Mars 2026` (4 078 lignes, drift J+15 simulé) et désigne le
gagnant qui sera productisé en A4.3.

---

## Section 1 — Prérequis

- **Python 3.10+** (testé 3.13)
- **Accès Supabase** : `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  pour le projet `vkkdbygwbrxyogqosten` (déjà présents dans `.env.local`
  racine pour Next.js)
- **HTTPS sortant vers `*.supabase.co`** ouvert (port 443) — c'est le seul
  port utilisé. Plus de dépendance aux ports postgres 5432/6543, donc plus
  de souci de firewall corporate.

---

## Section 2 — Configuration env

Le benchmark lit **`.env.local` à la racine du projet** (source de vérité
unique, partagée avec Next.js). Il NE faut PAS créer un `.env` dans
`scripts/benchmarking/`.

**Aucune modification de `.env.local` n'est nécessaire** : le benchmark
réutilise les variables déjà consommées par l'app Next.js MAGELIAN :

| Variable                       | Description                                | Source                                                                                       |
|--------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`     | URL du projet Supabase                     | déjà dans `.env.local` (utilisée par Next.js)                                                |
| `SUPABASE_SERVICE_ROLE_KEY`    | Clé `service_role` (INSERT/UPDATE)         | déjà dans `.env.local`, sinon Supabase Dashboard → Settings → API → **service_role** key     |

Variable alternative lue si `NEXT_PUBLIC_SUPABASE_URL` absent :
- `SUPABASE_URL` (même valeur, sans le préfixe Next.js)

### ⚠️ `service_role_key` obligatoire (pas `anon_key`)

Le benchmark fait des `INSERT`/`UPDATE` sur `adaptive_model_state` et
`bidding_simulations`. La `anon_key` est bloquée par les policies RLS — il
faut impérativement la `service_role` key (préfixée `eyJhbGciOiJIUzI1NiI...`
et > 100 caractères, claim `"role":"service_role"` dans le payload JWT).

### Pourquoi HTTPS et plus postgres direct

Cette approche passe par **HTTPS port 443**, donc fonctionne derrière les
firewalls corporate qui bloquent les ports postgres direct (5432) et pooler
(6543). C'est exactement le même chemin réseau que `npm run dev` chez Vince :
si l'app Next.js tourne, le benchmark Python tournera aussi.

`DATABASE_URL` (legacy psycopg2) n'est **plus utilisée** par le benchmark.

---

## Section 3 — Setup venv

```powershell
# Windows PowerShell (PC Dentsu)
cd C:\GENESIS\genesis_app\scripts\benchmarking
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

```bash
# Linux / macOS
cd scripts/benchmarking
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## Section 4 — Test de connexion (à faire AVANT le benchmark)

```powershell
python test_connection.py
```

Doit afficher 3 ✅ :
```
[test] Connexion à Supabase via HTTPS...
✅ Connexion DB OK
✅ 5 algos enabled en base
✅ 4078 lignes de dataset démo accessibles
→ Tu peux lancer : python benchmark_bidding_algos.py
```

Si un ✗ apparaît, voir **Section 7 — Troubleshooting**.

---

## Section 5 — Lancer le benchmark

```powershell
python benchmark_bidding_algos.py
```

Durée : **~5 minutes**. Sortie attendue (extrait) :
```
[benchmark] Supabase URL set: True | service_role key set: True
[benchmark] 5 algos enabled, dataset = 4078 rows
[benchmark] strategy: Pitch Demo — Maximize Leads (Hoeffding) (objective=maximize_leads)
[benchmark] train: 2026-03-01→2026-03-21 (2856 rows)
[benchmark] test : 2026-03-22→2026-03-30 (1222 rows)
[benchmark] ► running hoeffding_adaptive_tree
[benchmark]   hoeffding_adaptive_tree: lift=+12.34%, cpl=11.20€, total=18450ms
...
[benchmark] 🏆 winner: hoeffding_adaptive_tree (lift=+12.34%)
[benchmark] report: docs/chantier_a4_2_benchmark_results.md
```

Effets en base :
- 5 rows dans `adaptive_model_state` (1 par algo)
- 1 row dans `bidding_simulations` (résumé global)
- Gagnant marqué `is_active = true` (partial unique index garantit unicité)
- Rapport `docs/chantier_a4_2_benchmark_results.md` + 3 PNG dans `docs/assets/`

---

## Section 6 — Validation post-run

Vérifier en SQL :

```sql
-- 5 algos, 1 seul actif
SELECT algorithm_code,
       performance_metrics->>'lift_pct' AS lift,
       is_active
FROM adaptive_model_state
WHERE strategy_id = (SELECT id FROM bidding_strategies WHERE is_demo = true LIMIT 1)
ORDER BY (performance_metrics->>'lift_pct')::numeric DESC NULLS LAST;
-- ATTENDU : 5 lignes, exactement 1 avec is_active=true

-- Adform legacy strictement intact (non-régression)
SELECT COUNT(*) FROM dsp_campaign_data
WHERE campaign_id IN (SELECT id FROM dsp_campaigns WHERE is_demo = false);
-- ATTENDU : 294135
```

---

## Section 7 — Troubleshooting

### Cas A — `EnvironmentError: Aucune URL Supabase trouvée`

**Cause** : `NEXT_PUBLIC_SUPABASE_URL` absent de `.env.local` racine.

**Solution** — vérifier la présence de la variable :
```powershell
findstr /N "NEXT_PUBLIC_SUPABASE_URL" ..\..\.env.local
```
Si absente, l'ajouter (URL du projet Supabase, format
`https://<ref>.supabase.co`).

---

### Cas B — `EnvironmentError: SUPABASE_SERVICE_ROLE_KEY manquante`

**Cause** : la variable n'est pas dans `.env.local` racine, ou tu as collé
par erreur la `anon_key`.

**Solution** :
1. Supabase Dashboard → Settings → API → **service_role** (pas `anon`)
2. Copier la clé complète (commence par `eyJhbGciOiJIUzI1NiI...`, > 100 chars)
3. Ajouter dans `.env.local` :
   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
   ```

---

### Cas C — `httpx.ConnectError` / `Network error` / DNS

**Cause** — improbable car ton Next.js marche déjà via HTTPS Supabase. Si ça
arrive :
- vérifier que `npm run dev` fonctionne (preuve que HTTPS Supabase passe)
- désactiver temporairement le VPN d'entreprise
- lancer le benchmark depuis un autre réseau (hotspot mobile)

---

### Cas D — `permission denied` ou erreur RLS policy

**Cause** : tu utilises probablement la `anon_key` au lieu de la
`service_role_key`. La `anon_key` est bloquée par les policies RLS sur
`adaptive_model_state` et `bidding_simulations`.

**Solution** — vérifier le claim JWT :
```powershell
python -c "import os; from dotenv import load_dotenv; from pathlib import Path; load_dotenv(Path('../../.env.local')); k = os.getenv('SUPABASE_SERVICE_ROLE_KEY', ''); print('Has service_role key:', 'service_role' in k or len(k) > 100)"
```
Si `False`, repasser par le Cas B.

---

## Section 8 — Commit après run validé

Une fois le benchmark exécuté avec succès :

```powershell
# Bump version 7.19.0 → 7.20.0 dans lib/version.ts AVANT commit
git add scripts/benchmarking/ docs/chantier_a4_2_benchmark_results.md docs/assets/a4_2_*.png lib/version.ts
git commit -m "feat(bidding-benchmark): A4.2 — benchmark 5 algos on demo dataset"
```

Les fichiers `.env`, `.venv/`, `__pycache__/` sont déjà gitignorés.

---

## Architecture du code

```
benchmarking/
├── README.md                       # ce fichier
├── requirements.txt                # supabase, pandas, numpy, matplotlib, python-dotenv, river
├── benchmark_bidding_algos.py      # entrée orchestratrice
├── test_connection.py              # vérification pré-run (3 ✅)
├── data_loader.py                  # load_env() + get_client() HTTPS + SELECT paginé
├── metrics.py                      # simulation linéaire + lift + drift robustness
├── persistence.py                  # INSERT adaptive_model_state + bidding_simulations
├── reporting.py                    # Markdown + matplotlib PNGs
└── algos/
    ├── base.py                     # interface BiddingAlgorithm
    ├── hoeffding.py                # river HoeffdingAdaptiveTreeRegressor
    ├── gbm_online.py               # river AdaptiveRandomForestRegressor
    ├── linucb.py                   # LinUCB manuel (6 arms)
    ├── thompson.py                 # Thompson Sampling manuel (Beta priors)
    └── baseline_random.py          # baseline aléatoire uniforme [0.5, 1.5]
```

---

## Reproductibilité

- `random.seed(42)` et `numpy.random.seed(42)` figés dans
  `benchmark_bidding_algos.py`
- Dataset démo en base reproductible (DO block SQL avec `setseed(-0.5)`)
- Train/test split temporel déterministe : 1-21 mars en train, 22-30 mars en
  test (capture le drift J+15 cumulé)
