# Refonte navigation — 5 thèmes, Campagne au cœur — Plan d'implémentation

> **Pour les agents d'exécution :** SOUS-SKILL REQUISE — `superpowers:subagent-driven-development`
> (recommandée) ou `superpowers:executing-plans`. Les étapes utilisent la syntaxe
> case à cocher (`- [ ]`) pour le suivi.

**But :** remplacer le rail à 7 entrées hétérogènes de `/map` par 5 entrées adossées à la
question de l'utilisateur — Filtre → Calques → Analyse → Zones → Campagne — sans supprimer
ni réécrire aucune feature métier.

**Architecture :** une configuration de navigation unique (`lib/navigation/config.ts`)
consommée par le rail, le routeur de panneaux et les raccourcis clavier. Trois règles
aujourd'hui absentes du code deviennent des modules purs testés : un seul filtre actif, un
seul dégradé de couleur, une seule pile `Échap`. Les panneaux existants sont **déplacés**,
pas réécrits : `FilterPanel` est éclaté en 4 panneaux par destination au lieu d'un
composant à ~140 props piloté par `visibleCategory`.

**Stack :** Next.js 15 App Router · TypeScript strict · MapLibre GL JS 5 · lucide-react ·
Vitest · Tailwind + tokens `DESIGN_SYSTEM.md`.

**Spec :** `PROMPT_NAV_5_THEMES.md` (racine du dépôt).

---

## Contraintes globales

Copiées de `CLAUDE.md`, `ARCHITECTURE.md`, `DESIGN_SYSTEM.md` et de la spec. Elles
s'appliquent à **toutes** les tâches.

- **Rien en dur.** Indicateurs, maillages, campagnes, catégories : toujours depuis la base
  ou `information_schema`. Interdit de figer une liste dans le code de navigation.
- **Une seule déclaration de navigation :** `lib/navigation/config.ts`. Aucun composant ne
  redéclare un id, un label, une icône ou un raccourci.
- **Pas de hex en dur** dans le CSS/JSX : `var(--token)` du design system.
  **Exception MapLibre** : les `paint` n'acceptent pas les variables CSS → littéraux
  hexadécimaux, comme aujourd'hui.
- **Fichiers protégés, ne pas modifier :** `app/api/isochrone-battle/route.ts`,
  les fonctions PostGIS `battle_*` / `get_isochrone_battle*`, `middleware.ts`.
- **Supabase Nano :** pas de bbox France entière, `Promise.all` ≤ 3 appels, lazy loading
  1 colonne à la fois, cache `useRef` vérifié avant tout fetch. Bbox métro max :
  `-5.5,41.2,9.8,51.2`.
- **Icônes lucide** : `size={20}`, `strokeWidth={1.5}` sur tout le rail (valeurs actuelles
  de `IconBar.tsx:188`, à conserver).
- **Sentence case** partout, sauf acronymes métier (OOH, DOOH, IRIS, POI, TMJA, CP, DSP).
- **TypeScript strict** : aucun `any` introduit, aucun `catch` non typé.
- **Doc dans le même commit** : toute route, table, RPC, variable d'env ou dépendance
  ajoutée/retirée met `ARCHITECTURE.md` à jour **dans le commit qui la change**.
  `tests/unit/docs/derive-documentation.test.ts` le vérifie.
- Tests : `npm test` (Vitest). Type-check : `npx tsc --noEmit`. Les deux doivent être verts
  à chaque commit.

---

## Ce que la cartographie a révélé, et qui contredit la spec

Relevé le 2026-09-12 sur le code réel. **À lire avant d'exécuter la moindre tâche.**

| Point de la spec | Réalité du code |
|---|---|
| « déplacer ELM dans Analyse » | **ELM n'existe pas.** Zéro occurrence dans `app/`, `lib/`, `components/`, `types/`. Rien à déplacer. |
| Zones > « dessin libre, rayon, import de CP » | **Aucun des trois n'existe.** Pas de `terra-draw`/`mapbox-gl-draw`, pas d'import de liste de CP. `rayon_poi` est un rayon de *recherche* POI, pas un outil de zone. Le seul chemin de création est la **capture des couches actives** (`CustomGeoCaptureModal`, 11 sources). |
| Analyse > « Corrélation » | Pas de route `/api/correlation` (`ARCHITECTURE.md` la cite pourtant — dérive de doc à corriger). La RPC `get_iris_iris_residual_inputs` existe en base, sans appelant. |
| Analyse > « chaque analyse est un objet enregistré, rejouable » | N'existe que pour le clustering (`clustering_models`, `clustering_jobs`). Voronoï, battle, isochrones ne persistent rien. |
| « un seul dégradé à la fois » | **Aucune exclusivité aujourd'hui** : carreaux, IRIS, indicateurs civiques, santé, météo peuvent empiler 5 dégradés. À construire. |
| « un seul filtre actif, chip persistant » | N'existe pas. Le périmètre territorial est un état éclaté dans `page.tsx:94-97` + `use-territory-selection.ts`. |
| Zones > « stocke sa géométrie ET sa liste de CP » | **Déjà vrai.** Table `custom_geo_zone_codes`, consommée par le push DV360 et l'export bidding. Rien à faire. |
| Campagne > onglet « Activation » (pré-vol, push par lots, statut par line item, rollback) | Onglets actuels : Programmer / Suivi campagne / Aperçu. Le push DV360 existe (`/api/admin/dsp/dv360/targeting/push`, `/zones/push`) mais **sans** pré-vol, ni statut par line item, ni historique, ni rollback. |
| Stratégie > « bandeau a changé depuis la publication de la vN » | Pas de versionnage de stratégie en base. À construire. |
| `?overlay=` deep-link | **N'est pas implémenté** sur `/map`. Le JSDoc de `page.tsx:13` le documente à tort. Seuls `?campaign=&tab=` et `?customZone=` fonctionnent. |

**Conséquence de périmètre.** La spec s'annonce comme « un déplacement et un regroupement,
pas une réécriture métier ». C'est vrai pour ~60 % de son contenu. Le reste est du
**développement neuf**. Ce plan couvre **le déplacement et les trois règles structurelles
explicitement demandées** (filtre unique, dégradé unique, légende unique). Le neuf est
listé en fin de document, chiffré, hors périmètre de ce plan, à arbitrer séparément.

---

## Structure de fichiers

### Créés

| Fichier | Responsabilité |
|---|---|
| `lib/navigation/config.ts` | Source unique : ids, labels, icônes, tooltips, type de panneau, raccourcis, `LARGEUR_RAIL`. Aucune logique. |
| `lib/carte/degrades.ts` | Réducteur pur d'exclusivité des dégradés de couleur. |
| `lib/carte/filtre.ts` | Type + réducteur purs du filtre unique actif, et sa bbox. |
| `lib/carte/pile-echap.ts` | Pile `Échap` à priorité : le dernier ouvert se ferme en premier. |
| `components/map/RailNavigation.tsx` | Le nouveau rail (remplace `IconBar.tsx`). |
| `components/map/FiltreChip.tsx` | Chip persistant du filtre actif, en haut à gauche de la carte. |
| `components/map/LegendeCarte.tsx` | Légende unique repliable en bas à gauche, alimentée par les calques actifs. |
| `app/map/_components/panneaux/PanneauFiltre.tsx` | Panneau Filtre. |
| `app/map/_components/panneaux/PanneauCalques.tsx` | Panneau Calques (Actifs + 6 groupes). |
| `app/map/_components/panneaux/PanneauAnalyse.tsx` | Panneau Analyse. |
| `app/map/_components/panneaux/PanneauZones.tsx` | Panneau Zones (Créer / Mes zones). |
| `app/map/_components/panneaux/GroupeCalques.tsx` | Groupe repliable générique (chevron droite fermé / bas ouvert). |
| `tests/unit/navigation/config.test.ts` | Verrouille la config de navigation. |
| `tests/unit/carte/degrades.test.ts` | Verrouille l'exclusivité des dégradés. |
| `tests/unit/carte/filtre.test.ts` | Verrouille le filtre unique + sa bbox. |
| `tests/unit/carte/pile-echap.test.ts` | Verrouille l'ordre de fermeture. |

### Modifiés

| Fichier | Nature du changement |
|---|---|
| `components/map/IconBar.tsx` | **Supprimé** en fin de Lot 1, une fois `RailNavigation` branché. |
| `app/map/page.tsx:635-1059` | La cascade de ternaires devient une table `id → composant`. Les offsets `48`/`56` en dur deviennent `LARGEUR_RAIL`. |
| `components/map/OverlayPanel.tsx:113` | `left: 56` → `LARGEUR_RAIL + 8`. |
| `components/map/MapTopBar.tsx:22-37` | `left: 48` → `LARGEUR_RAIL`. |
| `components/magelian/MagelianOverlay.tsx:36-39` | `panelLeft`/`panelWidth` dérivés de `LARGEUR_RAIL`. |
| `app/map/_components/FilterPanel.tsx` | Éclaté : ses 4 branches `visibleCategory` partent dans les 4 panneaux. Le fichier disparaît en fin de Lot 5. |
| `app/map/_components/filter-panel/use-filter-sections.ts` | `SECTION_KEYS` réordonné par nouveau groupe. |
| `next.config.js` | Ajout de `devIndicators: { position: 'bottom-right' }` après `:49`. |
| `ARCHITECTURE.md` | Section navigation + retrait de la mention `/api/correlation` (route inexistante). |

---

## Lot 1 — Socle : config de navigation et rail

### Tâche 1 : la configuration de navigation

**Fichiers :**
- Créer : `lib/navigation/config.ts`
- Test : `tests/unit/navigation/config.test.ts`

**Interfaces :**
- Produit : `type EntreeId`, `type PanneauId`, `type TypePanneau`, `interface EntreeNavigation`,
  `const ENTREES_NAVIGATION: readonly EntreeNavigation[]`, `const LARGEUR_RAIL: number`,
  `function entreeParRaccourci(e: KeyboardEvent): EntreeId | null`.
  Toutes les tâches suivantes consomment ce module et ne redéclarent rien.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// tests/unit/navigation/config.test.ts
import { describe, it, expect } from 'vitest';
import {
  ENTREES_NAVIGATION, LARGEUR_RAIL, entreeParRaccourci,
  type EntreeNavigation,
} from '@/lib/navigation/config';

/** Fabrique un KeyboardEvent minimal sans DOM. */
function touche(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { key: '', ctrlKey: false, metaKey: false, altKey: false, ...init } as KeyboardEvent;
}

