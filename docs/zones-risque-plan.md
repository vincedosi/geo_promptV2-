# Jeu de zones de risque et branchement campagne — audit et plan

> **Phase 0 de `docs/PROMPT.md`** (mission du 2026-09-20). Audit demandé avant
> tout code, puis plan de fichiers et de migrations.
>
> Tout ce qui est chiffré ici a été **mesuré sur la base locale le 2026-09-20**,
> jamais repris d'un document.

---

## Décision préalable : où vont les migrations

Le brief dit « Migrations via le MCP Supabase ». **Je ne suis pas cette
consigne**, pour la deuxième fois et pour la même raison qu'hier.

Le MCP Supabase ne parle qu'au projet hébergé `vkkdbygwbrxyogqosten`, que
Vincent supprime. `CLAUDE.md` § « LE LOCAL D'ABORD » est explicite depuis le
2026-09-18 : tout travail de développement passe par `psql` dans le conteneur.
C'est la situation exacte qui a produit l'incident du 2026-09-18, où sql/179 a
été appliquée en production parce qu'une règle survivante à son contexte
commandait le mauvais geste.

Le brief dit aussi « compute Nano ». Le compute est **Micro** — mesuré le
2026-09-13, `ARCHITECTURE.md` § Budget I/O le documente. Les contraintes d'I/O
restent appliquées telles quelles : le palier a changé, pas la prudence.

---

## 0. Les quatre symptômes, reproduits

Avant d'expliquer, j'ai reproduit. Les quatre constats du brief sont exacts, et
**ils viennent tous du seed que j'ai livré hier**.

| Symptôme | Mesure du 2026-09-20 |
|---|---|
| « 2 000 codes postaux sans plan défini » | `campaign_cp_rollup` : 2 000 lignes, **0 avec `planned_share`**, 2 000 sans |
| Alignement 100/100 avec 0 conforme | `calculer_alignement_geo` rend `score: 100`, `conformes_pct: 0.0`, `sous_pression: 0`, `sur_pression: 0`, `calculable: true` |
| Volumes irréalistes | **1 196 332 538 impressions** en 30 jours ; dv360 **7,06 €**, regie_locale **7,06 €**, tiktok **7,07 €** de CPM |
| « La dernière actualisation a échoué » | `get_campaign_suivi` rend `{"error": "no_strategy"}` |

---

## 1. Comment un plan de campagne est défini aujourd'hui

### 1.1 La chaîne, de bout en bout

```
dsp_campaigns
     │  (campaign_id)
     ▼
bidding_strategies            ← UNE stratégie par campagne, la plus récente
     │  in_zone_weights->>'variable_code'   → la VARIABLE du plan
     │  (strategy_id)
     ▼
bidding_zone_configs          ← UNE ligne par CODE POSTAL
     │  bid_multiplier numeric(6,3)
     │  is_active boolean
     ▼
refresh_campaign_rollups()
     │  planned_share = bid_multiplier / SUM(bid_multiplier) OVER ()
     ▼
campaign_cp_rollup.planned_share
```

**Le plan est donc un multiplicateur d'enchère par code postal, normalisé en
part.** Il n'existe aucune autre source : pas de table de plan, pas de fichier,
pas de champ sur la campagne.

Corollaire mesuré : `refresh_campaign_rollups` cherche
`bidding_strategies WHERE campaign_id = … ORDER BY created_at DESC LIMIT 1`.
Ma campagne de démo n'en a aucune, donc `planned_share` reste NULL sur ses
2 000 lignes — et tout ce qui en découle s'effondre en silence.

### 1.2 D'où vient « Taux d'abstention (prés. 2022) »

Le libellé vient de `cible_indicator_registry` :

```
indicator_code        | label                          | unit
abstention_pres_2022  | Taux d'abstention (prés. 2022) | %
```

Le CODE, lui, vient de `bidding_strategies.in_zone_weights->>'variable_code'`.
La campagne de démonstration des élections le porte :

