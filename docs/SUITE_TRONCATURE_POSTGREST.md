# Suite — les troncatures PostgREST (plafond `db-max-rows` = 1 000)

> Titre jusqu'au 2026-10-10 : « trois troncatures PostgREST vivantes en
> production ». La production n'existe plus depuis le 2026-09-21 ; le
> plafond qui compte est celui du stack local, 1 000 lignes.

> Écrit le 2026-09-15, pendant la relecture finale de `feat/suivi-v2`.
> **Ces défauts sont ANTÉRIEURS à cette branche et actifs en production
> aujourd'hui.** Ils en sortent par décision (ruling FR-1) : les corriger dans
> une branche déjà bicéphale, sur des domaines sans rapport avec le suivi de
> campagne, aurait mélangé deux choses que personne ne peut plus relire
> séparément. Ils ne sont pas abandonnés pour autant — ce fichier existe pour
> qu'ils ne se perdent pas.
>
> **Mis à jour le 2026-09-16 :** un troisième défaut (C) s'ajoute aux deux
> premiers, trouvé non par une relecture mais par le test de famille réclamé
> plus bas, dès sa première exécution. Les deux garde-fous que ce document
> demandait — une règle dans `CLAUDE.md` et un test de balayage — existent
> désormais.

## Le mécanisme, une bonne fois

**PostgREST coupe à `db-max-rows` TOUTE fonction `RETURNS TABLE` ou `SETOF`,
sans erreur, sans avertissement, sans en-tête** — et toute requête de table
ordinaire aussi. L'appelant reçoit un tableau parfaitement valide et n'a aucun
moyen de savoir qu'il en manquait.

**Ce plafond vaut 1 000 lignes** sur le seul environnement qui existe
(`supabase/config.toml` : `max_rows = 1000` ; `PGRST_DB_MAX_ROWS=1000` dans le
conteneur `supabase_rest_genesis_app`).

> **Ce document a dit « 5 000 » du 2026-09-15 au 2026-10-10.** C'était le
> réglage du projet hébergé `vkkdbygwbrxyogqosten`, supprimé le 2026-09-21 :
> le chiffre a survécu d'un mois à la seule base où il était vrai. Mesuré le
> 2026-10-10 par des appels PostgREST directs : `get_zone_centroids('cp')` →
> 1 000 lignes sur 6 187 ; `codes_postaux_dans_bbox` métropole → 1 000 sur
> 6 051 ; `calculer_score_composite` sur 1 429 CP → 1 000 ;
> `get_voronoi_by_category('lycee')` → 1 000 cellules sur 4 653. Toutes les
> bornes justifiées « sous 5 000 » ont été relues contre 1 000 ce jour-là —
> recensement plus bas. Le passage historique des défauts A à C garde ses
> chiffres d'époque (5 000), qui décrivaient la production d'alors.

Le projet l'a maintenant rencontré **six fois** :

| # | Où | Découvert | Corrigé |
|---|---|---|---|
| 1 | `correlation_campagne_indicateur` | 2026-09-13 | sql/154 (jumelle `RETURNS jsonb`) |
| 2 | `codes_postaux_du_perimetre` | 2026-09-15 | sql/168 + sql/169 (jumelle + enveloppe) |
| 3 | `calculer_score_composite` | 2026-09-15 (relecture finale) | sql/170 (jumelle + enveloppe) ; `/api/custom-geo/source/score`, qui lisait encore la forme TABLE, passé à la jumelle le 2026-10-10 |
| 4 | `get_zone_centroids` et `codes_postaux_dans_bbox` | 2026-09-15 (relecture finale) | sql/243 (A), sql/244-245 (B) — 2026-10-10 |
| 5 | `get_strategy_comparison_data` | 2026-09-16, **par le test de famille** | **clos par retrait le 2026-10-12** : son unique appelant (`final-report`, bilan Gemini) supprimé avec l'IA — défaut C ci-dessous |
| 6 | `get_voronoi_by_category` | 2026-10-10, recensement contre 1 000 | sql/246 (jumelle + enveloppe) |

Ce n'est plus un piège, c'est une propriété de la plateforme. Le correctif
ponctuel ne suffit plus : il faut un test qui balaie les fonctions
`RETURNS TABLE` appelées par l'application et signale celles qui peuvent
dépasser 1 000 lignes.

## Recensement du 2026-10-10 — contre 1 000, plus contre 5 000

Toutes les RPC `RETURNS TABLE`/`SETOF` appelées depuis `app/` ou `lib/`, lues
dans `pg_proc` (16 fonctions, dont deux **créées hors migrations** que le test
ne voyait pas : `get_dept_representative_communes` et
`get_zone_radius_targets`). Comptes mesurés en `psql` sur la base locale.

