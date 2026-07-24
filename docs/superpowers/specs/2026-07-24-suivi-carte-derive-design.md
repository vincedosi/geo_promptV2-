# Spec — Suivi : sous-onglet « Carte de dérive »

> Date : 2026-07-24 · Statut : design validé (brainstorm), à relire avant plan
> Feature parente : [[Suivi vue par acteur]] (mergé main 641b643)

## 1. Problème

Le cockpit de suivi actuel est **département-first** (tableau dept → drill CP). Pour piloter,
un media planner doit **voir en quelques minutes OÙ la campagne dérive géographiquement**,
à la maille qu'il choisit, sur une **vraie carte de France** (métropole + Corse + DROM-COM),
puis exporter cette vue. Aujourd'hui il n'y a ni vue cartographique dédiée dans le suivi, ni
lecture « dérive » lisible d'un coup d'œil, ni maille réglable.

## 2. Objectif V1

Un **sous-onglet « Carte de dérive »** dans le Suivi qui, en une vue :
1. montre une **carte composée** France + Corse + DROM-COM (une seule carte MapLibre, zoomable) ;
2. laisse **choisir la maille** — National → Région → Département → CP — via le sélecteur signature
   « Grain » (piste segmentée ; la carte se re-agrège au niveau choisi) ;
3. colore chaque zone par un **score de dérive** avec bascule **dérive relative / atteinte absolue** ;
4. laisse **régler le seuil de décrochage** (curseur) qui définit à partir de quand une zone
   « décroche » → pilote couleurs + tableau + compteur « N zones décrochent », **sans refetch** ;