```json
{"mode": "by_insee_variable", "variable_code": "abstention_pres_2022",
 "curve": [{"x":20,"y":0.63},{"x":30,"y":1},{"x":45,"y":1.6}]}
```

### 1.3 CE QUI EST EN DUR — la réponse à la question du brief

**`abstention_pres_2022` est écrit en dur à DEUX endroits**, et c'est ce qui
fait apparaître « taux d'abstention » sur une campagne qui n'a rien à voir :

| Endroit | Forme |
|---|---|
| `alignement_par_maille_geo` (sql/165) | `p_variable_code text DEFAULT 'abstention_pres_2022'` — un défaut de **signature SQL** |
| `app/api/campaigns/[campaignId]/alignement/maille/map/route.ts:62` | `const VARIABLE_DEFAUT = 'abstention_pres_2022'` |

Sont en dur également, côté écran :

- `components/campagne/suivi-v2/TrioCartes.tsx:134` — le sous-titre
  « La variable qui a servi à bâtir le plan. » Faux quand aucun plan n'existe,
  et faux dans son vocabulaire quand le plan sera un jeu de zones.
- `TrioCartes.tsx:102` — `aria-label="Choisir un autre indicateur pour la
  variable du plan"`, et le sélecteur d'indicateurs lui-même : il n'a aucun sens
  pour un plan qui ne repose pas sur une variable INSEE.
- `GraphiqueEcart.tsx:133` — « du plus lourd au plus léger dans le plan ».

**La carte du milieu** est servie par
`/api/campaigns/[id]/alignement/maille/map`, qui joint `indicator_cp_values`
sur `p_variable_code`. Sans stratégie, elle peint donc l'abstention — une
variable que personne n'a choisie, sur une campagne qui n'en parle pas.

---

## 2. Pourquoi l'alignement vaut 100/100, et pourquoi l'actualisation échoue

### 2.1 Le 100/100 : le score est parfait PARCE QU'il n'y a pas de plan

Lecture ligne à ligne de `calculer_alignement_geo` (sql/165, corrigée sql/172),
avec `planned_share` NULL partout :

```sql
part_plan  = max(r.planned_share)                     -- NULL
t_part     = sum(part_plan)                           -- NULL
plan_imps  = (part_plan / nullif(t_part,0)) * t_reel  -- NULL

manque = sum(greatest(0, plan_imps*(1-tol) - reel))
         FILTER (WHERE plan_imps > 0)   -- prédicat NULL → AUCUNE ligne → NULL
trop   = sum(greatest(0, reel - plan_imps*(1+tol)))
         -- ⚠ GREATEST IGNORE les NULL : greatest(0, NULL) = 0 → somme = 0

score = greatest(0, round(100 - coalesce(manque,0)/t_reel*100
                              - poids*coalesce(trop,0)/t_reel*100))
      = 100 - 0 - 0 = 100
```

**Zéro écart à un plan qui n'existe pas.** Les deux `coalesce(…, 0)` sont
corrects pris isolément — ils protègent du cas « aucune sous-pression » — mais
ils transforment « incalculable » en « parfait ».

Le garde-fou posé par sql/172 teste `n_cp = 0` ou `impressions_totales <= 0`.
Ici `n_cp` vaut 2 000 et les impressions 1,2 Md : **les deux conditions sont
fausses**, et la fonction se déclare `calculable: true`.

**La contradiction est visible dans le payload lui-même** : `score: 100` et
`conformes_pct: 0.0`. Un score parfait suppose que tous les CP sont conformes ;
zéro conforme suppose un score nul. Les deux ne peuvent pas être vrais ensemble
— c'est l'invariant que le test Vitest de la phase 1 doit verrouiller.

Il manque donc une troisième condition : **la couverture du plan**, soit le
nombre de CP portant un `planned_share` non nul. Elle vaut 0 ici.

### 2.2 L'actualisation : `no_strategy`

`get_campaign_suivi('d0000000-…-f1a5')` rend `{"error": "no_strategy"}`.

