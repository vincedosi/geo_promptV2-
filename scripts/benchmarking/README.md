# Benchmark Custom Bidding — chantier A4.2

Compare les 5 algos seedés dans `bidding_algorithms` sur le dataset démo
`Renault Captur — Mars 2026` (4 078 lignes, drift J+15 simulé) et désigne le
gagnant qui sera productisé en A4.3.

---

## Section 1 — Prérequis

- **Python 3.10+** (testé 3.13)
- **Accès Supabase** : DATABASE_URL en lecture/écriture sur le projet
  `vkkdbygwbrxyogqosten`
- **IP whitelistée** si Network restrictions activées (Supabase Dashboard →
  Settings → Database → Network restrictions)

---

## Section 2 — Configuration env

Le benchmark lit **`.env.local` à la racine du projet** (source de vérité
unique, partagée avec Next.js). Il NE faut PAS créer un `.env` dans
`scripts/benchmarking/`.

Vérifier que la variable suivante est présente dans `.env.local` à la racine :

| Variable       | Description                              | Exemple                                                                                        | Comment l'obtenir |
|----------------|------------------------------------------|------------------------------------------------------------------------------------------------|--------------------|
| `DATABASE_URL` | URL postgres direct connection           | `postgresql://postgres:PWD@db.vkkdbygwbrxyogqosten.supabase.co:5432/postgres`                  | Supabase → Settings → Database → Connection string → URI → **Direct connection** |

Variables alternatives lues si `DATABASE_URL` absent :
- `POSTGRES_URL` (convention Vercel)
- `SUPABASE_DB_URL` (alternative)

### ⚠️ Caractères spéciaux dans le password

Si le password contient `@`, `#`, `&`, `/`, etc., il faut **URL-encoder** ces
caractères dans la chaîne de connexion :

| Char | Encodage |
|------|----------|
| `@`  | `%40`    |
| `#`  | `%23`    |
| `&`  | `%26`    |
| `/`  | `%2F`    |
| `*`  | `%2A`    |
| `[`  | `%5B`    |
| `]`  | `%5D`    |

Exemple : si le password est `My@Pass#123` :
```
DATABASE_URL=postgresql://postgres:My%40Pass%23123@db.vkkdbygwbrxyogqosten.supabase.co:5432/postgres
```

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
[test] Connexion à Supabase...
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
[benchmark] DATABASE_URL set: True
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

### Cas A — `tenant/user not found`

```
Erreur Supabase : tenant/user non trouvé.
Tu utilises probablement le pooler avec un mauvais format d'username.
```

**Cause** : tu utilises le pooler (`aws-0-eu-west-3.pooler.supabase.com`)
avec un mauvais format d'username.

**Solution** : bascule sur la **Direct connection** :
- host : `db.vkkdbygwbrxyogqosten.supabase.co`
- port : `5432`
- user : `postgres` (sans suffixe `.<ref>`)
- DB : `postgres`

Récupérer la string complète depuis Supabase Dashboard → Settings → Database
→ Connection string → URI → onglet **Direct connection**.

---

### Cas B — `Connection timed out` / `could not connect to server` / `could not translate host name`

```
Connexion DB en timeout / DNS / network.
```

**Cause 1** — IP non whitelistée. **Solution** :
- Récupère ton IP publique : https://www.whatismyip.com/
- Supabase Dashboard → Settings → Database → Network restrictions → Add IP

**Cause 2** — Firewall corporate Dentsu bloque le port 5432. **Solution** :
bascule sur le **transaction pooler** (port 6543 souvent ouvert) :
```
DATABASE_URL=postgresql://postgres.vkkdbygwbrxyogqosten:PWD@aws-0-eu-west-3.pooler.supabase.com:6543/postgres
```

**Cause 3** — VPN d'entreprise filtre les connexions DB. **Solution** : se
déconnecter du VPN ou utiliser un partage de connexion mobile.

---

### Cas C — `password authentication failed`

```
Erreur d'authentification DB.
```

**Cause 1** — URL-encoding manquant pour les caractères spéciaux du password.
**Solution** : encoder selon la table de la section 2.

**Cause 2** — Password reset depuis le dashboard. **Solution** :
- Supabase Dashboard → Settings → Database → Reset database password
- Mettre à jour `DATABASE_URL` dans `.env.local`

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
├── requirements.txt                # river, psycopg2-binary, pandas, numpy, matplotlib, python-dotenv
├── benchmark_bidding_algos.py      # entrée orchestratrice
├── test_connection.py              # vérification pré-run (3 ✅)
├── data_loader.py                  # load_env() + get_conn() diagnostique + SELECT
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
