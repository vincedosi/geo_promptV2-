# Carreaux — la pastille, la couleur peinte et le filtre ne font plus qu'un

**Goal :** Qu'une pastille de légende affiche exactement la couleur que la carte peint dans cette tranche, et que cliquer cette pastille sélectionne exactement ces carreaux-là.

**Architecture :** Trois défauts d'un même sujet, relevés par la revue finale du chantier précédent. La couleur est peinte par un `interpolate` continu dont les six arrêts sont posés aux positions `k/5` de l'étendue, alors que la légende et le filtre découpent en six tranches égales (`k/6`). Une pastille peut donc désigner une teinte que la carte n'emploie pas dans cette tranche. On remplace l'interpolation continue par un `['step', …]` sur les bornes exactes de `palierEchelle`, ce qui rend l'égalité vraie par construction plutôt que par coïncidence. Le troisième défaut — le palier 0 du filtre non ouvert vers le bas — disparaît côté couleur avec le `step` et se corrige d'une ligne côté filtre.

**Tech Stack :** MapLibre GL JS 5.18, React, TypeScript strict, Vitest.

**Spec :** ce document. Constats issus de la revue finale de `fix/carreaux-echelle-comparable`.

## Constats (à ne pas re-dériver)

**1. Découpages différents.** `useMapLayers.ts:314` : `positions = [0, 0.20, 0.40, 0.60, 0.80, 1.00]`, soit des arrêts à `k/5`. `CarreauxSection.tsx:167` et `useMapLayers.ts:405` : `palierEchelle(bornes, i, 6)`, soit `k/6`. La pastille de la tranche 0 peut être décalée de près d'un cran de palette par rapport à la couleur réellement peinte.

**2. Palier 0 non ouvert vers le bas.** `useMapLayers.ts:366` : le palier 5 est ouvert vers le haut (`['>=', val, min]`), mais le palier 0 est fermé en bas. Les carreaux sous `bornes.min` — environ 5 % du palier 5 km par construction, `min` étant un p5 — sont peints de la teinte la plus pâle mais **disparaissent quand on clique cette tranche**.

**3. Conséquence de forme.** Le `step` transforme un dégradé continu en choroplèthe à 6 classes. C'est un changement d'aspect **voulu** : c'est la seule façon de rendre la pastille honnête. La carte paraîtra plus « en aplats », ce qui est la convention d'une légende à classes.

## Global Constraints

- Une expression MapLibre malformée est rejetée **en silence** : la couche reste sans couleur, sans exception ni message. `['step', …]` exige des bornes **strictement croissantes**, comme `interpolate`.
- Les couleurs de peinture restent en hexadécimal : le moteur de rendu ne résout pas les variables CSS.
- La cohérence doit rester **structurelle** — une seule définition du découpage (`palierEchelle`), lue par la couleur, la légende et le filtre. Ne recopie aucune formule.
- La liste des indicateurs reste pilotée par `CARREAUX_INDICATEURS`.
- TypeScript strict. `npx tsc --noEmit` 0 erreur, `npm run lint` 0 warning, `npm test -- --run` sans régression.
- Fichiers protégés : `app/api/isochrone-battle/route.ts`, `middleware.ts`.

---

### Task 1 : `step` à 6 classes, et palier 0 ouvert vers le bas

**Files:**
- Modify: `app/copilote/_hooks/useMapLayers.ts` (`applyCarreauxColor` ~l. 300-320, `applyBucketOpacity` ~l. 355-378)
- Create: `lib/carreaux/expressions.ts`
- Test: `tests/unit/carreaux/expressions.test.ts`

**Interfaces:**
- Consumes: `palierEchelle`, `BornesEchelle` (`lib/carreaux/bornes.ts`).
- Produces: `bornesInternes(bornes, nPaliers): number[]` — les `nPaliers - 1` frontières entre classes.

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// tests/unit/carreaux/expressions.test.ts
import { describe, it, expect } from 'vitest';
import { bornesInternes } from '@/lib/carreaux/expressions';
import { palierEchelle } from '@/lib/carreaux/bornes';