`components/campagne/suivi-v2/SuiviV2.tsx:259` pose
`erreurEcran = erreurAlignement || erreurMaille || erreurSuivi`, et la ligne 515
affiche « La dernière actualisation a échoué — les chiffres affichés datent
d'avant. »

**Ce n'est pas une panne, et le message ment deux fois** : rien n'a échoué, et
les chiffres ne datent pas d'avant. La campagne n'a simplement pas de stratégie
de bidding. `refresh_campaign_rollups` fonctionne, vérifié :
`{"as_of":"2026-09-18","cp_rows":2000,"daily_rows":90}`.

Il n'y a donc **rien à réparer dans l'actualisation** : il y a un état métier
— « campagne sans plan » — présenté comme une erreur technique.

### 2.3 Les volumes du seed, et pourquoi les trois CPM se ressemblent

1 196 332 538 impressions viennent de mon générateur :
`population × 0,9 × bruit × facteur`, par CP et par jour, sur les 2 000 CP les
plus peuplés (~44 M d'habitants) × 30 jours.

Les CPM identiques ont une cause plus intéressante : le CPM était
`5,0 + 2,0 × bruit`, où `bruit` est tiré par **(code postal, jour)**. Moyenné
sur 20 000 lignes par acteur, le bruit converge vers sa moyenne (1,0) et les
trois acteurs valent tous 5 + 2 = **7 €**. Un bruit qui varie sur un axe
qu'on agrège ensuite ne crée aucune différence : la variation doit porter sur
l'axe qu'on veut distinguer, ici l'ACTEUR.

---

## 3. L'entrée « Zones » : réutiliser ou créer ?

### 3.1 Ce qu'elle fait aujourd'hui

`lib/navigation/config.ts:111` déclare `{ id: 'zones', label: 'Zones',
tooltip: 'Ce que je fabrique', type: 'panneau-gauche' }`, `Alt+4`.
`app/map/_components/panneaux/PanneauZones.tsx` (137 lignes) monte « Mes zones »
(`ZonesOverlay`) et le modal de capture, sur la table `custom_geo_zones`.

Contenu réel : **7 zones**, `composite` (3), `indicator_threshold` (3),
`isochrone_battle` (1).

### 3.2 `custom_geo_zones` ne peut pas porter un jeu de zones

| Ce qu'un jeu de zones exige | `custom_geo_zones` |
|---|---|
| Plusieurs géométries CLASSÉES (haut:pprt, haut:1…bas:2) | **une seule** `geometry(MultiPolygon,4326)` |
| Un multiplicateur d'enchère PAR CLASSE | aucun champ |
| Un profil de rayons versionné | `source_metadata` jsonb, non typé, non validé |
| Une liste de CP avec classe dominante et part couverte | `feature_count_cp` — un COMPTE, pas une liste |

**Donc : à créer.** Mais pas en ignorant l'existant.

### 3.3 La décision, et sa justification

**`zone_sets` + `zone_set_geoms` + `zone_set_cp`**, comme le brief le demande,
**et** l'enregistrement d'une ligne `custom_geo_zones` miroir (union des classes,
`source_type = 'zone_set'`) à la sauvegarde.

Pourquoi le miroir : toute la plomberie d'export DSP existante part de
`custom_geo_zones` — `/api/custom-geo/[id]/export`,
`/api/admin/dsp/dv360/zones/push`, le plan média. Sans lui, un jeu de zones
serait un objet de plus qui ne sait parler à personne ; avec lui, il hérite de
six routes déjà écrites et testées.

⚠ **Le miroir est une PROJECTION, jamais la source.** La classe, les poids et
le profil vivent dans `zone_sets` ; `custom_geo_zones` n'en voit que l'union.
Écrire dans le miroir ne doit jamais remonter vers le jeu.

### 3.4 Ce qui existe déjà de la veille, et son sort

Le chantier d'hier a livré `zones_risque_cache (profil_code, classe, niveau,
bande, geom, geom_3857, surface_km2)` — la forme exacte de `zone_set_geoms`, à
la clé près.

**Les deux coexistent, et ce n'est pas un doublon** :

- `zones_risque_cache` est un **cache anonyme par profil**, vidé par
  `vider_zones_risque()`. Il sert la couche de tuiles pendant qu'on règle les
  anneaux.
- `zone_set_geoms` est une **copie figée**, attachée à un jeu nommé.

Un plan enregistré ne doit pas changer sous une éviction de cache. C'est
exactement le raisonnement de `strategie_versions.charge_utile`, que
`ARCHITECTURE.md` décrit comme « l'état complet, indépendant de l'état courant
de `bidding_strategies` ». On le reprend plutôt que de l'inventer.

---

## 4. Schéma réel des tables de campagne et de plan

| Table | Grain | Ce qu'il faut savoir |
|---|---|---|
| `dsp_campaigns` | la campagne | `is_demo` existe, avec index partiel. `geo_strategy` jsonb porte `channels` et `media_plan`, **pas** le plan géographique |
| `bidding_strategies` | 1 par campagne (la plus récente gagne) | `granularity` défaut `'postal_code'`, `weighting_mode`, `in_zone_weights` jsonb, `status`, `is_demo` |
| `bidding_zone_configs` | **campagne × CODE POSTAL** | `bid_multiplier numeric(6,3)`, `is_active`. UNIQUE `(strategy_id, postal_code, country_code)` |
| `dsp_campaign_data` | campagne × date × CP × ville × média × **acteur** | ⚠ `idx_dsp_data_unique` porte **SIX** expressions. Non inférable par `onConflict` : DELETE ciblé + INSERT |
| `campaign_cp_rollup` | campagne × CP × **acteur** | ⚠ un CP y apparaît jusqu'à 5 fois. **Sommer avant tout calcul.** `planned_share` y est répété par acteur — mesuré : `sum(planned_share) = 5.0` sur la campagne élections |

**La maille d'achat est le CODE POSTAL**, confirmée à trois endroits :
`bidding_zone_configs.postal_code`, `bidding_strategies.granularity` et
`campaign_cp_rollup`.

C'est ce qui rend le bloc « Dilution CP » du brief indispensable : un anneau de
1 km est très inférieur à un code postal, et le DSP ne sait pas acheter plus
fin.

---

## 5. La couche des sites et les tuiles MVT

Tout ceci a été livré hier et n'est pas à refaire.

| Élément | Où | Forme |
|---|---|---|
| Sites ICPE | `app/map/_components/RisqueIndustrielLayer.tsx` | **GeoJSON**, pas MVT. Trois couches : zone calculée (tiretée), halo, point |
| Périmètres PPRT | `PprtLayer.tsx` | GeoJSON, trait plein, plancher z8 |
| Zones de profil | `ZonesRisqueLayer.tsx` | **MVT**, `/api/tiles/zones-risque/{z}/{x}/{y}?profil=<code>`, plancher z4 |
| Tuile | `zones_risque_tuile` (sql/205) | `ST_AsMVT`, `ST_SimplifyPreserveTopology`, gzip obligatoire |

Mesures du 2026-09-19 : tuile brute z4 **43 ko** (la France entière), z7 5,0 ko,
z10 943 o. Construction d'un profil : **1 326 ms** pour 7 classes.
Exclusivité géométrique vérifiée — 0 recouvrement entre classes.

⚠ La couche doit rester enregistrée dans `lib/carte/degrades.ts`
(`'zones-risque'`), sans quoi elle s'empile avec les huit autres choroplèthes.

---

## 6. Plan de fichiers et de migrations

### 6.1 Migrations

| Migration | Contenu |
|---|---|
| `sql/209_plan_couverture.sql` | **Phase 1.** Ajoute `plan_couverture` (CP avec plan / CP total) à `calculer_alignement_geo` et le garde-fou `plan_absent`. Patron jumelle + enveloppe si le type de retour bouge |
| `sql/210_zone_sets.sql` | `zone_sets`, `zone_set_geoms`, `zone_set_cp` + index GIST, RLS deny-all |
| `sql/211_construire_zone_set.sql` | Fige un profil en jeu : géométries par classe et table CP (population en zone, part du CP, classe dominante, `retenu`) |
| `sql/212_plan_depuis_zone_set.sql` | Génère `bidding_zone_configs` depuis `zone_set_cp`, modes `exclusif` et `pondere` |
| `sql/213_metadonnees_plan.sql` | Source des libellés du Suivi : `variable` ou `zone_set`, avec le libellé et l'unité à afficher |

### 6.2 Logique pure (testée sans base)

| Fichier | Rôle |
|---|---|
| `lib/risques/profil.ts` | **existe** — `ProfilRayons`, Zod, `ANNEAUX_MAX` |
| `lib/risques/affectation.ts` | **existe** — la règle d'affectation unique, croisée TS ⇔ SQL |
| `lib/risques/code-profil.ts` | **existe** — sert de `profil_hash` (réversible, sans collision) |
| `lib/zones/jeu.ts` | *neuf* — `JeuDeZones`, Zod, `mode_plan`, `seuil_couverture_cp`, poids par classe |
| `lib/zones/plan.ts` | *neuf* — génération du plan CP dans les deux modes, **fonction pure** |
| `lib/campagne/source-plan.ts` | *neuf* — d'où vient le plan, et les libellés qui en découlent |

### 6.3 Routes

Neuves : `/api/zones/jeux` (GET/POST), `/api/zones/jeux/[id]` (GET/DELETE),
`/api/zones/jeux/[id]/dupliquer`, `/api/zones/jeux/[id]/export`,
`/api/zones/jeux/[id]/rattacher`, `/api/tiles/zone-set/[z]/[x]/[y]`.

**Supprimées** : `/api/risques/diffusion` et son hook — l'onglet Diffusion part
avec (phase 3). `/api/risques/profil/export` est **conservé** : il exporte le
profil et ses bandes, pas la diffusion.

### 6.4 Interface

Neufs : `components/zones/OngletZones.tsx`, `ComparateurRayons.tsx`,
`PanneauClasses.tsx`, `BlocDilutionCp.tsx`, `ListeJeuxZones.tsx`,
`app/map/_components/ZoneSetLayer.tsx`.

Supprimés : `components/risques/OngletDiffusion.tsx`, `use-diffusion.ts`.

Modifiés : `AnalysePopulationOverlay.tsx` (onglet 3), `PanneauZones.tsx`
(liste des jeux), `TrioCartes.tsx` et `GraphiqueEcart.tsx` (libellés depuis les
métadonnées), `SuiviV2.tsx` (bloc « Pression par classe », message d'état).

---

## 7. Trois arbitrages que je tranche, et pourquoi

**Le message « actualisation échouée » devient un état métier.** Il n'y a rien
à réparer : `refresh_campaign_rollups` fonctionne. Une campagne sans stratégie
doit lire « cette campagne n'a pas encore de plan », pas « la dernière
actualisation a échoué ». Le brief demande « corrige l'échec, ou expose l'erreur
réelle » — l'erreur réelle est qu'il n'y en a pas.

**Le sélecteur d'indicateur du Suivi disparaît pour un plan « jeu de zones ».**
Il propose de changer la variable qui a bâti le plan ; sur un plan de zones,
cette variable n'existe pas. Le laisser afficherait un choix sans effet.

**Le seuil de couverture CP par défaut reste à 20 %**, comme le brief le fixe,
mais l'écran affichera toujours le **taux d'utile** à côté — population exposée
rapportée à la population des CP retenus. C'est le seul chiffre qui dit ce que
le seuil coûte, et il doit voyager avec le plan jusqu'au rattachement.

---

## 8. Ce que je vérifie à chaque phase

`npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run catalogue`,
et `EXPLAIN ANALYZE` sur toute nouvelle requête PostGIS.

⚠ **Sans pipe.** `npx tsc --noEmit | head -3` rend le code de retour de `head`,
jamais celui de `tsc` : le commit `adc6257` d'hier annonce « tsc propre » et ne
l'était pas.
