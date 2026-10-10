# Suite — trois troncatures PostgREST vivantes en production

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

**PostgREST tronque à 5 000 lignes TOUTE fonction `RETURNS TABLE`, sans
erreur, sans avertissement, sans en-tête.** L'appelant reçoit un tableau
parfaitement valide de 5 000 éléments et n'a aucun moyen de savoir qu'il en
manquait 1 187.

Le projet l'a maintenant rencontré **cinq fois** :

| # | Où | Découvert | Corrigé |
|---|---|---|---|
| 1 | `correlation_campagne_indicateur` | 2026-09-13 | sql/154 (jumelle `RETURNS jsonb`) |
| 2 | `codes_postaux_du_perimetre` | 2026-09-15 | sql/168 + sql/169 (jumelle + enveloppe) |
| 3 | `calculer_score_composite` | 2026-09-15 (relecture finale) | sql/170 (jumelle + enveloppe) |
| 4 | `get_zone_centroids` et `codes_postaux_dans_bbox` | 2026-09-15 (relecture finale) | sql/243 (A), sql/244-245 (B) — 2026-10-10 |
| 5 | `get_strategy_comparison_data` | 2026-09-16, **par le test de famille** | **ouvert — défaut C ci-dessous** |

Ce n'est plus un piège, c'est une propriété de la plateforme. Le correctif
ponctuel ne suffit plus : il faut un test qui balaie les fonctions
`RETURNS TABLE` appelées par l'application et signale celles qui peuvent
dépasser 5 000 lignes.

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

## Défaut C — le bilan exécutif est écrit sur moins de 2 % des données

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

## Ce qui doit accompagner les correctifs

Une correction de plus ne vaut rien sans ce qui empêche la suivante. Au
minimum :

1. ~~**Une règle dans `CLAUDE.md`**~~ — **FAIT le 2026-09-16** : section
   « Troncature PostgREST », au même rang que les autres règles d'I/O. Toute
   RPC appelée par l'application dont le résultat peut dépasser 5 000 lignes
   est `RETURNS jsonb` ; la forme `RETURNS TABLE` reste réservée aux résultats
   bornés par construction, et le patron jumelle + enveloppe y est écrit.
2. ~~**Un test qui balaie**~~ — **FAIT le 2026-09-16** :
   `tests/unit/db/troncature-postgrest.test.ts`. Un contrôle automatique plutôt
   que la discipline — c'est déjà la doctrine du projet pour la dérive
   documentaire (`tests/unit/docs/derive-documentation.test.ts`).
3. ~~**Le repli silencieux de `meteo-geo`**~~ — **FAIT le 2026-10-10** avec
   sql/243 : aucune zone dans la vue rend une erreur dite, plus la France
   entière.

Le défaut C reste ouvert (A et B corrigés le 2026-10-10) : ce fichier les recense, il ne les
corrige pas. Le test les tient inscrits — retirer l'un d'eux de ce document
sans corriger la fonction fait échouer la suite.
