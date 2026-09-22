# Conversion zones → codes postaux, et simulation de campagne — audit

> Audit demandé par la Phase 0 de `docs/PROMPT CARTE .md`, mené le **2026-09-22**.
> Tous les chiffres sont **mesurés sur la base locale ce jour-là**, pas repris
> d'une documentation. Le protocole du document dit « arrête-toi et attends
> mon go » : ce fichier est ce point d'arrêt.

---

## 0. Ce qui bloquait, et qui est réparé

Deux prérequis du chantier étaient **absents en données**, sans que rien le
signale. Découverts en auditant, réparés avant d'écrire la suite.

| | État au matin du 22/09 | Après réparation |
|---|---|---|
| `carreau_risque_distance.code_postal` | **0 / 883 451** renseignés | **883 451 / 883 451** |
| `cp_population_totale` | **0 ligne** | 6 000+ codes postaux |

**Même cause pour les deux, et c'est la troisième fois qu'on la rencontre** :
une fonction SQL existe, elle marche, et **aucun script ne la pilote**
(`remplir_code_postal_carreau`, `remplir_cp_population_totale` — comme
`construire_carreau_risque_nature` le matin même). Une fonction sans pilote
n'est pas une étape de reconstruction : c'est une étape qu'on oublie.

Les deux sont désormais des étapes de `scripts/local/11-reconstruire.sh`, et
`12-sante.sh` les vérifie. ⚠ Il vérifie aussi le **remplissage de la colonne**
et pas seulement le compte de lignes : `carreau_risque_distance` affichait
883 451 lignes « en vert » pendant que sa colonne `code_postal` était vide sur
la totalité.

---

## 1. Géométries des codes postaux

**Elles existent** : `ref_codes_postaux`, **6 187 lignes**, géométrie et
centroïde renseignés sur toutes. Index GIST sur `centroid`. Pas besoin de
reconstruire quoi que ce soit par union de communes.

⚠ **Mais elles ne pavent pas le territoire et se recouvrent.** Mesuré lors de
la construction d'`unite_population_totale` (sql/221) : les contours postaux se
recouvrent sur **~14 % des carreaux**. Conséquence directe : un prorata dont le
numérateur vient du carroyage et le dénominateur des contours postaux **ne veut
rien dire**. C'est pour cela que :

- `cp_population_totale` (sql/207) attribue chaque carreau à **UN SEUL** code
  postal — celui dont le centroïde est le plus proche ;
- ⛔ **`carreaux_cp_population` ne doit PAS être utilisée** : mesurée le 19/09,
  elle totalise **74 876 618 habitants** contre 67 760 552 réels (**+10,5 %**),
  parce qu'un carreau y est compté dans chaque contour qui le recouvre.

**Communes à plusieurs CP et CP à plusieurs communes** : la question ne se pose
pas au niveau des communes, puisqu'on ne passe jamais par elles. La règle est
« un carreau, un code postal », appliquée deux fois avec la MÊME méthode
(`carreau_risque_distance.code_postal` et `cp_population_totale`), ce qui rend
numérateur et dénominateur cohérents par construction.

**Outre-mer** : Martinique et La Réunion sont couvertes. Guadeloupe, Guyane et
Mayotte n'ont **aucun carreau** — l'INSEE ne les carroie pas. Leurs sites
existent et leur population exposée n'est pas calculable : donnée absente à la
source, pas un zéro.

---

## 2. Rattachement carreau 200 m → code postal

**Il existe déjà** : colonne `carreau_risque_distance.code_postal`, posée par
sql/206, index partiel `idx_crd_code_postal`. Remplie le 22/09 en **9 lots de
100 000**, ~6 à 8 s par lot, **une minute au total**.

**3 934 codes postaux distincts** portent au moins un carreau exposé.

Aucun scan complet de `carreaux_filosofi` n'est nécessaire : le croisement a été
payé une fois, il est en colonne.

---

## 3. Tables du jeu de zones

`zone_set_cp` existe et porte **déjà** la moitié de ce que la Phase 2 demande :

| Colonne existante | Ce que la Phase 2 appelle |
|---|---|
| `code_postal` | code_postal |
| `classe` | classe dominante |
| `pop_en_zone` | population_exposee |
| `pop_totale` | population_totale_cp |
| `part_en_zone` | taux_exposition |
| `retenu` | retenu |
| — | **`cluster_id` (à créer)** |
| — | **`poids` (à créer)** |

**PK actuelle : `(zone_set_id, code_postal)`.** Index `idx_zone_set_cp_retenu`.

---

## 4. Décision : une ligne par zone — et ses trois conséquences

**Arbitrage de Vincent, 2026-09-22 : un CP à cheval sur plusieurs zones porte
UNE LIGNE PAR ZONE.** C'est le choix qui dit la vérité : un code postal peut
servir deux bassins industriels, et l'écraser en une ligne perdrait
l'information.

Trois conséquences en découlent, et la troisième n'est pas évidente.

**a) La clé primaire change** : `(zone_set_id, code_postal)` →
`(zone_set_id, code_postal, cluster_id)`. Migration à écrire.

**b) Le PLAN doit agréger, parce que le DSP ne sait pas lire deux poids.**
`bidding_zone_configs` a pour clé `(strategy_id, postal_code, country_code)` :
**un multiplicateur par code postal**, pas un par zone. `genererPlanCp` devra
donc sommer les lignes d'un même CP :

> poids du CP = Σ sur ses zones de (population exposée dans la zone ×
> multiplicateur de la classe)