describe('configuration de navigation', () => {
  it('declare exactement les sept entrees de la spec, dans l ordre', () => {
    expect(ENTREES_NAVIGATION.map(e => e.id)).toEqual([
      'assistant', 'campagne', 'filtre', 'calques', 'analyse', 'zones', 'reglages', 'aide',
    ]);
  });

  it('n a aucun id duplique', () => {
    const ids = ENTREES_NAVIGATION.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('donne une phrase de tooltip aux quatre outils', () => {
    const attendu: Record<string, string> = {
      filtre: 'Où je regarde',
      calques: 'Ce que je vois',
      analyse: 'Ce que je calcule',
      zones: 'Ce que je fabrique',
    };
    for (const [id, phrase] of Object.entries(attendu)) {
      expect(ENTREES_NAVIGATION.find(e => e.id === id)?.tooltip).toBe(phrase);
    }
  });

  it('n attribue jamais deux fois le meme raccourci', () => {
    const raccourcis = ENTREES_NAVIGATION.map(e => e.raccourci).filter(Boolean);
    expect(new Set(raccourcis).size).toBe(raccourcis.length);
  });

  it('reconnait Ctrl+K et Alt+1 a Alt+4', () => {
    expect(entreeParRaccourci(touche({ key: 'k', ctrlKey: true }))).toBe('assistant');
    expect(entreeParRaccourci(touche({ key: '1', altKey: true }))).toBe('filtre');
    expect(entreeParRaccourci(touche({ key: '2', altKey: true }))).toBe('calques');
    expect(entreeParRaccourci(touche({ key: '3', altKey: true }))).toBe('analyse');
    expect(entreeParRaccourci(touche({ key: '4', altKey: true }))).toBe('zones');
    expect(entreeParRaccourci(touche({ key: 'c', altKey: true }))).toBe('campagne');
  });

  it('ignore une touche sans modificateur', () => {
    expect(entreeParRaccourci(touche({ key: '1' }))).toBeNull();
  });

  it('laisse la place au plus long libelle', () => {
    // Le rail actuel (48 px) tronquait « Périmètre » a 8 caracteres.
    const plusLong = Math.max(...ENTREES_NAVIGATION.map(e => e.label.length));
    expect(plusLong).toBeLessThanOrEqual(9);        // « Assistant », « Campagne », « Réglages »
    expect(LARGEUR_RAIL).toBeGreaterThanOrEqual(72); // 9 car. a 9px ≈ 58px + marges
  });

  it('place Reglages et Aide en bas, le reste en haut', () => {
    const bas = ENTREES_NAVIGATION.filter(e => e.position === 'bas').map(e => e.id);
    expect(bas).toEqual(['reglages', 'aide']);
  });

  it('donne a chaque entree un type de panneau connu', () => {
    const types = new Set(['tiroir-droit', 'panneau-gauche', 'overlay-plein-ecran', 'lien']);
    for (const e of ENTREES_NAVIGATION as EntreeNavigation[]) {
      expect(types.has(e.type)).toBe(true);
    }
  });

  it('ouvre Assistant a droite et Campagne en plein ecran', () => {
    expect(ENTREES_NAVIGATION.find(e => e.id === 'assistant')?.type).toBe('tiroir-droit');
    expect(ENTREES_NAVIGATION.find(e => e.id === 'campagne')?.type).toBe('overlay-plein-ecran');
  });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Commande : `npx vitest run tests/unit/navigation/config.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "@/lib/navigation/config"`.

- [ ] **Étape 3 : écrire la configuration**

```ts
// lib/navigation/config.ts
/**
 * @file lib/navigation/config.ts — source unique de la navigation de /map
 *
 * Chaine mentale : Filtre -> Calques -> Analyse -> Zones -> Campagne.
 *   Filtre   : ou je regarde. Restreint l'affichage et allege les requetes.
 *   Calques  : ce que je vois. Affiche des donnees, ne fabrique rien.
 *   Analyse  : ce que je calcule. Produit un calque, une zone candidate, un rapport.
 *   Zones    : ce que je fabrique. Seul endroit qui cree de la geometrie et une liste de CP.
 *   Campagne : ce que j'active. Overlay plein ecran.
 *
 * AUCUN composant ne redeclare un id, un label, une icone ou un raccourci :
 * ils lisent ce fichier. Verrouille par tests/unit/navigation/config.test.ts.
 */
import {
  Sparkles, Megaphone, Funnel, Layers, FlaskConical, Shapes, Settings, CircleHelp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Les quatre outils qui ouvrent un panneau gauche. */
export type PanneauId = 'filtre' | 'calques' | 'analyse' | 'zones';

/** Toutes les entrees du rail. */
export type EntreeId = 'assistant' | 'campagne' | PanneauId | 'reglages' | 'aide';

/** Ou et comment s'ouvre le contenu d'une entree. */
export type TypePanneau =
  | 'tiroir-droit'          // Assistant : tiroir a DROITE de la carte
  | 'panneau-gauche'        // Les quatre outils : OverlayPanel a gauche
  | 'overlay-plein-ecran'   // Campagne : overlay MAGELIAN par-dessus la carte
  | 'lien';                 // Reglages, Aide

export interface EntreeNavigation {
  id: EntreeId;
  label: string;
  icone: LucideIcon;
  /** Phrase affichee au survol. Vide pour les entrees sans question associee. */
  tooltip: string;
  type: TypePanneau;
  /** Forme canonique du raccourci : 'ctrl+k', 'alt+1'... */
  raccourci?: string;
  position: 'haut' | 'bas';
  /** Filet de separation APRES cette entree. */
  separateurApres?: boolean;
  /** Traitement visuel distinct : bouton pleine largeur en fond teal. */
  accent?: boolean;
}

/**
 * Largeur du rail, en pixels. Etait a 48, ce qui tronquait « Perimetre » a
 * huit caracteres (« Perimetr »). Toute position calee sur le rail doit lire
 * cette constante, jamais un 48 ou un 56 en dur.
 */
export const LARGEUR_RAIL = 76;

/** Ecart entre le rail et le panneau qu'il ouvre. */
export const ECART_RAIL_PANNEAU = 8;

export const ENTREES_NAVIGATION: readonly EntreeNavigation[] = [
  {
    id: 'assistant', label: 'Assistant', icone: Sparkles,
    tooltip: 'Poser une question', type: 'tiroir-droit',
    raccourci: 'ctrl+k', position: 'haut', separateurApres: true,
  },
  {
    id: 'campagne', label: 'Campagne', icone: Megaphone,
    tooltip: 'Ce que j’active', type: 'overlay-plein-ecran',
    raccourci: 'alt+c', position: 'haut', separateurApres: true, accent: true,
  },
  {
    id: 'filtre', label: 'Filtre', icone: Funnel,
    tooltip: 'Où je regarde', type: 'panneau-gauche',
    raccourci: 'alt+1', position: 'haut',
  },
  {
    id: 'calques', label: 'Calques', icone: Layers,
    tooltip: 'Ce que je vois', type: 'panneau-gauche',
    raccourci: 'alt+2', position: 'haut',
  },
  {
    id: 'analyse', label: 'Analyse', icone: FlaskConical,
    tooltip: 'Ce que je calcule', type: 'panneau-gauche',
    raccourci: 'alt+3', position: 'haut',
  },
  {
    id: 'zones', label: 'Zones', icone: Shapes,
    tooltip: 'Ce que je fabrique', type: 'panneau-gauche',
    raccourci: 'alt+4', position: 'haut',
  },
  {
    id: 'reglages', label: 'Réglages', icone: Settings,
    tooltip: '', type: 'panneau-gauche', position: 'bas',
  },
  {
    id: 'aide', label: 'Aide', icone: CircleHelp,
    tooltip: '', type: 'panneau-gauche', position: 'bas',
  },
] as const;

/** Index raccourci canonique -> entree, construit une fois. */
const PAR_RACCOURCI: ReadonlyMap<string, EntreeId> = new Map(
  ENTREES_NAVIGATION.filter(e => e.raccourci).map(e => [e.raccourci as string, e.id]),
);

/**
 * Traduit un evenement clavier en entree de navigation.
 * Rend null si aucun modificateur, pour ne jamais voler une frappe de saisie.
 */
export function entreeParRaccourci(e: KeyboardEvent): EntreeId | null {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl && !e.altKey) return null;
  const prefixe = ctrl ? 'ctrl+' : 'alt+';
  return PAR_RACCOURCI.get(prefixe + e.key.toLowerCase()) ?? null;
}

/** Les quatre outils, dans l'ordre du rail. */
export const PANNEAUX_OUTILS: readonly PanneauId[] =
  ENTREES_NAVIGATION.filter(e => e.type === 'panneau-gauche' && e.position === 'haut')
    .map(e => e.id) as PanneauId[];
```

- [ ] **Étape 4 : relancer le test, vérifier qu'il passe**

Commande : `npx vitest run tests/unit/navigation/config.test.ts`
Attendu : SUCCÈS, 9 tests.

- [ ] **Étape 5 : commit**

```bash
git add lib/navigation/config.ts tests/unit/navigation/config.test.ts
git commit -m "feat(nav): une source unique pour la navigation de /map"
```

---

### Tâche 2 : le rail

**Fichiers :**
- Créer : `components/map/RailNavigation.tsx`
- Modifier : `next.config.js` (après la ligne 49)
- Supprimer en fin de tâche : `components/map/IconBar.tsx`

**Interfaces :**
- Consomme : `ENTREES_NAVIGATION`, `LARGEUR_RAIL`, `EntreeId` (Tâche 1).
- Produit : `<RailNavigation entreeActive={EntreeId | null} onEntree={(id: EntreeId) => void} masque?={boolean} badgeAlertes?={number} />`

- [ ] **Étape 1 : déplacer le badge de dev Next.js**

`next.config.js`, juste après `eslint: { ignoreDuringBuilds: true },` (ligne 49) :

```js
  // Le badge de dev se posait en bas a gauche, sur les dernieres entrees du rail.
  devIndicators: { position: 'bottom-right' },
```

- [ ] **Étape 2 : écrire le rail**

Reprendre `IconBar.tsx` comme base et appliquer exactement ces changements :

1. Supprimer `ICON_BAR_ITEMS`, `OverlayId`, `CAMPAIGN_ITEM_ID` → importer depuis
   `@/lib/navigation/config`.
2. `width: 48` → `width: LARGEUR_RAIL`.
3. Label : supprimer la troncature à 8 caractères (`IconBar.tsx:189-202`), `fontSize: 10`,
   `lineHeight: 1.2`, `textAlign: 'center'`, pas de `whiteSpace: nowrap`.
4. Bouton : `width: LARGEUR_RAIL - 8`, `height: 48`, icône au-dessus du label.
5. Entrée `accent` (Campagne) : bouton pleine largeur, `background: var(--brand-teal)`,
   `color: var(--background)`, `height: 56`, libellé toujours visible, badge d'alertes en
   pastille haut-droite quand `badgeAlertes > 0`. **Pas de `box-shadow`** — le design system
   interdit les ombres (`DESIGN_SYSTEM.md` §7.10) ; la spec demande « ombre légère », le
   design system tranche : on marque la différence par le fond plein et la hauteur.
6. État actif : `background: rgba(78,205,196,0.12)`, `color: var(--brand-teal)`,
   `aria-pressed={actif}` (déjà présent `IconBar.tsx:134`), barre verticale 3px conservée.
7. Tooltip : `title={entree.tooltip}` quand il est non vide, plus `aria-label={entree.label}`.
8. Le raccourci `/` de `IconBar.tsx:53-65` est **retiré** : il est remplacé par `Ctrl+K`,
   branché en Tâche 8. Ne pas laisser les deux.

- [ ] **Étape 3 : brancher le rail et purger les offsets en dur**

Quatre fichiers calent une position sur l'ancienne largeur 48. Remplacer :

| Fichier:ligne | Avant | Après |
|---|---|---|
| `app/map/page.tsx:639` | `paddingLeft: iconBarHidden ? 0 : 48` | `paddingLeft: railMasque ? 0 : LARGEUR_RAIL` |
| `components/map/OverlayPanel.tsx:113` | `left: 56` | `left: LARGEUR_RAIL + ECART_RAIL_PANNEAU` |
| `components/map/MapTopBar.tsx:22-37` | `left: 48` | `left: LARGEUR_RAIL` |
| `components/magelian/MagelianOverlay.tsx:36-39` | `panelLeft = onMap ? 56 : 256` et `calc(100vw - 68px)` | `panelLeft = onMap ? LARGEUR_RAIL + ECART_RAIL_PANNEAU : 256` et `calc(100vw - ${LARGEUR_RAIL + ECART_RAIL_PANNEAU + 12}px)` |

- [ ] **Étape 4 : supprimer l'ancien rail et vérifier qu'il ne reste aucun appelant**

```bash
git rm components/map/IconBar.tsx
grep -rn "IconBar\|OverlayId" app components lib --include=*.ts --include=*.tsx
```
Attendu : aucune occurrence hors `RailNavigation.tsx`.

- [ ] **Étape 5 : vérifier**

```bash
npx tsc --noEmit && npm test -- --run
```
Attendu : 0 erreur de type, tous les tests verts.

- [ ] **Étape 6 : commit**

```bash
git add -A
git commit -m "feat(nav): le rail passe a cinq themes, sans libelle tronque"
```

---

## Lot 2 — Le filtre unique

### Tâche 3 : le réducteur de filtre

**Fichiers :**
- Créer : `lib/carte/filtre.ts`
- Test : `tests/unit/carte/filtre.test.ts`

**Interfaces :**
- Produit : `type FiltreActif`, `function poserFiltre(prochain)`, `function retirerFiltre()`,
  `function bboxDuFiltre(f)`, `const BBOX_METRO`.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// tests/unit/carte/filtre.test.ts
import { describe, it, expect } from 'vitest';
import {
  poserFiltre, retirerFiltre, bboxDuFiltre, BBOX_METRO, type FiltreActif,
} from '@/lib/carte/filtre';

const region: FiltreActif = { type: 'region', code: '93', label: 'Provence-Alpes-Côte d’Azur' };
const dept: FiltreActif  = { type: 'departement', code: '13', label: 'Bouches-du-Rhône' };

describe('filtre unique', () => {
  it('remplace toujours : un seul filtre actif a la fois', () => {
    expect(poserFiltre(region, dept)).toEqual(dept);
  });

  it('re-poser le meme filtre le retire (bascule)', () => {
    expect(poserFiltre(region, region)).toBeNull();
  });

  it('retirer rend null', () => {
    expect(retirerFiltre()).toBeNull();
  });

  it('sans filtre, la bbox est la metropole et jamais le monde', () => {
    expect(bboxDuFiltre(null)).toEqual(BBOX_METRO);
    expect(BBOX_METRO).toEqual([-5.5, 41.2, 9.8, 51.2]);
  });

  it('rend la bbox portee par le filtre quand elle existe', () => {
    const avecBbox: FiltreActif = { ...dept, bbox: [4.2, 43.1, 5.8, 43.9] };
    expect(bboxDuFiltre(avecBbox)).toEqual([4.2, 43.1, 5.8, 43.9]);
  });

  it('retombe sur la metropole si le filtre n a pas encore sa bbox', () => {
    expect(bboxDuFiltre(dept)).toEqual(BBOX_METRO);
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

Commande : `npx vitest run tests/unit/carte/filtre.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : écrire le module**

```ts
// lib/carte/filtre.ts
/**
 * @file lib/carte/filtre.ts — le filtre unique de la carte
 *
 * « Ou je regarde ». UN SEUL filtre actif a la fois : poser un filtre remplace
 * le precedent, re-poser le meme le retire.
 *
 * Le filtre borne REELLEMENT les requetes (bbox ou liste de codes), il ne se
 * contente pas de masquer cote client : c'est le garde-fou contre les scans
 * France entiere qui ont epuise le budget I/O Nano le 28/03.
 *
 * Il ne s'applique JAMAIS au perimetre d'une strategie de campagne : une
 * strategie couvre toute la campagne (voir l'encart de l'onglet Strategie).
 */

/** Bbox metropole — plafond impose par CLAUDE.md, jamais la France entiere + DROM. */
export const BBOX_METRO: readonly [number, number, number, number] = [-5.5, 41.2, 9.8, 51.2];

export type TypeFiltre = 'region' | 'departement' | 'commune' | 'cp' | 'zone';

export interface FiltreActif {
  type: TypeFiltre;
  /** Code INSEE, code postal ou uuid de zone selon `type`. */
  code: string;
  /** Libelle affiche dans le chip. */
  label: string;
  /** Bbox resolue, quand elle est connue. */
  bbox?: readonly [number, number, number, number];
}

/** Meme filtre : meme type ET meme code. */
function memeFiltre(a: FiltreActif | null, b: FiltreActif): boolean {
  return a !== null && a.type === b.type && a.code === b.code;
}

/**
 * Pose un filtre. Remplace le precedent ; re-poser le meme le retire.
 * Rend le nouvel etat, jamais une mutation de l'ancien.
 */
export function poserFiltre(courant: FiltreActif | null, prochain: FiltreActif): FiltreActif | null {
  return memeFiltre(courant, prochain) ? null : prochain;
}

export function retirerFiltre(): null {
  return null;
}

/** Bbox a envoyer aux requetes. Sans filtre resolu, on borne a la metropole. */
export function bboxDuFiltre(f: FiltreActif | null): readonly [number, number, number, number] {
  return f?.bbox ?? BBOX_METRO;
}
```

- [ ] **Étape 4 : relancer, vérifier le succès**

Commande : `npx vitest run tests/unit/carte/filtre.test.ts` → SUCCÈS, 6 tests.

- [ ] **Étape 5 : commit**

```bash
git add lib/carte/filtre.ts tests/unit/carte/filtre.test.ts
git commit -m "feat(carte): un seul filtre actif, et il borne les requetes"
```

---

### Tâche 4 : le panneau Filtre et son chip

**Fichiers :**
- Créer : `app/map/_components/panneaux/PanneauFiltre.tsx`, `components/map/FiltreChip.tsx`
- Déplacer : le contenu de `app/map/_components/filter-panel/PerimeterSections.tsx`
  (scope `:90-106`, régions `:109-136`, départements `:139-159`, recherche locale `:162-182`)
- Modifier : `app/map/page.tsx` (état du filtre remonté), `use-territory-selection.ts`

**Interfaces :**
- Consomme : `FiltreActif`, `poserFiltre`, `bboxDuFiltre` (Tâche 3).
- Produit : `<PanneauFiltre filtre onFiltre zonesEnregistrees />`,
  `<FiltreChip filtre onRetirer />`.

- [ ] **Étape 1 : construire le panneau à partir de l'existant**

Contenu, dans cet ordre (spec §3) :
1. Recherche locale (adresse, commune, CP) — code repris tel quel de `PerimeterSections.tsx:162-182`
2. Découpage administratif : périmètre global (Métro / +DROM), région, département —
   repris de `:90-159`
3. « Filtrer sur une zone enregistrée » — liste alimentée par `/api/custom-geo/list`
   (déjà appelée par `ZonesOverlay`), **pas** une liste en dur

Chaque sélection appelle `onFiltre(poserFiltre(filtreCourant, { type, code, label, bbox }))`.

- [ ] **Étape 2 : le chip**

`FiltreChip` : `position: absolute`, haut-gauche de la carte, sous la top bar
(`top: MAP_TOPBAR_HEIGHT + 12`, `left: LARGEUR_RAIL + ECART_RAIL_PANNEAU`),
`background: var(--elevated)`, `border: 0.5px solid var(--border-default)`,
`borderRadius: 6`, Inter 12px `var(--text-primary)`, icône `Funnel` 12px teal,
croix `X` 12px `var(--text-tertiary)` → `onRetirer()`. Rien affiché si `filtre === null`.

Pastille sur l'icône Filtre du rail : passer `pastille={filtre !== null}` à
`RailNavigation` (point 6px `var(--brand-teal)` en haut-droite de l'icône).

- [ ] **Étape 3 : brancher la bbox sur les requêtes**

Tous les fetchs de couche qui prennent une bbox lisent `bboxDuFiltre(filtre)` au lieu du
viewport quand un filtre est actif. Points d'appel à modifier :
`useMapDirectActions.ts:58` (OOH), `:81` (POI), `CivicHealthMapLayer.tsx:285`,
`useMeteoLayer.ts:121`. **Ne pas toucher** aux tuiles MVT (`/api/tiles/...`) : MapLibre
demande ses tuiles par z/x/y, le filtre n'y change rien.

- [ ] **Étape 4 : vérifier**

```bash
npx tsc --noEmit && npm test -- --run
```

- [ ] **Étape 5 : commit**

```bash
git add -A && git commit -m "feat(nav): panneau Filtre — un perimetre, un chip, des requetes bornees"
```

---

## Lot 3 — Le panneau Calques

### Tâche 5 : l'exclusivité des dégradés

**Fichiers :**
- Créer : `lib/carte/degrades.ts`
- Test : `tests/unit/carte/degrades.test.ts`

**Interfaces :**
- Produit : `type DegradeId`, `function activerDegrade(actif, cible)`,
  `function libelleDegrade(id)`.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// tests/unit/carte/degrades.test.ts
import { describe, it, expect } from 'vitest';
import { activerDegrade, libelleDegrade, type DegradeId } from '@/lib/carte/degrades';

describe('exclusivite des degrades de couleur', () => {
  it('activer un degrade eteint le precedent', () => {
    expect(activerDegrade('carreaux', 'iris')).toEqual({ actif: 'iris', eteint: 'carreaux' });
  });

  it('n eteint rien quand aucun degrade n etait actif', () => {
    expect(activerDegrade(null, 'iris')).toEqual({ actif: 'iris', eteint: null });
  });

  it('re-activer le degrade courant l eteint', () => {
    expect(activerDegrade('iris', 'iris')).toEqual({ actif: null, eteint: 'iris' });
  });

  it('les impressions de campagne excluent les donnees INSEE, et l inverse', () => {
    expect(activerDegrade('campagne-impressions', 'carreaux').eteint).toBe('campagne-impressions');
    expect(activerDegrade('carreaux', 'campagne-impressions').eteint).toBe('carreaux');
  });

  it('donne un libelle francais a chaque degrade, pour le toast', () => {
    const ids: DegradeId[] = [
      'carreaux', 'iris', 'civic-indicateurs', 'civic-sante', 'meteo', 'campagne-impressions',
    ];
    for (const id of ids) expect(libelleDegrade(id).length).toBeGreaterThan(2);
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec** — `npx vitest run tests/unit/carte/degrades.test.ts`

- [ ] **Étape 3 : écrire le module**

```ts
// lib/carte/degrades.ts
/**
 * @file lib/carte/degrades.ts — un seul degrade de couleur a la fois
 *
 * Avant ce module, cinq choropletehes pouvaient s'empiler (carreaux, IRIS,
 * indicateurs civiques, sante environnementale, meteo) : la carte devenait
 * illisible et aucune legende ne disait laquelle on lisait.
 *
 * Reducteur PUR : il dit quoi eteindre, il n'eteint rien lui-meme.
 */

export type DegradeId =
  | 'carreaux'
  | 'iris'
  | 'civic-indicateurs'
  | 'civic-sante'
  | 'meteo'
  | 'campagne-impressions';

const LIBELLES: Record<DegradeId, string> = {
  'carreaux': 'Carreaux Filosofi',
  'iris': 'IRIS',
  'civic-indicateurs': 'Indicateurs civiques',
  'civic-sante': 'Santé environnementale',
  'meteo': 'Météo',
  'campagne-impressions': 'Impressions de la campagne',
};

export function libelleDegrade(id: DegradeId): string {
  return LIBELLES[id];
}

export interface BasculeDegrade {
  /** Le degrade desormais actif, ou null si on vient d'eteindre le dernier. */
  actif: DegradeId | null;
  /** Celui qu'il faut eteindre, ou null. Sert au toast d'explication. */
  eteint: DegradeId | null;
}

/** Active `cible`. Re-activer le degrade courant l'eteint. */
export function activerDegrade(actif: DegradeId | null, cible: DegradeId): BasculeDegrade {
  if (actif === cible) return { actif: null, eteint: cible };
  return { actif: cible, eteint: actif };
}
```

- [ ] **Étape 4 : relancer, vérifier le succès** — 5 tests verts.

- [ ] **Étape 5 : commit**

```bash
git add lib/carte/degrades.ts tests/unit/carte/degrades.test.ts
git commit -m "feat(carte): un seul degrade de couleur a la fois"
```

---

### Tâche 6 : le panneau Calques et la légende unique

**Fichiers :**
- Créer : `app/map/_components/panneaux/PanneauCalques.tsx`,
  `app/map/_components/panneaux/GroupeCalques.tsx`, `components/map/LegendeCarte.tsx`
- Déplacer (sans réécrire) : `CarreauxSection.tsx`, `IrisSection.tsx`,
  `CivicIndicatorsSection.tsx`, `CivicHealthSection.tsx`, `MeteoSection.tsx`,
  `PoiSection.tsx`, `TransportSection.tsx`, `TmjaSection.tsx`, `OohSection.tsx`,
  `RadioSection.tsx`
- Modifier : `app/copilote/_hooks/useMapLayers.ts` (rapatrie `degradeActif`),
  `use-filter-sections.ts` (`SECTION_KEYS` réordonné)

**Interfaces :**
- Consomme : `activerDegrade`, `libelleDegrade` (Tâche 5).
- Produit : `<PanneauCalques calquesActifs onRetirerCalque degradeActif onDegrade />`,
  `<GroupeCalques titre ouvert onToggle>{children}</GroupeCalques>`,
  `<LegendeCarte calquesActifs />`.

- [ ] **Étape 1 : les groupes (spec §2 et §4)**

| Groupe | Sections déplacées telles quelles |
|---|---|
| Socio-démographie | `CarreauxSection`, `IrisSection` |
| Campagne active | couche impressions (`SuiviMapLayer`), visible seulement si une campagne est active |
| POI et mobilité | `PoiSection`, `TransportSection`, `TmjaSection` |
| Médias offline | `OohSection`, `RadioSection` |
| Environnement | `CivicIndicatorsSection`, `CivicHealthSection`, `MeteoSection` |
| Mes analyses | résultats produits par le panneau Analyse (clusters, score) |

En tête : **« Actifs (n) »**, un item par calque affiché avec une croix `X` qui l'éteint.
Les réglages d'un calque (maillage, indicateur, palette, opacité) restent **dans** sa
section existante et ne s'affichent que quand le calque est actif.

- [ ] **Étape 2 : chevrons cohérents**

`GroupeCalques` est le **seul** composant qui rend un chevron de groupe :
`ChevronRight` fermé, `ChevronDown` ouvert, 14px, `var(--text-tertiary)`, `ml-auto`.
Supprimer les puces décoratives devant les titres de section
(`FilterSectionHeader.tsx`, dot 6px) — la spec §4 le demande explicitement, et cela
contredit `DESIGN_SYSTEM.md` §5 qui impose un dot teal sur les **section headers de
panneau** : le dot reste sur l'en-tête du panneau lui-même (`OverlayPanel.tsx:140`), il
disparaît des groupes internes.

- [ ] **Étape 3 : le toast d'exclusivité**

À l'activation d'un dégradé, si `eteint !== null` :
`toast("${libelleDegrade(eteint)} a été masqué — un seul dégradé de couleur à la fois")`
via `components/ui/geo-toast.tsx`.

- [ ] **Étape 4 : la légende unique**

`LegendeCarte` en bas à gauche, repliable, `position: absolute`,
`left: LARGEUR_RAIL + ECART_RAIL_PANNEAU`, `bottom: 12`, `zIndex: 35`.
Elle rend l'échelle du **dégradé actif** plus les figurés ponctuels actifs (POI, OOH,
radio, TMJA). Réutiliser `formaterValeur` / `palierEchelle` de `lib/carreaux/bornes.ts`
— déjà la garantie que la légende carreaux et la carte décrivent la même échelle
(`MapPanel.tsx:112-114`).

Les 8 légendes locales (`CarreauxSection:188-215`, `IrisSection:275-290`,
`TmjaSection:14-60`, `CivicIndicatorsSection:76-90`, `CivicHealthSection:304`,
`SuiviMapLayer:78-117`, `MapPanel:268-300`, `digital/MapLegend.tsx`) **exportent leurs
stops** et cessent de les rendre elles-mêmes. `digital/MapLegend.tsx` reste en place :
la page `/map/analyse/digital` est hors périmètre de cette refonte.

- [ ] **Étape 5 : vérifier** — `npx tsc --noEmit && npm test -- --run`

- [ ] **Étape 6 : commit**

```bash
git add -A && git commit -m "feat(nav): panneau Calques — six groupes, une legende, un degrade"
```

---

## Lot 4 — Analyse et Zones

### Tâche 7 : les panneaux Analyse et Zones

**Fichiers :**
- Créer : `app/map/_components/panneaux/PanneauAnalyse.tsx`,
  `app/map/_components/panneaux/PanneauZones.tsx`
- Déplacer : `VoronoiTool.tsx`, `BattleV2Tool.tsx`, `IsochronesTool.tsx`,
  `ClusteringSection.tsx`, `SpatialAnalysisIntro.tsx` → Analyse ;
  `components/map/overlays/ZonesOverlay.tsx` + entrée « Capturer zone custom » de
  `SettingsOverlay.tsx:145-168` → Zones
- Modifier : `SettingsOverlay.tsx` (perd la capture, gagne le choix du modèle IA et
  l'état de la clé, retirés de l'Assistant)

- [ ] **Étape 1 : Analyse**

Contenu : Clusters (K-Means) — `ClusteringSection` telle quelle ;
Battle isochrone — `IsochronesTool` + `BattleV2Tool` ; Voronoï — `VoronoiTool`.
Conserver l'exclusion mutuelle existante (`FilterPanel.tsx:787-851`) : ouvrir un outil
ferme les deux autres.

**Garde de périmètre (spec §5) :** avant tout lancement, si `filtre === null` **et**
qu'aucune zone n'est sélectionnée, bloquer et afficher : « Choisissez un périmètre
(filtre ou zone) avant de lancer un calcul ». C'est la traduction directe de la règle I/O
Nano — un calcul France entière est ce qui a fait tomber la base le 28/03 et le 08/04.

- [ ] **Étape 2 : Zones**

Section « Créer une zone » : la capture des couches actives
(`CustomGeoCaptureModal`, 11 sources). **Dessin libre, rayon et import de CP n'existent
pas** — ne pas inventer de bouton mort : ils sont en Phase 2.

Section « Mes zones » : `ZonesOverlay` déplacée telle quelle. Elle affiche déjà nom,
`source_type`, compteurs. Composition en clair et opérations booléennes
(Fusionner / Intersection / Soustraire) : Phase 2.

- [ ] **Étape 3 : vérifier et commit**

```bash
npx tsc --noEmit && npm test -- --run
git add -A && git commit -m "feat(nav): panneaux Analyse et Zones"
```

---

## Lot 5 — Routage, état global, raccourcis

### Tâche 8 : la table de routage et la pile Échap

**Fichiers :**
- Créer : `lib/carte/pile-echap.ts`, `tests/unit/carte/pile-echap.test.ts`
- Modifier : `app/map/page.tsx:648-829` (la cascade de ternaires)
- Supprimer : `app/map/_components/FilterPanel.tsx` (vidé par les lots 2 à 4)

- [ ] **Étape 1 : test de la pile Échap**

```ts
// tests/unit/carte/pile-echap.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { empiler, depiler, fermerLePlusHaut, etatPile } from '@/lib/carte/pile-echap';

beforeEach(() => { etatPile().length = 0; });

describe('pile Echap', () => {
  it('ferme le dernier ouvert en premier', () => {
    const ordre: string[] = [];
    empiler('overlay', () => ordre.push('overlay'));
    empiler('modale', () => ordre.push('modale'));
    fermerLePlusHaut();
    expect(ordre).toEqual(['modale']);
    fermerLePlusHaut();
    expect(ordre).toEqual(['modale', 'overlay']);
  });

  it('depiler retire une entree sans la fermer', () => {
    const ordre: string[] = [];
    empiler('modale', () => ordre.push('modale'));
    depiler('modale');
    fermerLePlusHaut();
    expect(ordre).toEqual([]);
  });

  it('ne casse pas quand la pile est vide', () => {
    expect(() => fermerLePlusHaut()).not.toThrow();
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

- [ ] **Étape 3 : écrire la pile**

```ts
// lib/carte/pile-echap.ts
/**
 * @file lib/carte/pile-echap.ts — un seul Echap, un ordre garanti
 *
 * Quatre listeners keydown concurrents ecoutaient Escape (page.tsx:147,
 * OverlayPanel.tsx:74, MagelianOverlay.tsx:241, ClusterPanel.tsx:243) sans
 * ordre impose : le commentaire de page.tsx:146 assumait une priorite que
 * rien ne garantissait. Ici, dernier ouvert = premier ferme.
 */
interface Entree { id: string; fermer: () => void; }

const pile: Entree[] = [];

/** Expose la pile pour les tests. Ne pas muter ailleurs. */
export function etatPile(): Entree[] { return pile; }

export function empiler(id: string, fermer: () => void): void {
  depiler(id);
  pile.push({ id, fermer });
}

export function depiler(id: string): void {
  const i = pile.findIndex(e => e.id === id);
  if (i !== -1) pile.splice(i, 1);
}

/** Ferme l'entree la plus haute. Sans effet si la pile est vide. */
export function fermerLePlusHaut(): void {
  const haut = pile.pop();
  haut?.fermer();
}
```

- [ ] **Étape 4 : relancer, vérifier le succès**

- [ ] **Étape 5 : remplacer la cascade de ternaires**

Dans `page.tsx`, à la place de `:652-669` (titres + couleurs) et `:672-827` (enfants) :

```tsx
const PANNEAUX: Record<PanneauId, () => React.ReactNode> = {
  filtre:  () => <PanneauFiltre  {...propsFiltre} />,
  calques: () => <PanneauCalques {...propsCalques} />,
  analyse: () => <PanneauAnalyse {...propsAnalyse} />,
  zones:   () => <PanneauZones   {...propsZones} />,
};
```

Le titre et le tooltip viennent de `ENTREES_NAVIGATION`, plus aucun ternaire.
`reglages` garde `SettingsOverlay`, `assistant` devient un tiroir **droit**
(`right: 0`, largeur 380) au lieu d'un panneau gauche.

- [ ] **Étape 6 : raccourcis**

Un seul listener global dans `page.tsx`, qui appelle `entreeParRaccourci(e)` (Tâche 1),
ignore la frappe si le focus est dans `INPUT`/`TEXTAREA`/`contentEditable` (garde reprise
de `IconBar.tsx:57-59`), et `Escape` → `fermerLePlusHaut()`.

- [ ] **Étape 7 : vérifier et commit**

```bash
npx tsc --noEmit && npm test -- --run
git add -A && git commit -m "feat(nav): une table de routage, une pile Echap, des raccourcis"
```

---

### Tâche 9 : campagne active et bascule Campagne / Carte

**Fichiers :**
- Modifier : `components/magelian/MagelianOverlayContext.tsx` (expose `campagneActive`),
  `components/map/MapTopBar.tsx` (bouton de bascule au centre),
  `components/magelian/MagelianOverlay.tsx` (onglets renommés)

- [ ] **Étape 1 : onglets**

`MagelianOverlay.tsx:405-409` : `Programmer` → **Stratégie**, `Suivi campagne` → **Suivi**.
`Aperçu` est conservé. **L'onglet Activation n'est pas créé** : son contenu (pré-vol,
push par lots, statut par line item, historique, rollback) n'existe pas — Phase 2.
Mettre à jour `deep-link.ts:3` (`MagelianTab`) et ses tests
(`tests/unit/magelian-deep-link.test.ts`) **dans le même commit**, ainsi que le deep-link
documenté en tête d'`ARCHITECTURE.md`.

- [ ] **Étape 2 : contexte global**

`campagneActive` (id + nom + annonceur) vit dans `MagelianOverlayContext`, s'affiche dans
la top bar et dans une carte flottante haut-gauche de la carte avec un bouton « Ouvrir ».
Sans campagne active, l'overlay affiche « Choisir une campagne » et les quatre outils
restent pleinement utilisables.

- [ ] **Étape 3 : bascule**

Bouton `Campagne / Carte` au centre de `MapTopBar`, raccourci `Alt+C` (déjà déclaré en
Tâche 1). La campagne sélectionnée reste active au retour à la carte.

- [ ] **Étape 4 : note de périmètre dans Stratégie**

Quand `filtre !== null`, afficher dans l'onglet Stratégie :
« Un filtre de carte est actif. Il ne s'applique pas à cette stratégie : une stratégie
couvre toute la campagne. » (spec §3, règle non négociable).

- [ ] **Étape 5 : vérifier et commit**

```bash
npx tsc --noEmit && npm test -- --run
git add -A && git commit -m "feat(nav): campagne active globale et bascule Campagne / Carte"
```

---

## Lot 6 — Documentation et clôture

### Tâche 10 : doc et nettoyage

- [ ] **Étape 1 : `ARCHITECTURE.md`**
  - nouvelle section « Navigation de /map » : les 5 thèmes, `lib/navigation/config.ts`
    comme source unique, `LARGEUR_RAIL`
  - retirer la mention de `api/correlation/compute/` (route inexistante, RPC
    `get_iris_iris_residual_inputs` sans appelant)
  - corriger le deep-link MAGELIAN (`creation` → `strategie`)

- [ ] **Étape 2 : `page.tsx:13`** — supprimer la mention du deep-link `?overlay=`, qui
  n'a jamais existé.

- [ ] **Étape 3 : vérification finale**

```bash
npx tsc --noEmit
npm test -- --run
npm run build
npm run lint
grep -rn "\bany\b" --include=*.tsx --include=*.ts lib/navigation lib/carte app/map/_components/panneaux components/map/RailNavigation.tsx
```
Attendu : tsc 0 erreur · tests verts (628 + les nouveaux) · build vert · aucun `any`.

- [ ] **Étape 4 : commit final + `@cleanup-geomatik` Parties 2 et 3** sur les fichiers
      modifiés uniquement (failles sécu, `any` introduits, `catch` non typés).

---

## Phase 2 — Développements neufs (arbitrée EN périmètre le 2026-09-12)

Ce que la spec décrit et qui n'existe pas dans le code. Chacun est un développement, pas
un déplacement. **Décision du 2026-09-12 : tout est retenu.** Le tableau ci-dessous sert
d'index ; les tâches 11 à 22 les détaillent.

Deux corrections au relevé initial, faites après vérification du code :
- **« Fusionner » existe déjà** — `/api/custom-geo/source/composite` fait l'union de 2 à 20
  zones membres (`source_metadata.member_zone_ids`). Seules **Intersection** et
  **Soustraire** sont à écrire.
- `@react-pdf/renderer` **n'est pas installé** (retiré avec le clustering, commit `7192c68`).
  Le rapport ELM le réclame : réinstallation dans la tâche 22.

| Sujet | Ce qu'il faut construire | Poids |
|---|---|---|
| **Onglet Activation** | Pré-vol lecture seule, push par lots, statut par line item, historique, rollback. Le push DV360 existe mais nu. | Gros — touche DSP et base |
| **Versionnage de stratégie** | Table de versions, « Vérifier et publier », bandeau « a changé depuis la vN », tag par ligne | Gros — migration SQL |
| **Analyses enregistrées rejouables** | Table `analyses` (nom, paramètres, maillage, date), rejeu, alimentation de Calques > Mes analyses. N'existe que pour le clustering. | Moyen |
| **Score composite** | Pondération multi-indicateurs → calque 0-100. Le socle existe : `/api/custom-geo/source/composite` et `/indicator-threshold` | Moyen |
| **Opérations booléennes sur zones** | Fusionner / Intersection / Soustraire + cases à cocher | Moyen — RPC PostGIS |
| **Composition de zone en clair** | « 3 départements moins Paris », « 412 IRIS et isochrone 15 min » — dérivé de `source_metadata` | Petit |
| **Dessin libre** | Dépendance de dessin (aucune installée) + capture de la géométrie tracée | Moyen |
| **Import de liste de CP** | Upload → résolution → zone. Les CP ne sont aujourd'hui qu'une **sortie**. | Petit |
| **Rayon comme outil de zone** | Distinct du rayon de recherche POI existant | Petit |
| **Corrélation** | Nuage de points impressions × indicateur. Route absente, RPC présente | Moyen |
| **ELM** | N'existe nulle part. À spécifier de zéro. | Inconnu |
| **Glisser-déposer des zones cibles** | Ordre par priorité dans l'onglet Stratégie | Petit |

---

---

## Lot 7 — Analyses enregistrées et nouvelles analyses

### Tâche 11 : la table des analyses et le rejeu

**Fichiers :**
- Créer : `sql/144_analyses_enregistrees.sql`, `app/api/analyses/route.ts`,
  `app/api/analyses/[id]/route.ts`, `app/api/analyses/[id]/rejouer/route.ts`,
  `lib/analyses/types.ts`, `tests/unit/analyses/parametres.test.ts`
- Modifier : `types/database.types.ts` (régénérer), `ARCHITECTURE.md`

**Interfaces :**
- Produit : `type TypeAnalyse = 'clusters' | 'score' | 'battle' | 'voronoi' | 'correlation' | 'elm'`,
  `interface AnalyseEnregistree`, `function cleParametres(p): string`.
  Consommé par les tâches 12, 13, 22 et par Calques > Mes analyses (Tâche 6).

- [ ] **Étape 1 : la migration**

```sql
-- sql/144_analyses_enregistrees.sql
-- Une analyse lancee est un objet : nom, parametres, maillage, date, rejouable.
-- N'existait que pour le clustering (clustering_models / clustering_jobs) ; les
-- battles, voronois et isochrones ne laissaient aucune trace.
CREATE TABLE IF NOT EXISTS public.analyses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL,
  type         text NOT NULL CHECK (type IN ('clusters','score','battle','voronoi','correlation','elm')),
  nom          text NOT NULL,
  -- Parametres COMPLETS du lancement : c'est ce qui rend l'analyse rejouable.
  parametres   jsonb NOT NULL,
  -- Palier de maille ('200m','1km','2km','5km','20km','iris','commune','departement').
  maillage     text,
  -- Perimetre : le filtre ou la zone au moment du lancement.
  perimetre    jsonb,
  -- Resultat leger (resume, bornes, compteurs). Les gros volumes restent dans
  -- leurs tables dediees (poi_clusters...), referencees par `parametres`.
  resultat     jsonb,
  statut       text NOT NULL DEFAULT 'termine' CHECK (statut IN ('en_cours','termine','echec')),
  erreur       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analyses_org_date ON public.analyses (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_type     ON public.analyses (org_id, type);

-- RLS deny-all : toutes les routes passent par service_role, comme les rollups.
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
```

Appliquer par **MCP Supabase `apply_migration`**, jamais à la main.

- [ ] **Étape 2 : test de la clé de paramètres**

La clé sert à reconnaître un rejeu à l'identique. Elle doit être **stable à l'ordre des
clés JSON près**, sinon deux lancements identiques produiraient deux entrées.

```ts
// tests/unit/analyses/parametres.test.ts
import { describe, it, expect } from 'vitest';
import { cleParametres } from '@/lib/analyses/types';

describe('cle de parametres d analyse', () => {
  it('ignore l ordre des cles', () => {
    expect(cleParametres({ a: 1, b: 2 })).toBe(cleParametres({ b: 2, a: 1 }));
  });
  it('distingue deux jeux differents', () => {
    expect(cleParametres({ k: 4 })).not.toBe(cleParametres({ k: 7 }));
  });
  it('descend dans les objets imbriques', () => {
    expect(cleParametres({ o: { x: 1, y: 2 } })).toBe(cleParametres({ o: { y: 2, x: 1 } }));
  });
  it('preserve l ordre des tableaux, qui est signifiant', () => {
    expect(cleParametres({ v: [1, 2] })).not.toBe(cleParametres({ v: [2, 1] }));
  });
});
```

- [ ] **Étape 3 : lancer, vérifier l'échec**

Commande : `npx vitest run tests/unit/analyses/parametres.test.ts` → module introuvable.

- [ ] **Étape 4 : implémenter `lib/analyses/types.ts`**

`cleParametres` = sérialisation avec tri récursif des clés d'objet, tableaux laissés en
ordre. Aucune dépendance ajoutée.

- [ ] **Étape 5 : les routes**

`GET /api/analyses?type=` (liste scopée org), `POST /api/analyses` (enregistre),
`GET|DELETE /api/analyses/[id]`, `POST /api/analyses/[id]/rejouer` (relance avec les mêmes
paramètres). Toutes : `export const dynamic = 'force-dynamic'`, corps via `lireCorps()`
(`lib/api/valider-corps.ts`), validation Zod, `createAdminClient()`, `requireAuth`,
scope org.

- [ ] **Étape 6 : brancher Calques > Mes analyses** — le groupe créé en Tâche 6 lit
      `GET /api/analyses` au lieu d'une liste vide.

- [ ] **Étape 7 : vérifier, régénérer les types, commit**

```bash
npx tsc --noEmit && npm test -- --run
git add -A && git commit -m "feat(analyse): une analyse lancee devient un objet rejouable"
```

---

### Tâche 12 : score composite

**Fichiers :**
- Créer : `sql/145_score_composite.sql`, `app/api/analyses/score/route.ts`,
  `lib/analyses/score.ts`, `tests/unit/analyses/score.test.ts`
- Modifier : `app/map/_components/panneaux/PanneauAnalyse.tsx` (Tâche 7)

**Interfaces :**
- Consomme : `AnalyseEnregistree` (Tâche 11), la table `indicator_cp_values`,
  la route `/api/custom-geo/source/indicator-threshold` (existante).
- Produit : `function normaliser(valeurs, sens)`, `function scoreComposite(lignes, poids)`.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// tests/unit/analyses/score.test.ts
import { describe, it, expect } from 'vitest';
import { normaliser, scoreComposite } from '@/lib/analyses/score';

describe('score composite', () => {
  it('normalise sur 0-100, min et max compris', () => {
    expect(normaliser([10, 20, 30], 'croissant')).toEqual([0, 50, 100]);
  });
  it('inverse le sens quand l indicateur est defavorable', () => {
    expect(normaliser([10, 20, 30], 'decroissant')).toEqual([100, 50, 0]);
  });
  it('rend 50 partout quand toutes les valeurs sont egales', () => {
    expect(normaliser([7, 7, 7], 'croissant')).toEqual([50, 50, 50]);
  });
  it('pondere et ramene a 100', () => {
    const lignes = [{ code: '13001', valeurs: [100, 0] }];
    expect(scoreComposite(lignes, [0.75, 0.25])[0].score).toBe(75);
  });
  it('ecarte une ligne dont toutes les valeurs manquent', () => {
    const lignes = [{ code: '13002', valeurs: [null, null] }];
    expect(scoreComposite(lignes, [0.5, 0.5])).toEqual([]);
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

- [ ] **Étape 3 : implémenter**

`normaliser` : min-max sur la population observée, `50` si l'étendue est nulle.
`scoreComposite` : somme pondérée des valeurs normalisées, poids re-normalisés à 1 si leur
somme diffère, ligne écartée si **toutes** ses valeurs sont nulles.

- [ ] **Étape 4 : relancer, vérifier le succès**

- [ ] **Étape 5 : la RPC**

```sql
-- sql/145_score_composite.sql
-- Score composite par CP : plusieurs indicateurs de indicator_cp_values,
-- normalises puis ponderes. La normalisation se fait EN SQL sur le perimetre
-- demande, JAMAIS sur la France entiere (budget I/O Nano).
CREATE OR REPLACE FUNCTION public.calculer_score_composite(
  p_indicateurs   text[],    -- variable_code de indicator_cp_values
  p_poids         numeric[],
  p_sens          text[],    -- 'croissant' | 'decroissant', un par indicateur
  p_codes_postaux text[]     -- perimetre OBLIGATOIRE : la liste de CP du filtre/zone
) RETURNS TABLE (postal_code text, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH base AS (
    SELECT v.postal_code, v.variable_code, v.valeur, i.poids, i.sens
    FROM public.indicator_cp_values v
    JOIN LATERAL (
      SELECT p_poids[g.ord] AS poids, p_sens[g.ord] AS sens
      FROM generate_subscripts(p_indicateurs, 1) AS g(ord)
      WHERE p_indicateurs[g.ord] = v.variable_code
    ) i ON true
    WHERE v.postal_code = ANY(p_codes_postaux)
  ), bornes AS (
    SELECT variable_code, MIN(valeur) AS mn, MAX(valeur) AS mx FROM base GROUP BY 1
  ), normalise AS (
    SELECT b.postal_code, b.poids,
           CASE WHEN bo.mx = bo.mn THEN 50
                WHEN b.sens = 'decroissant'
                  THEN 100 - 100 * (b.valeur - bo.mn) / (bo.mx - bo.mn)
                ELSE 100 * (b.valeur - bo.mn) / (bo.mx - bo.mn) END AS v
    FROM base b JOIN bornes bo USING (variable_code)
  )
  SELECT postal_code, ROUND(SUM(v * poids) / NULLIF(SUM(poids), 0), 1)
  FROM normalise GROUP BY postal_code;
$fn$;

REVOKE ALL ON FUNCTION public.calculer_score_composite(text[], numeric[], text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculer_score_composite(text[], numeric[], text[], text[])
  TO service_role;
```

**Avant d'appliquer : `EXPLAIN ANALYZE` sur un périmètre d'environ 500 CP**, et reporter
la mesure dans le message de commit (règle `CLAUDE.md`).

- [ ] **Étape 6 : l'UI**

Dans `PanneauAnalyse` : choix des indicateurs lus depuis `iris_indicator_registry`
(**jamais** une liste en dur), poids par curseur, sens par bascule ; sortie = calque de
score 0-100 plus un bouton « Créer une zone au-dessus d'un seuil » qui appelle
`/api/custom-geo/source/indicator-threshold` (existant).

- [ ] **Étape 7 : vérifier, `ARCHITECTURE.md` (1 route + 1 RPC), commit**

---

### Tâche 13 : corrélation impressions × indicateur

**Fichiers :**
- Créer : `app/api/analyses/correlation/route.ts`, `lib/analyses/correlation.ts`,
  `tests/unit/analyses/correlation.test.ts`
- Modifier : `PanneauAnalyse.tsx`, `ARCHITECTURE.md`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// tests/unit/analyses/correlation.test.ts
import { describe, it, expect } from 'vitest';
import { pearson, apparier } from '@/lib/analyses/correlation';

describe('correlation', () => {
  it('rend 1 sur une relation croissante parfaite', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
  });
  it('rend -1 sur une relation decroissante parfaite', () => {
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 6);
  });
  it('rend 0 quand une serie est constante, jamais NaN', () => {
    expect(pearson([1, 2, 3], [5, 5, 5])).toBe(0);
  });
  it('apparie sur le code postal et ecarte les CP non communs', () => {
    const a = [{ code: '75001', v: 10 }, { code: '75002', v: 20 }];
    const b = [{ code: '75002', v: 5 },  { code: '75003', v: 9 }];
    expect(apparier(a, b)).toEqual([{ code: '75002', x: 20, y: 5 }]);
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

- [ ] **Étape 3 : implémenter** — `pearson` rend `0` et non `NaN` quand un écart-type est
      nul : un `NaN` remonterait jusqu'au graphe et casserait l'axe.

- [ ] **Étape 4 : relancer, vérifier le succès**

- [ ] **Étape 5 : la route**

`GET /api/analyses/correlation?campaignId=&variable=` apparie `campaign_cp_rollup`
(impressions par CP, **déjà agrégé** — ne jamais scanner `dsp_campaign_data`) avec
`indicator_cp_values`. Enregistre l'analyse via la Tâche 11.

- [ ] **Étape 6 : l'UI** — nuage de points Recharts (`ScatterChart`, déjà installé),
      coefficient et `n` affichés.

- [ ] **Étape 7 : `ARCHITECTURE.md`** — ajouter la route, et **retirer** la mention fausse
      de `api/correlation/compute/`.

- [ ] **Étape 8 : vérifier et commit**

---

## Lot 8 — Zones : opérations, composition, nouveaux modes de création

### Tâche 14 : intersection et soustraction

**Fichiers :**
- Créer : `sql/146_zones_booleen.sql`, `app/api/custom-geo/source/intersection/route.ts`,
  `app/api/custom-geo/source/difference/route.ts`
- Modifier : `PanneauZones.tsx`

**Fusionner existe déjà** (`/api/custom-geo/source/composite`, union de 2 à 20 zones). Les
deux nouvelles routes en reprennent **exactement** la structure : `requireAuth`,
`checkZoneAccess` par lots de 3 (contrainte Nano), `lireCorps()`, Zod,
`createAdminClient()`.

- [ ] **Étape 1 : la migration**

```sql
-- sql/146_zones_booleen.sql
-- Intersection et difference de zones custom. L'union existe deja cote route
-- (composite). ST_MakeValid avant toute operation : une geometrie capturee
-- depuis des carreaux ou des isochrones peut etre invalide, et ST_Intersection
-- leve sur une entree invalide.
CREATE OR REPLACE FUNCTION public.zone_intersection(p_zone_ids uuid[])
RETURNS geometry LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT ST_Multi(ST_CollectionExtract(ST_Intersection(a.g, b.g), 3))
  FROM (SELECT ST_MakeValid(geometry) AS g FROM public.custom_geo_zones
         WHERE id = p_zone_ids[1]) a,
       (SELECT ST_MakeValid(ST_Union(geometry)) AS g FROM public.custom_geo_zones
         WHERE id = ANY(p_zone_ids[2:])) b;
$fn$;

CREATE OR REPLACE FUNCTION public.zone_difference(p_base uuid, p_retires uuid[])
RETURNS geometry LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT ST_Multi(ST_CollectionExtract(
    ST_Difference(
      (SELECT ST_MakeValid(geometry) FROM public.custom_geo_zones WHERE id = p_base),
      (SELECT ST_MakeValid(ST_Union(geometry)) FROM public.custom_geo_zones
        WHERE id = ANY(p_retires))
    ), 3));
$fn$;

REVOKE ALL ON FUNCTION public.zone_intersection(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zone_difference(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zone_intersection(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.zone_difference(uuid, uuid[]) TO service_role;
```

- [ ] **Étape 2 : le cas limite, traité explicitement**

Une intersection vide rend une géométrie vide : la route répond **409
`intersection_vide`** avec un message français. Elle ne crée pas une zone à zéro CP en
silence — cette zone partirait ensuite au DSP.

- [ ] **Étape 3 : l'UI**

Cases à cocher sur « Mes zones », barre d'opérations **Fusionner / Intersection /
Soustraire**. Soustraire exige exactement une zone de base (la première cochée) et au
moins une retirée ; le bouton reste désactivé sinon.

- [ ] **Étape 4 : recalculer la liste de CP**

Après chaque opération, appeler `resolve_custom_geo_zone_codes` (existant). Sans cela la
zone aurait une géométrie neuve et une liste de CP périmée — et c'est cette liste que
consomme le DSP.

- [ ] **Étape 5 : `EXPLAIN ANALYZE`, vérifier, `ARCHITECTURE.md` (2 routes + 2 RPC), commit**

---

### Tâche 15 : composition de zone en clair

**Fichiers :**
- Créer : `lib/custom-geo/composition.ts`, `tests/unit/custom-geo/composition.test.ts`
- Modifier : `PanneauZones.tsx`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// tests/unit/custom-geo/composition.test.ts
import { describe, it, expect } from 'vitest';
import { decrireComposition } from '@/lib/custom-geo/composition';

describe('composition lisible d une zone', () => {
  it('decrit une capture IRIS', () => {
    expect(decrireComposition('iris', { feature_count: 992 })).toBe('992 IRIS sélectionnés');
  });
  it('decrit une difference de zones administratives', () => {
    expect(decrireComposition('composite', {
      kind: 'difference', base_label: '3 départements', retires_labels: ['Paris'],
    })).toBe('3 départements moins Paris');
  });
  it('decrit une capture mixte', () => {
    expect(decrireComposition('composite', {
      kind: 'union', member_labels: ['412 IRIS', 'isochrone 15 min'],
    })).toBe('412 IRIS et isochrone 15 min');
  });
  it('retombe sur le type quand la metadata est muette', () => {
    expect(decrireComposition('battle', {})).toBe('Bataille isochrone');
  });
  it('ne jette jamais sur une metadata inattendue', () => {
    expect(() => decrireComposition('iris', { feature_count: null })).not.toThrow();
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

- [ ] **Étape 3 : implémenter** — lecture de `source_type` + `source_metadata`,
      **aucune requête** : la description est dérivée, jamais stockée.

- [ ] **Étape 4 : relancer, vérifier le succès**

- [ ] **Étape 5 : afficher** dans « Mes zones », avec le nombre de CP (`feature_count_cp`,
      déjà en base) et la population (`audience_stats`).

- [ ] **Étape 6 : commit**

---

### Tâche 16 : import d'une liste de codes postaux

**Fichiers :**
- Créer : `app/api/custom-geo/source/codes-postaux/route.ts`,
  `lib/custom-geo/parse-cp.ts`, `tests/unit/custom-geo/parse-cp.test.ts`
- Modifier : `PanneauZones.tsx`, `ARCHITECTURE.md`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// tests/unit/custom-geo/parse-cp.test.ts
import { describe, it, expect } from 'vitest';
import { parserCodesPostaux } from '@/lib/custom-geo/parse-cp';

describe('parseur de liste de CP', () => {
  it('accepte virgule, point-virgule, espace et retour ligne', () => {
    expect(parserCodesPostaux('75001,75002; 75003\n75004').codes)
      .toEqual(['75001', '75002', '75003', '75004']);
  });
  it('conserve le zero initial du 01 et de la Corse', () => {
    expect(parserCodesPostaux('01000 20000').codes).toEqual(['01000', '20000']);
  });
  it('dedoublonne en conservant l ordre', () => {
    expect(parserCodesPostaux('75001 75001 75002').codes).toEqual(['75001', '75002']);
  });
  it('signale les entrees invalides sans faire echouer le lot', () => {
    const r = parserCodesPostaux('75001 ABCDE 7500');
    expect(r.codes).toEqual(['75001']);
    expect(r.rejetes).toEqual(['ABCDE', '7500']);
  });
  it('applique trim — les CSV INSEE portent des espaces invisibles', () => {
    expect(parserCodesPostaux(' 75001 \t').codes).toEqual(['75001']);
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

- [ ] **Étape 3 : implémenter** — un CP valide fait exactement 5 chiffres. `.trim()`
      obligatoire (règle `CLAUDE.md` sur les données CSV INSEE).

- [ ] **Étape 4 : relancer, vérifier le succès**

- [ ] **Étape 5 : la route** — résout la géométrie depuis `ref_codes_postaux`, **borne à
      2 000 CP** par appel, rend les CP inconnus séparément pour que l'UI les affiche.
      Fichier déposé lu par `lireFormulaire()` + `fichierDeFormulaire()`, **jamais**
      `formData.get('file') as File`.

- [ ] **Étape 6 : l'UI** — zone de texte **ou** dépôt de fichier dans « Créer une zone »,
      avec l'aperçu du nombre reconnu / rejeté avant création.

- [ ] **Étape 7 : `ARCHITECTURE.md`, vérifier, commit**

---

### Tâche 17 : rayon comme outil de zone

**Fichiers :**
- Créer : `app/api/custom-geo/source/rayon/route.ts`
- Modifier : `PanneauZones.tsx`, `ARCHITECTURE.md`

**Ne pas confondre** avec `rayon_poi` / `poisRayon` (`FilterPanel.tsx:230`), qui est un
rayon de **recherche de POI** et reste où il est.

- [ ] **Étape 1 : la route** — corps `{ lon, lat, rayon_m }`, `rayon_m` borné à
      **100 000 m** (au-delà, la zone couvre une région entière et la résolution de CP
      explose). Géométrie = `ST_Buffer(geography, rayon_m)::geometry`, **clippée sur
      `france_borders`** comme les isochrones.
- [ ] **Étape 2 : l'UI** — clic sur la carte pour poser le centre, curseur de rayon,
      aperçu du cercle avant enregistrement.
- [ ] **Étape 3 : `ARCHITECTURE.md`, vérifier, commit**

---

### Tâche 18 : dessin libre

**Fichiers :**
- Modifier : `package.json` (`terra-draw` + `terra-draw-maplibre-gl-adapter`),
  `PanneauZones.tsx`, `ARCHITECTURE.md`
- Créer : `app/map/_components/DessinLibre.tsx`,
  `app/api/custom-geo/source/dessin/route.ts`

- [ ] **Étape 1 : la dépendance** — `terra-draw` est le seul moteur de dessin qui pilote
      MapLibre 5 nativement (`mapbox-gl-draw` exige un adaptateur non maintenu).
      **Vérifier la CSP de `next.config.js:9-43`** avant de coder : la librairie est
      bundlée et non chargée d'un CDN, donc aucune directive ne devrait être à ouvrir —
      le confirmer, ne pas le supposer.
- [ ] **Étape 2 : le composant** — modes polygone et rectangle, annuler / refaire,
      fermeture automatique du tracé.
- [ ] **Étape 3 : la route** — reçoit le GeoJSON tracé, `ST_MakeValid`, clip sur
      `france_borders`, refuse en 409 une géométrie auto-intersectante irrécupérable.
- [ ] **Étape 4 : `ARCHITECTURE.md`** (nouvelle dépendance externe — le test de dérive
      documentaire la vérifie), vérifier, commit

---

## Lot 9 — Campagne : versionnage, activation, priorités

### Tâche 19 : versionnage de stratégie

**Fichiers :**
- Créer : `sql/147_strategie_versions.sql`,
  `app/api/bidding/strategies/[id]/publier/route.ts`,
  `lib/campaigns/version-strategie.ts`, `tests/unit/campaigns/version-strategie.test.ts`
- Modifier : l'onglet Stratégie (Tâche 9), `ARCHITECTURE.md`

- [ ] **Étape 1 : la migration**

```sql
-- sql/147_strategie_versions.sql
-- Une strategie publiee est figee : on garde l'empreinte des zones au moment
-- de la publication, pour pouvoir dire « la zone X a change depuis la vN ».
CREATE TABLE IF NOT EXISTS public.strategie_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategie_id    uuid NOT NULL,
  version         integer NOT NULL,
  publiee_le      timestamptz NOT NULL DEFAULT now(),
  publiee_par     uuid NOT NULL,
  -- Empreinte par zone : { zone_id: updated_at } au moment de la publication.
  empreinte_zones jsonb NOT NULL DEFAULT '{}'::jsonb,
  charge_utile    jsonb NOT NULL,
  UNIQUE (strategie_id, version)
);

CREATE INDEX IF NOT EXISTS idx_strategie_versions_strat
  ON public.strategie_versions (strategie_id, version DESC);

ALTER TABLE public.strategie_versions ENABLE ROW LEVEL SECURITY;
```

- [ ] **Étape 2 : écrire le test qui échoue**

```ts
// tests/unit/campaigns/version-strategie.test.ts
import { describe, it, expect } from 'vitest';
import { zonesModifiees } from '@/lib/campaigns/version-strategie';

describe('derive d une strategie publiee', () => {
  it('ne signale rien quand aucune zone n a bouge', () => {
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-01T10:00:00Z' },
    )).toEqual([]);
  });
  it('signale la zone dont updated_at a avance', () => {
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-02T08:00:00Z' },
    )).toEqual(['z1']);
  });
  it('signale une zone ajoutee depuis la publication', () => {
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-01T10:00:00Z', z2: '2026-09-03T00:00:00Z' },
    )).toEqual(['z2']);
  });
  it('signale une zone retiree depuis la publication', () => {
    expect(zonesModifiees(
      { z1: '2026-09-01T10:00:00Z', z2: '2026-09-01T10:00:00Z' },
      { z1: '2026-09-01T10:00:00Z' },
    )).toEqual(['z2']);
  });
});
```

- [ ] **Étape 3 : lancer, vérifier l'échec**

- [ ] **Étape 4 : implémenter**

- [ ] **Étape 5 : relancer, vérifier le succès**

- [ ] **Étape 6 : l'UI** — encart « Vérifier et publier » (crée la version N+1), bandeau
      « a changé depuis la publication de la v{N}, republier » quand `zonesModifiees` n'est
      pas vide, et un tag sur chaque ligne concernée.

- [ ] **Étape 7 : vérifier, `ARCHITECTURE.md` (1 route + 1 table), commit**

---

### Tâche 20 : onglet Activation

**Fichiers :**
- Créer : `components/campaign/ActivationPanel.tsx`, `sql/148_activation_lots.sql`,
  `app/api/campaigns/[id]/activation/previol/route.ts`,
  `app/api/campaigns/[id]/activation/pousser/route.ts`,
  `app/api/campaigns/[id]/activation/historique/route.ts`,
  `app/api/campaigns/[id]/activation/rollback/route.ts`
- Modifier : `MagelianOverlay.tsx`, `components/magelian/deep-link.ts`,
  `tests/unit/magelian-deep-link.test.ts`, `ARCHITECTURE.md`

Le push DV360 existe (`/api/admin/dsp/dv360/targeting/push`, `/zones/push`) mais **nu** :
ni pré-vol, ni statut par line item, ni historique, ni retour arrière. Ces routes
l'**enveloppent**, elles ne le réécrivent pas — et elles ne touchent à aucun fichier
protégé.

- [ ] **Étape 1 : la migration**

```sql
-- sql/148_activation_lots.sql
-- Historique des poussees vers les DSP, par lot et par line item, pour afficher
-- un statut et pouvoir revenir en arriere.
CREATE TABLE IF NOT EXISTS public.activation_lots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL,
  org_id            uuid NOT NULL,
  canal             text NOT NULL,   -- code du dsp_channel_registry
  version_strategie integer,
  statut            text NOT NULL DEFAULT 'en_cours'
                    CHECK (statut IN ('en_cours','termine','partiel','echec','annule')),
  lance_par         uuid NOT NULL,
  lance_le          timestamptz NOT NULL DEFAULT now(),
  termine_le        timestamptz
);

CREATE TABLE IF NOT EXISTS public.activation_cibles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id        uuid NOT NULL REFERENCES public.activation_lots(id) ON DELETE CASCADE,
  line_item_id  text NOT NULL,
  line_item_nom text,
  statut        text NOT NULL DEFAULT 'en_attente'
                CHECK (statut IN ('en_attente','pousse','echec','annule')),
  erreur        text,
  -- Etat AVANT la poussee : c'est ce qui rend le rollback possible.
  etat_avant    jsonb,
  maj_le        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activation_lots_campagne
  ON public.activation_lots (campaign_id, lance_le DESC);
CREATE INDEX IF NOT EXISTS idx_activation_cibles_lot
  ON public.activation_cibles (lot_id);

ALTER TABLE public.activation_lots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_cibles ENABLE ROW LEVEL SECURITY;
```

- [ ] **Étape 2 : le pré-vol, en LECTURE SEULE**

Liste ce qui sera poussé : canal, line items visés, nombre de CP, nombre de geo IDs
résolus, bornes de CPM, version de stratégie. **Aucun appel d'écriture au DSP.** Bloque si
la stratégie n'est pas publiée, ou si `zonesModifiees` (Tâche 19) n'est pas vide.

- [ ] **Étape 3 : le push par lots**

Réutilise les routes DV360 existantes, par lots de 500 geo IDs (limite déjà appliquée par
`/zones/push`). **Progression SSE/NDJSON obligatoire** — règle `CLAUDE.md` : jamais de
traitement DB silencieux. Un `activation_cibles` par line item, `etat_avant` enregistré
**avant** l'appel sortant.

- [ ] **Étape 4 : historique et rollback**

Rollback = repousser `etat_avant` pour chaque cible du lot, puis statut `annule`.
Confirmation explicite côté UI : c'est une action sortante et difficilement réversible.

- [ ] **Étape 5 : le quatrième onglet**

`MagelianOverlay.tsx:405-409` passe à : Stratégie · **Activation** · Suivi · Aperçu.
Mettre à jour `MagelianTab` (`deep-link.ts:3`) et `tests/unit/magelian-deep-link.test.ts`
**dans le même commit**.

- [ ] **Étape 6 : vérifier, `ARCHITECTURE.md` (4 routes + 2 tables), commit**

---

### Tâche 21 : priorité des zones cibles par glisser-déposer

**Fichiers :**
- Créer : `lib/campaigns/priorite.ts`, `tests/unit/campaigns/priorite.test.ts`
- Modifier : `components/campaign/wizard/` (tableau des zones cibles)

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// tests/unit/campaigns/priorite.test.ts
import { describe, it, expect } from 'vitest';
import { deplacer } from '@/lib/campaigns/priorite';

describe('reordonnancement des zones cibles', () => {
  it('deplace un element vers le haut', () => {
    expect(deplacer(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
  it('deplace un element vers le bas', () => {
    expect(deplacer(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });
  it('ne change rien quand la position est identique', () => {
    expect(deplacer(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
  it('ne mute pas le tableau d entree', () => {
    const src = ['a', 'b'];
    deplacer(src, 0, 1);
    expect(src).toEqual(['a', 'b']);
  });
  it('ignore un index hors bornes', () => {
    expect(deplacer(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

- [ ] **Étape 3 : implémenter** — aucune dépendance de drag & drop ajoutée : l'API HTML5
      `draggable` suffit pour une liste de quelques lignes.

- [ ] **Étape 4 : relancer, vérifier le succès**

- [ ] **Étape 5 : persister l'ordre** dans `geo_strategy`, vérifier, commit

---

### Tâche 22 : ELM

> **QUESTION OUVERTE — à lever avant d'exécuter cette tâche.**
>
> La spec dit : « ELM : une zone plus une activité, rapport PDF en sortie ». C'est tout ce
> que le dépôt contient sur le sujet — l'acronyme n'apparaît nulle part : ni dans le code,
> ni dans les docs, ni dans les migrations. Le **contenu** du rapport ne peut pas être
> planifié sans savoir ce que l'étude doit démontrer, ni à qui elle s'adresse.

**Ce qui est décidable sans la réponse :**

- [ ] **Étape 1 : réinstaller `@react-pdf/renderer`**, retiré en dommage collatéral de la
      suppression du clustering (commit `7192c68`) — il n'avait pas d'autre consommateur.
      `ARCHITECTURE.md` le liste pourtant encore comme dépendance : le doc redeviendra
      vrai. Le composant d'origine est récupérable :
      `git show 9213439^:components/ClusteringPDFReport.tsx`.
- [ ] **Étape 2 : l'ossature** — `POST /api/analyses/elm` prend `{ zone_id, activite }`,
      enregistre une analyse de type `elm` (Tâche 11) et rend un PDF.
- [ ] **Étape 3 : le contenu du rapport** — **bloqué** sur la réponse à la question
      ci-dessus.

---

## Auto-revue

**Couverture de la spec.** §1 rail → Tâches 1-2. §2 reclassement → Tâches 4, 6, 7.
§3 Filtre → Tâches 3-4. §4 Calques → Tâches 5-6. §5 Analyse → Tâche 7 (garde de périmètre),
Tâche 11 (analyses enregistrées et rejouables), Tâche 12 (score composite), Tâche 13
(corrélation), Tâche 22 (ELM). §6 Zones → Tâche 7 (capture), Tâche 14 (booléens),
Tâche 15 (composition en clair), Tâche 16 (import de CP), Tâche 17 (rayon), Tâche 18
(dessin libre) ; la liste de CP est **déjà** stockée. §7 Campagne → Tâche 9 (onglets,
campagne active), Tâche 19 (versionnage + bandeau vN), Tâche 20 (Activation),
Tâche 21 (glisser-déposer). §8 État global → Tâches 8-9.
Contraintes techniques → section « Contraintes globales ». Post-livraison → Tâche 10 étape 4.

**Une seule zone d'ombre subsiste : ELM** (Tâche 22, étape 3). L'ossature est planifiée,
le contenu du rapport ne l'est pas — faute de savoir ce que l'étude démontre.

**Ordre d'exécution.** Les tâches 1 à 10 d'abord : elles posent le socle que les tâches 11
à 22 viennent garnir (Calques > Mes analyses attend la Tâche 11, le panneau Analyse attend
12 et 13, le panneau Zones attend 14 à 18, l'overlay Campagne attend 19 à 21). Exécuter une
tâche de Phase 2 avant son socle obligerait à la refaire.

**Cohérence des types.** `EntreeId`, `PanneauId`, `TypePanneau` définis en Tâche 1 et
consommés tels quels en 2, 8, 9. `FiltreActif` défini en 3, consommé en 4 et 9.
`DegradeId` défini en 5, consommé en 6. `LARGEUR_RAIL` et `ECART_RAIL_PANNEAU` définis en
1, consommés en 2, 4, 6.

**Points d'attention pour l'exécutant.**
1. `FilterPanel.tsx` reçoit ~140 props de `page.tsx:674-814`. Les lots 2 à 4 les
   redistribuent ; le fichier ne doit être supprimé qu'en Tâche 8, une fois vide.
2. La spec demande une « ombre légère » sur le bouton Campagne ; `DESIGN_SYSTEM.md` §7.10
   interdit toute ombre. Le design system l'emporte — arbitrage noté en Tâche 2 étape 2.
3. La spec demande de supprimer les puces décoratives des groupes ; le design system
   impose un dot teal sur les section headers. Résolution : le dot reste sur l'en-tête du
   panneau, il disparaît des groupes internes (Tâche 6 étape 2).
