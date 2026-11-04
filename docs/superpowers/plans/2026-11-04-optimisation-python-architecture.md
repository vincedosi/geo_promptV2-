# Optimisation en Python — phase 0 : inventaire, architecture, algorithme cible, phases

Rédigé le 04/11/2026, branche `feat/optimisation-python`, code au commit `72185c97`. Réécrit le même jour pour se conformer au
**cahier des charges du propriétaire** (`C:\GENESIS\prompt-claude-code-algo-optimisation.md`, « refonte de l'algorithme
d'optimisation », 10 décisions non négociables, phases 0 à 5). **Le cahier prime sur tout le reste**, y compris sur la
version précédente de ce document (18 tâches T0-T17) et sur `docs/rebid-v2.md`, qui devient **historique** (écarts au § 10).

Toutes les mesures : base locale le 04/11 (`docker exec supabase_db_genesis_app psql -U postgres`, lecture seule), dépôt au
commit ci-dessus. Document de référence de l'algorithme : `C:\GENESIS\algorithme-optimisation-impressions-dentsu-explore.docx`
(26/10/2026, annexe B = emplacement des formules). Ce document ne contient aucun code ; il est le livrable de la **phase 0**.

---

## 0. Synthèse

- **Ce qui est déjà fait (phase 1, partiel)** : socle Python `services/optimisation/` (uv, Python 3.13, FastAPI, psycopg 3,
  mypy strict, pytest), rôle Postgres `optimisation_service` (sql/342), plan initial **méthode B** (zone dessinée, jeux de zone
  et jeux risque) porté **à l'identique** : 276 fixtures de parité générées par le TS, tolérance nulle, empreintes md5 égales à
  celles stockées en base ; routes `POST /v1/plans/zone` et `/v1/plans/risque`. Next n'appelle pas encore le service.
- **Ce qui reste à porter à l'identique (phase 1)** : plan initial **méthode A** (courbe de pression INSEE — c'est celle de la
  campagne de démo), part du plan et impressions prévues, mesures (score 93/100, écarts, alertes), rebid plafonné
  (`lib/pacing/rebid.ts`), recalage amorti (`lib/simulation/recalage.ts`), simulateur (`lib/demo/simulator.ts`).
- **Chiffres de non-régression vérifiés aujourd'hui** sur « Démo pilotage — élections » : tous reproductibles (§ 2.7),
  avec un écart d'arrondi dans le `.docx` (facteur du 75 : 0,617, pas 0,618).
- **Architecture** : trois couches du cahier — noyau sans plateforme (part cible, part livrée → coefficient), deux traducteurs
  purs (enchère, budget), quatre connecteurs dont **DV360 seul implémenté** ; Meta, TTD, TikTok = interface seule. **Aucun mode
  simulé, aucune donnée factice dans les connecteurs.**
- **`modal/bidding_ml/`** : n'existe plus, supprimé le 12/10 (commit `c03cd0fd`, lot 2 de la suppression de l'IA). Rien à
  réutiliser ni fusionner : **le service neuf le remplace**, sans reprendre son modèle (§ 2.6).
- **Base** : accès **direct** psycopg, pas par l'API (plafond PostgREST 1 000 lignes, transactions, rejeu) ; Next reste le seul
  point d'entrée authentifié et transmet l'identité.
- **Défauts proposés** : volume minimum **100 impressions sur 7 jours** par zone et plateforme ; **N = 5 jours** ; envoi anticipé
  si le **score global lissé perd 5 points** depuis le dernier envoi (au plus tôt 3 jours après) ; K = 3 (§ 8).
- **Volume** : ≈ 33 jours-dev pour les phases 1 à 5 restantes (§ 12), dont 9 pour finir la phase 1.
- **3 questions** au propriétaire (§ 15) : la dilution ×0,6 à chaque envoi ou une fois ; les zones sous le volume minimum
  (TTD : 96 % des CP de la démo) ; le seuil « budget réellement dépensé » (à 0,85 il bloque toute la démo).

---

## 1. Ce que le cahier impose (rappel, pour situer chaque section)

