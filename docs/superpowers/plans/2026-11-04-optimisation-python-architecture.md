# Optimisation en Python — architecture, frontière, migration

Rédigé le 04/11/2026, branche `feat/optimisation-python`. Remplace l'architecture du 26/10 (noyau TS `lib/optimisation/noyau/`,
`docs/rebid-v2.md` § 5) — jamais codée : `lib/optimisation/` n'existe pas (mesuré le 04/11). Décision du propriétaire,
04/11, non négociable : **tout l'algorithme d'optimisation est en Python**, plan initial et adaptateurs DSP compris. Restent
hors Python : le front Angular (contrat AIDA, ne cadre que le front), l'API Next.js comme passerelle authentifiée
(`getSession` sur `/api/*`), les écrans ①-⑤ du découpage.

Toutes les mesures : base locale le 04/11 (`docker exec supabase_db_genesis_app psql -U postgres`, lecture seule), code au
commit `c519839b`.

**Arbitrages du 04/11 (chef de projet, mode accéléré, recommandations retenues — § 7)** : Q1 = A (ordonnanceur Python),
Q2 = A (code React gelé non porté), Q3 = A (super_admin + admins de l'espace, expiration au cycle suivant).

---

## 0. Synthèse

- **Frontière** : ⑤ s'arrête à la ligne d'unité (code, population en zone, population totale, part, `retenu` au seuil de la
  plateforme, groupes de CP, liste exacte) et au bilan de découpage. Python commence au premier nombre qui n'est pas une
  population : multiplicateur, part prévue, `HORS_ZONE`, écrêtage, plan par plateforme, correction, paliers, envoi.
- **Règle SQL** : ce qui agrège des livraisons ou lit un référentiel reste SQL ; ce qui décide un poids, une part prévue,
  une correction, un palier ou un envoi est Python.
- **Service** : paquet `optimisation` (Python 3.13, noyau pur, mypy strict, pytest), exposé par FastAPI sur le réseau Docker
  `supabase_network_genesis_app`, base lue par psycopg 3 en direct (pas de PostgREST, donc pas de plafond 1 000 lignes).
  Jamais exposé au navigateur.
- **Cycle** : ordonnanceur Python (Inngest n'a plus d'ordonnanceur depuis le 19/09), table `optimisation_cycles`
  (clé unique campagne/jour/plateforme, instantané des entrées + sha256), validation humaine avant tout envoi.
- **Parité** : le plan initial Python redonne les multiplicateurs TS au millième et les parts prévues à 1e-12 près, sur
  73 cas unitaires existants, 6 zones de référence et les 4 extractions risque en base (9 190 lignes).
- **Volume** : 18 tâches (T0-T17), 34 jours-dev dont 4 bloqués (TTD, Meta : accès comptes). Chemin critique 16,5 j.

---

## 1. Inventaire mesuré

### 1.1 Ce qui calcule un poids, une part, un multiplicateur ou une correction

| Morceau | Lignes | Ce qu'il calcule | Appelants | Sort |
|---|---|---|---|---|
| `lib/zones/plan.ts` | 554 | `genererPlanCp` sémantique `repartition` (jeux risque : `pop × poids de classe`, part × n, bornes 0,001 / 999,999) et `multiplicateur` (jeux de zone, A1 : part ÷ moyenne des parts retenues, écrêtage E4, `HORS_ZONE` E3) ; `bornerMultiplicateur`, `etendreAuxGroupes`, `regrouperParCodePostal`, `tauxUtile` | `rattacher` (risque, vivant), `jeux/[id]/export`, `jeux/[id]/cp-geo`, `jeux/[id]/extractions` (risque), `plan-jeu-zone.ts` | **Python** pour tout le calcul ; `plierParCodePostal` (repli d'affichage, sans poids) reste TS |
| `lib/zones/plan-jeu-zone.ts` | 340 | `planCpDeZone`, `plansParPlateforme` (B12), `reglageDuPlan`, `sortiesPoids` | `extraction-jeu-zone.ts` | **Python**, entier |
| `lib/zones/part-prevue.ts` | 127 | E5 : `part × volume × classe ÷ (Σ + HORS_ZONE)`, répartie entre membres ; `universDeZone` (D35) | `plan-jeu-zone.ts` | **Python**, entier |
| `lib/zones/part-prevue-serveur.ts` | 59 | `lireVolumesAttendus` (sql/337), `lireHorsZone` (sql/306) | extraction, `plan-extraction.ts` | `lireVolumesAttendus` → **Python** (psycopg) ; `lireHorsZone` reste TS (lecture figée) |
| `lib/zones/unite-cp.ts` | 78 | `developperUnites`, `canoniques` | `plan-jeu-zone.ts` | **Python** ; supprimé en TS à T6 |
| `lib/zones/jeu.ts` | 310 | schéma Zod du jeu ; `poidsDeClasse` | `plan.ts`, `plan-jeu-zone.ts`, `jeux/[id]/export` | Validation reste TS ; `poidsDeClasse` → **Python** |
| `lib/zones/extraction-jeu-zone.ts` | 648 | orchestration de ⑤ ; plans l. 512-541 (`planCp`) et 588-600 (`sortiesPoids`) | `POST /api/zones/jeux/[id]/extractions` | Conversions **restent** TS/SQL ; `planCp` + `sortiesPoids` = **un appel Python** ; écriture `creer_extraction_jeu_zone` reste |
| `lib/zones/plan-extraction.ts` | 170 | aucun calcul : recopie `zone_set_extraction_cp` dans `bidding_zone_configs` | `rattacher`, `…/fichier`, `cp-plateforme.ts` | **Reste** TS |
| `lib/zones/cp-plateforme.ts` | 60 | aucun calcul ; ⚠ rend le plan **commun** filtré par plateforme (dette D32, sql/334) | `…/cp`, `…/fichier`, `…/activation/{prevol,pousser}`, `etat-activation.ts` | **Reste** TS ; bascule sur `zone_set_extraction_cp_plateforme` à T7 |
| `lib/pacing/rebid.ts` | 44 | rebid plafonné V1 | `PacingPanel.tsx` (React, navigateur), `lib/demo/controller.ts` ← `/api/demo/apply-rebid` (aucun appelant front) | **Gelé, non porté** (Q2), supprimé au lot 7 ; remplacé par la correction v2 |
| `lib/pacing/compute.ts` | 62 | diagnostic ±5 pts sur `campaign_plan_snapshot` (**0 ligne**) | `/api/digital/[campaignId]/pacing`, `lib/report/aggregate.ts`, démo, `PacingPanel.tsx` | **Gelé** (Q2) ; les mesures d'écart du cycle sont en Python |
| `lib/pacing/snapshot.ts` | 48 | `expected_share` des POI | `/api/custom-geo/media-plan/snapshot` | **Gelé** (Q2) |
| `lib/simulation/recalage.ts` | 92 | recalage amorti `clamp(plan/obs; 1/3; 3)^0,8`, ×0,6 sous 20 % | `/api/zones/jeux/[id]/simulation/recaler` (Angular `features/risques/data/simulation.api.ts:46`, React `PanneauCampagne.tsx`) | **Python** (correction v2) ; changement voulu (D1, D5) → acceptation sur `rebid-v2.md` § 7, pas de parité |
| `lib/simulation/generateur.ts` | 261 | diffusion synthétique (démo) ; paramètres `0,8`, `20`, `0,6` (l. 39-41) | `simulation`, `simulation/recaler`, `PanneauCampagne.tsx` | **Reste** TS (données de démo) ; les 3 paramètres de correction vont dans `optimisation_reglages` (T9) |
| `lib/simulation/alignement.ts` (`cibleParZone`) | 123 | part de population exposée par bassin (affichage) | `vue.ts` ; copie Angular | **Reste** |
| `lib/digital/bidding-export.ts` | 156 | paliers par quantiles (export « pression ») | `/api/bidding/strategies/[id]/export` (React) | **Gelé** (Q2) ; paliers v2 en Python |
| `lib/digital/dv360-bidding-script.ts` | 92 | script custom bidding DV360 | `lib/dsp/push/{dv360,simulated}.ts`, `/api/custom-geo/[id]/export` (React) | **Python** (adaptateur DV360) ; export custom-geo React gelé |
| `lib/digital/dv360-geo.ts` + `google-geo-postal-fr.json` | 48 + 5 989 | CP → geo IDs Google | `pousser-ciblage.ts`, `fichiers-dv360.ts` | **Copié** dans l'image Python au build ; TS le garde pour le SDF ; test d'égalité `GEO_POSTAL_FR_VERSION` |
| `lib/zones/fichiers-plateformes.ts`, `lib/digital/fichiers-dv360.ts` | 236 + 40 | mise en forme des unités figées, sans poids | `…/fichier` | **Restent** TS |
| `angular/…/carte/logique/plan/impressions.ts:74-92` | — | ⑥ : `impressions × m ÷ Σ m` par CP | écran ⑥ | **Reste** front, mais lit `part_prevue` du plan de la plateforme (T7) — aujourd'hui ⑥ et le suivi E5 ne répartissent pas pareil |

### 1.2 Fonctions SQL

| Fonction | Corps | Rôle | Sort |
|---|---|---|---|
| `refresh_campaign_rollups` (sql/306:275-341) | 3 302 car. | agrège les livraisons ; `planned_share = part_prevue` sinon `m ÷ Σ m` ; `in_target = m > 1` | **Reste** ; le chemin `m ÷ Σ m` reste pour les plans risque et les 13 641 lignes de `bidding_zone_configs` ; le plan risque Python n'écrit pas de `part_prevue` (condition de parité) |
| `volumes_attendus_cp_univers` (sql/337) | 917 car. | volume V1 d'une liste de CP + total de l'univers, un passage sur 6 010 lignes | **Reste**, appelée par Python |
| `hors_zone_extraction` (sql/306) | 130 car. | ligne `HORS_ZONE` figée | **Reste**, lue par Python |
| `creer_extraction_jeu_zone` (sql/317) | 16 802 car. | seul écrivain de l'extraction ; empreinte md5 sur multiplicateurs arrondis au millième ; verrou consultatif | **Reste** ; reçoit le plan Python, signature inchangée |
| `creer_zone_set_extraction` (risque) | 5 192 car. | extraction risque | **Reste** ; reçoit le plan risque Python |
| `get_campaign_expected` (sql/280) | 1 022 car. | volume attendu à date (suivi) | **Reste** pour l'affichage ; le cycle calcule `I_total` par plateforme avec la formule de ⑥ |
| `get_campaign_pacing` | 3 213 car. | ancien suivi par snapshot | **Gelé** (Q2) |
| `simulate_dsp_report` | 3 379 car. | démo dans `campaign_dsp_report` | **Reste** |

### 1.3 Plomberie DSP

| Morceau | Lignes | État mesuré | Sort |
|---|---|---|---|
| `lib/dsp/dv360/auth.ts` | 110 | compte de service (JWT) + OAuth 3 jambes, `google-auth-library` | **Python** (`google-auth`) |
| `lib/dsp/dv360/client.ts` | 295 | API DV360 v3 : geo regions, location lists, custom bidding script, budget d'IO, listages | **Python** (httpx, délais explicites) |
| `lib/dsp/dv360/pousser-ciblage.ts` | 158 | CP → geo IDs, plafond 2 000, mode simulé | **Python** ; `/activation/pousser` (377 l.) devient passerelle |
| `lib/dsp/push/*` | 157 | `REAL_PUSHERS = { dv360 }` ; **`runPush` sans appelant** hors `lib/dsp` | **Python** ; l'envoi après validation remplace `runPush` |
| `lib/dsp/report/*` | 89 | `REAL_REPORTERS = { dv360 }` → `skipped` (droits Google) | **Python**, écrit `campaign_dsp_report` |
| `lib/dsp/tiktok/client.ts` | 88 | OAuth (jeton longue durée, sans refresh), test | **Python** |
| TTD, Meta | 0 | aucun code | **Python**, à écrire (T16) |
| `lib/crypto/secrets.ts`, `lib/dsp/oauth-state.ts` | ~40 + 57 | AES-256-GCM `iv:tag:ct` base64 (`DSP_ENC_KEY`) ; HMAC du `state` (domaine `dsp-oauth-state:v1`, 10 min) | **Python**, même format (pas de rechiffrement) |
| 16 routes `app/api/admin/dsp/**`, `app/api/dsp/**` | 1 978 avec `activation`, `reconcile` | appellent les modules ci-dessus | **Restent** passerelles (session, rôle, espace), corps réduit à l'appel Python |

En base : `dsp_connections` 1 ligne (`dv360`, `oauth`, statut `error`) ; colonnes `credentials_encrypted`,
`oauth_refresh_token_encrypted`, `oauth_client_secret_encrypted`. `campaign_dsp_report` 2 131 lignes, toutes « Démo pilotage —
élections » (01/04-30/04/2026).

---

## 2. Frontière découpage / algorithme

### 2.1 Décision

**Le découpage (TS/SQL, ①-⑤) produit et fige** : par plateforme et maille, les unités (code, nom, population en zone,
population totale, part, `retenu` par `estRetenue` au seuil de la plateforme — part non arrondie, B11) ; cercles pavés, pays,
polygone simplifié et leurs bilans ; blocs (ARB-6) ; avertissements et refus de maille ; les entrées du plan (groupes de CP
`lireGroupesCp`, liste exacte `codes_postaux` B15, type de recette, mode du plan, poids de classe).

**L'algorithme (Python) calcule** : le réglage de chaque plateforme (`plateformes_poids`, 5 lignes au 04/11) ; volumes attendus
et univers (D35) ; plan commun (déprécié, D32) et plan de chaque plateforme au CP (multiplicateurs, écrêtage, groupes
`meme`/`divise`, `HORS_ZONE`, parts prévues E5, `resume.multiplicateur`, `resume.part_prevue`) ; sorties de poids par mécanisme
et avertissements (`multiplicateur_min`, `multiplicateur_max`, `nb_max_entrees`, `n_envois`) ; plan d'un jeu risque
(`repartition`) ; puis chaque jour : correction v2, paliers, score hors zone, envoi, lecture des rapports.

**Couper à `retenu`** : `retenu` est affiché en ⑤ avant l'extraction, calculé par la même fonction à l'écran et à l'extraction
(A-5), et entre dans l'empreinte. Le déplacer obligerait ⑤ à appeler Python à chaque mouvement de seuil pour une comparaison
`part ≥ seuil`. Tout ce qui suit dépend du registre des mécanismes de poids : c'est l'algorithme.

**L'écriture reste SQL** : `creer_extraction_jeu_zone` tient le verrou, l'empreinte md5 et l'idempotence (`deja_extraite`).
Un second écrivain Python dupliquerait la règle d'empreinte.

### 2.2 Chemin de l'extraction après bascule

```
Angular ⑤ → POST /api/zones/jeux/[id]/extractions (Next : session, quota, chargement du jeu)
  → conversions TS/SQL, séquentielles (inchangées)
  → POST {OPTIMISATION_URL}/v1/plans/zone   { couverture CP, retenus par plateforme, groupes, liste exacte,
                                              recette.type, mode_plan, poids, choix des plateformes }
       Python : lit plateformes_poids et volumes_attendus_cp_univers, appelle le noyau pur, rend
                { commun, par_plateforme[], sorties_poids[], algo: { version, entrees_sha256 } }
  → creer_extraction_jeu_zone (inchangée)
```

Plan national ≈ 6 009 lignes, ≈ 1 Mo de JSON aller-retour en local ; délai 30 s (`lib/http/fetch-avec-delai.ts`).

### 2.3 Ce que Python recalcule dans l'extraction ⑤ livrée, et la compatibilité

Python recalcule tout ce que produisent `planCp` (l. 512-541) et `sortiesPoids` (l. 588-600) : `zone_set_extraction_cp`,
`zone_set_extraction_cp_plateforme`, `resume_plan.multiplicateur`, `resume_plan.part_prevue`, `plateformes[].poids`,
`plateformes[].plan_cp`, avertissements d'écrêtage.

Base locale au 04/11 : 4 extractions, **toutes risque** (2 000, 2 000, 2 595, 2 595 lignes de plan, 0 part prévue) ; 0 jeu de
type zone ; 0 ligne dans `zone_set_extraction_cp_plateforme` et `zone_set_extraction_unites`. Pas de prod (supprimée le 21/09).
**Aucune extraction de zone à migrer.**

Compatibilité des extractions produites par le TS avant bascule :

1. Une extraction est immuable ; Python n'en réécrit aucune.
2. Nouvelle clé `resume_plan.algo = { moteur: 'python', version, entrees_sha256 }` ; absente = calculée en TS. Les lecteurs
   (`lireHorsZone`, `planExtraction`, `refresh_campaign_rollups`) ne la lisent pas.
3. L'empreinte md5 ne dépend que des multiplicateurs au millième et des unités : la parité (§ 5) rend la même empreinte, donc
   re-extraire un jeu inchangé rend `deja_extraite`. Un écart = nouvelle version (pas de corruption), compté comme échec de parité.
4. Entiers sérialisés en entiers (`1`, pas `1.0`) : texte `jsonb` identique au TS.

---

## 3. Service Python

### 3.1 Emplacement et paquet

**Même dépôt**, `services/optimisation/` : fixtures de parité générées par le TS du même commit, `ARCHITECTURE.md` mis à jour
dans le même commit, `aucun-secret-en-dur.test.ts` balaie déjà tous les fichiers suivis.

```
services/optimisation/
  pyproject.toml, uv.lock            Python 3.13 (3.13.14 en local), ruff, mypy --strict, pytest, hypothesis
  Dockerfile, compose.yaml, .env.example (noms seulement)
  openapi.json                       exporté par un test, source des types TS générés
  src/optimisation/
    noyau/                           PUR : ni psycopg, ni httpx, ni horloge — vérifié par un test
      nombres.py                     arrondi_js (Math.round), somme_gauche, bornes
      plan_risque.py                 genererPlanCp sémantique repartition
      plan_zone.py                   planMultiplicateur, groupes, HORS_ZONE, plans par plateforme
      part_prevue.py                 E5, univers D35
      reglage.py                     reglageDuPlan, sortiesPoids
      correction.py                  rebid v2 (rebid-v2.md § 2)
      paliers.py                     paliers par valeur, médiane, score hors zone (§ 3)
      types.py                       dataclasses figées des entrées/sorties
    lecture/                         psycopg : registre, volumes, plan figé, livraisons
    cycles/                          machine d'états, instantané, empreinte, rejouer, expiration
    adaptateurs/{dv360,tiktok,ttd,meta,simule}/
    secrets.py                       AES-256-GCM iv:tag:ct compatible Node
    api/                             FastAPI, /v1/*
    ordonnanceur.py
  tests/
    noyau/ (INV1-INV10, hypothesis), parite/ (fixtures/*.json.gz), lecture/ (base locale), adaptateurs/
```

Dépendances limitées : fastapi, uvicorn, pydantic 2, psycopg 3 + psycopg_pool, cryptography, httpx, google-auth, apscheduler 3.

### 3.2 HTTP : FastAPI

Pydantic 2 = rôle de Zod ; OpenAPI → `openapi-typescript` → `types/optimisation.gen.ts`. Un test pytest vérifie que
`openapi.json` est à jour, un test vitest que le TS généré lui correspond. uvicorn **1 worker** : un calcul à la fois.

Routes, toutes sous en-tête `X-Optimisation-Cle` (comparaison à temps constant) :

| Route | Rôle |
|---|---|
| `GET /sante` | service + base |
| `POST /v1/plans/zone`, `POST /v1/plans/risque` | plan initial |
| `POST /v1/executions` | passage du cycle (ordonnanceur ou manuel), progression NDJSON |
| `GET /v1/campagnes/{id}/cycles` | cycles d'une campagne |
| `POST /v1/cycles/{id}/valider`, `…/refuser` | décision humaine (`X-Utilisateur`, `X-Espace` transmis par Next) |
| `POST /v1/cycles/{id}/rejouer` | recalcul depuis l'instantané, comparaison d'empreintes |
| `POST /v1/dsp/{plateforme}/oauth/{url,echange}`, `…/config`, `…/test`, `…/ressources` | connexions |
| `POST /v1/activation/pousser` | poussée de ⑦ |

Authentification : Angular → Next `/api/*` (`getSession`, rôle via `lib/auth/roles.ts`, espace) → Python (clé interne + identité
en en-têtes). Écoute `127.0.0.1:8090` et le réseau Docker ; jamais joint par le navigateur.

### 3.3 Base : psycopg en direct

| Critère | psycopg direct | PostgREST |
|---|---|---|
| Plafond 1 000 lignes | aucun (6 009 lignes en une requête) | `db-max-rows = 1000` ; `lireTout` = 7 pages, chacune refait l'agrégation |
| Transactions, `FOR UPDATE`, verrou consultatif | oui | non |
| Secret | rôle Postgres dédié | JWT `service_role` (contourne toute RLS) |

Rôle `optimisation_service` (migration de T1) : `LOGIN BYPASSRLS` — nécessaire car `plateformes_poids`, `dsp_connections`,
`campaign_dsp_report`, `bidding_zone_configs`, `zone_set_extraction_cp_plateforme` ont la RLS active sans policy (sinon 0 ligne,
sans erreur). Droits : `SELECT` tables de plan/livraison/registre ; `INSERT`/`UPDATE` sur `optimisation_*` ; `SELECT`/`UPDATE`
`dsp_connections` ; `INSERT` `campaign_dsp_report`, `dsp_api_logs` ; `EXECUTE` `volumes_attendus_cp_univers`,
`hors_zone_extraction`.

Règles I/O de CLAUDE.md : pool ≤ 3 connexions (100 permises, 12 occupées le 04/11) ; `statement_timeout` 30 s ; campagnes une par
une ; `EXPLAIN ANALYZE` sur toute requête neuve ; index `(campaign_id, channel, date)` à ajouter sur `campaign_dsp_report`.

### 3.4 Conteneur et déploiement

`compose.yaml` : deux services sur l'image `python:3.13-slim`, réseau externe `supabase_network_genesis_app` —
`optimisation_api` (uvicorn) et `optimisation_ordonnanceur` (`python -m optimisation.ordonnanceur`). Base :
`supabase_db_genesis_app:5432` depuis le conteneur, port 54322 depuis l'hôte. `scripts/local/13-optimisation-up.sh` complète
`00-docker-up.sh` et `01-supabase-up.sh`.

Déploiement (AWS siège / GCP en pause) ouvert : une image OCI, configuration par variables d'environnement. L'ordonnanceur ne fait
qu'appeler `POST /v1/executions` ; sur un service qui s'endort (Cloud Run…), Cloud Scheduler / EventBridge le remplace sans code.

### 3.5 Variables d'environnement

| Variable | Où | Rôle |
|---|---|---|
| `OPTIMISATION_DATABASE_URL` | Python | rôle `optimisation_service` |
| `OPTIMISATION_CLE_INTERNE` | Python + Next | clé de la passerelle |
| `OPTIMISATION_URL` | Next | `http://127.0.0.1:8090` |
| `OPTIMISATION_PLAN_SOURCE` | Next | `ts` / `ombre` / `python` (§ 5.2) ; supprimée à T6 |
| `DSP_ENC_KEY` | Python ; Next jusqu'à T14 | AES-256-GCM + HMAC du `state` |
| `DV360_OAUTH_CLIENT_ID`, `DV360_OAUTH_CLIENT_SECRET` | Python | client OAuth de secours |
| `OPTIMISATION_HEURE_CYCLE`, `TZ=Europe/Paris` | Python | heure du passage (06:30 proposé) |

`services/optimisation/.env` non suivi ; `.env.example` = noms seuls. Ces variables entrent dans `derive-documentation.test.ts`.

### 3.6 OAuth DSP repris en Python

**Jetons aujourd'hui** : `dsp_connections` — JSON du compte de service (`credentials_encrypted`), refresh token
(`oauth_refresh_token_encrypted`), secret client (`oauth_client_secret_encrypted`), en AES-256-GCM `iv_b64:tag_b64:ct_b64`
(`lib/crypto/secrets.ts`, `DSP_ENC_KEY` 32 octets base64 dans `.env.local`). TikTok : jeton longue durée, sans refresh. TTD,
Meta : rien.

**À refaire** :
1. `secrets.py` même format (`AESGCM` rend `ct || tag` : découper/recoller) ; test croisé Node ↔ Python ; aucun rechiffrement.
2. `state` HMAC même format (`orgId.expiresAtMs.signature`), même domaine.
3. DV360 : compte de service, refresh, échange du code (`google-auth`), délai 30 s sur le jeton.
4. TikTok : échange du code, liste des annonceurs.
5. TTD, Meta : tout (T16), bloqué par l'accès aux comptes (C28).

**URI de redirection inchangées** : les callbacks restent `/api/admin/dsp/{dv360,tiktok}/oauth/callback` sur Next ; Next vérifie
la session puis transmet `{code, state}` à Python, qui vérifie, échange, chiffre, stocke. Après T14, `DSP_ENC_KEY` ne vit plus
que côté Python.

---

## 4. Cycle quotidien

### 4.1 Déclencheur : ordonnanceur Python (Q1 = A)

Inngest n'a plus d'ordonnanceur depuis le 19/09 (pas de déploiement, `ARCHITECTURE.md` l. 223) ; `lib/inngest/functions/` ne
porte que `civicDailyIngest` et `populateCarreauxColumns`. `pg_cron` disponible mais non installé — on ne l'installe pas
(réseau sortant `pg_net` dans la base). Conteneur `optimisation_ordonnanceur` (APScheduler, `CronTrigger` 06:30 Europe/Paris) =
même fonction que `POST /v1/executions`. Next expose `POST /api/campaigns/[id]/optimisation/declencher` (manuel, NDJSON :
lecture → calcul → écriture, compteurs).

### 4.2 Déroulé d'un passage

Par campagne éligible (stratégie active avec `extraction_id`, période en cours, démo seulement sur drapeau), **une par une**, puis
par plateforme au CP de l'extraction :

1. Verrou consultatif `(hashtext('optimisation'), hashtext(campagne))`.
2. Le cycle précédent resté `propose` passe `expire`.
3. Lecture : plan figé de la plateforme (`zone_set_extraction_cp_plateforme`) + `HORS_ZONE` ; poids courants (sortie du dernier
   `envoye`, sinon le plan) ; livraisons en une requête sur `campaign_dsp_report` (`SUM(impressions)` et
   `SUM(impressions) FILTER (WHERE date > J − F)` par CP, CP hors plan imputés à `HORS_ZONE`) ; `I_total` (formule de ⑥) ;
   réglages (`optimisation_reglages`) et `cp_geoloc_defaut`.
4. Cycle écrit en `lu` avec l'instantané et son empreinte.
5. Noyau : `pas_de_correction` / `plan_atteint` → reste `lu` (final) avec la raison ; sinon `propose` avec la sortie (poids,
   `corr_dep`, `corr_cp`, parts cible/observée, fuite, écrêtés, paliers) et son empreinte.
6. Exécution journalisée dans `optimisation_executions` (début, fin, campagnes, cycles, erreurs, étapes) — la progression
   obligatoire des batchs pour un passage sans écran.

### 4.3 `optimisation_cycles`

| Colonne | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `campagne_id` | uuid → `dsp_campaigns` | |
| `plateforme` | text | code de `dsp_channel_registry` |
| `jour` | date | Europe/Paris |
| `statut` | text check | `lu`, `propose`, `valide`, `envoye`, `refuse`, `expire` |
| `strategie_id`, `extraction_id`, `extraction_version` | | version du plan figé |
| `algo_version` | text | version du paquet |
| `parametres` | jsonb | α, k, fenêtre, bornes, paliers, seuil de fuite |
| `date_livraison` | date | J |
| `entrees`, `entrees_sha256` | jsonb, char(64) | instantané en colonnes (`cp[]`, `dep[]`, `poids[]`, `part_plan[]`, `livre_cum[]`, `livre_fen[]`) |
| `sortie`, `sortie_sha256` | jsonb, char(64) | |
| `resume` | jsonb | statut du noyau, fuite, moyenne après écrêtage, neutralisés, CP par palier, CP qui changent de palier |
| `propose_le`, `decide_par`, `decide_le`, `motif_refus` | | décision humaine |
| `envoye_le`, `envoi` | | résultat de l'adaptateur |
| `erreur`, `tentatives_envoi` | | |
| `cree_le` | timestamptz | |

- Unique `(campagne_id, jour, plateforme)`, écriture `INSERT … ON CONFLICT DO NOTHING RETURNING id` (un second passage le même jour
  ne crée rien et le dit).
- Unique partiel `(campagne_id, plateforme) WHERE statut IN ('lu','propose','valide')`.
- Transitions `UPDATE … WHERE id = $1 AND statut = $de RETURNING` ; 0 ligne = refusée avec message. Admises : `lu → propose`,
  `propose → valide | refuse | expire`, `valide → envoye`. Python seul écrivain.
- RLS active sans policy.
- Volume : plan national 6 009 CP ≈ 250 Ko par instantané (colonnes) ; zone de 895 CP ≈ 40 Ko ; 600 cycles/mois ≈ 24-150 Mo bruts
  avant TOAST. Mesure à T10 avant de fixer une rétention.

Même migration : `optimisation_reglages` (par campagne, réglages P5 de `rebid-v2.md` + défauts), `cp_geoloc_defaut` (E8),
`optimisation_executions`.

### 4.4 Validation humaine et envoi (Q3 = A)

Aucun envoi sans `valide`. Écran Angular ⑧ (T12), par plateforme : poids proposés contre courants, `corr_dep` par département,
écrêtés, neutralisés, fuite, paliers et CP qui changent de palier ; « Valider et envoyer » / « Refuser » (motif obligatoire).
**Valident** : super_admin et admins de l'espace propriétaire de la campagne. **Expiration** : au cycle suivant (24 h).

Next → Python (`/v1/cycles/{id}/valider`) : transition puis adaptateur. Succès → `envoye` ; échec → reste `valide` avec `erreur`,
3 tentatives par l'ordonnanceur puis échec affiché. Mécanisme `aucun` (Meta, TikTok au CP selon `plateformes_poids`) : cycles
jusqu'à `propose`, non validables — l'écran le dit.

### 4.5 Rejouer

Le noyau ne lit ni horloge, ni hasard, ni base. Instantané en JSON canonique (clés triées, CP triés, nombres en `repr`) → sha256.
`POST /v1/cycles/{id}/rejouer` recalcule depuis `entrees` et compare `sortie_sha256` : identique à `algo_version` égale ; sinon
l'écart CP par CP (non-régression entre versions). Le plan initial porte la même empreinte dans `resume_plan.algo`.

---

## 5. Parité et migration

### 5.1 Parité du plan initial

**Fixtures générées par le TS** (T2) : `tests/parite/generer-fixtures.ts` (vitest) exécute les fonctions pures actuelles et écrit
`{ entree, sortie }` en JSON gzip dans `services/optimisation/tests/parite/fixtures/`. Sources :

1. Entrées des tests existants : `plan.test.ts` (36), `plan-jeu-zone.test.ts` (24), `part-prevue.test.ts` (13) = 73 cas.
2. Les 6 zones de référence (Q39 : cinq zones + composite de 895 unités), sorties de `couverture_zone` lues en base, déclinées en
   exclusif/pondéré, DV360 seul / DV360+TTD / liste exacte ; une zone nationale (6 009 CP) = le plus gros cas.
3. Les 4 extractions risque (9 190 lignes) : entrées rejouées depuis `zone_set_cp` (2 081 et 2 746 lignes), comparées aux
   multiplicateurs stockés — seules sorties réelles déjà figées.

**Critères** : multiplicateurs égaux au millième (aucun écart) ; `part_prevue` à 1e-12 relatif ; `resume` égal clé par clé ;
empreinte md5 recalculée (formule sql/317) identique.

**Pièges identifiés avant de coder** :
- Python ≥ 3.12 : `sum()` sur flottants = sommation compensée (Neumaier) ≠ `reduce` JS → `somme_gauche()` ; un test interdit
  `sum(` dans `noyau/`.
- `round()` arrondit au pair ; `Math.round` vers +∞ à la moitié → `arrondi_js(x, n) = floor(x × 10ⁿ + 0,5) / 10ⁿ`, même
  multiplication intermédiaire.
- `Math.min(...[])` = `Infinity`, `min([])` lève → cas vides codés explicitement.
- Ordre d'itération : `Map` JS et `dict` Python suivent l'insertion, mais les entrées doivent arriver dans le même ordre (fixé par
  les fixtures).

### 5.2 Bascule

1. **`ts`** (actuel) jusqu'à parité pytest verte (T3, T4).
2. **`ombre`** (T5) : Next calcule TS et Python, compare, journalise l'écart (une ligne JSON par extraction) ; le TS est écrit.
   Cinq appelants : extraction de zone, extraction risque, `rattacher`, `jeux/[id]/export`, `jeux/[id]/cp-geo`. Python en panne →
   TS + panne journalisée.
3. **`python`** (T6) quand : 20 extractions en ombre sans écart (dont une nationale et une risque) et intégrations vertes
   (`jeu-zone-extraction`, `rattacher-extraction`, `part-prevue`, `zone-set-extractions`, `activation-extraction`,
   `fichier-extraction`). Python en panne → 503 « Le calcul du plan est indisponible, réessayez dans une minute. » Jamais de repli
   silencieux sur le TS.
4. Le cycle quotidien n'existe pas en TS : acceptation sur `rebid-v2.md` § 7 (ordre 13 > 59 > 1 > 75 ≈ 29 sur « Démo pilotage —
   élections » au 30/04, convergence des simulateurs, stabilité 1e-6 sur 20 itérations).

### 5.3 Suppressions

| Quand | Supprimé |
|---|---|
| T6 | `lib/zones/plan.ts` sauf `plierParCodePostal` et types d'affichage ; `plan-jeu-zone.ts`, `part-prevue.ts`, `unite-cp.ts`, `lireVolumesAttendus`, `poidsDeClasse` ; leurs tests TS (devenus pytest) ; `OPTIMISATION_PLAN_SOURCE` |
| T7 (D32) | plan commun non écrit pour un jeu de zone ; existants gardés en lecture |
| T9 | `lib/simulation/recalage.ts` ; paramètres de correction du générateur |
| T15 | `lib/dsp/push/*`, `lib/dsp/report/*`, `pousser-ciblage.ts`, `dv360-bidding-script.ts` (sauf export custom-geo React) |
| T17 | `lib/dsp/dv360/{auth,client}.ts`, `lib/dsp/tiktok/client.ts`, `lib/crypto/secrets.ts`, `lib/dsp/oauth-state.ts` ; `DSP_ENC_KEY` hors `.env.local` |
| Lot 7 (retrait React) | `lib/pacing/*`, `/api/demo/apply-rebid`, `lib/demo/controller.ts`, `bidding-export.ts`, `/api/custom-geo/[id]/export`, `get_campaign_pacing` — rien de cela porté (Q2 = A) |

Test de garde `tests/unit/optimisation/aucune-formule-hors-python.test.ts` : échoue si `app/` ou `lib/` contient un nom de
fonction de calcul retiré, hors liste gelée du lot 7. Remplace INV7 côté TS ; INV7 testé par pytest côté Python.

---

## 6. Tâches

| Tâche | Contenu | Jours | Dépend de |
|---|---|---|---|
| T0 | `ARCHITECTURE.md` : section « Service d'optimisation » (remplace le 26/10) ; `rebid-v2.md` § 5 amendé ; variables d'env | 0,5 | — |
| T1 | Socle : paquet, uv, ruff, mypy strict, pytest, FastAPI `/sante`, Dockerfile, `compose.yaml`, `13-optimisation-up.sh`, migration du rôle `optimisation_service` (`IF NOT EXISTS`, aucun `DROP`) | 1,5 | T0 |
| T2 | Générateur de fixtures TS : 73 cas, 6 zones de référence, 4 extractions risque | 1,5 | T0 |
| T3 | Noyau du plan initial (risque, zone, groupes, `HORS_ZONE`, part prévue, réglage, sorties de poids) + `nombres.py` ; parité verte | 3 | T1, T2 |
| T4 | `/v1/plans/{zone,risque}`, lecteurs registre et volumes, `resume_plan.algo` | 1 | T3 |
| T5 | Client Next `lib/optimisation/client.ts` (Zod, délai), types générés, mode `ombre` sur les 5 appelants | 2 | T4 |
| T6 | Bascule `python`, suppressions TS, tests d'intégration | 1 | T5 + § 5.2 |
| T7 | ⑥/⑦ sur le plan par plateforme (D32, `cp-plateforme.ts`) ; Angular ⑥ sur `part_prevue` | 1,5 | T6 |
| T8 | Migrations `optimisation_cycles`, `optimisation_reglages`, `cp_geoloc_defaut`, `optimisation_executions`, index `campaign_dsp_report` ; `EXPLAIN ANALYZE` | 1 | T1 |
| T9 | Noyau correction v2 + paliers ; INV1-INV10 ; simulateurs ; critère démo ; `/simulation/recaler` branché | 3 | T3 |
| T10 | Cycle : livraisons, instantané, empreinte, machine d'états, expiration, `rejouer` ; mesure du volume | 2,5 | T8, T9 |
| T11 | Ordonnanceur + déclenchement manuel NDJSON | 1 | T10 |
| T12 | Passerelle Next (cycles, valider, refuser, déclencher) + écran Angular ⑧ de validation | 2,5 | T10 |
| T13 | `secrets.py` (vecteurs croisés), adaptateur DV360 (jetons, geo, script, budget), mode simulé | 3 | T1 |
| T14 | Relais OAuth DV360/TikTok, `state` HMAC, `config`, `test` | 1,5 | T13 |
| T15 | Envoi après validation, `/activation/pousser` délégué, rapporteurs DV360/TikTok → `campaign_dsp_report` | 2,5 | T12, T13 |
| T16 | TTD et Meta : auth, envoi, rapport | 4 | T15 + accès comptes (C28) |
| T17 | Suppressions DSP TS, `DSP_ENC_KEY` hors Next, test de garde, docs | 1 | T15 |

**Total : 34 jours** (30 sans TTD/Meta). Chemin critique T0 → T1/T2 → T3 → T9 → T10 → T12 → T15 → T17 : **16,5 jours**. T13/T14
en parallèle de T3-T10.

### Risques

| Risque | Mesure | Parade |
|---|---|---|
| Écart flottant JS / Python | `sum()` compensée (≥ 3.12), `round()` au pair | `somme_gauche`, `arrondi_js`, test anti-`sum(`, md5 vérifié en test |
| Python en panne sur l'extraction | appel ≤ 30 s | `ombre` : repli TS journalisé ; `python` : 503 français, jamais de repli silencieux |
| Pas de vraie livraison datée | rapporteur DV360 `skipped` ; une seule campagne (démo, 2 131 lignes) | cycles validés sur démo + simulateurs ; réel après T15 et droits Google |
| Volume des instantanés | 24-150 Mo/mois pour 600 cycles | format colonnes, mesure T10, rétention après mesure |
| Base partagée entre worktrees | autres agents sur la même base | `IF NOT EXISTS`, `CREATE OR REPLACE`, aucun `DROP`, jumelles |
| Formats de chiffrement | Node `iv:tag:ct`, Python `ct‖tag` | vecteurs croisés dans les deux suites |
| ⑥ et suivi divergents | `impressions.ts:74-92` en `m ÷ Σ m`, suivi en E5 | T7 |

---

## 7. Questions — tranchées le 04/11 (recommandations retenues)

- **Q1 — Déclencheur du cycle** : A (ordonnanceur Python, `POST /v1/executions` ; Cloud Scheduler/EventBridge au déploiement)
  plutôt que B (Inngest TS → Python) : Inngest n'a plus d'ordonnanceur depuis le 19/09, B ajoute un relais et deux points de panne.
- **Q2 — Code d'optimisation ne servant que React gelé** (`computeRebidWeights`, `/api/demo/apply-rebid`, `binScoresIntoTiers`,
  `computePacing`/`get_campaign_pacing` sur 0 ligne) : A, non porté, supprimé au lot 7 — aucun écran Angular ne s'en sert, la
  correction v2 le remplace (D1).
- **Q3 — Validation et expiration** : A, super_admin + admins de l'espace propriétaire ; expiration au cycle suivant (24 h). Une
  validation réservée à une personne ferait expirer les propositions dès son premier jour d'absence.
