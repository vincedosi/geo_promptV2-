# Design — Zones cibles : l'étape Cible du setup campagne

> Date : 2026-07-07 · Statut : validé (approche A, périmètre V1)
> Concept validé avec Vincent : « une zone cible = une zone géo qui a un seuil »,
> seuil dans l'unité naturelle de l'indicateur, cibles dynamiques posées en début
> de vague et révisables (l'agent IA se souvient de la règle).

## 1. Concept

**Une zone cible = une définition + un snapshot.**

- **Définition** : une source de données + (pour les indicateurs) un opérateur et
  un seuil fixés par le planner, exprimés dans l'unité naturelle de l'indicateur
  (% abstention, part 15-24, °C, niveau pollen 0-6). Sur- OU sous-représentation
  (`>=` / `<=`).
- **Snapshot** : la géométrie matérialisée à la pose (début de vague), datée.
- Les cibles **statiques** (socio-démo, isochrones, zones perso) ne bougent pas.
  Les **dynamiques** (météo, pollen/ATMO) sont révisables en cours de vague ;
  l'agent IA connaît la définition (pas seulement la géométrie) — V2.

**Support de stockage : les zones custom existantes** (aucune nouvelle table).
La définition vit dans `source_metadata` :

```json
{ "kind": "indicator_threshold",
  "indicator": "part_15_24",
  "operator": ">=",
  "threshold": 22,
  "unit": "%",
  "scale": "iris",
  "materialized_at": "2026-07-07T10:00:00Z" }
```

Une **zone composite** (sélection multiple fusionnée) porte
`{ "kind": "composite", "member_zone_ids": [...] }` — les définitions membres
restent lisibles individuellement.

## 2. Registre des indicateurs ciblables

Le registre IRIS existant (`iris_indicator_registry` : key/dataset/label/type)
n'a ni unité ni bornes. On ajoute une **fiche de ciblage** par indicateur
(nouvelle table `cible_indicator_registry`, dynamique — jamais de liste
hardcodée) :

| Champ | Exemple |
|---|---|
| `indicator_code` | `part_15_24` |
| `label` | Part des 15-24 ans |
| `famille` | `audience` \| `comportement` \| `contexte` \| — |
| `unit` | `%`, `°C`, `niveau`, `€` |
| `slider_min` / `slider_max` / `slider_step` | 0 / 50 / 0.5 |
| `default_operator` | `>=` |
| `data_source` | `iris.<col>` \| `pollen_map_daily` \| `atmo_map_daily` |
| `scale` | `iris` \| `cp` |
| `dynamic` | false (socio-démo) / true (pollen, ATMO, météo) |
| `active` | visibilité dans le catalogue |

Peuplée par migration depuis le registre IRIS + pollen/ATMO. Familles du
catalogue : **Audience** (socio-démo INSEE), **Comportement** (abstention…),
**Contexte** (pollen, ATMO — badge « dynamique » ; météo = V2), **Mes zones**
(galerie custom-geo existante : isochrones, battle, dessins…).

## 3. UI — l'étape Cible du wizard (fusion Cible + Zones)

Le wizard passe de 5 à **4 étapes** : Cible · Budget · Stratégie · Lancement.
L'ancienne étape Zones (national / zone custom) fusionne dans Cible.

Parcours :
1. **Catalogue** par familles (+ « National » = pas de restriction géo, comportement actuel).
2. Choix d'un indicateur → **slider adapté** (unité, bornes, pas de la fiche) +
   opérateur ≥/≤.
3. **Aperçu en direct** (debounced) : « 2 314 IRIS · 4,1 M habitants » — COUNT
   uniquement, jamais de géométrie à ce stade.
4. « Ajouter à la cible » → matérialise la zone custom, nommée automatiquement
   (ex. « Part 15-24 ≥ 22 % — juil. 2026 »), visible aussi dans la galerie.
5. Le panier de cibles (1..n : indicateurs matérialisés + zones de la galerie)
   → si n > 1, fusion en **zone composite** à la validation de l'étape.
6. La stratégie reçoit `scope_type='custom_zone'` + `zone_id` = zone unique ou
   composite. **Aucun changement du moteur de bidding** (1 zone + courbes,
   comme aujourd'hui). L'intensité (courbes doux/marqué/fort) reste dans l'étape
   Cible, inchangée.

Design system : dark minimal, tokens `var(--…)`, sliders/inputs conformes
DESIGN_SYSTEM.md, sentence case, pas d'exemple de marque.

## 4. Backend & contraintes Nano

- **Nouvelle RPC `get_indicator_threshold_selection`**
  `(p_indicator, p_operator, p_threshold, p_scale, p_preview boolean)` →
  en preview : `{ count, population }` seul ; sinon : liste de codes (cap
  10 000, tri par valeur décroissante/croissante selon l'opérateur pour tronquer
  proprement). Filtre `is_true_iris = true` pour l'échelle IRIS.
  `EXPLAIN ANALYZE` obligatoire ; index à créer si seq scan sur colonne ciblée.
  SECURITY DEFINER + service_role only + `set search_path` (pattern 098/099).
- **Nouvelle route `POST /api/custom-geo/source/indicator-threshold`**
  (pattern des routes source existantes : requireAuth, Zod, maxDuration ≤ 15) :
  résout les codes via la RPC puis réutilise la chaîne de matérialisation
  existante (`get_iris_selection_geometry` pour l'échelle IRIS ;
  `get_admin_filter_geometry` à l'échelle CP — la même que la source météo).
  Écrit la définition dans `source_metadata`.
- **Composite** : `POST /api/custom-geo/source/composite` — union des
  géométries des `member_zone_ids` (RPC bornée, même clip France que les
  sources actuelles).
- Pollen/ATMO : seuil directement sur `pollen_map_daily` / `atmo_map_daily`
  (par CP, ~6 200 lignes/jour — trivial).
- Aperçu : 1 seule requête par mouvement de slider (debounce 400 ms), COUNT
  indexé. Jamais plus de 3 appels Supabase parallèles.

## 5. Périmètre

**V1 (ce spec)**
- Table registre + peuplement (socio-démo IRIS actives + abstention + pollen + ATMO).
- RPC seuil + route source indicator-threshold + route composite.
- Étape Cible refondue (catalogue, slider, aperçu, panier, composite), retrait
  de l'étape Zones, wizard à 4 étapes.
- Prefill édition : re-programmation d'une stratégie existante recharge la
  sélection depuis la zone/composite.

**V2 (hors périmètre, préparé par le modèle)**
- Re-matérialisation en cours de vague : bouton « Recalculer » + recommandation
  de l'agent (système `agent_recommendations` existant) quand la condition d'une
  cible dynamique a bougé.
- Météo prévisionnelle (Open-Meteo) comme indicateur `contexte`.
- Historique des snapshots d'une définition.
- Poids/budget par cible membre (aujourd'hui : plan média zones custom).

## 6. Erreurs & bords

- Sélection seuil vide (0 zone) → bouton « Ajouter » désactivé + message.
- Cap 10 000 codes atteint → message explicite « seuil trop large, resserre »
  (pas de troncature silencieuse côté UI).
- Échec matérialisation → toast erreur, panier inchangé.
- Composite d'une seule zone → pas de composite, on référence la zone directe.
- Suppression d'une zone membre d'un composite référencé par une stratégie :
  interdite (409) tant que la stratégie est active.

## 7. Tests

- Vitest : logique de nommage auto, construction du payload composite,
  validation Zod des routes, mapping fiche registre → props slider.
- `EXPLAIN ANALYZE` documenté dans la migration pour chaque colonne ciblable.
- Navigateur : parcours complet (catalogue → slider → aperçu → matérialiser →
  composite → lancement stratégie) sur la campagne démo.
