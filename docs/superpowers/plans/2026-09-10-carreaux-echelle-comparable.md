# Carreaux — échelle de couleurs comparable

> ⚠️ **AMENDEMENT (2026-09-10, après livraison) — ce plan ne décrit plus ce qui a été fait.**
> Il cible `components/CarreauxPMTilesLayer.tsx` et une échelle **linéaire** sur
> des percentiles `p5`/`p95` recalculés côté client. En cours d'implémentation,
> une ronde 2 a tout remplacé :
> - `CarreauxPMTilesLayer.tsx` n'est **jamais monté** (composant mort, non
>   supprimé — cf. `docs/known_tech_debt.md`, section Ouvert). La couche
>   carreaux réellement affichée vit dans `app/copilote/_hooks/useMapLayers.ts`
>   + `app/map/_components/filter-panel/CarreauxSection.tsx`.
> - L'échelle n'est plus linéaire mais **logarithmique** (base 10) : des
>   percentiles viewport `p5`/`p95` linéaires saturaient 78,7 % des carreaux de
>   France en maille 200 m (voir mesure dans `lib/carreaux/bornes.ts`).
> - Les bornes ne s'appellent plus `p5`/`p95` mais `min`/`max` : elles ne sont
>   ni un percentile symétrique, ni mesurées sur le même palier de zoom (`min`
>   vient du palier 5 km le plus grossier, `max` du palier 200 m le plus fin —
>   p99,9 pour les effectifs, p95 pour les deux moyennes). Un nom de percentile
>   aurait été faux dans les deux sens.
>
> Un futur relecteur qui implémenterait ce plan tel qu'écrit referait exactement
> le défaut de la ronde 1 (échelle linéaire, saturation massive). La source de
> vérité du comportement livré est `lib/carreaux/normalisation.ts` et
> `lib/carreaux/bornes.ts`, pas ce document.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire qu'une couleur donnée sur la carte des carreaux désigne toujours la même réalité, quel que soit le zoom et la zone affichée.

**Architecture :** Le défaut est que l'échelle de couleurs est *relative au viewport* — `CarreauxPMTilesLayer` recalcule p5/p95 sur `queryRenderedFeatures()` à chaque déplacement. On corrige en deux volets indépendants : (1) rendre les **valeurs** comparables entre paliers de zoom, en normalisant chaque indicateur par le bon dénominateur ; (2) rendre les **bornes** stables, en remplaçant les percentiles du viewport par des quantiles nationaux pré-calculés. La logique de normalisation vit dans un module pur testable ; la carte et la tuile ne font que la consommer.

**Tech Stack :** PostGIS (`get_tile`, MVT), MapLibre GL JS 5.18, React, Vitest.

**Spec :** ce document. Constats mesurés le 2026-09-10, reproduits ci-dessous.

## Constats mesurés (à ne pas re-dériver)

**1. L'échelle est relative au viewport.** `components/CarreauxPMTilesLayer.tsx:173` :
`queryRenderedFeatures()` → `p5`/`p95` → `buildColorExpression(p5, p95)`, rappelé
à chaque `moveend` (débounce 200 ms, `scheduleColor`).

**2. La cascade de zoom change l'ordre de grandeur.** RPC `get_tile` : z≥10 →
`carreaux_filosofi` 200 m ; z 8-9 → `carreaux_2km` ; z≤7 → `carreaux_5km`.
Même emprise (Paris, bbox `2.25,48.81,2.42,48.91`) :

| Source | Carreaux | Pop. médiane | Pop. max |
|---|---|---|---|
| `carreaux_2km` | 49 | **57 310** | 143 789 |
| `carreaux_filosofi` 200 m | 3 105 | **814** | 4 714 |

Médiane **×70** en franchissant z9→z10.

**3. Deux indicateurs sont des sommes affichées comme des moyennes.** Sur un
carreau 200 m de 748 habitants et 336 ménages :