5. affiche le **tableau des zones qui dérivent** (pire d'abord) synchronisé à la maille ;
6. permet l'**export PNG** de la carte.

**Décision de design (brainstorm, maquettes `.superpowers/brainstorm/606-*/content/`)** : le « truc »
MAGELIAN = le sélecteur de maille « Grain » (piste segmentée National/Région/Département/CP) qui
re-agrège la **vraie carte** ; pas un glyphe schématique. Style dans le design system (flat, teal,
mono, zéro glow/gradient/violet) ; la signature vient de l'interaction/transition, pas d'effets.

## 3. Hors V1 (→ V1.1 / après)

- **Choix de palettes multiples** (V1 = une palette « dérive divergente » par défaut).
- **Filtres avancés** (« on verra après » — V1 garde le filtre acteurs existant, hérité du suivi).
- Sync **bidirectionnelle** carte ↔ tableau (V1 = clic ligne → vol/surbrillance carte, unidirectionnel).
- **Tendance de dérive dans le temps**.

## 4. Score de dérive (2 lectures, bascule)

Agrégés depuis `campaign_cp_rollup` (grain CP) jusqu'à la maille M choisie. `planned_share`
(part planifiée) est sommé sur les CP de M ; la délivrance est filtrée par acteur (héritage suivi).

- **Dérive relative** (défaut) = `(imps livrées de M / total livré) / (part planifiée de M) × 100`.
  Centré 100 = « M reçoit sa juste part ». **Isole la dérive géographique du retard global** :
  si toute la campagne est à 80 %, tout est ~100 (vert) ; une zone sous-servie décroche (rouge).
  Base = la métrique `hold` déjà exposée par `get_campaign_suivi_map`.
- **Atteinte absolue** = `imps livrées de M / (part planifiée de M × objectif global attendu) × 100`.
  Mélange retard global + dérive géo (toute la France ambre si campagne en retard). Base = `objectif`.
- Sous **filtre acteur partiel**, l'atteinte absolue devient une contribution trompeuse → même
  règle que le bloc objectif du suivi : masquer/neutraliser « atteinte absolue » en filtre partiel,
  garder « dérive relative » (réutilise `hiddenUnderPartialActors`, cf. SuiviMapLayer).

## 5. Seuil de décrochage

- Curseur (plage ~50–100 %, défaut 80). Une zone **décroche** si `score < seuil`.
- **Appliqué côté client** : les features portent la valeur brute du score → bouger le curseur
  **recolore la carte + recompte le tableau/compteur SANS appel réseau** (instantané, zéro I/O Nano).
- Couleurs (palette divergente V1) : `< seuil` rouge (décroche) · `seuil–100` ambre · `~100` vert ·
  `> 110` teal (sur-livré). Le curseur déplace la frontière rouge.

## 6. Mailles & géométrie (l'infra existe)

| Maille | Géométrie source | Agrégation rollup | Notes |
|--------|------------------|-------------------|-------|
| National | `france_borders` | tout | 1 forme → sert de KPI de tête (score global), pas une choroplèthe |
| Région | `ref_regions.geom` | CP → région via ref | 13 zones |
| Département | `ref_departements.geom` | CP → dépt via ref (**codes 971-976**, PAS `LEFT(cp,2)`) | ~101 zones, DROM éclatés |
| CP | `ref_codes_postaux.geom_simplified` | grain natif | borné/bbox (anti-12k) |

- **DROM-COM** : `ref_departements`/`ref_regions` incluent 971-976 (géométries réelles, dispersées).
  Pour la **carte composée**, chaque DROM est **repositionné en inset** (`ST_Translate`/`ST_Scale`
  vers un emplacement fixe près de l'hexagone) côté RPC → une seule `FeatureCollection` cohérente,
  DROM cliquables/zoomables dans la même carte. Corse (2A/2B) = géométrie réelle, aucun traitement.
- **Correctif donnée** : l'agrégation département des nouvelles RPC dérive le code dépt via les tables
  ref (3 chiffres pour l'outre-mer) et non `LEFT(cp,2)` → plus de faux « 97 ». Le tableau dept
  existant du suivi (`get_campaign_suivi.depts`, qui collapse encore en « 97 ») reste inchangé en V1
  et est noté comme correctif de suivi (hors périmètre, pour ne pas retoucher une RPC vérifiée).

## 7. Architecture

### 7.1 UI — sous-onglet dans le Suivi

- `CampaignSuivi` gagne une **barre de sous-onglets** : « Vue d'ensemble » (cockpit/tableau/acteurs/
  réconciliation actuels, inchangés) et « Carte de dérive » (nouveau). État local `subTab`.
- Nouveau composant **`SuiviDeriveMap`** (`components/campaign/suivi/SuiviDeriveMap.tsx`), autonome
  dans le panneau (ne se sert PAS du canvas /map — carte MapLibre embarquée dans le sous-onglet,
  pour être self-contained et exportable). Sous-composants :
  - `MeshSelector` — la piste « Grain » (National/Région/Département/CP), teal, animée.
  - Bascule score `[Dérive relative | Atteinte absolue]`.
  - Curseur seuil de décrochage + compteur « N zones décrochent ».
  - Carte MapLibre embarquée (`preserveDrawingBuffer: true` pour l'export), choroplèthe + insets DROM.
  - `DeriveTable` — « top zones qui dérivent » à la maille courante, pire d'abord, borné.
  - Bouton **Export PNG**.
- Réutilise les palettes/légende de `SuiviMapLayer` (tokens CSS lus au runtime) et le filtre acteurs
  (héritage : `selectedActors`, `parseActorsParam`, `hiddenUnderPartialActors`).

### 7.2 Données — nouvelles RPC (SECURITY DEFINER, service_role only)

- **`get_campaign_derive_map(p_campaign_id, p_mesh text, p_metric text, p_actors text[], bbox…)`**
  → `FeatureCollection` `{code, nom, in_target, value, geometry}` à la maille `p_mesh`
  (`region|departement|cp`), agrégée depuis `campaign_cp_rollup`, jointe à la géométrie ref,
  DROM repositionnés en insets. `value` = score brut (relatif ou absolu selon `p_metric`).
  Pour `cp` : borné/bbox comme `get_campaign_suivi_map` (dont il généralise la logique).
- **`get_campaign_derive_ranked(p_campaign_id, p_mesh, p_metric, p_actors, p_limit)`**
  → zones triées score croissant (pire d'abord) à la maille : `{code, nom, value, impressions,
  in_target}`. Région/dépt = toutes ; CP = top `p_limit` (~50). Anti-12k respecté.
- **`get_campaign_derive_headline(p_campaign_id, p_metric, p_actors)`** (ou champ du map RPC) →
  score national global (KPI de tête du niveau National).

### 7.3 Routes API (requireAuth + checkCampaignAccess + no-store)

- `GET /api/digital/[campaignId]/derive/map?mesh=&metric=&bbox=&actors=`
- `GET /api/digital/[campaignId]/derive/ranked?mesh=&metric=&actors=&limit=`
- (headline peut être embarqué dans la réponse map). `?actors=` via `parseActorsParam` (existant).

## 8. Flux de données

1. Ouverture du sous-onglet → fetch `map` + `ranked` à la maille par défaut (Département) et métrique
   par défaut (dérive relative), filtre acteurs courant.
2. **Changer de maille / métrique / acteurs** → refetch `map` + `ranked` (cachés par
   `campagne|maille|métrique|acteurs` dans une ref, comme `suiviCacheRef`), débounce, max 3 //.
3. **Bouger le seuil** → **aucun fetch** : recolore la carte (expression MapLibre recalculée sur la
   valeur brute) + recompte le tableau/compteur côté client.
4. **Clic ligne tableau** → vol + surbrillance de la zone sur la carte.
5. **Export PNG** → `map.getCanvas().toDataURL()` (+ bandeau titre/légende) → téléchargement.

## 9. Contraintes Nano / perf

- Seuil = 100 % client-side (0 I/O). Région/dépt = 13/101 lignes (négligeable). CP = borné + bbox +
  `geom_simplified`. Cache par clé, débounce, `no-store`, jamais > 3 requêtes //.
- `EXPLAIN ANALYZE` obligatoire sur les 2-3 nouvelles RPC (agrégation rollup + join ref + ST_Translate).
- Carte embarquée sans fond de tuiles lourd si possible (polygones sur fond sombre) pour un export net.

## 10. Gestion d'erreur & états

- Pas de stratégie/rollup → sous-onglet en empty state (« suivi disponible pour les campagnes pilotées »).
- Erreur RPC → toast + carte/tableau vides, pas de crash.
- Code sans géométrie ref → feature ignorée (pas d'entrée fantôme).
- Filtre partiel + « atteinte absolue » → option neutralisée (cohérence avec le suivi).

## 11. Tests

- **RPC** : vérif EN BASE (EXPLAIN + valeurs) — agrégation correcte par maille, DROM en 971-976,
  score relatif/absolu, insets DROM présents, borne CP respectée. Non-régression : `p_actors` NULL.
- **TS purs** : helper de recolore/décompte seuil (pure), enum maille/métrique, format score. Vitest.
- **Navigateur** : maille change la choroplèthe + tableau ; seuil recolore sans réseau ; DROM visibles
  et cliquables ; export PNG produit une image ; filtre acteurs propagé ; 0 erreur console.

## 12. Réutilisation (ne pas réinventer)

- `SuiviMapLayer` : palettes divergentes, lecture tokens runtime, expression fill — à généraliser.
- `get_campaign_suivi_map` : logique CP/score → base de `get_campaign_derive_map` (maille=cp).
- `get_zone_polygons` / `get_admin_filter_geometry` / `ref_*` : géométrie par échelle.
- `parseActorsParam`, `actorsKey`, `hiddenUnderPartialActors` : filtre acteurs (héritage suivi).
- Pattern route : `app/api/digital/[campaignId]/suivi/map/route.ts`.
