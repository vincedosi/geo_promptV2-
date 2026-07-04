# Design — Pacing plan-vs-réel géographique + rebid correctif

> Date : 2026-07-04 · Portée : campagnes **digitales** uniquement (DSP programmatique).
> Statut du doc : validé en brainstorming, en attente de relecture avant plan d'implémentation.
> Mémoire liée : `project_boucle_dsp_adserver` (modèle levier-DSP / vérité-adserver).

## Problème

MAGELIAN pilote une campagne digitale par une **boucle** : on planifie des zones et
leur répartition de budget (plan média sur zones custom), on **pousse** cette intention
comme custom bidding pondéré dans le DSP (DV360 / TikTok), puis l'**ad server** mesure
la délivrance réelle (`dsp_campaign_data` : impressions / spend par code postal / régie).
La question de pilotage est : **la délivrance a-t-elle atterri là où je l'avais voulu ?**

Aujourd'hui l'app calcule bien un sur-servi / sous-servi par zone — mais **toujours
contre la population INSEE**, jamais contre le plan qu'on a réellement poussé. Et les
deux briques ne se rejoignent nulle part : le plan média vit dans le monde des carreaux
Filosofi (géométries d'isochrones), la délivrance dans le monde administratif du code
postal. **Rien ne relie « j'ai poussé ce ciblage sur cette zone » à « voici ce qui y a
été délivré ».** C'est le chaînon manquant de la boucle.

## Objectif

Fermer la boucle : figer l'intention poussée, la comparer à la délivrance réelle par
**item de zone** (le composant pondéré du plan), et produire un **rebid correctif** qui
repousse la répartition vers le plan.

### Bénéfice mesurable

Depuis le panneau d'analyse digitale, l'utilisateur voit par zone → par item l'écart
entre part planifiée et part réelle (sur-servi / conforme / sous-servi **vs son plan**),
descend au code postal pour comprendre, et génère en un clic un export de bidding corrigé
prêt à re-pousser — ce qui fige la version suivante du plan et relance la boucle.

## Non-objectifs (hors scope)

- **Synchro DSP live** (savoir qu'un DSP a réellement appliqué le ciblage) → nécessite l'API push, non fiabilisée.
- **Pacing temporel budget** (burn du budget dans le temps vs plan de flighting) → c'est du pacing *géographique*, pas *temporel*.
- **Redistribution du poids par audience du CP** : le poids est défini et poussé **par item**, uniforme sur ses CP. On ne réinvente pas une pondération intra-item que l'export ne produit pas.
- **Optimisation automatique / boîte noire** : le rebid applique une règle **transparente** et tunable, pas un modèle appris.
- **Push API automatique** du rebid : la v1 produit un **export fichier** (comme aujourd'hui) ; le re-push reste une action utilisateur.

## Décisions de design (arbitrées en brainstorming)

1. **Baseline = l'intention poussée au DSP** (pas la population). Le sur/sous-servi vs population existe déjà ; la valeur neuve est la comparaison au plan.
2. **Snapshot figé, versionné** : un push = une version horodatée. La comparaison se fait contre le snapshot choisi (défaut : dernier). L'historique des versions = l'historique de la boucle.
3. **Déclencheur du snapshot = la génération de l'export DSP** (le moment réel du push), via `exportWeighted` côté client où `campaign_id` + poids + items coexistent. L'export fichier reste inchangé ; le snapshot passe par un endpoint dédié.
4. **Granularité de comparaison = l'item** (composant de zone), remonté par zone ; le **code postal** est la clé de jointure au réel et le niveau de drill-down.
5. **Comparaison en parts normalisées** (« voulu 30 %, eu 21 % → −9 pts ») ; volume absolu (impressions / €) en lecture secondaire.
6. **v1 = diagnostic + rebid** (refermer la boucle), le rebid étant la dernière unité (shippable juste après le diagnostic).

## Approche retenue : snapshot CP au push + pacing par item + rebid

Le plan est figé au niveau item, expansé en CP au moment du snapshot (réutilise la RPC
d'export `get_zone_items_export`). Le pacing joint les CP du snapshot à `dsp_campaign_data`
au code postal, agrège le réel par item, compare les parts, remonte par zone. Le rebid
dérive des poids corrigés du diagnostic et les réinjecte dans la machinerie d'export
existante.

Approches écartées : (2) snapshot au niveau CP avec pondération intra-item — infidèle, l'export
n'attribue pas de poids par CP ; (3) pas de snapshot, recalcul à la volée — perd la vérité
historique et recoûte l'expansion item→CP à chaque lecture ; (4) accrocher le snapshot à la
route d'export — elle ignore `campaign_id`, ne convient pas.

## Modèle de données

Nouvelle table `campaign_plan_snapshot` (migration versionnée dans `sql/`), petite
(quelques centaines à ~2 000 CP × quelques versions par campagne) :

| Colonne | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `campaign_id` | `uuid NOT NULL` | rattachement campagne (FK logique `dsp_campaigns`) |
| `version` | `int NOT NULL` | 1,2,3… incrémenté par campagne au push |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | horodatage du push |
| `created_by` | `uuid` | auteur (auth) |
| `dsp` | `text` | `dv360` / `tiktok` (un export = un DSP) |
| `budget` | `numeric` | budget global figé (attendu absolu + audit) |
| `cpm` | `numeric` | CPM global figé |
| `cible` | `text` | clé de cible figée (`CIBLE_KEYS`) |
| `zone_id` | `text NOT NULL` | zone du plan |
| `zone_name` | `text` | libellé zone |
| `item_id` | `text NOT NULL` | item pondéré = `zone_id:poi_id` |
| `item_name` | `text` | libellé item |
| `item_weight` | `numeric NOT NULL` | poids brut saisi (0-100) de l'item |
| `expected_share` | `numeric NOT NULL` | part attendue de l'item, **normalisée à 1 au sein de sa zone** (répétée sur chaque CP de l'item) |
| `postal_code` | `text NOT NULL` | clé de jointure au réel |

- Une ligne par `(id_snapshot, postal_code)`. `item_*` / `expected_share` sont dénormalisés (répétés sur les CP de l'item) — table petite, jointure simple.
- Index : `(campaign_id, version)` (résolution du snapshot courant), `(campaign_id, version, postal_code)` (jointure au réel).
- RLS : lecture scopée org (miroir de `dsp_campaign_data`), écriture service-role uniquement. Les routes serveur utilisent `createAdminClient()` (service role) ; la RLS protège tout accès direct.

Aucun « attendu par CP » n'est stocké : `expected_share` est **par item**, la ligne CP ne
sert qu'à attribuer le réel et à drill-downer.

## Le snapshot (au moment du push)

**Déclencheur** : `exportWeighted` dans `app/map/_components/ZoneMediaPlanPanel.tsx`. La
fonction boucle déjà sur les zones pour télécharger un fichier par zone ; on ajoute **un
seul** appel `POST /api/custom-geo/media-plan/snapshot` couvrant **tout le plan** (toutes
zones/items), en plus des téléchargements existants (inchangés).

**Payload** (client → serveur) : `{ campaign_id, dsp, budget, cpm, cible, zones: [{ zone_id, zone_name, items: [{ item_id, item_name, weight }] }] }`.

**Traitement serveur** (endpoint dédié, `createAdminClient`) :
1. Pour chaque zone du plan, appeler `get_zone_items_export(zone_id, …)` → items + `cps: string[]` (≤ 3 appels parallèles, règle Nano ; un plan a peu de zones).
2. Retenir les items présents dans le payload (ceux qui portent un poids) et leurs CP.
3. Calculer `expected_share` par item = `item_weight / Σ(item_weight de sa zone)` — normalisation **intra-zone**, fidèle à l'export (une requête d'export par zone, poids d'items relatifs au sein de la zone). Dans le cas mono-zone (ex. CIRFA à 4 items), intra-zone = plan-global. Le cas multi-zones avec un **poids de zone** explicite (clé `zoneId` dans `weights`, distincte de `zoneId:poi_id`) relève d'une lecture inter-zones secondaire (part de zone planifiée vs réelle), à caler sur la sémantique exacte de `lib/custom-geo/media-plan.ts` — hors cœur v1 sauf si le code confirme que le poids de zone est déjà poussé.
4. `version = COALESCE(max(version) WHERE campaign_id, 0) + 1`.
5. Insérer une ligne par `(item, cp)` (batch 50, pattern `lib/import/inserter.ts`), `created_by` = auth user.
6. Retourner `{ version, items, cps_count }`.

**Progression** : l'insertion est petite (≤ ~2 000 lignes) et synchrone ; un toast
« Plan figé — version N » suffit (pas de SSE requis à cette taille ; si un jour un plan
dépasse le batch, basculer sur le pattern de progression obligatoire).

## Calcul du pacing — RPC bornée

Deux RPC, toutes deux bornées à la campagne + version (jamais de scan intégral) :

**`get_campaign_pacing(p_campaign_id uuid, p_version int)`** → agrégation **par item** :
- CP planifiés = lignes du snapshot `(campaign_id, version)`.
- Réel = `dsp_campaign_data` de la campagne joint sur `postal_code` aux CP planifiés.
- `actual_imp(item)` = `SUM(impressions réel)` des CP de l'item ; métrique primaire =
  `COALESCE(impressions, unique_impressions, 0)` (alignée sur la métrique du panneau
  d'analyse pour que les chiffres se réconcilient) ; `actual_spend(item)` = `SUM(spend)`.
- `zone_in_plan_imp(zone)` = `SUM(actual_imp)` sur les items de **la même zone** (dénominateur intra-zone, cohérent avec `expected_share`).
- `actual_share(item)` = `actual_imp / NULLIF(zone_in_plan_imp, 0)`.
- `expected_share(item)` = depuis le snapshot (déjà normalisé intra-zone).
- `delta_pts(item)` = `(actual_share − expected_share) × 100` (comparaison au sein de la zone).
- `expected_imp(item)` = `budget_zone / cpm × 1000 × expected_share` (lecture absolue ; `budget_zone` = budget global en mono-zone, sinon × part de budget de la zone quand la lecture inter-zones est câblée).
- Retour par item : `zone_id, zone_name, item_id, item_name, expected_share, actual_share, delta_pts, expected_imp, actual_imp, actual_spend, cp_count`.

**`get_campaign_pacing_cp(p_campaign_id uuid, p_version int, p_item_id text)`** → drill CP
d'un item : par `postal_code`, `actual_imp`, `actual_spend`, présence de délivrance.

**Spillover (hors-plan)** : la première RPC retourne aussi une ligne agrégée « hors-plan »
= délivrance de la campagne sur des CP **absents** du snapshot (impressions / spend / part
du total campagne). Signalée à part, **jamais fondue dans les parts d'items** (les parts
d'items se comparent sur le périmètre in-plan).

**Classification** (côté logique pure TS, pas SQL) :
- `sur_servi` si `delta_pts > +PACING_TOLERANCE_PTS`
- `sous_servi` si `delta_pts < −PACING_TOLERANCE_PTS`
- `conforme` sinon
- `PACING_TOLERANCE_PTS` = constante (défaut **5**), ajustable — comme `FRESHNESS_DAYS`.

**Nano** : `EXPLAIN ANALYZE` obligatoire sur les deux RPC avant livraison ; la jointure est
bornée aux CP du snapshot (index `(campaign_id, version, postal_code)`) et aux données de la
campagne (index `campaign_id`). Vérifier l'index scan, pas de seq scan (leçon R1 du statut).

## Le rebid correctif — refermer la boucle

Logique pure `lib/pacing/rebid.ts`, testée. À partir du diagnostic (par item :
`item_weight` d'origine, `expected_share`, `actual_share`), produire des poids corrigés :

```
factor(item)   = clamp( expected_share / max(actual_share, ε),  1 − CAP,  1 + CAP )
new_weight_raw = item_weight × factor
new_weight     = renormalisation des new_weight_raw (par zone, à 100 %)
```

- Items **sous-servis** (`actual < expected`) → `factor > 1` → poids relevé ; **sur-servis** → poids abaissé ; plafonné par `CAP` (défaut **0,5** = ±50 %) pour ne pas sur-corriger ; `ε` évite la division par zéro (item sans délivrance → poussé au max autorisé).
- `CAP`, `ε` = constantes tunables, couvertes par tests.

Les poids corrigés sont réinjectés dans **la machinerie d'export existante**
(`GET /api/custom-geo/[id]/export?format=bidding_script|tiktok_geo&weights=…`) → export
fichier corrigé téléchargeable. Le re-pousser déclenche à nouveau le snapshot → version N+1
→ la boucle tourne. Le composant de reco de bid existant (vs population) sert de patron UI ;
ici la source est le pacing vs plan.

## UI — onglet « Plan vs réel »

Nouvel onglet **dans le panneau d'analyse digitale existant** (`app/map/analyse/digital/`,
`AnalysisPanel`), à côté de breakdown / heatmap, **sans refonte** (règle
`feedback_ui_pas_de_refonte`).

- **Sélecteur de version** de snapshot (comparer au push v1/v2/v3…), défaut : dernier.
- **KPIs en tête** : taux de conformité (part des items conformes), budget planifié vs `spend` réel, nombre d'items sous-servis / sur-servis, volume hors-plan.
- **Tableau par zone → item** : zone · item · part planifiée · part réelle · Δ (pts) ·
  badge sur/sous/conforme. Triable, drill CP (réutilise le patron région→dept→CP).
- **Bouton « Générer le rebid corrigé »** → télécharge l'export corrigé (choix DV360 / TikTok).
- Design system : dark, accent teal, sentence case, pas de violet, tokens `var(--…)`,
  badges de statut réutilisant le patron des badges existants.

## Flux de données

- **Push (écriture)** : `exportWeighted` → téléchargements fichiers (inchangés) **+**
  `POST /snapshot` → matérialise `campaign_plan_snapshot` version N.
- **Lecture (diagnostic)** : onglet → `GET /api/digital/[campaignId]/pacing?version=` →
  `get_campaign_pacing` (+ `get_campaign_pacing_cp` au drill) → parts / Δ / classification / spillover.
- **Rebid (écriture indirecte)** : bouton → `lib/pacing/rebid.ts` (poids corrigés) →
  export existant → fichier → re-push utilisateur → snapshot N+1.

## Gestion d'erreur

- **Jamais poussé** (0 snapshot) → état vide explicite : « aucun plan figé — pousse un export pour démarrer la boucle ». Pas d'erreur.
- **Snapshot mais réel encore vide** (campagne fraîche) → planifié affiché, réel = 0, **aucun faux sous-servi** (Δ = −expected mais libellé « en attente de données », pas « sous-servi »).
- **Délivrance hors-plan** → ligne spillover, jamais fondue dans les parts d'items.
- **CP planifiés sans délivrance** → item potentiellement sous-servi, drill CP montre lesquels sont à zéro.
- **Total réel ≠ total planifié** → neutralisé par la comparaison en parts (volume absolu montré à part).
- **`get_zone_items_export` renvoie zéro CP pour un item** (zone non décomposable) → item exclu du snapshot avec log ; le plan ne fige que ce qui est réellement poussable.
- **Version demandée inexistante** → 404 explicite ; défaut = dernière version.
- **Campagne d'une autre org** → 403 (garde org en place sur les routes digital + RLS table).
- **Push concurrent** (deux exports quasi simultanés) → `version` calculé côté serveur ; contrainte d'unicité `(campaign_id, version)` + retry sur collision.

## Plan de test

- **Unitaire `lib/pacing/compute.ts`** (cœur) : normalisation des parts, `delta_pts`,
  classification (sur/sous/conforme aux bornes de `PACING_TOLERANCE_PTS`), dénominateur
  in-plan, séparation du spillover, cas réel-vide (« en attente » ≠ « sous-servi »).
- **Unitaire `lib/pacing/rebid.ts`** : `factor` plafonné à `CAP`, item sans délivrance
  poussé au max, renormalisation à 100 % par zone, invariance (plan déjà conforme → poids ~inchangés).
- **RPC** : justesse des parts vs jeu de données connu ; `EXPLAIN ANALYZE` → index scan borné, pas de seq scan.
- **Snapshot** : un export → une version ; deux exports → deux versions horodatées distinctes ; `expected_share` somme à 1 ; unicité `(campaign_id, version)`.
- **Route pacing** : version par défaut = dernière ; version inexistante → 404 ; cross-org → 403.

## Migration

- `sql/096_campaign_plan_snapshot.sql` : `CREATE TABLE campaign_plan_snapshot` + index +
  RLS + `get_campaign_pacing` + `get_campaign_pacing_cp`. Appliquée via MCP Supabase,
  définition versionnée dans le repo (règle anti-dérive DB↔repo).
- Rétrocompat : table neuve, aucune campagne existante n'a de snapshot → l'onglet affiche
  l'état vide jusqu'au premier push. Aucun backfill.

## Découpage & interfaces (pour le plan)

Unités isolées, dans l'ordre (le rebid en dernier, shippable après le diagnostic) :

1. **Migration** `sql/096` : table + index + RLS + RPC `get_campaign_pacing` / `get_campaign_pacing_cp`.
2. **`lib/pacing/compute.ts`** (pur, testé) : parts, `delta_pts`, classification, `PACING_TOLERANCE_PTS`, séparation spillover, libellés/couleurs de statut (tokens `var(--…)`).
3. **Endpoint snapshot** `POST /api/custom-geo/media-plan/snapshot` : expansion item→CP (RPC export), normalisation, insertion versionnée.
4. **Accroche client** : `exportWeighted` appelle l'endpoint snapshot (une fois, tout le plan) en plus des téléchargements ; toast « Plan figé — version N ».
5. **Route pacing** `GET /api/digital/[campaignId]/pacing?version=` : appelle les RPC, applique `lib/pacing/compute.ts`, renvoie diagnostic + spillover.
6. **`lib/pacing/rebid.ts`** (pur, testé) : poids corrigés (`factor`, `CAP`, `ε`, renormalisation).
7. **UI onglet « Plan vs réel »** dans `AnalysisPanel` : sélecteur version, KPIs, tableau zone→item, drill CP, bouton rebid → export corrigé.

Cohérence des types : `expected_share` / `actual_share` ∈ [0,1] partout ; `delta_pts` en
points (×100) ; `item_id` = `zone_id:poi_id` (aligné sur les clés `weights` du panneau et
le filtre `r.id.startsWith(zone_id + ':')` de l'export) ; métrique réel = `COALESCE(impressions,
unique_impressions, 0)` alignée sur le panneau d'analyse.