| Champ | Valeur brute | ÷ dénominateur | Libellé actuel dans l'UI |
|---|---|---|---|
| `ind_snv` | 11 941 181 | **15 964** (÷ `ind`) | « Revenu médian (€) » |
| `men_surf` | 25 024 | **74** (÷ `men`) | « Surface moyenne (m²) » |

L'interface affiche donc aujourd'hui « Revenu médian : 11 941 181 € ».

## Global Constraints

- **Supabase Nano** : pas de full scan sur `carreaux_filosofi` (2 298 582 lignes).
  `EXPLAIN ANALYZE` obligatoire sur toute nouvelle requête PostGIS.
- **Migrations** : via MCP Supabase (`apply_migration`) uniquement, jamais de SQL
  manuel. Fichier miroir versionné dans `sql/NNN_*.sql`.
- **Types générés** : régénérer `types/database.types.ts` après chaque migration,
  puis restaurer l'en-tête documentaire (le générateur ne le produit pas).
- **MVT** : gzip obligatoire sur les réponses (MapLibre 5.x plante sans).
- **Design system** : aucune couleur en dur dans les styles React/CSS,
  `var(--token)` uniquement. **Exception cartographique** : les expressions de
  peinture MapLibre (`COLOR_STOPS`, `fill-color`) sont evaluees par le moteur de
  rendu, qui ne resout pas les variables CSS — elles restent en hex litteral.
- **Pas de valeurs en dur** : la liste des indicateurs reste pilotée par
  `CARREAUX_INDICATEURS`.
- Fichiers protégés, ne pas toucher : `app/api/isochrone-battle/route.ts`,
  fonctions PostGIS `battle_*`, `middleware.ts`.

---

### Task 1 : Classification et normalisation des indicateurs (module pur)

Le cœur du correctif, isolé en fonctions pures pour être testable sans carte ni base.

**Files:**
- Create: `lib/carreaux/normalisation.ts`
- Test: `tests/unit/carreaux/normalisation.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type ClasseIndicateur = 'effectif' | 'moyenne'`
  - `function classeDe(id: string): ClasseIndicateur`
  - `function denominateurDe(id: string): 'superficie_km2' | 'population_totale' | 'menages_total'`
  - `function normaliser(valeur: number, denominateur: number): number | null`
  - `function uniteNormalisee(id: string, uniteBrute: string): string`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// tests/unit/carreaux/normalisation.test.ts
import { describe, it, expect } from 'vitest';
import { classeDe, denominateurDe, normaliser, uniteNormalisee } from '@/lib/carreaux/normalisation';

describe('classeDe', () => {
  it('classe les effectifs de population, ménages et logements', () => {
    expect(classeDe('population_totale')).toBe('effectif');
    expect(classeDe('ind_18_24')).toBe('effectif');
    expect(classeDe('menages_pauvres')).toBe('effectif');
    expect(classeDe('logements_sociaux')).toBe('effectif');
  });

  it('classe comme moyennes les deux sommes Filosofi mal nommées', () => {
    expect(classeDe('revenu_median')).toBe('moyenne');
    expect(classeDe('surface_moyenne')).toBe('moyenne');
  });
});

describe('denominateurDe', () => {
  it('divise les effectifs par la superficie', () => {
    expect(denominateurDe('population_totale')).toBe('superficie_km2');
    expect(denominateurDe('logements_sociaux')).toBe('superficie_km2');
  });

  it('divise ind_snv par la population et men_surf par les ménages', () => {
    expect(denominateurDe('revenu_median')).toBe('population_totale');
    expect(denominateurDe('surface_moyenne')).toBe('menages_total');
  });
});

describe('normaliser', () => {
  it('divise la valeur par le dénominateur', () => {
    // Carreau 200 m = 0,04 km² ; 814 habitants -> 20 350 hab/km²
    expect(normaliser(814, 0.04)).toBeCloseTo(20350, 0);
  });

  it('rend un carreau 200 m et un carreau 2 km comparables', () => {
    const dense200m = normaliser(814, 0.04);      // 0,04 km²
    const dense2km  = normaliser(57310, 4);       // 4 km²
    // Meme territoire : les densites doivent etre du meme ordre, pas x70.
    const rapport = Math.max(dense200m!, dense2km!) / Math.min(dense200m!, dense2km!);
    expect(rapport).toBeLessThan(2);
  });

  it('retourne null sur un dénominateur nul ou négatif plutôt que Infinity', () => {
    expect(normaliser(100, 0)).toBeNull();
    expect(normaliser(100, -1)).toBeNull();
  });
});