describe('bornesInternes', () => {
  it('produit n-1 frontieres pour n classes', () => {
    expect(bornesInternes({ min: 0, max: 6 }, 6)).toHaveLength(5);
  });

  it('donne des bornes strictement croissantes — MapLibre rejette le contraire en silence', () => {
    const b = bornesInternes({ min: 0.3464, max: 3.4157 }, 6);
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
  });

  it('coincide exactement avec le decoupage de la legende', () => {
    const bornes = { min: 0.3464, max: 3.4157 };
    const internes = bornesInternes(bornes, 6);
    // La frontiere k separe le palier k-1 du palier k : c'est le max de l'un
    // et le min de l'autre. C'est cette egalite qui rend la pastille honnete.
    for (let k = 1; k < 6; k++) {
      expect(internes[k - 1]).toBeCloseTo(palierEchelle(bornes, k - 1, 6).max, 10);
      expect(internes[k - 1]).toBeCloseTo(palierEchelle(bornes, k, 6).min, 10);
    }
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

Run : `npx vitest run tests/unit/carreaux/expressions.test.ts`
Expected : FAIL — module introuvable.

- [ ] **Step 3 : Écrire `lib/carreaux/expressions.ts`**

```ts
/**
 * @file lib/carreaux/expressions.ts
 *
 * Frontieres de classes partagees par la couleur peinte, la legende et le
 * filtre par palier.
 *
 * Avant : la couleur etait un `interpolate` continu dont les 6 arrets etaient
 * poses a `k/5` de l'etendue, tandis que legende et filtre decoupaient en
 * `k/6`. Une pastille pouvait donc annoncer une teinte que la carte n'employait
 * pas dans cette tranche. Un `step` sur CES bornes rend l'egalite vraie par
 * construction.
 */
import { palierEchelle, type BornesEchelle } from '@/lib/carreaux/bornes';

/**
 * Les `nPaliers - 1` frontieres internes, dans l'ordre croissant.
 *
 * @returns pour 6 classes, les 5 valeurs qui les separent — exactement les
 *          `max` des paliers 0 a 4, donc les `min` des paliers 1 a 5.
 */
export function bornesInternes(bornes: BornesEchelle, nPaliers: number): number[] {
  return Array.from({ length: nPaliers - 1 }, (_, k) => palierEchelle(bornes, k, nPaliers).max);
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

Run : `npx vitest run tests/unit/carreaux/expressions.test.ts`
Expected : PASS, 3 tests.

- [ ] **Step 5 : Passer `applyCarreauxColor` en `step`**

Remplace le bloc `positions` / `interpolate` par un `step` bâti sur `bornesInternes(bornes, 6)` et les six `pal.stops`. La forme attendue :

```ts
const frontieres = bornesInternes(bornes, 6);
const expr = ['step', safeNum, pal.stops[0],
  ...frontieres.flatMap((b, i) => [b, pal.stops[i + 1]]),
] as unknown as maplibregl.ExpressionSpecification;
```

Conserve la garde `if (etendue <= 0) return;`. Note dans un commentaire que le `step` traite d'office les valeurs sous `bornes.min` (elles reçoivent `stops[0]`), ce que l'`interpolate` faisait aussi par clamp — mais que le filtre, lui, ne le faisait pas : c'est l'objet du step suivant.

- [ ] **Step 6 : Ouvrir le palier 0 vers le bas dans `applyBucketOpacity`**

Aujourd'hui : `bucket === 5 ? ['>=', val, min] : ['all', ['>=', val, min], ['<', val, max]]`.
Le palier 5 est ouvert vers le haut ; le palier 0 doit l'être vers le bas, sans quoi les carreaux sous `bornes.min` sont peints mais introuvables au clic. Traite les trois cas : palier 0 → `['<', val, max]` ; palier 5 → `['>=', val, min]` ; sinon l'encadrement actuel.

- [ ] **Step 7 : Vérifier**

```bash
npx tsc --noEmit          # 0 erreur
npm run lint              # 0 warning
npm test -- --run         # aucune régression
```

Ne lance **aucun** serveur dev : la vérification navigateur est à la charge du contrôleur.

- [ ] **Step 8 : Commit**

```bash
git add lib/carreaux/expressions.ts tests/unit/carreaux/expressions.test.ts app/copilote/_hooks/useMapLayers.ts
git commit -m "fix(carreaux): la pastille de legende affiche la couleur reellement peinte

La couleur etait un interpolate continu dont les 6 arrets etaient poses a k/5 de
l'etendue, alors que legende et filtre decoupent en k/6. Une pastille pouvait
annoncer une teinte que la carte n'employait pas dans cette tranche.

Un step sur les bornes de palierEchelle rend l'egalite vraie par construction :
pastille, couleur peinte et selection du filtre designent le meme intervalle.
Effet de forme assume : la carte devient une choroplethe a 6 classes au lieu
d'un degrade continu — c'est la convention d'une legende a classes, et la seule
facon de rendre la pastille honnete.

Le palier 0 du filtre est aussi ouvert vers le bas : les carreaux sous la borne
nationale basse (~5 % du palier 5 km, min etant un p5) etaient peints de la
teinte la plus pale mais disparaissaient quand on cliquait cette tranche."
```

## Hors périmètre

- `carreauxNormaliseExpr` ne distingue pas « superficie absente » de « superficie nulle » (entrée de dette séparée).
- La péremption des 28 bornes nationales.
- `components/CarreauxPMTilesLayer.tsx`, composant mort.