| RPC | Lignes aujourd'hui | Peut dépasser 1 000 ? | Suite |
|---|---:|---|---|
| `calculer_score_composite` | 1 429 sur une zone AURA + Occitanie (route : jusqu'à 3 000) | **dépassait** | appelant passé à `calculer_score_composite_jsonb` (sql/170) |
| `get_voronoi_by_category` | 4 653 (lycées, métropole) | **dépassait** | jumelle sql/246, outil `voronoi_analysis` passé dessus |
| `get_strategy_comparison_data` | 306 150 et 174 780 | **dépasse** | **clos le 2026-10-12** : plus appelée par l'application (défaut C) ; la fonction reste en base, sans appelant |
| `count_emetteurs_par_radio` | 861 | **oui** — une ligne par radio ayant un émetteur, 1 175 radios en table | **dette D ci-dessous**, non touchée |
| `get_zone_radius_targets` | 565 au plus (7 zones) | **oui** — une ligne par poche disjointe d'une zone, sans LIMIT | **dette E ci-dessous**, non touchée |
| `get_table_sizes` | 119 | non (tables du schéma) | — |
| `get_dept_representative_communes` | 104 | non (référentiel) | — |
| `get_iris_fill_status`, `get_iris_metric_columns` | 41 | non (colonnes d'`iris`) | — |
| `get_active_data_registry` | 13 | non (configuration) | — |
| `get_dsp_campaign_stats` | 8 | non (une ligne par campagne) | — |
| `get_campaign_available_metrics` | une vingtaine au plus (12 au registre + 5 colonnes natives) | non (registre des métriques) | — |
| `get_campaign_last_data_dates` | ≤ nombre d'ids passés | non (ids d'une liste elle-même lue sous le plafond) | — |
| `classer_territoires` | ≤ 100 | non (`LIMIT` ramené entre 1 et 100) | — |
| `smart_demographie_top_villes` | ≤ 300 | non (corpus de 300 villes) | — |
| `compte_poi_par_categorie` | ≤ catégories demandées (5 en base) | non | — |

> **Ce test existe depuis le 2026-09-16 :
> `tests/unit/db/troncature-postgrest.test.ts`.** Il croise les `.rpc('…')` de
> `app/` et `lib/` avec les `CREATE FUNCTION` de `sql/` et
> `supabase/migrations/`, et exige de CHAQUE fonction tabulaire appelée une
> borne écrite — soit démontrable (`borne`), soit inexistante et alors
> obligatoirement nommée **dans ce document** (`dette`). On ne peut donc pas
> faire taire le verrou sans écrire la dette là où quelqu'un la relira.
>
> Il a trouvé le défaut C dès sa première exécution : quatre correctifs
> ponctuels n'avaient pas empêché le cinquième cas, et aucun humain n'était
> allé regarder du côté du rapport de fin de campagne.

## Défaut A — la météo efface l'outre-mer — CORRIGÉ le 2026-10-10 (sql/243)

> **Corrigé.** Mesure du 2026-10-10 sur la base locale : `max_rows` y vaut
> 1 000 et mord AUSSI les RPC tabulaires — `get_zone_centroids('cp')` rendait
> **1 000** centroïdes sur 6 187, pas 5 000. `/api/meteo-geo` lit désormais
> `get_zone_centroids_jsonb` (jumelle `RETURNS jsonb`, l'originale devient une
> enveloppe mince que plus rien n'appelle) : la bbox est filtrée EN BASE par
> l'index GIST, la borne (10 000) est écrite et `tronque` la dit. Et **le
> repli « pas de zone → France entière » a disparu** : une vue sans code
> postal rend « Aucun code postal dans la zone affichée. ». Verrous :
> `tests/integration/zone-centroids-jsonb.test.ts`,
> `tests/unit/api/plafond-lectures-carte.test.ts`. Le texte qui suit décrit
> le défaut tel qu'il était.

**`app/api/meteo-geo/route.ts:258`**, via `get_zone_centroids('cp')`.

6 187 codes postaux demandés, 5 000 rendus. Et **les 136 codes ultramarins
sont tous dans la queue perdue** — mesuré, pas supposé : l'ordre de la
fonction les place en fin de liste.

Ce n'est pas une absence, et c'est ce qui le rend grave. Quand la bbox
demandée ne rend aucune zone, la route **retombe sur la France entière**. Une
carte cadrée sur La Réunion n'affiche donc pas « aucune donnée » : elle
affiche la météo de la métropole. L'utilisateur lit un chiffre faux sans
aucun signe que quelque chose a échoué.

C'est le **quatrième effacement de l'outre-mer** rencontré sur ce chantier,
après le `97` fantôme de la tâche 6, l'amputation de Mayotte par
simplification en 13A, et le piège inversé du filtre France. Les trois autres
ont été trouvés parce qu'on les cherchait. Celui-ci ne l'a été par aucune des
seize tâches.

**Correction attendue :** jumelle `RETURNS jsonb` de `get_zone_centroids` sur
le patron sql/168-169 (jumelle porteuse de la logique + originale réduite à
une enveloppe mince, pour qu'aucune des deux ne puisse dériver). Et surtout :
**le repli « pas de zone → France entière » doit disparaître ou devenir
visible**. Un repli silencieux qui substitue un territoire à un autre est pire
que l'erreur qu'il prétend masquer.

## Défaut B — la carte santé environnementale est incomplète — CORRIGÉ le 2026-10-10 (sql/244-245)

> **Corrigé.** `health-map?scale=cp` lit tout en UN appel à
> `lire_sante_cp_jsonb` (sql/244 : date, seuil, bbox par le centroïde du CP,
> borne écrite, `tronque`) et n'appelle plus `codes_postaux_dans_bbox`. Son
> autre appelant, `/api/analyses/score` (bbox d'une zone enregistrée — les
> plus grandes en couvrent 6 165), lit la jumelle `codes_postaux_dans_bbox_jsonb`
> (sql/245) ; l'originale devient une enveloppe mince que plus rien
> n'appelle. Mesuré ce jour-là : en local, `max_rows` = 1 000 mord aussi les
> RPC tabulaires — la fonction rendait **1 000** CP sur 6 051, pas 5 000. Le
> texte qui suit décrit le défaut tel qu'il était.

**`app/api/civic-indicators/health-map/route.ts:133`**, via
`codes_postaux_dans_bbox`.

6 051 codes postaux dans la bbox métropole, 5 000 rendus. La choroplèthe
pollen/ATMO est donc incomplète, en silence, sur environ un code postal sur
six.

Circonstance aggravante : **`sql/147:24` cite cette mesure**. Le chiffre
« 5 000 rendus pour 6 051 réels » est écrit dans nos propres migrations depuis
le 13 septembre, comme argument justifiant un autre correctif — et personne
n'est remonté au consommateur de cette fonction. Nous avions la mesure, la
conclusion, et nous ne l'avons pas appliquée là où elle valait aussi.

**Correction attendue :** même patron de jumelle `RETURNS jsonb`.

## Défaut C — le bilan exécutif est écrit sur moins de 2 % des données — CLOS PAR RETRAIT le 2026-10-12

> **Clos sans correctif, par suppression de l'appelant.** Le 2026-10-12, le
> chantier « suppression de toute l'IA » (lot 3) a retiré la route
> `final-report` et le composant `FinalReport` : le bilan exécutif était
> rédigé par Gemini. `get_strategy_comparison_data` n'a plus aucun appelant
> dans `app/` ni `lib/`, et sort donc du verrou de
> `tests/unit/db/troncature-postgrest.test.ts`. La fonction reste en base
> (liste des objets IA remise au propriétaire). **Si un bilan de fin de
> campagne revient un jour, la leçon ci-dessous tient** : l'agrégat se calcule
> en base, il ne transite pas ligne à ligne.

**`app/api/bidding/strategies/[id]/final-report/route.ts:80`**, via
`get_strategy_comparison_data`.

Trouvé le 2026-09-16 par `tests/unit/db/troncature-postgrest.test.ts`, à sa
première exécution — c'est-à-dire par le contrôle automatique que ce document
réclamait, et non par une relecture humaine de plus.

La fonction
(`supabase/migrations/20260503_fix_get_strategy_comparison_country_join.sql`)
rend **une ligne par ligne de `dsp_campaign_data`** pour la campagne de la
stratégie : pas de `GROUP BY`, pas de `LIMIT`, et ses deux arguments de date
(`p_date_from`, `p_date_to`) sont passés `undefined` par son unique appelant.
Une campagne réelle porte **280 000 lignes** (incident du 08/04). PostgREST en
rend 5 000.

Ce qui en sort n'est pas une erreur : c'est le **bilan exécutif Gemini de fin
de campagne** — impressions réelles contre simulées, dépense, leads, écart au
plan — calculé sur moins de 2 % des lignes puis présenté comme le résultat de
la campagne. Le rapport est partiel, plausible, et signé.

Et l'ordre des lignes conservées n'est pas garanti : selon le plan choisi par
PostgreSQL, c'est un sous-ensemble arbitraire de dates ET de codes postaux.
Aucune lecture du rapport ne peut le deviner.

**Correction attendue :** deux choses, pas une.
1. La jumelle `RETURNS jsonb`, patron sql/154 / 168-169 / 170 — mais elle ne
   suffit pas : faire transiter 280 000 lignes en JSON pour les agréger en
   TypeScript est la famille d'incident du 08/04.
2. **L'agrégation appartient à la base.** Le bilan n'a besoin que de totaux et
   d'un découpage par code postal — ce que produisent déjà
   `refresh_campaign_rollups` et `campaign_cp_rollup`. La bonne correction est
   une RPC qui rend l'agrégat, pas la fonction actuelle rendue non tronquée.

> **Mesure du 2026-10-10, contre le vrai plafond :** les deux stratégies en
> base portent **306 150** et **174 780** lignes ; PostgREST en rend
> **1 000** — 0,3 % de la première. Laissé ouvert ce jour-là, à dessein : la
> « même jumelle jsonb » que les autres ferait transiter 306 150 lignes en JSON
> (la famille de l'incident du 08/04), et la route est un bilan Gemini, dans
> le périmètre de la suppression de l'IA en attente d'arbitrage. La bonne
> correction reste le point 2 ci-dessus : l'agrégat en base.

## Dette D — `count_emetteurs_par_radio` : sous le plafond, pas par construction

**`app/api/radio/stations/route.ts:56`**. Une ligne par radio AYANT au moins
un émetteur (`GROUP BY radio_id` sur `emetteur_radio_stations`, sql/078).
**861** lignes le 2026-10-10 : pas de troncature aujourd'hui. Mais la table
`radios` en compte **1 175** ; le jour où plus de 1 000 d'entre elles ont un
émetteur, la liste des radios affiche « 0 émetteur » pour les dernières, en
silence. **Correction le moment venu :** jumelle `RETURNS jsonb`, ou un
`count` filtré par les ids de la page affichée (la route n'en montre que
quelques-unes).

## Dette E — `get_zone_radius_targets` : une ligne par poche, sans LIMIT

**`app/api/custom-geo/[id]/export/route.ts:232`** (export `tiktok_geo`).
Fonction **créée hors migrations** (aucun `CREATE` dans `sql/`), d'où son
absence du test jusqu'au 2026-10-10. Une ligne par polygone disjoint de la
zone (`ST_Dump`), sans `LIMIT` : **565** au plus sur les zones en base. Une
zone faite de plus de 1 000 poches — un seuil sur 1 500 CP disjoints en
produit — perdrait des rayons de ciblage TikTok, sans erreur. **Correction le
moment venu :** la versionner dans `sql/` en jumelle `jsonb` + enveloppe.

## Ce qui doit accompagner les correctifs

Une correction de plus ne vaut rien sans ce qui empêche la suivante. Au
minimum :

1. ~~**Une règle dans `CLAUDE.md`**~~ — **FAIT le 2026-09-16** : section
   « Troncature PostgREST », au même rang que les autres règles d'I/O. Toute
   RPC appelée par l'application dont le résultat peut dépasser le plafond
   (écrit 5 000 à l'époque, **1 000** depuis le 2026-10-10) est
   `RETURNS jsonb` ; la forme `RETURNS TABLE` reste réservée aux résultats
   bornés par construction, et le patron jumelle + enveloppe y est écrit.
2. ~~**Un test qui balaie**~~ — **FAIT le 2026-09-16** :
   `tests/unit/db/troncature-postgrest.test.ts`. Un contrôle automatique plutôt
   que la discipline — c'est déjà la doctrine du projet pour la dérive
   documentaire (`tests/unit/docs/derive-documentation.test.ts`).
3. ~~**Le repli silencieux de `meteo-geo`**~~ — **FAIT le 2026-10-10** avec
   sql/243 : aucune zone dans la vue rend une erreur dite, plus la France
   entière.

4. ~~**Le bon plafond**~~ — **FAIT le 2026-10-10** : `CLAUDE.md`, ce fichier,
   `lib/supabase/lire-tout.ts` et le test disent 1 000, et le test lit
   `max_rows` dans `supabase/config.toml` au lieu de le supposer.

Les dettes D et E restent ouvertes (A et B corrigés le 2026-10-10, C clos
par retrait de son appelant le 2026-10-12) : ce fichier les recense, il ne les corrige pas. Le test les
tient inscrits — retirer l'un d'eux de ce document sans corriger la fonction
fait échouer la suite.