describe('uniteNormalisee', () => {
  it('suffixe les effectifs par km²', () => {
    expect(uniteNormalisee('population_totale', 'pers.')).toBe('pers./km²');
  });

  it('laisse l’unité intacte pour les moyennes', () => {
    expect(uniteNormalisee('revenu_median', '€')).toBe('€');
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run : `npx vitest run tests/unit/carreaux/normalisation.test.ts`
Expected : FAIL — `Cannot find module '@/lib/carreaux/normalisation'`

- [ ] **Step 3 : Écrire l'implémentation minimale**

```ts
// lib/carreaux/normalisation.ts
/**
 * @file lib/carreaux/normalisation.ts
 *
 * Rend les valeurs des carreaux comparables entre paliers de zoom.
 *
 * La cascade de `get_tile` sert des mailles de 200 m, 2 km ou 5 km selon le
 * zoom. Un effectif brut n'y est donc pas comparable : mesuré le 2026-09-10 sur
 * Paris, la population mediane passe de 57 310 (2 km) a 814 (200 m) — un facteur
 * 70 pour un seul cran de zoom. Rapporte a la surface, l'ecart disparait.
 *
 * Deux champs Filosofi font exception. `ind_snv` et `men_surf` sont des SOMMES
 * (somme des niveaux de vie winsorises, somme des surfaces de logements), que
 * l'interface presente en « Revenu median » et « Surface moyenne ». Les diviser
 * par la surface n'aurait aucun sens : leur denominateur naturel est le nombre
 * d'individus et le nombre de menages. Sans cette division, la carte affiche
 * aujourd'hui « Revenu median : 11 941 181 € ».
 */

/** Un effectif se rapporte a une surface ; une moyenne a son propre effectif. */
export type ClasseIndicateur = 'effectif' | 'moyenne';

/**
 * Indicateurs qui sont des sommes a moyenner par leur effectif, et non des
 * effectifs a rapporter a une surface. Table close : ce sont les deux seuls
 * champs Filosofi dans ce cas.
 */
const MOYENNES: Record<string, 'population_totale' | 'menages_total'> = {
  revenu_median:   'population_totale', // ind_snv  / ind
  surface_moyenne: 'menages_total',     // men_surf / men
};

export function classeDe(id: string): ClasseIndicateur {
  return id in MOYENNES ? 'moyenne' : 'effectif';
}

export function denominateurDe(
  id: string,
): 'superficie_km2' | 'population_totale' | 'menages_total' {
  return MOYENNES[id] ?? 'superficie_km2';
}

/**
 * @returns la valeur normalisee, ou `null` si le denominateur est inexploitable
 *          — un carreau sans habitant ne doit pas produire `Infinity`, qui
 *          contaminerait le calcul des bornes.
 */
export function normaliser(valeur: number, denominateur: number): number | null {
  if (!Number.isFinite(denominateur) || denominateur <= 0) return null;
  return valeur / denominateur;
}

export function uniteNormalisee(id: string, uniteBrute: string): string {
  return classeDe(id) === 'effectif' ? `${uniteBrute}/km²` : uniteBrute;
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run : `npx vitest run tests/unit/carreaux/normalisation.test.ts`
Expected : PASS, 8 tests.

- [ ] **Step 5 : Commit**

```bash
git add lib/carreaux/normalisation.ts tests/unit/carreaux/normalisation.test.ts
git commit -m "feat(carreaux): module de normalisation des indicateurs

Trois constats mesures le 2026-09-10 motivent ce module :
- la population mediane passe de 57 310 (maille 2 km) a 814 (maille 200 m)
  sur la meme emprise parisienne, soit x70 pour un cran de zoom ;
- ind_snv et men_surf sont des SOMMES affichees comme des moyennes — la carte
  annonce aujourd'hui « Revenu median : 11 941 181 € » ;
- les effectifs se rapportent a une surface, ces deux-la a leur effectif.

Fonctions pures, sans dependance carte ni base."
```

---

### Task 2 : `get_tile` émet la superficie du carreau

Le client ne peut pas déduire la surface : elle dépend du palier servi, que seul `get_tile` connaît.

**Files:**
- Create: `sql/122_get_tile_superficie.sql` (miroir versionné)
- Migration MCP : `get_tile_superficie`
- Modify: `types/database.types.ts` (régénéré)

**Interfaces:**
- Consumes: rien.
- Produces: chaque feature MVT porte `superficie_km2` (numeric), en plus des
  propriétés existantes.

- [ ] **Step 1 : Mesurer le coût avant modification**

Run (MCP `execute_sql`) :

```sql
explain (analyze, buffers)
select st_asmvt(q, 'carreaux', 4096, 'geom') from (
  select st_asmvtgeom(cf.geom_3857, st_tileenvelope(11, 1037, 704), 4096, 0, true) as geom,
         st_area(cf.geom::geography) / 1e6 as superficie_km2
  from carreaux_filosofi cf
  where cf.geom_3857 && st_tileenvelope(11, 1037, 704) and cf.resolution = '200m'
) q;
```

Noter le temps et les blocs lus. Si `ST_Area(geography)` dépasse ~200 ms sur une
tuile, préférer une constante par palier (200 m → 0.04, 2 km → 4, 5 km → 25),
la maille INSEE étant régulière.

- [ ] **Step 2 : Écrire la migration**

Reprendre la définition courante de `get_tile` (`pg_get_functiondef`) et ajouter
la colonne dans les **trois** branches, sans rien changer d'autre :

```sql
-- branche z >= 10, dans le SELECT interne
0.04::numeric AS superficie_km2,   -- maille INSEE 200 m
-- branche z 8-9
4::numeric AS superficie_km2,      -- maille 2 km
-- branche z <= 7
25::numeric AS superficie_km2,     -- maille 5 km
```

Constantes plutôt que `ST_Area` : la maille INSEE est régulière par
construction, et ça évite un calcul géodésique par carreau et par tuile.

- [ ] **Step 3 : Appliquer et vérifier que la tuile porte bien la propriété**

Appliquer via MCP `apply_migration`, puis :

```sql
select (jsonb_array_elements(
  (st_asgeojson(q.*)::jsonb)
)) from (select 1) q; -- remplacer par un decodage MVT si disponible
```

À défaut d'outil de décodage MVT en SQL, vérifier côté navigateur (Task 3, step 4).
Contrôle minimal ici : la fonction se recrée sans erreur et
`select get_tile(11, 1037, 704)` retourne un `bytea` non vide et de taille
comparable à avant (± 5 %).

- [ ] **Step 4 : Régénérer les types et restaurer l'en-tête**

```bash
# via MCP Supabase generate_typescript_types, puis :
head -12 types/database.types.ts   # verifier que l'en-tete documentaire est present
npx tsc --noEmit                   # attendu : 0 erreur
```

- [ ] **Step 5 : Commit**

```bash
git add sql/122_get_tile_superficie.sql types/database.types.ts
git commit -m "feat(tiles): get_tile emet superficie_km2 par carreau

Le client ne peut pas deduire la surface d'un carreau : elle depend du palier
servi (200 m / 2 km / 5 km), que seule la cascade de get_tile connait. Sans
elle, aucune normalisation en densite n'est possible cote carte.

Constante par palier plutot que ST_Area geodesique : la maille INSEE est
reguliere par construction, et le calcul par carreau et par tuile serait paye
a chaque requete pour un resultat connu d'avance."
```

---

### Task 3 : La carte colore sur la valeur normalisée

**Files:**
- Modify: `components/CarreauxPMTilesLayer.tsx` (`updateColors` ~ligne 170-190,
  `buildColorExpression` ~ligne 116, tooltip ~ligne 292)

**Interfaces:**
- Consumes: `classeDe`, `denominateurDe`, `normaliser`, `uniteNormalisee` (Task 1) ;
  la propriété `superficie_km2` des features (Task 2).
- Produces: la couche colore sur la densité ; le tooltip affiche la valeur
  normalisée avec la bonne unité.

- [ ] **Step 1 : Remplacer l'expression de couleur par une expression normalisée**

`buildColorExpression` doit diviser dans l'expression MapLibre elle-même — la
couleur est évaluée par le moteur, pas en JS :

```ts
function buildColorExpression(
  min: number,
  max: number,
  indicator: string,
): maplibregl.ExpressionSpecification {
  if (max <= min) {
    // Hex litteral et non `var(--token)` : une expression de peinture MapLibre
    // est evaluee par le moteur de rendu, qui ne resout pas les variables CSS.
    // La regle « pas de couleur en dur » du DESIGN_SYSTEM vise les styles
    // React/CSS, pas les palettes cartographiques — cf. COLOR_STOPS juste au-dessus.
    return ['to-color', '#FC9272'] as unknown as maplibregl.ExpressionSpecification;
  }
  const denom = denominateurDe(indicator);
  const range = max - min;
  const stops = COLOR_STOPS.flatMap(([t, color]) => [min + t * range, color]);
  // Valeur normalisee : effectif / superficie, ou somme / son effectif.
  // `max(denominateur, epsilon)` evite la division par zero cote GPU, ou il n'y
  // a pas de branchement possible.
  const valeurNormalisee = [
    '/',
    ['coalesce', ['get', indicator], 0],
    ['max', ['coalesce', ['get', denom], 0], 0.0001],
  ];
  return [
    'interpolate', ['linear'],
    valeurNormalisee,
    ...stops,
  ] as unknown as maplibregl.ExpressionSpecification;
}
```

- [ ] **Step 2 : Calculer p5/p95 sur les valeurs normalisées**

Dans `updateColors`, remplacer le `map` des valeurs brutes :

```ts
const ind   = indicatorRef.current;
const denom = denominateurDe(ind);
const values = features
  .map(f => {
    const p = f.properties as Record<string, unknown>;
    return normaliser(Number(p?.[ind] ?? 0), Number(p?.[denom] ?? 0));
  })
  .filter((v): v is number => v !== null && v > 0);
```

- [ ] **Step 3 : Corriger le tooltip**

Ligne ~292, la valeur brute est affichée telle quelle. La remplacer par la valeur
normalisée et l'unité correspondante, en s'appuyant sur `CARREAUX_INDICATEURS`
pour l'unité brute :

```ts
const meta   = CARREAUX_INDICATEURS.find(i => i.id === ind);
const brute  = Number(props[ind] ?? 0);
const den    = Number(props[denominateurDe(ind)] ?? 0);
const val    = normaliser(brute, den);
const texte  = val === null
  ? '—'
  : `${Math.round(val).toLocaleString('fr-FR')} ${uniteNormalisee(ind, meta?.unit ?? '')}`;
```

- [ ] **Step 4 : Vérifier dans le navigateur, des deux côtés du seuil**

```bash
npm run dev
```

Se connecter, ouvrir `/map` → Audience → Carreaux, indicateur « Population totale ».
Se placer sur Paris et traverser lentement **z9 → z10**.

Attendu : la carte garde le même aspect général de part et d'autre du seuil (la
finesse change, pas les couleurs). Sur `revenu_median`, le tooltip doit afficher
un ordre de grandeur de ~16 000 €, plus 11 941 181 €.

Contrôle console : 0 erreur. Un `interpolate` dont les bornes ne sont pas
strictement croissantes est rejeté **en silence** par MapLibre — si la couche
reste unie, vérifier `p5 < p95` avant de conclure à un problème de données.

- [ ] **Step 5 : Commit**

```bash
git add components/CarreauxPMTilesLayer.tsx
git commit -m "fix(carreaux): colorer sur la densite, pas sur l'effectif brut

Le saut z9->z10 (mediane x70) disparait : la valeur coloree est desormais
rapportee a la surface du carreau, donc comparable entre paliers.

La division se fait dans l'expression MapLibre et non en JS : la couleur est
evaluee par le moteur de rendu, feature par feature. `max(denominateur, 1e-4)`
protege la division cote GPU, ou aucun branchement n'est possible.

Le tooltip cesse aussi de mentir sur revenu_median et surface_moyenne, qui sont
des SOMMES Filosofi affichees comme des moyennes."
```

---

### Task 4 : Bornes nationales fixes, à la place des percentiles du viewport

Corrige le second volet : l'échelle ne doit plus dépendre de ce qui est à l'écran.

**Files:**
- Create: `sql/123_carreaux_bornes_nationales.sql`
- Create: `lib/carreaux/bornes.ts`
- Test: `tests/unit/carreaux/bornes.test.ts`
- Modify: `components/CarreauxPMTilesLayer.tsx` (`updateColors`)

**Interfaces:**
- Consumes: `denominateurDe`, `normaliser` (Task 1).
- Produces: `BORNES_NATIONALES: Record<string, { p5: number; p95: number }>`,
  et `bornesDe(id: string): { p5: number; p95: number }`.

- [ ] **Step 1 : Calculer les quantiles nationaux, une fois, sur le palier 5 km**

Le palier 5 km ne compte que 22 058 lignes : le calcul est instantané et sans
risque pour Nano, contrairement aux 2,3 M de carreaux 200 m. Les densités étant
désormais comparables entre paliers, les bornes calculées sur le 5 km valent
pour tous.

Run (MCP `execute_sql`) :

```sql
select 'population_totale' as indicateur,
       round(percentile_cont(0.05) within group (order by ind / 25.0)::numeric, 2) as p5,
       round(percentile_cont(0.95) within group (order by ind / 25.0)::numeric, 2) as p95
from carreaux_5km where ind > 0
union all
select 'menages_total',
       round(percentile_cont(0.05) within group (order by men / 25.0)::numeric, 2),
       round(percentile_cont(0.95) within group (order by men / 25.0)::numeric, 2)
from carreaux_5km where men > 0
union all
select 'revenu_median',
       round(percentile_cont(0.05) within group (order by ind_snv / nullif(ind,0))::numeric, 2),
       round(percentile_cont(0.95) within group (order by ind_snv / nullif(ind,0))::numeric, 2)
from carreaux_5km where ind > 0;
```

Répéter pour chaque `id` de `CARREAUX_INDICATEURS` (27 au total). Reporter les
résultats dans `lib/carreaux/bornes.ts` comme constantes commentées de leur date
de calcul.

- [ ] **Step 2 : Écrire le test des bornes**

```ts
// tests/unit/carreaux/bornes.test.ts
import { describe, it, expect } from 'vitest';
import { CARREAUX_INDICATEURS } from '@/components/CarreauxPMTilesLayer';
import { bornesDe, BORNES_NATIONALES } from '@/lib/carreaux/bornes';

describe('bornes nationales', () => {
  it('couvre tous les indicateurs du catalogue', () => {
    const manquants = CARREAUX_INDICATEURS
      .map(i => i.id)
      .filter(id => !(id in BORNES_NATIONALES));
    expect(manquants).toEqual([]);
  });

  it('a des bornes strictement croissantes — MapLibre rejette le contraire en silence', () => {
    for (const [id, b] of Object.entries(BORNES_NATIONALES)) {
      expect(b.p95, `${id} : p95 doit etre > p5`).toBeGreaterThan(b.p5);
    }
  });

  it('retourne un repli exploitable pour un indicateur inconnu', () => {
    const b = bornesDe('indicateur_inexistant');
    expect(b.p95).toBeGreaterThan(b.p5);
  });
});
```

- [ ] **Step 3 : Lancer le test, vérifier qu'il échoue**

Run : `npx vitest run tests/unit/carreaux/bornes.test.ts`
Expected : FAIL — module introuvable.

- [ ] **Step 4 : Écrire `lib/carreaux/bornes.ts` et brancher `updateColors`**

Dans `updateColors`, remplacer le calcul de percentiles par la lecture des
bornes, et supprimer l'appel à `queryRenderedFeatures` devenu inutile :

```ts
const { p5, p95 } = bornesDe(indicatorRef.current);
map.setPaintProperty(FILL_ID, 'fill-color', buildColorExpression(p5, p95, indicatorRef.current));
```

Conséquence à vérifier : `scheduleColor` n'a plus besoin d'être rappelé sur
`moveend` — seulement au changement d'indicateur. Retirer l'abonnement au
mouvement (ligne ~310), ce qui supprime aussi le débounce de 200 ms et un
`queryRenderedFeatures` par déplacement.

- [ ] **Step 5 : Vérifier au navigateur que le déplacement ne change plus les couleurs**

Se placer sur Paris à z10, noter la couleur d'un quartier dense. Se déplacer sur
une zone rurale **sans changer de zoom**. Attendu : la zone rurale est
uniformément pâle, et en revenant sur Paris le quartier a **exactement** la même
couleur qu'au départ. Avant ce correctif, la zone rurale se recolorait sur sa
propre plage et paraissait aussi contrastée que Paris.

- [ ] **Step 6 : Commit**

```bash
git add lib/carreaux/bornes.ts tests/unit/carreaux/bornes.test.ts sql/123_carreaux_bornes_nationales.sql components/CarreauxPMTilesLayer.tsx
git commit -m "fix(carreaux): bornes nationales fixes au lieu des percentiles du viewport

Second volet. L'echelle etait recalculee sur queryRenderedFeatures() a chaque
deplacement : deux territoires ne pouvaient pas etre compares, meme a zoom
constant — la meme couleur se reajustait sur la plage locale.

Les bornes viennent desormais de quantiles nationaux calcules une fois sur le
palier 5 km (22 058 lignes, sans risque pour Nano ; les densites etant
comparables entre paliers depuis la Task 3, elles valent pour tous).

Effet de bord bienvenu : plus de queryRenderedFeatures ni de debounce a chaque
mouvement de carte."
```

---

## Self-Review

**1. Couverture des constats.** Constat 1 (échelle relative au viewport) → Task 4.
Constat 2 (cascade de zoom) → Tasks 1-3. Constat 3 (sommes affichées comme
moyennes) → Tasks 1 et 3 (step 3). Aucun constat sans tâche.

**2. Placeholders.** Aucun « TODO », « à compléter » ni « similaire à la tâche N ».
La seule valeur non figée est la table de `BORNES_NATIONALES` (Task 4 step 1),
qui est produite par une requête donnée en toutes lettres.

**3. Cohérence des types.** `denominateurDe` renvoie la même union en Tasks 1, 3
et 4. `normaliser` renvoie `number | null` et les trois appelants filtrent le
`null`. `CARREAUX_INDICATEURS` est importé depuis `CarreauxPMTilesLayer` en Task 4 :
export vérifié, ligne 23.

**4. Correction apportée en revue.** La Task 3 proposait `var(--carreaux-neutre)`
dans l'expression de couleur. Erreur : MapLibre évalue ces expressions dans son
moteur de rendu et ne résout pas les variables CSS — la couche serait restée
sans couleur, en silence. Rétabli en hex littéral, avec la raison en commentaire.

## Hors périmètre — plans séparés

- **Carreaux en 3D** (`fill-extrusion`) : faisable, MapLibre 5.18 le gère, mais
  **après** ce plan. En 3D le saut ×70 deviendrait un effondrement du relief au
  changement de zoom ; une fois les valeurs normalisées, la 3D est cohérente
  gratuitement.
- **`maplibre-gl` 6.x** (faille XSS) — major, revalidation carto complète.
- **Ménage en base** — 82 tables, ~55 fonctions orphelines.
- **`compute_panneau_scores`** — mesurer d'abord si quelqu'un lit ces scores.