| # | Décision du cahier | Où ce document la traite |
|---|---|---|
| 1 | Tout l'algorithme en Python : plan initial, correction, connecteurs DSP | § 2, § 4 |
| 2 | Front Angular, API Next.js (point d'entrée authentifié), écrans ①-⑤ inchangés ; seules des routes Next qui appellent Python s'ajoutent | § 3, § 5 |
| 3 | Trois couches : noyau, traducteurs enchère/budget, quatre connecteurs (DV360 d'abord, les autres en interface seule) | § 4 |
| 4 | Mesure quotidienne ; calcul et envoi tous les N jours (3 à 7), envoi anticipé au-delà d'un seuil ; validation humaine | § 7.6, § 8 |
| 5 | Formule unique de correction | § 7.2 |
| 6 | Cible du plan fixe, seuls les poids bougent | § 7.1 |
| 7 | Deux niveaux de score, le global décide | § 7.3 |
| 8 | Saturation (K cycles) et redistribution | § 7.4 |
| 9 | Garde-fous avant toute surpondération | § 7.5 |
| 10 | Journal `optimisation_cycles`, rejouable, envois réversibles | § 7.7, § 9 |
| — | Corrections de données (plan LEFT JOIN livraison, référentiel complet, seuils réglables) | § 2.2, § 12 phase 2 |
| — | `workspace_id` + RLS avec policies testées ; jetons jamais dans le code ; bascule par drapeau ; pytest + Vitest ; local + Cloud Run | § 9, § 4.4, § 11 |

---

## 2. Inventaire mesuré

### 2.1 Calculs à porter (fichier:ligne, état)

| Morceau | Où | Ce qu'il calcule | État au 04/11 |
|---|---|---|---|
| Plan méthode B (zone dessinée) | `lib/zones/plan.ts` (554 l.), `plan-jeu-zone.ts` (340), `part-prevue.ts` (127), `unite-cp.ts` (78), `jeu.ts` `poidsDeClasse` | multiplicateurs (part × n, bornes 0,001 / 999,999), écrêtage, `HORS_ZONE`, groupes de CP, parts prévues E5, plans par plateforme, sorties de poids | **Porté** (T3 `672cc744`, T4 `f327f892`) : parité 276/276 à tolérance nulle. Next non branché |
| Plan méthode A (donnée INSEE + pression) | `components/campaign/wizard/steps/types.ts:166` (`pressureCurve`) ; `sql/106_indicator_cp_values.sql:86` (`apply_zone_weights_to_strategy`, `interpolate_on_curve`, `GREATEST(0, LEAST(5, …))`) | courbe à 3 nœuds (min+0,2Δ ; 1/M), (min+0,4Δ ; 1), (min+0,7Δ ; M), interpolation, bornes 0-5, hors zone 0 en strict | **À porter**. C'est la méthode de la campagne de démo (11 435 lignes `bidding_zone_configs`, 1 641 > 0, max 1,6) |
| Part du plan | `sql/306_part_prevue.sql:275` (`refresh_campaign_rollups`) | `planned_share = part_prevue` sinon `m ÷ Σ m` ; `in_target = m > 1` (ou `> 0` en strict) | **À porter** (la mesure), la fonction SQL reste pour l'affichage |
| Impressions prévues | `angular/src/app/features/carte/logique/plan/impressions.ts:42-92` ; `sql/280_get_campaign_expected_un_jour.sql:17` | budget ÷ CPM × 1 000 par plateforme ; répartition par CP aux plus forts restes ; attendu à date `× t` | **À porter** (Angular reste tel quel : il continue d'afficher) |
| Mesures d'écart, score | `sql/209_plan_couverture.sql:68` (`calculer_alignement_geo`) ; `alignement_par_maille` ; `lib/campagne/palette-divergente.ts` | score `100 − manque − poids × trop` à tolérance 10 % ; écart par maille, 7 tranches | **À porter** : le score par plateforme et le score global (décision 7) sont des sorties du service |
| Alertes de suivi | `sql/113_campaign_actors.sql:117` (`get_campaign_suivi`) | rythme, CPM, CP sous le plan, fuite | **Seuils à paramétrer** (§ 2.2), la fonction reste |
| Rebid plafonné | `lib/pacing/rebid.ts:30` (`computeRebidWeights`, `REBID_CAP = 0.5` l. 8, `REBID_EPSILON = 0.001` l. 9) | `clamp(prévu / max(livré, 0,001), 0,5, 1,5)`, renormalisé à 100 par zone | **À porter à l'identique** (phase 1), puis remplacé (phase 3). Appelants : `PacingPanel.tsx:57` (React, navigateur), `lib/demo/controller.ts:166` |
| Recalage amorti | `lib/simulation/recalage.ts:94` (`recaler`, bornes l. 70-75) ; paramètres `lib/simulation/generateur.ts:39-41` (`amortissement 0.8`, `seuilDilution 20`, `baisseDilues 0.6`) | `clamp(plan / obs, 1/3, 3) ^ 0,8`, × 0,6 sous 20 %, recentré sur 1, arrondi 3 décimales | **À porter à l'identique** (phase 1). Appelant : `app/api/zones/jeux/[id]/simulation/recaler/route.ts:117` (Angular `features/risques/data/simulation.api.ts:46`) |
| Simulateur de convergence | `lib/demo/simulator.ts:35` (`simulateDelivery`, réponse saturante `x/(1+x)`, gain 3, bruit 0,1) ; `lib/demo/rng.ts` (mulberry32 + FNV-1a, `Math.imul`) ; `lib/demo/constants.ts` | délivrance déterministe contre une résistance cachée par CP | **À porter** (phase 1, parité bit à bit) : la phase 3 en a besoin pour comparer les trois formules |
| Paliers et script | `lib/digital/bidding-export.ts:26-65` (`binScoresIntoTiers`, 5 quantiles, score = moyenne du palier) ; `lib/digital/dv360-bidding-script.ts` (`max_aggregate`, hors zone 0 / 1) | quantification des poids en 5 paliers | **À porter** en phase 5 (traducteur enchère), erreur de quantification à mesurer |
| Constats | `lib/campagne/constats.ts` | « à corriger » au-delà de ±20 %, CPM × 1,25 | Seuils à paramétrer ; le calcul reste TS (affichage React gelé) |

### 2.2 Seuils écrits en dur (correction de données du cahier)

Relevés par `Grep` au 04/11. Ceux du cahier (0,85 / 1,15 / 1,25 / 70 % / 5 % / ±20 %) et ceux qu'il ne nomme pas mais qui
jouent le même rôle :

| Seuil | Fichier:ligne | Rôle |
|---|---|---|
| 0,85 (grave 0,70) | `sql/113_campaign_actors.sql:211`, `:213` | rythme de dépense « en retard » |
| 1,15 (grave 1,30) | `sql/113_campaign_actors.sql:216`, `:218` | rythme « en avance » |
| 1,25 | `sql/113_campaign_actors.sql:222` ; `lib/campagne/constats.ts:86` (`SEUIL_CPM_CHER`) | CPM réel > prévu × 1,25 |
| 70 % | `sql/113_campaign_actors.sql:239` | CP cibles sous 70 % du plan |
| 5 % | `sql/113_campaign_actors.sql:246` | fuite hors cible (zones strictes) |
| ±20 % | `lib/campagne/constats.ts:76` (`SEUIL_ECART_SIGNALE_PCT`) | constats « à corriger » |
| ±5 pts | `lib/pacing/compute.ts:10` (`PACING_TOLERANCE_PTS`) | écart en points par sous-zone |
| 0,5 / 0,001 | `lib/pacing/rebid.ts:8-9` | plafond et plancher du rebid plafonné |
| 1/3, 3, 0,001, 999,999 | `lib/simulation/recalage.ts:70-75` | bornes du recalage amorti |
| 0,8 / 20 / 0,6 | `lib/simulation/generateur.ts:39-41` | amortissement, seuil et baisse de dilution |
| 0,75/0,9/1,1/1,25 ; 70/90/110/130 | `lib/campaigns/suivi-metrics.ts:94`, `:101`, `:116` | bandes de couleur du suivi React (affichage seul, gelé) |
| 10 % / 1,0 | colonnes `dsp_campaigns.tolerance_pct`, `overpressure_weight` | tolérance et poids de sur-pression du score — **déjà par campagne** |
| 2 000 | `lib/dsp/dv360/pousser-ciblage.ts:25` ; `plateformes_poids.nb_max_entrees` (dv360/script) | plafond de CP par envoi DV360 |

`sql/108_get_campaign_suivi.sql` porte une copie plus ancienne des mêmes seuils, remplacée par sql/113 (fonction vivante
vérifiée dans `pg_proc`). Aucune copie dans `angular/src/app` (les 0,85 qu'on y trouve sont des opacités).

### 2.3 Données de livraison : ce qui existe vraiment

- `dsp_campaign_data` : **grain quotidien × CP × acteur**. Démo : 306 150 lignes = 2 041 CP × 30 jours × 5 acteurs,
  01/04-30/04. **Livraison à plat** (13001 / dv360 = 26 impressions chaque jour) : la démo ne contient aucun bruit, le lissage
  7 jours n'y change rien.
- `campaign_dsp_report` : grain quotidien × canal **sans CP** (dv360 1 827 540, tiktok 690 210, ttd 440 670 impressions) et
  cumul × CP sans date (2 041 CP) — `chk_campaign_dsp_report_grain`. Le lissage par CP lit donc `dsp_campaign_data`
  aujourd'hui, et le connecteur DV360 (rapport Bid Manager quotidien au CP, phase 5) devra écrire du **quotidien × CP**.
- `campaign_cp_rollup` : 10 205 lignes pour la démo (2 041 × 5 acteurs), `imps_7d`, `planned_share`, RLS active sans policy.
- **CP du plan jamais servis** : 0 sur la démo (les 1 641 CP du plan ont tous des impressions, pour chaque acteur). Deux
  stratégies sans aucune livraison en ont 176 et 88. **La phase 2 ne montrera donc rien sur la démo** : il faudra le dire, et
  prouver la correction sur un cas construit.
- **Univers de la méthode A** : `SELECT DISTINCT postal_code FROM dsp_campaign_data` (toutes campagnes) = **11 415** codes,
  dont **6 167** du référentiel (`ref_codes_postaux` = 6 187) et 5 248 codes étrangers (`00-001`, `?`…). La stratégie de la
  démo, écrite quand l'univers en comptait 11 435, couvre les 6 187 : recalculée aujourd'hui, elle **perdrait 20 CP** du
  référentiel. Partir du référentiel (phase 2) les rend et retire les 5 248 codes étrangers (tous à 0).

### 2.4 Plomberie DSP (`lib/dsp/`)

| Morceau | Lignes | État mesuré | Sort |
|---|---|---|---|
| `dv360/auth.ts` | 110 | compte de service + OAuth 3 jambes | **Python** (`google-auth`), phase 5 |
| `dv360/client.ts` | 295 | API DV360 v3 : geo, location lists, custom bidding, budget d'IO | **Python** (httpx, délais explicites), phase 5 |
| `dv360/pousser-ciblage.ts` | 158 | CP → geo IDs, plafond 2 000 (l. 25, 96), **mode `simule`** (l. 45, 110) | **Python sans mode simulé** ; le TS reste jusqu'à la bascule |
| `push/*` | 157 | `REAL_PUSHERS = { dv360 }`, **`simulatedPusher`** (`push/simulated.ts`, `push/index.ts:15`) ; `runPush` sans appelant | **Non porté** : l'envoi validé du cycle le remplace. Rien de simulé côté Python |
| `report/*` | 89 | `REAL_REPORTERS = { dv360 }` → `skipped` (droits Google) | **Python** : rapport Bid Manager quotidien au CP (phase 5) |
| `tiktok/client.ts` | 88 | OAuth (jeton longue durée), test | Interface seule en Python (cahier) ; le TS existant reste |
| `oauth-state.ts`, `lib/crypto/secrets.ts` | 57 + 39 | HMAC du `state` ; AES-256-GCM `iv:tag:ct` (`DSP_ENC_KEY`) | **Python**, même format (aucun rechiffrement), vecteurs croisés |
| TTD, Meta | 0 | aucun code | **Interface seule** (cahier) |

En base : `dsp_connections` 1 ligne (`dv360`, statut `error`), policy `dsp_connections_select (organization_id = get_user_org())`.
`plateformes_poids` 5 lignes : dv360 multiplicateur 0,1-10 (« non confirmée ») et script 2 000 entrées ; ttd multiplicateur
(plage non relevée) ; meta et tiktok `aucun`.

### 2.5 Fonctions SQL

| Fonction | Sort |
|---|---|
| `creer_extraction_jeu_zone` (sql/317, 340), `creer_zone_set_extraction` (sql/231) | **Restent** seuls écrivains de l'extraction (verrou, empreinte md5) ; reçoivent le plan Python |
| `volumes_attendus_cp_univers` (sql/337), `hors_zone_extraction` (sql/306) | **Restent**, lues par Python |
| `refresh_campaign_rollups` (sql/306:275) | **Reste** (affichage) ; phase 2 : jumelle « depuis le plan » (LEFT JOIN), sans `DROP` |
| `apply_zone_weights_to_strategy` (sql/106:86) | Calcul porté en Python (phase 1), puis univers = référentiel (phase 2) ; la fonction reste jusqu'à la bascule |
| `calculer_alignement_geo` (sql/209:68), `alignement_par_maille`, `get_campaign_suivi` (sql/113:117), `get_campaign_expected` (sql/280:17) | **Restent** pour l'affichage ; formules recopiées en Python pour la parité ; seuils lus dans les réglages (phase 2) |
| `get_campaign_pacing` (sql/097) | Sur `campaign_plan_snapshot` (**0 ligne**) ; ne sert qu'à `lib/demo/controller.ts`. Non porté |

### 2.6 `modal/bidding_ml/` — mesure et recommandation

`git log --all -- modal/bidding_ml` : créé par `19f1a28b` (« A4.3 — deploy Hoeffding to Modal »), **supprimé par `c03cd0fd`
le 12/10/2026** (« retrait de l'agent d'enchères, du ML Modal et de l'historique de chat », lot 2 de la suppression de l'IA).
Contenu à la veille de la suppression : un arbre de Hoeffding (apprentissage en ligne), détection de dérive, chargeur de
données, persistance, déployé sur Modal. `modal/` n'existe pas dans l'arbre courant ; les variables `MODAL_*` ont été retirées.

**Recommandation : le remplacer, sans rien en reprendre.** (1) Il n'existe plus ; le ressusciter irait contre une décision du
propriétaire (suppression de l'IA). (2) Il prédisait une performance par apprentissage ; le cahier demande une correction
**déterministe et rejouable** (décision 10), qu'un modèle en ligne ne garantit pas. (3) Modal n'est pas branchable
(mémoire du 22/09) et la cible est Cloud Run. Seule idée qui survit : le service Python séparé — que `services/optimisation/`
réalise déjà.

### 2.7 Chiffres de non-régression de la démo : reproductibles aujourd'hui, et leur source

Campagne `dccc0000-0000-4000-8000-000000000002` (`is_demo`, espace `00000000-…-0001`, 01/04-31/05/2026, budget 65 000 €
dans `bidding_strategies.total_budget` — `dsp_campaigns.total_budget` vaut 45 000, ancien), stratégie
`dccc0000-…-0012` (méthode A, courbe d'abstention, pression 1,6).

| Chiffre (`.docx`) | Mesuré le 04/11 | Source |
|---|---|---|
| Poids 13001 = 1,214 ; 75011 = 0,848 ; 29200 = 1,012 ; 1 641 CP > 0 ; max 1,6 | identiques | `bidding_zone_configs.bid_multiplier` (méthode A) |
| Part 13001 = 0,000853 | 0,00085284 | `campaign_cp_rollup.planned_share` (`m ÷ Σ m`) |
| 10 000 000 impressions prévues ; 4 920 000 attendues au 30/04 | identiques | `get_campaign_expected` (CPM prévu 6,50, `get_campaign_suivi.cpm.forecast`) |
| 3 936 390 livrées, 25 689,90 € | identiques | somme des 5 acteurs du rollup |
| **Score 93/100** ; manque 3,84 % ; trop 3,35 % ; 72,5 % conformes | identiques | `calculer_alignement_geo(campagne, 10, 1.0)` |
| Dép. 13 à −48,4 % ; 59 à −46,2 % ; 62 à +11,3 % | identiques | `alignement_par_maille(campagne, 'departement', …)` |
| 161 CP sous 70 % ; rythme 0,80 | identiques | `get_campaign_suivi` |
| **Facteurs dép. 13 / 59 / 75 / 29** = 1,209 / 1,159 / 0,618 / 0,587 ; poids 48,1→54,1, 32,5→35,0, 10,3→5,9, 9,1→5,0 | 1,2089 / 1,1585 / **0,6172** / 0,5873 ; mêmes poids après | **reconstruction** : rollup des 5 acteurs agrégé par département, **restreint aux 4 départements** et renormalisé, passé à `computeRebidWeights` (une zone, 4 items) |
| Amortie 1,164 / 1,125 / 0,680 / 0,653 | identiques | même entrée, `clamp(·, 1/3, 3)^0,8` |

Deux réserves pour la phase 1 : (a) le 0,618 du `.docx` est un arrondi (exact : 0,61719) — la parité porte sur la sortie
TS, pas sur le document ; (b) les « 4 départements » ne sont **pas** la campagne (1 641 CP sur 89 départements) mais un
sous-ensemble choisi par le document : l'entrée de non-régression doit être figée telle quelle dans une fixture, sinon le
chiffre n'est pas rejouable. Les poids de la méthode A doivent être recalculés **sur l'univers figé de 11 435 codes**, pas sur
l'univers d'aujourd'hui (11 415, § 2.3).

---

## 3. Frontière découpage ⑤ / Python (inchangée)

**Le découpage (TS/SQL, ①-⑤) produit et fige** : par plateforme et maille, les unités (code, population en zone, population
totale, part, `retenu` au seuil de la plateforme), les bilans, les groupes de CP, la liste exacte, le type de recette, le mode
du plan, les poids de classe. **Python commence au premier nombre qui n'est pas une population** : multiplicateur, part prévue,
`HORS_ZONE`, écrêtage, plan par plateforme, mesures, correction, paliers, envoi. On coupe à `retenu` parce qu'il est affiché en
⑤ et entre dans l'empreinte ; le déplacer obligerait ⑤ à appeler Python à chaque mouvement de seuil.

**L'écriture de l'extraction reste SQL** (`creer_extraction_jeu_zone`) : un second écrivain dupliquerait la règle d'empreinte.
Règle générale : **ce qui agrège des livraisons ou lit un référentiel reste SQL ; ce qui décide un poids, une part, un
coefficient, un palier ou un envoi est Python.** Les extractions existantes sont immuables ; `resume_plan.algo =
{moteur: 'python', version, entrees_sha256}` marque les plans calculés en Python (amendement de sql/340 à faire au branchement).

---

## 4. Service Python : trois couches

### 4.1 Arborescence

```
services/optimisation/                         (existe : T1)
  pyproject.toml, uv.lock, Dockerfile, compose.yaml, .env.example (noms seuls)
  src/optimisation/
    noyau/            PUR (liste blanche d'imports, test_purete.py) — ne connaît AUCUNE plateforme
      nombres.py                 existe : somme_gauche, math_round, arrondi_js
      plan/                      existe (à ranger ici) : plan_zone, plan_risque, part_prevue, reglage, regroupement
      plan/pression.py           phase 1 : méthode A (courbe, interpolation, bornes 0-5)
      historique/                phase 1 : rebid_plafonne.py, recalage_amorti.py (comparaison, retirés après validation)
      mesures.py                 phase 1 : part du plan, impressions prévues, score, écarts, coût pondéré
      lissage.py                 phase 3 : fenêtre glissante
      correction.py              phase 3 : formule unique (§ 7.2) — entrée : par zone, part cible et part livrée
      garde_fous.py              phase 3 (§ 7.5)
      niveaux.py, saturation.py  phase 4 (§ 7.3, § 7.4)
      parametres.py              dataclass figée des réglages + défauts (§ 8)
    traducteurs/      PURS aussi (même test de pureté)
      enchere.py                 DV360, TTD : multiplicateur = ancien × coefficient, borné par la plateforme ; paliers
      budget.py                  Meta, TikTok : budget d'ad set = ancien × coefficient, recalé au total de la campagne
    connecteurs/
      base.py                    Protocol Connecteur (§ 4.3) + registre { 'dv360': Dv360 } — les autres absents
      dv360/                     phase 5 : auth, rapport Bid Manager, script, ciblage, état courant
    cycles/           orchestration : lire → noyau → traducteur → journaliser ; machine d'états ; rejeu
    lecture/          psycopg (existe : registre, volumes)
    secrets.py        AES-256-GCM compatible Node (phase 5)
    api/              FastAPI (existe : /sante, /v1/plans/*)
    ordonnanceur.py   local seulement (APScheduler) ; Cloud Scheduler en déploiement
  tests/  noyau/, parite/ (fixtures TS), traducteurs/, connecteurs/, cycles/, lecture/ (base locale), simulation/
```

Le **simulateur** porté de `lib/demo/simulator.ts` vit dans `tests/simulation/` (outil de validation), **jamais** dans
`connecteurs/` : le cahier interdit tout mode ou donnée de démonstration dans les connecteurs.

### 4.2 Contrat de chaque couche

- **Noyau** : entrée = pour une plateforme (ou le global), par zone opaque (`str`) : poids courant, part cible fixe, livraison
  quotidienne sur la fenêtre, valeur de la zone, taux d'inclusion ; paramètres ; état de saturation précédent. Sortie =
  indice, coefficient brut et borné, poids proposé, alertes, raisons. Aucune notion de CP, ad set, script ou API.
- **Traducteur enchère** (DV360, TTD) : `multiplicateur' = multiplicateur × coefficient`, borné par
  `plateformes_poids.valeur_min/valeur_max` (dv360 0,1-10), puis, pour DV360 script, quantification en paliers
  (5 aujourd'hui) et **erreur résiduelle** = ½ Σ |part visée − part après paliers| exposée.
- **Traducteur budget** (Meta, TikTok) : `budget'(ad set) = budget × coefficient`, puis recalage proportionnel pour que
  Σ budgets = budget de la campagne sur la plateforme ; une valeur ramenée à un minimum plateforme est affichée avant/après.
- **Connecteur** : I/O seulement, aucune formule.

### 4.3 Interface commune des connecteurs

`Protocol Connecteur` : `lire_livraison(campagne, du, au) → lignes quotidiennes (zone, jour, impressions, dépense)` ;
`lire_etat_courant(campagne) → réglage actuellement actif sur la plateforme` (pour la réversibilité) ;
`envoyer(campagne, reglage) → référence externe` ; `retablir(campagne, etat) → référence` ; `url_oauth`, `echanger_code`,
`tester`. **Seul `Dv360` l'implémente.** Meta, TTD, TikTok n'ont **aucune classe** : le registre ne les connaît pas, un appel
rend « Connecteur non disponible pour cette plateforme » (409). Pas de bouchon, pas de jeu de données d'exemple.

### 4.4 Framework, déploiement, secrets

FastAPI + Pydantic 2 (rôle de Zod), uvicorn 1 worker, psycopg 3 + pool ≤ 3. Image OCI `python:3.13-slim`, configuration par
variables d'environnement : tourne en local (`compose.yaml` sur le réseau `supabase_network_genesis_app`,
`scripts/local/13-optimisation-up.sh`) et se **déploie sur Cloud Run** sans changement de code (port `$PORT`, aucun état
local, ordonnanceur remplacé par Cloud Scheduler → `POST /v1/executions`). Base en Cloud Run : connecteur Cloud SQL ou
Postgres joignable en TLS, même rôle dédié. Jetons DSP : chiffrés en base (`dsp_connections`, AES-256-GCM, `DSP_ENC_KEY`
injectée par Secret Manager en Cloud Run), jamais dans le code, jamais dans un export ni dans `optimisation_cycles`
(test : aucune colonne `*_encrypted` ni clé `token` dans les instantanés).

---

## 5. Appel Next.js → service

```
Angular → Next /api/campaigns/[id]/optimisation/...   getSession() (JWT local), rôle (lib/auth/roles.ts), espace,
                                                      accès à la campagne (campaign_organizations), Zod, quota
        → POST {OPTIMISATION_URL}/v1/...              en-têtes X-Optimisation-Cle (temps constant),
                                                      X-Utilisateur, X-Role, X-Espace ; délai 30 s ; NDJSON pour les passages
        ← réponse relayée telle quelle (types générés depuis l'OpenAPI du service)
```

- Le service n'est **jamais** joint par le navigateur. Il fait confiance à Next pour l'identité, et revérifie que la campagne
  appartient à `X-Espace` (sinon 404) avant toute lecture ou écriture `optimisation_*`.
- Client unique `lib/optimisation/client.ts` (délai, erreurs en français, aucun repli silencieux).
- **Routes Next ajoutées** (les seules permises par le cahier) : `GET …/optimisation/cycles`, `GET …/optimisation/reglages`,
  `PUT …/optimisation/reglages`, `POST …/optimisation/declencher` (NDJSON : lecture → calcul → écriture, compteurs),
  `POST /api/optimisation/cycles/[id]/{valider,refuser,annuler}`, `POST /api/admin/dsp/dv360/...` relayés.
- **Routes existantes** (`/extractions`, `/rattacher`, `/simulation/recaler`…) : contrat inchangé ; leur intérieur bascule par
  drapeau (`OPTIMISATION_PLAN_SOURCE`, `OPTIMISATION_CORRECTION_SOURCE` = `ts` / `ombre` / `python`). En `ombre`, Next calcule
  TS et Python, journalise l'écart, sert le TS. Le TS n'est supprimé qu'après validation du propriétaire.
- **Écran de validation** : le cahier gèle le front Angular ; ce plan n'y touche pas. Les routes ci-dessus sont le contrat que
  l'écran ⑧ Live (chantier séparé) consommera. Tant qu'il n'existe pas, la validation n'est possible que par ces routes —
  donc rien ne part.

---

## 6. Accès à la base : direct, pas par l'API

| Critère | psycopg direct (retenu) | Par l'API Next / PostgREST |
|---|---|---|
| Volume | aucun plafond : plan national 6 009 CP, univers méthode A 11 435, livraison 61 230 lignes/acteur pour la démo | `db-max-rows = 1000`, troncature **silencieuse** ; `lireTout` = pages qui re-parcourent l'agrégat |
| Cohérence d'un cycle | une transaction : instantané lu, cycle écrit, verrou consultatif par campagne | impossible sur plusieurs appels HTTP |
| Rejeu (décision 10) | l'instantané est exactement ce qui a été lu | dépend de N réponses paginées |
| Secret | rôle Postgres dédié aux droits minimaux (sql/342), mot de passe SCRAM | clé `service_role` (contourne toute RLS) ou appel circulaire Python → Next → Python |
| Couplage | le service lit le schéma : toute migration touchant ses tables le dit (test d'intégration) | contrat HTTP, mais Next n'a pas de route pour la moitié de ces lectures |

L'inconvénient du direct — deux chemins vers la base — est borné : Python ne lit que les tables listées dans les `GRANT` de
sql/342 (complétés à chaque phase), n'écrit que `optimisation_*`, `campaign_dsp_report`/`dsp_campaign_data` (rapports du
connecteur) et `dsp_connections` (jetons). `optimisation_service` garde `BYPASSRLS` pour lire les tables héritées dont la RLS
est active **sans** policy (`plateformes_poids`, `campaign_cp_rollup`, `campaign_dsp_report`, `bidding_zone_configs`…) ; le
cloisonnement côté service est donc applicatif (`workspace_id = X-Espace` dans chaque requête `optimisation_*`, testé).
Règles I/O : pool ≤ 3, `statement_timeout` 30 s, campagnes une par une, `EXPLAIN ANALYZE` sur toute requête neuve, index
`(campaign_id, actor, date)` sur `dsp_campaign_data` à vérifier avant la phase 3.

---

## 7. Algorithme cible

### 7.1 Notations — la cible ne bouge pas

Pour une campagne, une plateforme `p` et un jour `J` (dernier jour de rapport complet) :

```
Z_p            zones de p : CP (DV360, TTD) ou ad sets (Meta, TikTok) ; plus HORS_ZONE en mode national
cible_p(z)     part cible FIXE, Σ_z = 1 — la part du plan figé (planned_share / part_prevue), jamais recalculée
               (décision 6). Seule exception : une redistribution sur saturation (§ 7.4), qui est tracée.
poids_p(z)     poids courant = sortie du dernier envoi validé, sinon le plan
livre_p(z, d)  impressions livrées le jour d ; depense_p(d) dépense du jour
F              = min(7, jours de livraison disponibles) ; F < 3 → pas de correction (raison « fenêtre trop courte »)
L_p(z)         = Σ_{d = J−F+1 … J} livre_p(z, d)            livraison lissée sur la fenêtre
o_p(z)         = L_p(z) / Σ_{z'} L_p(z')                    dénominateur = TOUTES les impressions de p (plan + hors plan)
```

### 7.2 Formule unique (décision 5)

```
indice_p(z)    = o_p(z) / cible_p(z)                          cible_p(z) > 0 ; zone jamais servie : indice = 0
coef_brut(z)   = (1 / indice_p(z)) ^ α                        indice = 0 → +∞ (écrit tel quel dans le journal)
coef(z)        = clamp(coef_brut(z), c_min, c_max)            c_min = 0,8, c_max = 1,2, α = 0,5
brut(z)        = poids_p(z) × coef(z) × (d si taux_in(z) < s_dil, sinon 1)     d = 0,6, s_dil = 20 % (voir Q1)
poids'(z)      = brut(z) × Σ_{A} poids_p / Σ_{A} brut        renormalisation sur A = zones actives non gelées :
                                                             la somme des poids de A est conservée ; une zone gelée
                                                             par un garde-fou garde EXACTEMENT son poids
poids''(z)     = clamp(poids'(z), 0,001, 999,999)             pas de renormalisation après ; valeurs bornées journalisées
cout_pondere_p = Σ_d depense_p(d) / Σ_z L_p(z) × valeur(z)    sur la fenêtre
```

- `valeur(z)` : méthode B, part de la population du CP dans la zone × poids de classe ; méthode A, 1 si la zone est dans la
  cible (`m > 0` strict, `m > 1` sinon), 0 sinon. `HORS_ZONE` vaut 0.
- `taux_in(z)` = population dans la zone / population totale du CP (méthode B) ; non défini en méthode A → pas de dilution.
- `HORS_ZONE` : mode strict → exclue de la correction (part cible 0, son `o_p` est le **taux de fuite**, alerte) ; mode national
  → zone comme les autres.
- α, `c_min`, `c_max`, F max (7), F min (3), `d`, `s_dil`, bornes de poids : **paramètres par campagne** (§ 8).
- Bornes : `c_min`/`c_max` bornent le **coefficient** ; la renormalisation peut décaler le rapport effectif poids''/poids de
  quelques pour cent — le journal affiche les deux.

Ordre de grandeur sur la démo (4 départements, § 2.7) : coefficients 1,0995 (13), 1,0764 (59), 0,8 (75, brut 0,786),
0,8 (29, brut 0,766). Au CP, le 13 à −48,4 % donne un coefficient brut 1,392, ramené à 1,2.

### 7.3 Deux niveaux de score (décision 7)

- **Par plateforme** : `score_p` = formule de `calculer_alignement_geo` appliquée à la seule plateforme (plan = `cible_p`,
  livré = `L_p`, tolérance `tolerance_pct`, poids de sur-pression `overpressure_weight`).
- **Global, par zone** : `objectif_p(z) = cible_p(z) × Σ_z L_p(z)` ; `indice_global(z) = Σ_p L_p(z) / Σ_p objectif_p(z)` ;
  `score_global` = même formule sur les sommes. C'est le score affiché et suivi.
- **« Le global décide »**, traduit en règle : le coefficient de `p` sur `z` n'est appliqué que si `indice_global(z)` est hors
  de la tolérance (`|indice_global − 1| > tolerance_pct`) **et** que `indice_p(z)` va dans le même sens ; sinon
  `coef = 1` (raison « compensée par les autres plateformes »). Deux plateformes qui se compensent sur une zone ne sont pas
  poussées l'une contre l'autre. (Décision prise seul, § 14.)

### 7.4 Saturation et redistribution (décision 8)

- **Butée** de `(p, z)` à un cycle de proposition : `coef_brut` hors de `[c_min, c_max]`.
- **Saturée** : en butée dans le même sens pendant **K = 3** cycles de proposition consécutifs **et** l'écart global ne s'est
  pas réduit : `|ln indice_global(z)|` au cycle courant ≥ 0,9 × sa valeur K cycles plus tôt (réduction de moins de 10 %,
  paramètre `saturation_reduction_min`).
- **Receveurs** : plateformes `q` présentes sur `z` (z ∈ plan de q), non en butée sur `z`, garde-fous G2 et G3 passés.
  Aucun receveur → alerte « zone saturée sans relais », rien ne bouge.
- **Transfert** (sous-livraison ; symétrique en sur-livraison) : `S = objectif_p(z) − L_p(z)` (impressions sur la fenêtre),
  réparti entre les receveurs au prorata de `objectif_q(z)` → `cible_q(z) += S_q / Σ L_q`, `cible_p(z) −= S / Σ L_p`.
  **Compensation** pour que ni la cible globale d'aucune zone ni le volume d'aucune plateforme ne bouge : sur les zones
  `z' ≠ z` communes à `p` et `q` et non saturées pour `p`, `Δ_p(z') = +S_q × objectif_q(z') / Σ objectif_q`,
  `Δ_q(z') = −Δ_p(z')` (plafonné pour que `cible_q(z') ≥ 0`). Résultat : Σ_p objectif_p(z) inchangé pour toute zone,
  Σ_z cible_p(z) = 1 pour toute plateforme, budgets inchangés.
- La répartition de la cible entre plateformes **ne change qu'à ce constat**, jamais à chaque cycle. Elle est portée par la
  sortie du cycle (rejouable) ; la levée d'une saturation est **manuelle** (route `…/saturations/{z}/lever`), pour éviter le
  va-et-vient.

### 7.5 Garde-fous avant toute surpondération (décision 9)

Avant de proposer `coef(z) > 1` pour `p` :

| # | Condition | Portée | Défaut |
|---|---|---|---|
| G1 | `L_p(z) ≥ V_min` | zone | 100 impressions sur la fenêtre (§ 8, Q2) |
| G2 | `cout_pondere_p ≤ plafond` | plateforme | 1,25 × coût pondéré prévu (CPM prévu de p ÷ valeur moyenne du plan) — reprend le 1,25 existant |
| G3 | rythme de dépense de p sur la fenêtre ≥ `s_dep` | plateforme | voir Q3 (0,5 recommandé ; 0,85 bloque la démo) |

Échec de G1 → la zone est **gelée** (poids inchangé, hors renormalisation). Échec de G2 ou G3 → **toute la proposition de la
plateforme** est « réglage conservé » (une renormalisation ne doit pas surpondérer implicitement les autres zones). Chaque échec
produit une alerte au trader : condition, valeur mesurée, seuil, zone. Les sous-pondérations ne sont pas soumises aux
garde-fous. Toute valeur ramenée à une borne (coefficient, poids, multiplicateur plateforme, budget minimum) est affichée
avant et après.

### 7.6 Rythme (décision 4)

- **Chaque jour** (après l'arrivée des rapports) : cycle de nature `mesure` — indices, scores par plateforme et global, coût
  pondéré, garde-fous, fuite, alertes. Aucun poids calculé.
- **Tous les N jours** depuis la dernière proposition (N ∈ [3, 7], défaut 5) : cycle `proposition` par plateforme
  (coefficients, poids, traduction, saturations).
- **Envoi anticipé** : si `score_global` lissé ≤ score au dernier envoi − `seuil_anticipe` (défaut 5 points) et au moins
  `delai_min` = 3 jours depuis le dernier envoi → proposition anticipée (`anticipe = true`, raison chiffrée).
- **Validation humaine obligatoire** pour tout envoi, y compris un retour arrière. Une proposition non validée expire à la
  proposition suivante. Valident : super_admin et admins de l'espace propriétaire (arbitrage Q3 du matin, maintenu).

### 7.7 Journal, rejeu, réversibilité (décision 10)

- Chaque cycle porte son instantané d'entrées (JSON canonique : clés et zones triées, nombres en `repr`) et son sha256, ses
  paramètres, `algo_version`, sa sortie et son sha256. `POST /v1/cycles/{id}/rejouer` recalcule depuis l'instantané et compare
  les empreintes (identiques à version égale, sinon écart zone par zone).
- **Réversibilité** : avant tout envoi, le connecteur lit l'état actif sur la plateforme (`lire_etat_courant` : script de
  custom bidding actif et sa référence, liste géo, budgets) et le stocke dans `etat_avant` ; après, `etat_apres` et la
  référence externe. **Annuler** un envoi = créer un cycle `retour_arriere` dont la sortie est `etat_avant` de l'envoi visé,
  le valider, l'envoyer (`retablir`) ; les deux cycles se référencent. DV360 : les scripts sont versionnés, on réassigne la
  version précédente sans la recalculer.

### 7.8 Ce qui n'entre pas dans le noyau

La boucle de **volume** (retard global : budget, enchère de base) reste hors périmètre, comme dans le `.docx` ; G3 empêche de
la confondre avec la répartition. Pas de courbe de rythme non linéaire.

---

## 8. Valeurs par défaut proposées (toutes réglables par campagne)

| Paramètre | Défaut | Justification (données locales du 04/11) |
|---|---|---|
| α | 0,5 | cahier |
| `c_min` / `c_max` | 0,8 / 1,2 | cahier |
| Fenêtre F max / min | 7 / 3 jours | cahier (7) ; 3 = minimum de la v2 historique, en dessous un indice repose sur 1-2 jours |
| Dilution `d` / `s_dil` | 0,6 / 20 % | cahier (voir Q1) |
| Bornes de poids | 0,001 / 999,999 | cahier ; bornes plateforme en plus, lues dans `plateformes_poids` |
| **Volume minimum `V_min`** | **100 impressions par zone et plateforme sur la fenêtre** | bruit de Poisson : écart relatif `1/√n` = 10 % à n = 100, soit ≈ 5 % sur le coefficient avec α = 0,5 — le quart de la marge ±20 %. Démo : DV360 46 CP sur 1 641 sous 100 (2,8 %, médiane 231) ; TTD 1 572 (95,8 %, médiane 56) ; TikTok 1 137 (69 %) — d'où Q2 |
| **N** | **5 jours** | modèle de retard à réponse proportionnelle, fenêtre 7 j, α = 0,5 : l'indice vu au cycle k mêle N jours du nouveau réglage et 7 − N de l'ancien. N = 7 : erreur log ×0,5 par cycle, monotone, < 5 % en 5 cycles = **35 jours**. N = 5 : 0,5 → 0,18 → 0,04 → 0,003, dépassement −0,4 % (dans la tolérance) = **20 jours**. N = 3 : dépassement à **−13 %** puis oscillation (contraire au critère « aucune oscillation »), ≈ 18-21 jours. La démo dure 61 jours ; 35 en consomment plus de la moitié. À confirmer en phase 3 avec le simulateur |
| **Seuil d'envoi anticipé** | **−5 points de score global lissé** depuis le dernier envoi, `delai_min` 3 jours | la démo, avec deux départements divisés par deux (−48 %), perd 7 points (93) : un incident neuf de taille comparable justifie de ne pas attendre N. Le score global agrège toutes les plateformes, donc reste peu bruité (démo : ≈ 560 impressions par CP sur 7 jours, contre 56 pour TTD seul) ; un seuil en écart au CP par plateforme serait dominé par le bruit (½ Σ |o − c| ≈ 2,5 % de pur bruit pour DV360, ≈ 5 % pour TTD). Démo : `score_prev_7j` = `score` = 93 (livraison à plat) — le bruit réel est à mesurer sur la première vraie campagne |
| K | 3 cycles | cahier |
| Réduction minimale de l'écart (saturation) | 10 % sur K cycles | en dessous, l'écart est jugé stationnaire |
| Plafond de coût pondéré | 1,25 × coût pondéré prévu | reprend `SEUIL_CPM_CHER` et l'alerte CPM de sql/113:222 |
| Rythme de dépense minimal (G3) | 0,5 (Q3) | démo au 30/04 : DV360 11 513,70 € sur 40 000 € à 49,2 % du temps = **0,585** ; TTD 0,59 ; TikTok 0,86. À 0,85, DV360 et TTD seraient bloqués |
| Seuils d'alerte existants | 0,85 / 0,70 / 1,15 / 1,30 / 1,25 / 70 % / 5 % / ±20 % / ±5 pts | valeurs actuelles comme défaut (phase 2), à calibrer sur historique |

---

## 9. Modèle de données

### 9.1 L'espace s'appelle déjà `workspace_id` dans le jeton

Mesuré : l'espace est `organizations` (5 lignes) ; le crochet `custom_access_token_hook` pose la revendication JWT
**`workspace_id`** = `profiles.organization_id` ; `get_user_org()` la lit. Les tables existantes écrivent `organization_id` (12
tables, dont `dsp_campaigns`, `dsp_connections`) ou `org_id` (5). Les nouvelles tables prennent **`workspace_id uuid not null
references organizations(id)`** comme l'exige le cahier — même nom que la revendication. Pour une table de campagne, il vaut
`dsp_campaigns.organization_id` (espace propriétaire) au moment de l'écriture.

### 9.2 Tables (migration de la phase 3, `CREATE … IF NOT EXISTS`, aucun `DROP`)

**`optimisation_reglages`** — `campagne_id` pk → `dsp_campaigns`, `workspace_id`, `parametres jsonb` (validé par Pydantic,
défauts du § 8 appliqués à la lecture), `maj_par`, `maj_le`.

**`optimisation_cycles`**

| Colonne | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `workspace_id` | uuid not null → organizations | |
| `campagne_id` | uuid → dsp_campaigns | |
| `plateforme` | text null | null = cycle global (mesure) ; sinon code de `dsp_channel_registry` |
| `nature` | text check | `mesure`, `proposition`, `retour_arriere` |
| `jour` | date | Europe/Paris |
| `statut` | text check | `mesure` ; `propose`, `valide`, `envoye`, `refuse`, `expire`, `echec` |
| `anticipe` | bool | envoi anticipé et sa raison dans `resume` |
| `parametres`, `algo_version` | jsonb, text | |
| `entrees`, `entrees_sha256` | jsonb, char(64) | instantané en colonnes (zones, parts cibles, poids, livraisons de la fenêtre) |
| `sortie`, `sortie_sha256` | jsonb, char(64) | indices, coefficients brut/borné, poids, traduction, saturations, répartition |
| `resume`, `alertes` | jsonb | scores par plateforme et global, garde-fous, valeurs bornées avant/après |
| `decide_par`, `decide_le`, `motif` | | décision humaine |
| `etat_avant`, `etat_apres`, `reference_externe` | jsonb | réversibilité (§ 7.7) — jamais de jeton |
| `annule_cycle_id` | uuid → optimisation_cycles | lien d'un retour arrière |
| `envoye_le`, `erreur`, `tentatives` | | |
| `cree_le` | timestamptz | |

Unique `(campagne_id, jour, nature, coalesce(plateforme, ''))` ; écriture `INSERT … ON CONFLICT DO NOTHING RETURNING id` ;
transitions `UPDATE … WHERE id = $1 AND statut = $de RETURNING`. Python seul écrivain.

**`optimisation_executions`** — journal des passages (début, fin, campagnes, cycles, erreurs, étapes), `workspace_id not
null` : l'ordonnanceur écrit une ligne par espace traité.

### 9.3 RLS avec policies écrites et testées (remplace « RLS active sans policy »)

Sur chacune des trois tables : `ENABLE ROW LEVEL SECURITY` ;
- `SELECT` à `authenticated` : `get_user_role() = 'super_admin' OR workspace_id = get_user_org() OR EXISTS (SELECT 1 FROM
  campaign_organizations co WHERE co.campaign_id = campagne_id AND co.organization_id = get_user_org())` — calquée sur
  `dsp_campaigns_select` ;
- **aucune** policy `INSERT`/`UPDATE`/`DELETE` pour `anon`/`authenticated`, et `REVOKE INSERT, UPDATE, DELETE` explicite :
  toute écriture passe par Next → Python ;
- `optimisation_service` : `SELECT, INSERT, UPDATE` (pas `DELETE`).

**Tests** : `tests/integration/optimisation-rls.test.ts`, sur le modèle de `cloisonnement-rls.test.ts` (vrais comptes, clé
publique, PostgREST) : un client d'un autre espace lit 0 ligne ; un client de l'espace lit les siennes ; un compte d'un espace
avec qui la campagne est partagée les lit ; `insert`/`update`/`delete` refusés à tous ; super_admin lit tout. Côté pytest :
`X-Espace` qui ne possède pas la campagne → 404, aucune ligne écrite.

---

## 10. Écarts à `docs/rebid-v2.md` (qui devient historique)

| rebid-v2 | Cahier (retenu) | Conséquence |
|---|---|---|
| D1 une formule (l'amortie réécrite) | une formule, mais **neuve** (§ 7.2) | les deux anciennes portées à l'identique pour comparaison, puis retirées |
| D2 cible = **reste à livrer** / jours restants | **cible du plan fixe** (décision 6) | plus de `reste`, `cible_jour`, `R` ; le retard de volume relève de G3 et de la boucle de volume |
| D3 fenêtre 7 j, repli 3 j | 7 j glissants ; min 3 j conservé (décision prise seul) | |
| D4 correction **hiérarchique** dép → CP, rétrécissement λ = n/(n+k), k = 200 | **par zone, sans hiérarchie** ; volume faible → garde-fou G1 | k disparaît ; Q2 propose une agrégation au département pour les plateformes à faible volume |
| D5 ×0,6 **une fois**, dans le plan, retiré de la correction (INV7) | ×0,6 **dans la formule** de correction | INV7 tombe ; Q1 (cumul à chaque envoi) |
| D6 paliers par valeur, score = médiane | 5 paliers aujourd'hui, **mesurer** l'erreur de quantification | décision reportée à la mesure (phase 5) |
| D7 hors zone national = 0,8 × min | non tranché par le cahier | conservé comme proposition en phase 5 (traducteur enchère), à valider |
| α = 0,8, `clamp(ratio, 1/3, 3)` → coefficient ∈ [0,415 ; 2,408] (INV3) | α = 0,5, coefficient ∈ [0,8 ; 1,2] | INV3 devient `coef ∈ [c_min, c_max]` ; INV5 devient ×(1 − α) = 0,5 par cycle |
| Normalisation : moyenne non pondérée = 1 puis écrêtage (E4) | renormalisation puis bornes 0,001-999,999 | somme conservée sur les zones actives non gelées (§ 7.2) |
| `cp_geoloc_defaut` (E8) | absent | **reporté** : à rouvrir sur une vraie campagne datée |
| Taux de fuite, dénominateur toutes impressions (E8), `HORS_ZONE` (E3) | — | conservés |
| P2 LEFT JOIN, P4 référentiel, P5 seuils réglables | idem | phase 2 |
| P3 `t = jours livrés / N` | — | conservé comme proposition en phase 2 (mesure), à valider |
| Absents de rebid-v2 | deux niveaux, saturation, redistribution, garde-fous, rythme N, envoi anticipé, réversibilité | § 7.3-7.7 |

Critères d'acceptation de rebid-v2 § 7 réutilisés : convergence des simulateurs (proportionnel < 0,5 point après 3 cycles,
saturant < 1 point après 5, aucune oscillation), stabilité 1e-6 sur 20 cycles à livraison conforme, INV1 (point fixe), INV9,
INV10 (2 000 CP). L'ordre 13 > 59 > 1 > 75 ≈ 29 n'est plus un critère : il venait de la cible « reste à livrer ».

---

## 11. Parité et pièges flottants (acquis de T2-T3, toujours valables)

**Fixtures générées par le TS du même commit** (`services/optimisation/tests/parite/generer-fixtures.ts`), JSON gzip, comparées
par pytest à tolérance **nulle** (le 1e-12 relatif prévu s'est révélé inutile). La phase 1 étend le générateur aux nouvelles
fonctions (§ 12) ; la parité SQL (méthode A, score) se fait par lecture des sorties des fonctions SQL sur la base locale.

- Python ≥ 3.12 : `sum()` sur flottants = sommation compensée ≠ `reduce` JS → `somme_gauche()` ; `sum`/`fsum` interdits dans
  `noyau/` et `traducteurs/` (test de pureté en liste blanche).
- `round()` arrondit au pair, `Math.round` vers +∞ à la moitié → `arrondi_js(x, n) = math_round(x × 10ⁿ) / 10ⁿ`, où
  `math_round(v)` = `floor(v) + 1` si `v − floor(v) ≥ 0,5`, sinon `floor(v)` (zéro signé conservé, |v| ≥ 2⁵² rendu tel quel).
  Ne pas « corriger » vers `floor(x × 10ⁿ + 0,5)` : faux sur 0.49999999999999994.
- `Math.min(...[])` = `Infinity`, `min([])` lève → cas vides explicites.
- Ordre d'itération : `Map` et `dict` suivent l'insertion ; les entrées arrivent dans l'ordre des fixtures ; toute lecture SQL
  en ordre **total** (leçon de `zone_set_cp`, commit `72185c97`).
- **Nouveaux pour la phase 1** : le simulateur emploie `Math.imul`, `>>> 0`, `| 0` (mulberry32, FNV-1a) → arithmétique
  32 bits explicite (`& 0xFFFFFFFF`, signe recalculé), testée sur les vecteurs de `tests/unit/demo/rng.test.ts` ;
  `numeric` Postgres → `Decimal` à la lecture, converti en `float` à l'entrée du noyau comme le fait supabase-js (nombre JS) ;
  `GREATEST(0, LEAST(5, …))` en `numeric` puis `numeric(6,3)` à l'écriture (arrondi au millième **demi-loin-de-zéro** de
  Postgres, pas celui de JS).
- Limite connue : les fixtures de T2 portent sur des sommes entières ou demi-entières (`fsum` indiscernable) ; la garde contre
  `sum` reste structurelle.

---

## 12. Les cinq phases, en tâches chiffrées

Estimations en jours-dev ; « fait » = commité sur `feat/optimisation-python`.

### Phase 1 — portage à l'identique (≈ 9 j restants)

| Tâche | Contenu | Jours | État |
|---|---|---|---|
| 1.0 | Socle, rôle sql/342, fixtures, noyau du plan méthode B, routes `/v1/plans/{zone,risque}` (T0-T4) | — | **fait** (`f163002d` → `72185c97`, 369 tests pytest) |
| 1.1 | Plan méthode A : `pressureCurve` (TS) + calcul de `apply_zone_weights_to_strategy` / `interpolate_on_curve` (SQL), sur l'**univers figé** de 11 435 codes de la démo ; parité : 11 435 multiplicateurs, 1 641 > 0, 13001 = 1,214, 75011 = 0,848, 29200 = 1,012 | 1,5 | |
| 1.2 | Part du plan (`m ÷ Σ m`, `in_target`), impressions prévues (budget ÷ CPM, plus forts restes de `impressions.ts`, attendu à date de sql/280) ; parité : 0,00085284, 10 000 000, 4 920 000 | 1 | |
| 1.3 | Mesures : score de `calculer_alignement_geo` (93, 3,84 %, 3,35 %, 72,5 %), écarts par maille (13 à −48,4 %, 59 à −46,2 %), alertes (161 CP sous 70 %, rythme 0,80) — parité contre les fonctions SQL | 1,5 | |
| 1.4 | `computeRebidWeights` et `recaler` portés tels quels (`noyau/historique/`) ; fixtures TS : les cas de `tests/unit/pacing/rebid.test.ts` (4) et de `recaler` dans `tests/unit/simulation/simulation.test.ts`, plus l'entrée « 4 départements » figée (1,2089 / 1,1585 / 0,6172 / 0,5873 ; 54,1 / 35,0 / 5,9 / 5,0 ; amortie 1,164 / 1,125 / 0,680 / 0,653) | 1 | |
| 1.5 | Simulateur + rng portés bit à bit (`tests/simulation/`), fixtures de `simulator.test.ts` et `convergence.test.ts` | 1 | |
| 1.6 | Client Next `lib/optimisation/client.ts`, types générés, drapeaux `OPTIMISATION_PLAN_SOURCE` / `OPTIMISATION_CORRECTION_SOURCE` en `ombre` sur les appelants (extraction zone, extraction risque, `rattacher`, `jeux/[id]/export`, `jeux/[id]/cp-geo`, `simulation/recaler`) ; `resume_plan.algo` persisté (CREATE OR REPLACE de sql/340) ; lectures `zone_set_cp` en ordre total | 2,5 | |
| 1.7 | Rapport de non-régression « Démo pilotage — élections » (toutes les valeurs ci-dessus, TS = Python), arrêt pour accord | 0,5 | |

`PacingPanel.tsx` calcule dans le navigateur (React gelé) : porté pour la parité, jamais rebranché. La bascule `python` (et la
suppression du TS) n'a lieu qu'après accord du propriétaire, pas à la fin de la phase.

### Phase 2 — corrections de données (≈ 3 j)

| Tâche | Contenu | Jours |
|---|---|---|
| 2.1 | Tableaux par CP **depuis le plan** (plan LEFT JOIN livraison, 0 si non servi) : lecture Python + jumelle SQL de `refresh_campaign_rollups` (sans `DROP`) | 1 |
| 2.2 | Méthode A sur `ref_codes_postaux` (6 187) au lieu de `DISTINCT dsp_campaign_data` | 0,5 |
| 2.3 | `optimisation_reglages` (avec `workspace_id`, policies, tests RLS) ; seuils du § 2.2 lus depuis les réglages par Python et par `get_campaign_suivi` (CREATE OR REPLACE, défaut = valeurs actuelles) | 1 |
| 2.4 | Effet mesuré : démo **0 CP non servi** (tous servis) → on le dit et on prouve sur un cas construit (fixture) et sur les deux stratégies sans livraison (176 et 88 CP qui deviennent visibles) ; méthode A : +20 CP du référentiel, −5 248 codes étrangers | 0,5 |

### Phase 3 — formule cible (≈ 6 j)

| Tâche | Contenu | Jours |
|---|---|---|
| 3.1 | `noyau/{lissage,correction,garde_fous,parametres}.py` (§ 7.1, 7.2, 7.5) ; invariants : point fixe, coefficient dans `[c_min, c_max]`, somme conservée, zone gelée intacte, cible inchangée sur 20 cycles, stabilité 1e-6 | 2 |
| 3.2 | Migration `optimisation_cycles`, `optimisation_executions` (workspace_id, policies, tests RLS) ; `EXPLAIN ANALYZE` des lectures de fenêtre | 1 |
| 3.3 | `cycles/` : mesure quotidienne, proposition tous les N jours, envoi anticipé, instantané, empreintes, rejeu, expiration ; ordonnanceur local | 1,5 |
| 3.4 | Validation contre le simulateur : **cycles pour converger** de la formule unique vs rebid plafonné vs recalage amorti (réponse proportionnelle et saturante, N = 3, 5, 7) ; confirme ou corrige N = 5 | 1 |
| 3.5 | Rapport, arrêt | 0,5 |

### Phase 4 — deux niveaux et saturation (≈ 4 j)

| Tâche | Contenu | Jours |
|---|---|---|
| 4.1 | `noyau/niveaux.py` : scores par plateforme et global, règle « le global décide » | 1 |
| 4.2 | `noyau/saturation.py` : détection sur K cycles, receveurs, transfert et compensation (§ 7.4), levée manuelle | 1,5 |
| 4.3 | Scénario à deux plateformes (simulateur : l'une plafonne sur une zone, l'autre a de la marge) : le total revient vers le plan, **Σ_p objectif_p(z) constant à 1e-9 pour toute zone**, budgets constants | 1 |
| 4.4 | Rapport, arrêt | 0,5 |

### Phase 5 — traducteurs et connecteur DV360 (≈ 11 j)

| Tâche | Contenu | Jours |
|---|---|---|
| 5.1 | `traducteurs/enchere.py` (bornes `plateformes_poids`, 5 paliers, **erreur résiduelle de quantification mesurée** sur la démo, comparaison avec les paliers par valeur de rebid-v2 D6) et `traducteurs/budget.py` (recalage au total) | 2 |
| 5.2 | `secrets.py` (AES-256-GCM compatible Node, vecteurs croisés), `state` HMAC, OAuth DV360 en Python ; relais des callbacks Next (URI inchangées) | 2 |
| 5.3 | Connecteur DV360 : rapport Bid Manager **quotidien au CP** → `dsp_campaign_data`/`campaign_dsp_report`, script de custom bidding, plafond **2 000 CP** par envoi (au-delà : refus avec renvoi au fichier), `lire_etat_courant`, `retablir` | 3,5 |
| 5.4 | Envoi **après validation** seulement (routes Next `valider`/`refuser`/`annuler`), retour arrière, journal ; interfaces Meta/TTD/TikTok (Protocol seul, registre sans elles) | 2 |
| 5.5 | Bascule par drapeau du ciblage `/activation/pousser` ; rapport, arrêt | 1,5 |

**Total restant ≈ 33 jours.** Chemin critique : 1.1-1.5 → 3.1 → 3.3 → 4.2 → 5.3 → 5.4. 5.2 peut avancer en parallèle de la
phase 3. Blocage externe : droits Google sur le compte partenaire DV360 (`dsp_connections` en `error`), nécessaires pour
prouver 5.3 contre la vraie API.

---

## 13. Ce qui devient caduc dans le plan du matin (version T0-T17)

| Élément du matin | Sort |
|---|---|
| Q2 = A « code React gelé non porté » (`computeRebidWeights`, `/api/demo/apply-rebid`) ; « pas de `computeRebidWeightsV1` » | **Caduc** : le cahier exige le portage à l'identique des deux formules (1.4) |
| `recalage.ts` « pas de parité, acceptation sur rebid-v2 § 7 » | **Caduc** : parité exacte (1.4) |
| Correction v2 hiérarchique (rebid-v2 § 2) dans `correction.py`, paliers par valeur dans `paliers.py` | **Caduc** : formule du § 7.2 ; paliers selon mesure (5.1) |
| `adaptateurs/simule/`, mode simulé de l'activation, « mécanisme aucun → cycles non validables » | **Caduc** : aucun mode simulé ; Meta/TikTok passent par le traducteur budget |
| T16 « TTD et Meta : auth, envoi, rapport » (4 j) | **Caduc** : interfaces seules |
| Ordonnanceur quotidien **d'envoi**, cycle unique `(campagne, jour, plateforme)`, expiration à 24 h | **Remplacé** : mesure quotidienne, proposition tous les N jours, envoi anticipé, expiration à la proposition suivante |
| « RLS active sans policy » sur `optimisation_*` | **Remplacé** : `workspace_id` + policies testées (§ 9.3) |
| `cp_geoloc_defaut` (E8) dans la migration | **Reporté** |
| T7 : Angular ⑥ lit `part_prevue` ; T12 : écran Angular ⑧ | **Hors périmètre** (front gelé) ; contrat de routes fourni pour ⑧ Live |
| Déploiement « AWS siège / GCP en pause » | **Cloud Run** (cahier) |
| T6 « bascule `python` dès 20 extractions sans écart » | **Soumis à l'accord du propriétaire** (TS conservé jusque-là) |
| Conservés : frontière ⑤, psycopg direct, rôle sql/342, parité par fixtures TS, pièges flottants, `ombre`, `resume_plan.algo`, Q1 (ordonnanceur Python / Cloud Scheduler), Q3 (qui valide) | |

---

## 14. Décisions prises seul (à valider)

1. Colonne **`workspace_id`** (nom de la revendication JWT), FK `organizations`, valeur = espace propriétaire de la campagne ;
   lecture ouverte aussi aux espaces avec qui la campagne est partagée (comme `dsp_campaigns_select`).
2. « **Le global décide** » = un coefficient de plateforme n'est appliqué que si l'indice global de la zone est hors tolérance
   et dans le même sens (§ 7.3).
3. Redistribution par **échange compensé** entre plateformes, pour garder constants la cible globale de chaque zone **et** le
   volume de chaque plateforme (§ 7.4) ; levée de saturation manuelle.
4. Échec de G2 ou G3 → toute la proposition de la plateforme est conservée (sinon la renormalisation surpondère en douce).
5. `valeur(z)` : part de population dans la zone (méthode B), 1/0 dans la cible (méthode A).
6. Fenêtre minimale de 3 jours ; `HORS_ZONE` exclu de la correction en mode strict (fuite = alerte).
7. Bornes 0,8/1,2 appliquées au coefficient, pas au rapport effectif après renormalisation (affiché).
8. Simulateur dans `tests/simulation/`, jamais dans les connecteurs.
9. Pas d'écran : la validation passe par des routes Next, l'écran ⑧ Live les consommera.
10. Défauts du § 8 (V_min 100, N 5, seuil anticipé −5 points, délai 3 jours, réduction 10 %, plafond 1,25).

---

## 15. Questions au propriétaire (3)

**Q1 — Dilution ×0,6 : à chaque envoi, ou une fois ?** Écrite dans la formule, elle se **cumule** : un CP dilué perd 40 % de
poids relatif à chaque envoi, et même au coefficient maximal (×1,2 × 0,6 = 0,72) il décroît sans fin — 0,6⁸ ≈ 0,017 après
8 envois. C'est le défaut que rebid-v2 (D5) avait relevé dans `recaler`. **Recommandation** : l'appliquer **une seule fois**,
au premier envoi de la campagne (marqué dans le journal), puis plus jamais ; la formule reste celle du cahier pour ce premier
envoi.

**Q2 — Zones sous le volume minimum.** À 100 impressions sur 7 jours, la démo laisse 2,8 % des CP de DV360 sous le seuil, mais
**95,8 % de TTD** et 69 % de TikTok : avec la règle du cahier (« réglage conservé, alerte »), TTD ne serait presque jamais
corrigé et produirait 1 572 alertes. **Recommandation** : sous `V_min`, la zone prend le coefficient de son **département**
(calculé sur la livraison agrégée du département, mêmes garde-fous), et l'alerte est groupée par département ; le CP n'est gelé
que si le département lui-même est sous `V_min`.

**Q3 — « Budget réellement dépensé » (G3).** Avec le seuil d'alerte existant (rythme ≥ 0,85), la démo au 30/04 serait
bloquée sur DV360 (0,585) et TTD (0,59) : aucune surpondération proposée, alors que c'est le cas d'école du document.
**Recommandation** : G3 = rythme de dépense de la plateforme sur la fenêtre **≥ 0,5** (elle dépense au moins la moitié de son
rythme : le problème est la répartition, pas un blocage) ; l'alerte « pacing en retard » à 0,85 reste affichée à part.