Ce qui reste fidèle au principe du document — le plan est une part de
population **exposée** — tout en rendant un seul nombre par CP.

**c) ⚠ Le seuil de rétention se décide sur le CP, jamais sur la ligne.**
Un code postal exposé à 12 % par la zone A et à 15 % par la zone B est exposé
à **27 %** : ligne par ligne, le seuil de 20 % l'écarterait **deux fois**,
alors qu'il doit être retenu. `appliquer_seuil_zone_set` (sql/215) devra donc
grouper par code postal avant de trancher. C'est le piège principal de cette
décision.

---

## 5. Composants du Suivi réutilisables

| Composant | Réutilisable ? |
|---|---|
| `calculer_alignement_geo` (sql/165, 172, 209) | ⚠ **Partiellement** — voir ci-dessous |
| `alignement_par_maille`, `..._geo` | oui, même patron |
| `alignement_dispersion_cp` | oui |
| « Ce qu'il faut corriger » (`lib/campagne/constats.ts`) | oui, constantes exportées |
| « Qui a diffusé » (`get_campaign_actors`) | oui |
| Palette divergente, `trancheDivergente` | oui |

⚠ **Le score d'alignement existant se calcule sur `campaign_cp_rollup.planned_share`,
pas sur la population exposée.** Le document demande un alignement « calculé sur
la population EXPOSÉE » : c'est un **second dénominateur**, donc un nouveau
score, pas un réemploi. À trancher avant la Phase 5.

✅ **Le « taux d'abstention codé en dur » est déjà corrigé** (20/09, sql/216) :
`source_plan` + `part_plan_pct` font qu'un plan issu d'un jeu de zones
n'affiche plus de variable d'indicateur. Rien à faire de ce côté.

---

## 6. Tables de campagne et contraintes

- `dsp_campaign_data` : index d'unicité d'**EXPRESSION à SIX termes**
  (`campaign_id`, `date`, `postal_code`, `city`, `media`, **`actor`**, en
  `COALESCE`). ⚠ Non inférable par `onConflict` PostgREST : pour un écrivain
  idempotent, faire **DELETE ciblé + INSERT**, jamais un upsert.
- Pré-agrégation obligatoire avant insertion, lots de 50.
- `campaign_cp_rollup` : PK (campagne × CP × **acteur**) — un CP y apparaît
  jusqu'à cinq fois, toute lecture doit sommer d'abord.
- Le flag « simulation » demandé par la Phase 5 : `dsp_campaigns.is_demo`
  existe déjà et sert exactement à ça.

---

## 7. Corrections à apporter au document lui-même

| Ligne du document | Réalité mesurée le 22/09 |
|---|---|
| « Migrations via le MCP Supabase » | ⛔ **Faux et risqué** : le projet hébergé est supprimé et le MCP pointe sur un AUTRE compte (une org, un projet `HOTARU` sans rapport). La voie est `psql` dans le conteneur. |
| « compute Nano » | Micro — et le projet hébergé n'existe plus. Les règles d'I/O tiennent pour le budget local ; leur justification, non. |
| « corriger les libellés *taux d'abstention* » | Déjà fait le 20/09. |
| « Table `zone_set_cp` (compléter si elle existe) » | Elle existe et porte déjà 5 des 7 colonnes. |
| « si aucune géométrie CP propre n'existe » | Elles existent (6 187), mais se recouvrent — voir § 1. |

---

## 8. Plan de fichiers et de migrations

**Phase 1 — clusters**
`sql/224_zone_set_clusters.sql` : table + `ST_ClusterIntersecting` par
`profil_hash`, index GIST sur `geom_3857`.

**Phase 2 — conversion CP**
`sql/225_zone_set_cp_par_cluster.sql` : PK élargie, colonnes `cluster_id` et
`poids`, seuil groupé par CP (§ 4c). `lib/zones/plan.ts` : agrégation au CP
(§ 4b), fonction pure, testée.

**Phase 3 — vue double**
`components/risques/CarteRisque.tsx` : seconde instance montée **à côté**, on
bascule sa **visibilité** (`visibility: hidden`, jamais `display: none`).
⚠ Ne pas démonter/remonter la carte permanente : c'est une décision explicite
de l'architecture, prise parce que la remonter fait perdre fond, tuiles et
position à chaque aller-retour ② ↔ ③. À mesurer avant de s'engager : deux
instances MapLibre sur une VM WSL plafonnée à 3 Go.

**Phase 4 — extraction**
`sql/226_zone_set_extractions.sql`, route d'export via `exceljs` (déjà au
projet).

**Phase 5 — simulation**
`lib/simulation/` pur et testé, graine fixe. ⚠ **Générateur LOCAL** : décision
du 22/09, `modal/bidding_ml/` n'est pas branchable (voir `ARCHITECTURE.md`
§ « Modal n'est PAS branchable »).

**Phase 6 — finitions** : états vides, formats français, Vitest, `catalogue`.

---

## 9. Ce qui n'est PAS tranché et attend un arbitrage

1. **Le score d'alignement sur population exposée** est un nouveau score
   (§ 5). Le construire à côté de l'existant, ou généraliser l'existant avec un
   dénominateur paramétrable ?
2. **Le coût mémoire de la seconde carte** (§ 8, Phase 3) n'est pas mesuré.
3. **Le nom automatique d'un cluster** (« commune du site le plus peuplé »)
   demande une population par commune du site : disponible via
   `iris_agg_commune`, à confirmer.
