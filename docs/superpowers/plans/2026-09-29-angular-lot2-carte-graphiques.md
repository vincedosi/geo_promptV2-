# Angular — Lot 2 : carte et graphiques — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les deux briques techniques du module risque — une carte MapLibre et une courbe — en Angular, prouvées sur une page d'essai qui affiche les VRAIES zones de risque, les vrais sites et la vraie courbe de couverture, avec les mêmes chiffres que l'API.

**Architecture:** Un composant `mg-carte` qui possède le cycle de vie de MapLibre (création après rendu, `ResizeObserver`, destruction) et rend la carte à son parent, qui y pose ses sources et couches. Des utilitaires sans DOM (`lierCameras`, `chargerParCadre`, `contenuPopup`, `bbox`) testés sur une carte factice. Un `CouleursService` qui lit la valeur CALCULÉE des jetons CSS — MapLibre et ECharts ne résolvent pas `var()`, et côté React c'était la raison de tables d'hexadécimaux recopiées ; ici il n'y en a plus. Un composant `mg-courbe` sur Apache ECharts (import modulaire, rendu SVG).

**Tech Stack:** Angular 21.2.4, `maplibre-gl` 5.18.0 (version exacte installée à la racine), `echarts` 6.x (nouvelle dépendance, décision P7 de la feuille de route), Vitest.

**Spec:** `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (lot 2, P7, « À savoir pour les lots suivants »).

**Inventaire qui fonde ce plan (2026-09-29).** Le module risque monte trois cartes MapLibre (`CarteRisque`, `CarteCodesPostaux`, `CarteCampagne`), toutes sur le fond OpenFreeMap Positron dans les deux thèmes, toutes permanentes avec `ResizeObserver`, deux d'entre elles liées par un verrou de réentrance et `jumpTo`. Sources : les tuiles MVT `/api/tiles/zones-risque/{z}/{x}/{y}` (protégées par COOKIE, chargées par MapLibre lui-même) et des GeoJSON chargés à la main par `fetch` authentifié puis posés par `setData`, sur la bbox visible, au `moveend` (jamais au `move`), avec un délai de 350 ms. Graphiques : DEUX courbes Recharts seulement (`OngletRayonInfluence`, `PanneauCampagne`) — une courbe par nature avec un repère vertical au rayon choisi et une légende cliquable maison. La mini-carte de France est du SVG dessiné à la main, pas MapLibre : elle part au lot 3 avec son écran.

## Global Constraints

- Angular **21.2.4** exact. Nouvelles dépendances, et SEULEMENT celles-ci : `maplibre-gl` **5.18.0** exact (même version que la racine) et `echarts` en version exacte (la dernière 6.x publiée au moment de l'installation, notée dans le rapport).
- **Aucun import croisé** : rien dans `angular/` n'importe hors de `angular/`.
- **Aucune couleur en dur**, y compris pour MapLibre et ECharts : toute couleur passe par `CouleursService`, qui lit un jeton de `styles/jetons.css`.
- **Règles d'I/O de `CLAUDE.md`** : données de carte chargées sur la bbox VISIBLE, au `moveend` et jamais au `move`, avec délai ; jamais la France entière au premier chargement ; au plus 3 appels simultanés (tenu par `limiteurInterceptor` pour tout ce qui passe par `HttpClient`).
- **Gzip MVT** : rien à faire côté client, mais ne jamais faire passer les tuiles par `HttpClient` — MapLibre les charge lui-même, avec le cookie (route protégée par `middleware.ts`).
- Textes d'interface en français, sentence case. Composants `OnPush`, `input()`/`output()`, préfixe `mg`.
- Les composants de `carte/` et `graphiques/` sont **génériques** ; seul la page d'essai parle de risque.
- Ne pas modifier `middleware.ts`. Ne jamais pousser. Git : `export PATH="/c/GENESIS/PortableGit/cmd:$PATH"`.
- Après chaque tâche : `cd angular && npx ng test --watch=false && npm run build` verts ; à la racine `npx tsc --noEmit` (sans pipe) et `npm run test:unit` verts.

## Review Focus

- **Bascule de thème** : toutes les couleurs de carte et de courbe suivent, sans recharger la page ni reconstruire la carte. → test dans la tâche 1 (`CouleursService` relit après bascule) et dans la tâche 4 (`mg-courbe` repose ses options).
- **Panoramique rapide** : dix `moveend` en une seconde ne déclenchent qu'UN appel, et une réponse périmée n'écrase jamais une plus récente. → test dans la tâche 3.
- **Deux cartes liées** : déplacer l'une ne fait pas trembler l'autre (pas de boucle). → test dans la tâche 3.
- **Quitter la page** : la carte et le graphique sont détruits, leurs observateurs débranchés, aucun chargement ne se termine sur une carte détruite. → tests dans les tâches 2, 3 et 4.
- **Jeton inconnu** : une faute de frappe dans un nom de jeton doit échouer bruyamment, pas peindre en noir. → test dans la tâche 1.

---

### Task 1: Couleurs résolues depuis les jetons

**Files:**
- Modify: `angular/src/app/core/theme/theme.service.ts` + `theme.service.spec.ts` (signal `themeApplique`)
- Create: `angular/src/app/core/theme/couleurs.service.ts` + `couleurs.service.spec.ts`

**Interfaces:**
- Consumes: `ThemeService`.
- Produces: `ThemeService.themeApplique: Signal<Theme>` (change APRÈS la pose de la classe sur `<html>`) ; `CouleursService.palette<K extends string>(jetons: Record<K, string>): Signal<Record<K, string>>` — les clés sont celles de l'appelant, les valeurs des NOMS de jetons sans `--` (ex. `{ haut: 'niveau-haut' }`), le signal rend les couleurs calculées.

- [ ] **Step 1: `themeApplique` — test puis implémentation**

Ajouter à `angular/src/app/core/theme/theme.service.spec.ts` :

```ts
  it('themeApplique ne change qu\'une fois la classe posée', () => {
    const theme = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(theme.themeApplique()).toBe('dark');
    theme.basculer();
    expect(theme.themeApplique()).toBe('dark'); // effet pas encore passé
    TestBed.tick();
    expect(theme.themeApplique()).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });
```

Dans `angular/src/app/core/theme/theme.service.ts`, ajouter un signal privé `_themeApplique = signal<Theme>(<valeur initiale du thème>)`, exposé en lecture seule `themeApplique`, et dans l'`effect` existant, APRÈS les deux `classList.toggle`, `this._themeApplique.set(t);`. Commentaire : « Les couleurs calculées ne sont justes qu'une fois la classe posée : qui lit `getComputedStyle` doit dépendre de ce signal-ci, jamais de `theme`. »

- [ ] **Step 2: `CouleursService` — test (échec attendu)**

Créer `angular/src/app/core/theme/couleurs.service.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { CouleursService } from './couleurs.service';
import { ThemeService } from './theme.service';

describe('CouleursService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.style.setProperty('--essai-a', '#112233');
    document.documentElement.style.setProperty('--essai-b', ' rgba(1, 2, 3, 0.5) ');
  });
  afterEach(() => {
    document.documentElement.style.removeProperty('--essai-a');
    document.documentElement.style.removeProperty('--essai-b');
  });

  it('rend la valeur calculée de chaque jeton, sous les clés de l\'appelant', () => {
    const p = TestBed.inject(CouleursService).palette({ fond: 'essai-a', trait: 'essai-b' });
    TestBed.tick();
    expect(p()).toEqual({ fond: '#112233', trait: 'rgba(1, 2, 3, 0.5)' });
  });

  it('relit après une bascule de thème', () => {
    const p = TestBed.inject(CouleursService).palette({ fond: 'essai-a' });
    TestBed.tick();
    expect(p().fond).toBe('#112233');
    document.documentElement.style.setProperty('--essai-a', '#445566');
    TestBed.inject(ThemeService).basculer();
    TestBed.tick();
    expect(p().fond).toBe('#445566');
  });

  it('échoue en nommant un jeton inconnu, au lieu de peindre en noir', () => {
    const p = TestBed.inject(CouleursService).palette({ fond: 'jeton-qui-nexiste-pas' });
    TestBed.tick();
    expect(() => p()).toThrow(/--jeton-qui-nexiste-pas/);
  });
});
```

Run: `cd angular && npx ng test --watch=false` — Expected: FAIL (module introuvable).

- [ ] **Step 3: `CouleursService` — implémentation**

Créer `angular/src/app/core/theme/couleurs.service.ts` :

```ts
import { DOCUMENT, Injectable, type Signal, computed, inject } from '@angular/core';
import { ThemeService } from './theme.service';

/**
 * Les couleurs CALCULÉES des jetons de `styles/jetons.css`, pour les
 * bibliothèques qui ne savent pas lire `var()` : MapLibre (`paint`) et ECharts.
 *
 * Côté React, ces bibliothèques recevaient des tables d'hexadécimaux recopiées
 * des jetons (`lib/carte/palette-zones-risque.ts`, `lib/campagne/palette-*.ts`),
 * tenues à jour à la main et par des tests de parité. Ici, la valeur est LUE
 * dans le CSS au moment de l'affichage : il n'existe qu'une définition.
 */
@Injectable({ providedIn: 'root' })
export class CouleursService {
  private readonly doc = inject(DOCUMENT);
  private readonly theme = inject(ThemeService);

  palette<K extends string>(jetons: Record<K, string>): Signal<Record<K, string>> {
    return computed(() => {
      this.theme.themeApplique();
      const style = this.doc.defaultView!.getComputedStyle(this.doc.documentElement);
      const sortie = {} as Record<K, string>;
      for (const cle of Object.keys(jetons) as K[]) {
        const nom = `--${jetons[cle]}`;
        const valeur = style.getPropertyValue(nom).trim();
        if (!valeur) {
          throw new Error(`Jeton de couleur inconnu : ${nom} (voir angular/src/styles/jetons.css).`);
        }
        sortie[cle] = valeur;
      }
      return sortie;
    });
  }
}
```

Run: `cd angular && npx ng test --watch=false` — Expected: les tests de la tâche PASS.

- [ ] **Step 4: Vérifier et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src/app/core/theme
git commit -m "feat(angular): couleurs lues dans les jetons pour MapLibre et ECharts"
```

---

### Task 2: Le composant carte

**Files:**
- Modify: `angular/package.json`, `angular/package-lock.json` (dépendance `maplibre-gl` 5.18.0 exact)
- Modify: `angular/angular.json` (feuille de style `maplibre-gl/dist/maplibre-gl.css`)
- Create: `angular/src/app/carte/bbox.ts` + `bbox.spec.ts`
- Create: `angular/src/app/carte/fabrique-carte.ts`
- Create: `angular/src/app/carte/testing/carte-factice.ts`
- Create: `angular/src/app/carte/carte.component.ts` + `carte.component.spec.ts`

**Interfaces:**
- Produces:
  - `type Bbox = readonly [ouest: number, sud: number, est: number, nord: number]`, `CADRE_METROPOLE: Bbox = [-5.5, 41.2, 9.8, 51.2]`, `bboxDeCarte(carte: Pick<maplibregl.Map, 'getBounds'>): Bbox`, `bboxEnParametre(b: Bbox): string` (4 décimales, séparées par des virgules).
  - `FOND_POSITRON = 'https://tiles.openfreemap.org/styles/positron'`, `type FabriqueCarte = (options: maplibregl.MapOptions) => maplibregl.Map`, `FABRIQUE_CARTE: InjectionToken<FabriqueCarte>`.
  - `CarteFactice` (classe de test : `on`, `off`, `emettre(evt)`, `remove`, `resize`, `getBounds`, `jumpTo`, `getCenter`, `getZoom`, `getBearing`, `getPitch`, compteurs `appelsResize`, `retiree`, et `options` reçues).
  - `CarteComponent` (`mg-carte`) : entrées `fond` (défaut `FOND_POSITRON`), `cadre: Bbox` (requise) ; sorties `prete: maplibregl.Map` (à l'événement `load`), `deplacee: Bbox` (à chaque `moveend`).

- [ ] **Step 1: Dépendance et feuille de style**

```bash
cd angular && npm install --save-exact maplibre-gl@5.18.0
```

Dans `angular/angular.json`, `projects.magelian.architect.build.options.styles`, ajouter AVANT `src/styles.css` : `"node_modules/maplibre-gl/dist/maplibre-gl.css"`. (Même chose sous `test.options.styles` s'il existe.)

- [ ] **Step 2: bbox — test puis implémentation**

Créer `angular/src/app/carte/bbox.spec.ts` :

```ts
import { CADRE_METROPOLE, bboxDeCarte, bboxEnParametre } from './bbox';

describe('bbox', () => {
  it('lit la bbox visible d\'une carte', () => {
    const carte = { getBounds: () => ({ getWest: () => 4.75, getSouth: () => 43.35, getEast: () => 5.3, getNorth: () => 43.6 }) };
    expect(bboxDeCarte(carte as never)).toEqual([4.75, 43.35, 5.3, 43.6]);
  });
  it('écrit le paramètre de requête à 4 décimales', () => {
    expect(bboxEnParametre([4.751234, 43.35, 5.3, 43.6])).toBe('4.7512,43.3500,5.3000,43.6000');
  });
  it('le cadre métropole est celui de CLAUDE.md', () => {
    expect(CADRE_METROPOLE).toEqual([-5.5, 41.2, 9.8, 51.2]);
  });
});
```

Créer `angular/src/app/carte/bbox.ts` :

```ts
import type maplibregl from 'maplibre-gl';

/** [ouest, sud, est, nord], en degrés WGS84. */
export type Bbox = readonly [ouest: number, sud: number, est: number, nord: number];

/** La bbox métropole de CLAUDE.md — un CADRAGE, jamais une zone de requête par défaut. */
export const CADRE_METROPOLE: Bbox = [-5.5, 41.2, 9.8, 51.2];

export function bboxDeCarte(carte: Pick<maplibregl.Map, 'getBounds'>): Bbox {
  const b = carte.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

/** Format attendu par les routes `?bbox=` du projet (même arrondi que côté React). */
export function bboxEnParametre(b: Bbox): string {
  return b.map((v) => v.toFixed(4)).join(',');
}
```

- [ ] **Step 3: Fabrique et carte factice**

Créer `angular/src/app/carte/fabrique-carte.ts` :

```ts
import { InjectionToken } from '@angular/core';
import maplibregl from 'maplibre-gl';

/** Le fond du module risque, dans les DEUX thèmes (inventaire du 2026-09-29). */
export const FOND_POSITRON = 'https://tiles.openfreemap.org/styles/positron';

export type FabriqueCarte = (options: maplibregl.MapOptions) => maplibregl.Map;

/**
 * Qui crée la carte. Un jeton plutôt qu'un `new maplibregl.Map` en dur :
 * l'environnement de test n'a pas de WebGL, et les tests fournissent une
 * carte factice (`testing/carte-factice.ts`).
 */
export const FABRIQUE_CARTE = new InjectionToken<FabriqueCarte>('FABRIQUE_CARTE', {
  providedIn: 'root',
  factory: () => (options) => new maplibregl.Map(options),
});
```

Créer `angular/src/app/carte/testing/carte-factice.ts` :

```ts
import type maplibregl from 'maplibre-gl';

type Rappel = (...args: unknown[]) => void;

/** Une carte sans WebGL, pour les tests : elle enregistre ce qu'on lui fait. */
export class CarteFactice {
  readonly options: maplibregl.MapOptions | null;
  retiree = false;
  appelsResize = 0;
  centre: [number, number] = [5, 43.5];
  zoom = 9;
  bearing = 0;
  pitch = 0;
  cadre: [number, number, number, number] = [4.75, 43.35, 5.3, 43.6];
  readonly sauts: unknown[] = [];
  private readonly rappels = new Map<string, Set<Rappel>>();

  constructor(options: maplibregl.MapOptions | null = null) {
    this.options = options;
  }

  on(evt: string, rappel: Rappel): this {
    if (!this.rappels.has(evt)) this.rappels.set(evt, new Set());
    this.rappels.get(evt)!.add(rappel);
    return this;
  }
  off(evt: string, rappel: Rappel): this {
    this.rappels.get(evt)?.delete(rappel);
    return this;
  }
  emettre(evt: string): void {
    for (const r of [...(this.rappels.get(evt) ?? [])]) r();
  }
  nombreEcouteurs(evt: string): number {
    return this.rappels.get(evt)?.size ?? 0;
  }
  remove(): void { this.retiree = true; }
  resize(): this { this.appelsResize++; return this; }
  getBounds() {
    const [o, s, e, n] = this.cadre;
    return { getWest: () => o, getSouth: () => s, getEast: () => e, getNorth: () => n };
  }
  getCenter() { return { lng: this.centre[0], lat: this.centre[1] }; }
  getZoom() { return this.zoom; }
  getBearing() { return this.bearing; }
  getPitch() { return this.pitch; }
  /** Comme MapLibre : un saut émet `move` de façon synchrone. */
  jumpTo(o: { center?: { lng: number; lat: number } | [number, number]; zoom?: number }): this {
    this.sauts.push(o);
    if (o.zoom !== undefined) this.zoom = o.zoom;
    this.emettre('move');
    return this;
  }
}
```

- [ ] **Step 4: `mg-carte` — test (échec attendu)**

Créer `angular/src/app/carte/carte.component.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { CarteComponent } from './carte.component';
import { FABRIQUE_CARTE } from './fabrique-carte';
import { CarteFactice } from './testing/carte-factice';

class ObservateurFactice {
  static instances: ObservateurFactice[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(readonly rappel: () => void) { ObservateurFactice.instances.push(this); }
}

async function rendre() {
  let carte!: CarteFactice;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ObservateurFactice;
  TestBed.configureTestingModule({
    providers: [{ provide: FABRIQUE_CARTE, useValue: (o: never) => (carte = new CarteFactice(o)) }],
  });
  const f = TestBed.createComponent(CarteComponent);
  f.componentRef.setInput('cadre', [4.75, 43.35, 5.3, 43.6]);
  const pretes: unknown[] = [];
  const cadres: unknown[] = [];
  f.componentInstance.prete.subscribe((m) => pretes.push(m));
  f.componentInstance.deplacee.subscribe((b) => cadres.push(b));
  await f.whenStable();
  return { f, carte: () => carte, pretes, cadres };
}

describe('CarteComponent', () => {
  afterEach(() => { ObservateurFactice.instances = []; });

  it('crée la carte dans son conteneur, sur le fond et le cadre demandés', async () => {
    const { carte } = await rendre();
    const o = carte().options as { container: HTMLElement; style: string; bounds: unknown };
    expect(o.container).toBeInstanceOf(HTMLElement);
    expect(o.style).toBe('https://tiles.openfreemap.org/styles/positron');
    expect(o.bounds).toEqual([4.75, 43.35, 5.3, 43.6]);
  });

  it('rend la carte au chargement, et chaque cadre au moveend', async () => {
    const { carte, pretes, cadres } = await rendre();
    carte().emettre('load');
    carte().emettre('moveend');
    expect(pretes).toEqual([carte()]);
    expect(cadres).toEqual([[4.75, 43.35, 5.3, 43.6]]);
  });

  it('se redimensionne quand son conteneur change de taille', async () => {
    const { carte } = await rendre();
    ObservateurFactice.instances[0].rappel();
    expect(carte().appelsResize).toBe(1);
  });

  it('à la destruction : observateur débranché, carte retirée', async () => {
    const { f, carte } = await rendre();
    f.destroy();
    expect(ObservateurFactice.instances[0].disconnect).toHaveBeenCalled();
    expect(carte().retiree).toBe(true);
  });
});
```

- [ ] **Step 5: `mg-carte` — implémentation**

Créer `angular/src/app/carte/carte.component.ts` :

```ts
import {
  ChangeDetectionStrategy, Component, DestroyRef, type ElementRef, afterNextRender,
  inject, input, output, viewChild,
} from '@angular/core';
import type maplibregl from 'maplibre-gl';
import { type Bbox, bboxDeCarte } from './bbox';
import { FABRIQUE_CARTE, FOND_POSITRON } from './fabrique-carte';

/**
 * Une carte MapLibre, et SEULEMENT son cycle de vie : le parent reçoit la
 * carte (`prete`) et y pose ses sources et ses couches.
 *
 * - Créée APRÈS le premier rendu : MapLibre mesure son conteneur à la création.
 * - `ResizeObserver` OBLIGATOIRE : MapLibre ne se redimensionne que sur un
 *   changement de taille de FENÊTRE ; une poignée ou un panneau replié laisse
 *   sinon une moitié grise et des clics décalés (constaté côté React).
 * - `deplacee` au `moveend`, JAMAIS au `move` : un chargement par image de
 *   panoramique serait la famille de l'incident du 28/03 (CLAUDE.md).
 * - Le composant ne choisit pas de cadre « France entière » par défaut :
 *   `cadre` est requis.
 */
@Component({
  selector: 'mg-carte',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div #conteneur class="absolute inset-0"></div>',
  host: { class: 'block relative' },
})
export class CarteComponent {
  readonly fond = input(FOND_POSITRON);
  readonly cadre = input.required<Bbox>();
  readonly prete = output<maplibregl.Map>();
  readonly deplacee = output<Bbox>();

  private readonly conteneur = viewChild.required<ElementRef<HTMLDivElement>>('conteneur');
  private readonly fabrique = inject(FABRIQUE_CARTE);
  private readonly destruction = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const element = this.conteneur().nativeElement;
      const carte = this.fabrique({
        container: element,
        style: this.fond(),
        bounds: [...this.cadre()] as [number, number, number, number],
        fitBoundsOptions: { padding: 40 },
        attributionControl: { compact: true },
      });
      carte.on('load', () => this.prete.emit(carte));
      carte.on('moveend', () => this.deplacee.emit(bboxDeCarte(carte)));
      const observateur = new ResizeObserver(() => carte.resize());
      observateur.observe(element);
      this.destruction.onDestroy(() => {
        observateur.disconnect();
        carte.remove();
      });
    });
  }
}
```

Run: `cd angular && npx ng test --watch=false` — Expected: tests `bbox` et `CarteComponent` PASS. (Si `afterNextRender` ne s'exécute pas dans le test avant `whenStable`, appeler `f.detectChanges()` avant `await f.whenStable()` dans `rendre` et le noter.)

- [ ] **Step 6: Vérifier et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/package.json angular/package-lock.json angular/angular.json angular/src/app/carte
git commit -m "feat(angular): composant carte MapLibre, cycle de vie et bbox visible"
```

Noter dans le rapport la taille du chunk qui contient MapLibre (`npm run build` l'affiche) : il doit être un chunk PARESSEUX, jamais dans le paquet initial.

---

### Task 3: Utilitaires de carte — cadre, caméras liées, popup

**Files:**
- Create: `angular/src/app/carte/charger-par-cadre.ts` + `.spec.ts`
- Create: `angular/src/app/carte/lier-cameras.ts` + `.spec.ts`
- Create: `angular/src/app/carte/contenu-popup.ts` + `.spec.ts`

**Interfaces:**
- Consumes: `Bbox`, `bboxDeCarte`, `CarteFactice`.
- Produces:
  - `type CarteEcoutable = Pick<maplibregl.Map, 'on' | 'off' | 'getBounds'>`
  - `chargerParCadre<T>(carte: CarteEcoutable, charger: (b: Bbox) => Observable<T>, appliquer: (v: T) => void, options?: { delaiMs?: number; surEchec?: (e: unknown) => void }): () => void` — charge une première fois, puis à chaque `moveend` après `delaiMs` (défaut 350) de calme ; annule la requête précédente ; rend une fonction d'arrêt.
  - `lierCameras(a: CarteLiable, b: CarteLiable): () => void` où `CarteLiable = Pick<maplibregl.Map, 'on' | 'off' | 'jumpTo' | 'getCenter' | 'getZoom' | 'getBearing' | 'getPitch'>` — aligne `b` sur `a` tout de suite, puis chacune suit l'autre.
  - `interface LignePopup { libelle: string; valeur: string }`, `contenuPopup(titre: string, lignes: LignePopup[], doc?: Document): HTMLElement`.

- [ ] **Step 1: `chargerParCadre` — test (échec attendu)**

Créer `angular/src/app/carte/charger-par-cadre.spec.ts` :

```ts
import { Subject, throwError } from 'rxjs';
import type { Bbox } from './bbox';
import { chargerParCadre } from './charger-par-cadre';
import { CarteFactice } from './testing/carte-factice';

describe('chargerParCadre', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('charge une fois au départ, puis une seule fois après un panoramique rapide', () => {
    const carte = new CarteFactice();
    const demandes: Bbox[] = [];
    const reponses: Subject<string>[] = [];
    const appliques: string[] = [];
    chargerParCadre(carte as never, (b) => { demandes.push(b); const s = new Subject<string>(); reponses.push(s); return s; }, (v) => appliques.push(v));
    vi.advanceTimersByTime(350);
    expect(demandes.length).toBe(1);
    for (let i = 0; i < 10; i++) { carte.emettre('moveend'); vi.advanceTimersByTime(50); }
    expect(demandes.length).toBe(1);
    vi.advanceTimersByTime(350);
    expect(demandes.length).toBe(2);
  });

  it('une réponse périmée n\'écrase jamais la plus récente', () => {
    const carte = new CarteFactice();
    const reponses: Subject<string>[] = [];
    const appliques: string[] = [];
    chargerParCadre(carte as never, () => { const s = new Subject<string>(); reponses.push(s); return s; }, (v) => appliques.push(v));
    vi.advanceTimersByTime(350);
    carte.emettre('moveend');
    vi.advanceTimersByTime(350);
    reponses[0].next('ancienne');
    reponses[1].next('récente');
    expect(appliques).toEqual(['récente']);
  });

  it('un échec est signalé et n\'arrête pas les chargements suivants', () => {
    const carte = new CarteFactice();
    const echecs: unknown[] = [];
    let n = 0;
    chargerParCadre(carte as never, () => (n++ === 0 ? throwError(() => new Error('panne')) : new Subject<string>()), () => undefined, { surEchec: (e) => echecs.push(e) });
    vi.advanceTimersByTime(350);
    carte.emettre('moveend');
    vi.advanceTimersByTime(350);
    expect(echecs.length).toBe(1);
    expect(n).toBe(2);
  });

  it('arrêter débranche l\'écoute et abandonne la requête en cours', () => {
    const carte = new CarteFactice();
    const reponse = new Subject<string>();
    const appliques: string[] = [];
    const arreter = chargerParCadre(carte as never, () => reponse, (v) => appliques.push(v));
    vi.advanceTimersByTime(350);
    arreter();
    reponse.next('trop tard');
    expect(appliques).toEqual([]);
    expect(carte.nombreEcouteurs('moveend')).toBe(0);
  });
});
```

- [ ] **Step 2: `chargerParCadre` — implémentation**

Créer `angular/src/app/carte/charger-par-cadre.ts` :

```ts
import type maplibregl from 'maplibre-gl';
import { EMPTY, Observable, catchError, debounceTime, switchMap } from 'rxjs';
import { type Bbox, bboxDeCarte } from './bbox';

export type CarteEcoutable = Pick<maplibregl.Map, 'on' | 'off' | 'getBounds'>;

/**
 * Charge une donnée pour la bbox VISIBLE : au départ, puis à chaque `moveend`
 * après `delaiMs` de calme (350 ms, comme les sites côté React). La requête
 * précédente est ANNULÉE — une réponse lente d'un ancien cadre ne remplace
 * jamais celle du cadre courant.
 *
 * Passe par `HttpClient` côté appelant : les 3 appels simultanés au plus
 * (`limiteurInterceptor`) et le jeton s'appliquent donc d'office.
 */
export function chargerParCadre<T>(
  carte: CarteEcoutable,
  charger: (b: Bbox) => Observable<T>,
  appliquer: (v: T) => void,
  options: { delaiMs?: number; surEchec?: (e: unknown) => void } = {},
): () => void {
  const cadres = new Observable<Bbox>((abonne) => {
    const emettre = () => abonne.next(bboxDeCarte(carte));
    carte.on('moveend', emettre);
    emettre();
    return () => carte.off('moveend', emettre);
  });
  const abonnement = cadres
    .pipe(
      debounceTime(options.delaiMs ?? 350),
      switchMap((b) =>
        charger(b).pipe(
          catchError((e: unknown) => {
            options.surEchec?.(e);
            return EMPTY;
          }),
        ),
      ),
    )
    .subscribe(appliquer);
  return () => abonnement.unsubscribe();
}
```

Run: `cd angular && npx ng test --watch=false` — Expected: 4 tests PASS.

- [ ] **Step 3: `lierCameras` — test puis implémentation**

Créer `angular/src/app/carte/lier-cameras.spec.ts` :

```ts
import { lierCameras } from './lier-cameras';
import { CarteFactice } from './testing/carte-factice';

describe('lierCameras', () => {
  it('aligne la seconde sur la première dès la liaison', () => {
    const a = new CarteFactice();
    const b = new CarteFactice();
    a.zoom = 11;
    lierCameras(a as never, b as never);
    expect(b.zoom).toBe(11);
  });

  it('déplacer l\'une déplace l\'autre UNE fois, sans boucle', () => {
    const a = new CarteFactice();
    const b = new CarteFactice();
    lierCameras(a as never, b as never);
    a.sauts.length = 0;
    b.sauts.length = 0;
    a.zoom = 12;
    a.emettre('move');
    expect(b.sauts.length).toBe(1);
    expect(a.sauts.length).toBe(0);
  });

  it('délier débranche les deux écoutes', () => {
    const a = new CarteFactice();
    const b = new CarteFactice();
    const delier = lierCameras(a as never, b as never);
    delier();
    expect(a.nombreEcouteurs('move')).toBe(0);
    expect(b.nombreEcouteurs('move')).toBe(0);
  });
});
```

Créer `angular/src/app/carte/lier-cameras.ts` :

```ts
import type maplibregl from 'maplibre-gl';

export type CarteLiable = Pick<maplibregl.Map, 'on' | 'off' | 'jumpTo' | 'getCenter' | 'getZoom' | 'getBearing' | 'getPitch'>;

/**
 * Deux cartes qui regardent le même endroit (portée de VueCartesZones.tsx).
 *
 * - Un VERROU de réentrance : placer B émet `move` sur B, qui replacerait A,
 *   qui émettrait `move`… Sans lui, les deux cartes tremblent.
 * - `jumpTo` et jamais `easeTo` : une animation ferait arriver la carte liée
 *   APRÈS celle qu'on manipule.
 */
export function lierCameras(a: CarteLiable, b: CarteLiable): () => void {
  let enCours = false;
  const suivre = (source: CarteLiable, cible: CarteLiable) => () => {
    if (enCours) return;
    enCours = true;
    try {
      cible.jumpTo({
        center: source.getCenter(),
        zoom: source.getZoom(),
        bearing: source.getBearing(),
        pitch: source.getPitch(),
      });
    } finally {
      enCours = false;
    }
  };
  const aVersB = suivre(a, b);
  const bVersA = suivre(b, a);
  a.on('move', aVersB);
  b.on('move', bVersA);
  aVersB();
  return () => {
    a.off('move', aVersB);
    b.off('move', bVersA);
  };
}
```

- [ ] **Step 4: `contenuPopup` — test puis implémentation**

Créer `angular/src/app/carte/contenu-popup.spec.ts` :

```ts
import { contenuPopup } from './contenu-popup';

describe('contenuPopup', () => {
  it('affiche un titre et des lignes libellé / valeur', () => {
    const el = contenuPopup('Site A', [{ libelle: 'Commune', valeur: 'Martigues' }]);
    expect(el.textContent).toContain('Site A');
    expect(el.textContent).toContain('Commune');
    expect(el.textContent).toContain('Martigues');
  });
  it('n\'interprète jamais une valeur comme du HTML', () => {
    const el = contenuPopup('<img src=x onerror=alert(1)>', [{ libelle: 'x', valeur: '<b>gras</b>' }]);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<b>gras</b>');
  });
});
```

Créer `angular/src/app/carte/contenu-popup.ts` :

```ts
export interface LignePopup {
  libelle: string;
  valeur: string;
}

/**
 * Le contenu d'une `maplibregl.Popup`, construit par `textContent` et JAMAIS
 * par `innerHTML` : les valeurs viennent de la base (noms de sites, communes)
 * et ne sont pas des textes de confiance.
 */
export function contenuPopup(titre: string, lignes: LignePopup[], doc: Document = document): HTMLElement {
  const racine = doc.createElement('div');
  racine.className = 'flex flex-col gap-1 text-xs text-primary';
  const t = doc.createElement('strong');
  t.className = 'font-medium';
  t.textContent = titre;
  racine.appendChild(t);
  for (const l of lignes) {
    const ligne = doc.createElement('div');
    const libelle = doc.createElement('span');
    libelle.className = 'text-tertiary';
    libelle.textContent = `${l.libelle} : `;
    const valeur = doc.createElement('span');
    valeur.className = 'font-mono';
    valeur.textContent = l.valeur;
    ligne.append(libelle, valeur);
    racine.appendChild(ligne);
  }
  return racine;
}
```

- [ ] **Step 5: Vérifier et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src/app/carte
git commit -m "feat(angular): chargement par cadre visible, caméras liées et popup sûre"
```

---

### Task 4: La courbe, sur ECharts

**Files:**
- Modify: `angular/package.json`, `angular/package-lock.json` (dépendance `echarts`, version exacte)
- Create: `angular/src/app/graphiques/option-courbe.ts` + `.spec.ts`
- Create: `angular/src/app/graphiques/fabrique-graphique.ts`
- Create: `angular/src/app/graphiques/courbe.component.ts` + `.spec.ts`

**Interfaces:**
- Consumes: `CouleursService.palette`.
- Produces:
  - `interface SerieCourbe { cle: string; libelle: string; jeton: string; points: ReadonlyArray<readonly [number, number]>; epaisseur?: number }` — `jeton` = nom de jeton sans `--` (ex. `brand-teal`, `nature-1`).
  - `interface RepereCourbe { x: number; libelle: string }`
  - `interface CouleursCourbe { series: Record<string, string>; texte: string; grille: string; fondInfobulle: string; bordInfobulle: string; repere: string }`
  - `optionCourbe(e: { series: SerieCourbe[]; masquees: ReadonlySet<string>; couleurs: CouleursCourbe; formaterX: (x: number) => string; formaterY: (y: number) => string; repere?: RepereCourbe; domaineX?: readonly [number, number] }): EChartsCoreOption` — fonction PURE.
  - `type FabriqueGraphique = (el: HTMLElement) => GraphiqueMinimal` avec `GraphiqueMinimal = { setOption(o: unknown, opts?: unknown): void; resize(): void; dispose(): void }`, `FABRIQUE_GRAPHIQUE: InjectionToken<FabriqueGraphique>`.
  - `CourbeComponent` (`mg-courbe`) : entrées `series` (requise), `formaterX`, `formaterY`, `repere?`, `domaineX?`, `libelle` (requise, texte accessible du graphique), `hauteur` (px, défaut 280).

- [ ] **Step 1: Dépendance**

```bash
cd angular && npm install --save-exact echarts@6
```

Noter dans le rapport la version installée.

- [ ] **Step 2: `optionCourbe` — test (échec attendu)**

Créer `angular/src/app/graphiques/option-courbe.spec.ts` :

```ts
import { optionCourbe, type SerieCourbe } from './option-courbe';

const COULEURS = {
  series: { total: '#4ecdc4', a: '#e07a3f' },
  texte: '#8a8a8a', grille: '#1a1a1a', fondInfobulle: '#0a0a0a', bordInfobulle: '#262626', repere: '#b0b0b0',
};
const SERIES: SerieCourbe[] = [
  { cle: 'total', libelle: 'Toutes natures', jeton: 'brand-teal', points: [[100, 10], [200, 30]], epaisseur: 2 },
  { cle: 'a', libelle: 'Nature A', jeton: 'nature-1', points: [[100, 4], [200, 9]] },
];
const base = { series: SERIES, masquees: new Set<string>(), couleurs: COULEURS, formaterX: (x: number) => `${x / 1000} km`, formaterY: (y: number) => String(y) };

describe('optionCourbe', () => {
  it('une série par courbe, dans sa couleur, avec ses points', () => {
    const o = optionCourbe(base) as { series: { name: string; data: unknown; lineStyle: { color: string; width: number } }[] };
    expect(o.series.map((s) => s.name)).toEqual(['Toutes natures', 'Nature A']);
    expect(o.series[0].lineStyle.color).toBe('#4ecdc4');
    expect(o.series[0].lineStyle.width).toBe(2);
    expect(o.series[1].data).toEqual([[100, 4], [200, 9]]);
  });

  it('une série masquée disparaît', () => {
    const o = optionCourbe({ ...base, masquees: new Set(['a']) }) as { series: { name: string }[] };
    expect(o.series.map((s) => s.name)).toEqual(['Toutes natures']);
  });

  it('le repère est une ligne verticale étiquetée, portée par la première série visible', () => {
    const o = optionCourbe({ ...base, masquees: new Set(['total']), repere: { x: 5000, libelle: 'Rayon 5 km' } }) as {
      series: { markLine?: { data: { xAxis: number; label: { formatter: string } }[] } }[];
    };
    expect(o.series[0].markLine!.data[0].xAxis).toBe(5000);
    expect(o.series[0].markLine!.data[0].label.formatter).toBe('Rayon 5 km');
  });

  it('les axes utilisent les formateurs et le domaine donnés', () => {
    const o = optionCourbe({ ...base, domaineX: [100, 10000] }) as {
      xAxis: { min: number; max: number; axisLabel: { formatter: (v: number) => string } };
      yAxis: { axisLabel: { formatter: (v: number) => string } };
    };
    expect(o.xAxis.min).toBe(100);
    expect(o.xAxis.max).toBe(10000);
    expect(o.xAxis.axisLabel.formatter(5000)).toBe('5 km');
    expect(o.yAxis.axisLabel.formatter(12)).toBe('12');
  });

  it('aucune couleur ne vient d\'ailleurs que de la palette reçue', () => {
    const texte = JSON.stringify(optionCourbe({ ...base, repere: { x: 5000, libelle: 'R' } }));
    const hex = texte.match(/#[0-9a-fA-F]{6}/g) ?? [];
    const permises = new Set([...Object.values(COULEURS.series), COULEURS.texte, COULEURS.grille, COULEURS.fondInfobulle, COULEURS.bordInfobulle, COULEURS.repere]);
    expect(hex.filter((h) => !permises.has(h))).toEqual([]);
  });
});
```

- [ ] **Step 3: `optionCourbe` — implémentation**

Créer `angular/src/app/graphiques/option-courbe.ts` :

```ts
import type { EChartsCoreOption } from 'echarts/core';

export interface SerieCourbe {
  cle: string;
  libelle: string;
  /** Nom de jeton sans `--` (ex. `brand-teal`, `nature-1`). */
  jeton: string;
  points: ReadonlyArray<readonly [number, number]>;
  epaisseur?: number;
}

export interface RepereCourbe {
  x: number;
  libelle: string;
}

export interface CouleursCourbe {
  /** Couleur de chaque série, par `cle`. */
  series: Record<string, string>;
  texte: string;
  grille: string;
  fondInfobulle: string;
  bordInfobulle: string;
  repere: string;
}

/** Construit l'option ECharts d'une courbe. PURE : testée sans ECharts ni DOM. */
export function optionCourbe(e: {
  series: SerieCourbe[];
  masquees: ReadonlySet<string>;
  couleurs: CouleursCourbe;
  formaterX: (x: number) => string;
  formaterY: (y: number) => string;
  repere?: RepereCourbe;
  domaineX?: readonly [number, number];
}): EChartsCoreOption {
  const c = e.couleurs;
  const visibles = e.series.filter((s) => !e.masquees.has(s.cle));
  const police = { color: c.texte, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 10 };
  return {
    animation: false,
    grid: { left: 56, right: 16, top: 16, bottom: 28 },
    xAxis: {
      type: 'value',
      min: e.domaineX?.[0],
      max: e.domaineX?.[1],
      axisLabel: { ...police, formatter: e.formaterX },
      axisLine: { lineStyle: { color: c.grille } },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { ...police, formatter: e.formaterY },
      splitLine: { lineStyle: { color: c.grille } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: c.fondInfobulle,
      borderColor: c.bordInfobulle,
      textStyle: { ...police, fontSize: 11 },
      valueFormatter: (v: unknown) => e.formaterY(Number(v)),
    },
    series: visibles.map((s, i) => ({
      type: 'line',
      name: s.libelle,
      data: s.points.map((p) => [p[0], p[1]]),
      showSymbol: false,
      lineStyle: { color: c.series[s.cle], width: s.epaisseur ?? 1.5 },
      itemStyle: { color: c.series[s.cle] },
      ...(i === 0 && e.repere
        ? {
            markLine: {
              symbol: 'none',
              silent: true,
              lineStyle: { color: c.repere, type: 'dashed', width: 1 },
              label: { ...police, position: 'insideEndTop' },
              data: [{ xAxis: e.repere.x, label: { formatter: e.repere.libelle } }],
            },
          }
        : {}),
    })),
  };
}
```

Run: `cd angular && npx ng test --watch=false` — Expected: 5 tests PASS.

- [ ] **Step 4: Fabrique ECharts**

Créer `angular/src/app/graphiques/fabrique-graphique.ts` :

```ts
import { InjectionToken } from '@angular/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

/**
 * Import MODULAIRE : seuls la courbe, la grille, l'infobulle, le repère et le
 * rendu SVG entrent dans le paquet. `import * from 'echarts'` en tirerait tout.
 */
echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, SVGRenderer]);

export interface GraphiqueMinimal {
  setOption(option: unknown, options?: unknown): void;
  resize(): void;
  dispose(): void;
}

export type FabriqueGraphique = (el: HTMLElement) => GraphiqueMinimal;

/** Un jeton pour que les tests fournissent un graphique factice (pas de rendu réel en test). */
export const FABRIQUE_GRAPHIQUE = new InjectionToken<FabriqueGraphique>('FABRIQUE_GRAPHIQUE', {
  providedIn: 'root',
  factory: () => (el) => echarts.init(el, undefined, { renderer: 'svg' }),
});
```

- [ ] **Step 5: `mg-courbe` — test (échec attendu)**

Créer `angular/src/app/graphiques/courbe.component.spec.ts` :

```ts
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CouleursService } from '../core/theme/couleurs.service';
import { CourbeComponent } from './courbe.component';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from './fabrique-graphique';
import type { SerieCourbe } from './option-courbe';

class GraphiqueFactice implements GraphiqueMinimal {
  options: unknown[] = [];
  redimensionnements = 0;
  detruit = false;
  setOption(o: unknown) { this.options.push(o); }
  resize() { this.redimensionnements++; }
  dispose() { this.detruit = true; }
}

const SERIES: SerieCourbe[] = [
  { cle: 'total', libelle: 'Toutes natures', jeton: 'brand-teal', points: [[100, 10]] },
  { cle: 'a', libelle: 'Nature A', jeton: 'nature-1', points: [[100, 4]] },
];

async function rendre() {
  const graphique = new GraphiqueFactice();
  const teinte = signal('#111111');
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  TestBed.configureTestingModule({
    providers: [
      { provide: FABRIQUE_GRAPHIQUE, useValue: () => graphique },
      {
        provide: CouleursService,
        useValue: { palette: (j: Record<string, string>) => () => Object.fromEntries(Object.keys(j).map((k) => [k, teinte()])) },
      },
    ],
  });
  const f = TestBed.createComponent(CourbeComponent);
  f.componentRef.setInput('series', SERIES);
  f.componentRef.setInput('libelle', 'Population par rayon');
  await f.whenStable();
  return { f, graphique, teinte, el: f.nativeElement as HTMLElement };
}

describe('CourbeComponent', () => {
  it('pose les options et décrit le graphique aux lecteurs d\'écran', async () => {
    const { graphique, el } = await rendre();
    expect(graphique.options.length).toBeGreaterThan(0);
    expect(el.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Population par rayon');
  });

  it('la légende masque et rétablit une série', async () => {
    const { f, graphique, el } = await rendre();
    const boutons = el.querySelectorAll('button');
    expect(boutons.length).toBe(2);
    boutons[1].click();
    await f.whenStable();
    expect(boutons[1].getAttribute('aria-pressed')).toBe('false');
    const derniere = graphique.options.at(-1) as { series: { name: string }[] };
    expect(derniere.series.map((s) => s.name)).toEqual(['Toutes natures']);
  });

  it('repose les options quand les couleurs changent (bascule de thème)', async () => {
    const { f, graphique, teinte } = await rendre();
    const avant = graphique.options.length;
    teinte.set('#222222');
    await f.whenStable();
    expect(graphique.options.length).toBeGreaterThan(avant);
  });

  it('libère le graphique à la destruction', async () => {
    const { f, graphique } = await rendre();
    f.destroy();
    expect(graphique.detruit).toBe(true);
  });
});
```

Note : la palette factice rend une FONCTION qui lit un signal — c'est un `Signal` au sens de lecture, suffisant pour `computed`. Si le typage l'exige, l'envelopper dans `computed(() => …)`.

- [ ] **Step 6: `mg-courbe` — implémentation**

Créer `angular/src/app/graphiques/courbe.component.ts` :

```ts
import {
  ChangeDetectionStrategy, Component, DestroyRef, type ElementRef, afterNextRender,
  computed, effect, inject, input, signal, viewChild,
} from '@angular/core';
import { CouleursService } from '../core/theme/couleurs.service';
import { FABRIQUE_GRAPHIQUE, type GraphiqueMinimal } from './fabrique-graphique';
import { type RepereCourbe, type SerieCourbe, optionCourbe } from './option-courbe';

/**
 * Une ou plusieurs courbes, avec un repère vertical optionnel et une légende
 * cliquable (portée d'OngletRayonInfluence.tsx). Les couleurs viennent des
 * jetons par CouleursService : elles suivent le thème sans recharger.
 */
@Component({
  selector: 'mg-courbe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="img" [attr.aria-label]="libelle()" class="relative w-full" [style.height.px]="hauteur()">
      <div #conteneur class="absolute inset-0"></div>
    </div>
    <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      @for (s of series(); track s.cle) {
        <button type="button" (click)="basculer(s.cle)" [attr.aria-pressed]="!masquees().has(s.cle)"
                class="inline-flex items-center gap-1.5 text-[11px] cursor-pointer"
                [class.text-secondary]="!masquees().has(s.cle)" [class.text-tertiary]="masquees().has(s.cle)"
                [class.line-through]="masquees().has(s.cle)">
          <span aria-hidden="true" class="inline-block w-3 h-0.5" [style.background]="'var(--' + s.jeton + ')'"></span>
          {{ s.libelle }}
        </button>
      }
    </div>
  `,
})
export class CourbeComponent {
  readonly series = input.required<SerieCourbe[]>();
  readonly libelle = input.required<string>();
  readonly formaterX = input<(x: number) => string>((x) => String(x));
  readonly formaterY = input<(y: number) => string>((y) => String(y));
  readonly repere = input<RepereCourbe>();
  readonly domaineX = input<readonly [number, number]>();
  readonly hauteur = input(280);

  protected readonly masquees = signal<ReadonlySet<string>>(new Set());

  private readonly conteneur = viewChild.required<ElementRef<HTMLDivElement>>('conteneur');
  private readonly fabrique = inject(FABRIQUE_GRAPHIQUE);
  private readonly couleursService = inject(CouleursService);
  private readonly destruction = inject(DestroyRef);
  private readonly graphique = signal<GraphiqueMinimal | null>(null);

  private readonly teintesSeries = computed(() =>
    this.couleursService.palette(Object.fromEntries(this.series().map((s) => [s.cle, s.jeton]))),
  );
  private readonly teintesCadre = this.couleursService.palette({
    texte: 'text-tertiary', grille: 'border-subtle', fondInfobulle: 'bg-level-1',
    bordInfobulle: 'border-default', repere: 'text-secondary',
  });

  private readonly option = computed(() =>
    optionCourbe({
      series: this.series(),
      masquees: this.masquees(),
      couleurs: { ...this.teintesCadre(), series: this.teintesSeries()() },
      formaterX: this.formaterX(),
      formaterY: this.formaterY(),
      repere: this.repere(),
      domaineX: this.domaineX(),
    }),
  );

  constructor() {
    afterNextRender(() => {
      const element = this.conteneur().nativeElement;
      const g = this.fabrique(element);
      this.graphique.set(g);
      const observateur = new ResizeObserver(() => g.resize());
      observateur.observe(element);
      this.destruction.onDestroy(() => {
        observateur.disconnect();
        g.dispose();
      });
    });
    effect(() => {
      const g = this.graphique();
      if (g) g.setOption(this.option(), { notMerge: true });
    });
  }

  protected basculer(cle: string): void {
    this.masquees.update((m) => {
      const suivant = new Set(m);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });
  }
}
```

Run: `cd angular && npx ng test --watch=false` — Expected: les 4 tests du composant PASS.

- [ ] **Step 7: Vérifier et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/package.json angular/package-lock.json angular/src/app/graphiques
git commit -m "feat(angular): courbe sur ECharts, couleurs des jetons et légende cliquable"
```

Noter dans le rapport la taille du chunk qui contient ECharts (paresseux, jamais dans le paquet initial).

---

### Task 5: Page d'essai — vraies zones, vrais sites, vraie courbe — et documentation

**Files:**
- Create: `angular/src/app/features/essai-carte/essai-carte.page.ts` + `.html` + `.spec.ts`
- Create: `angular/src/app/features/risques/data/zones-risque.api.ts` + `.spec.ts`
- Modify: `angular/src/app/app.routes.ts`, `angular/src/app/layout/coquille.component.html`
- Modify: `ARCHITECTURE.md`, `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md`

**Interfaces:**
- Consumes: `CarteComponent`, `chargerParCadre`, `contenuPopup`, `bboxEnParametre`, `CourbeComponent`, `SerieCourbe`, `CouleursService`, `HttpBaseService`, `ChargementService`, `BarreProgressionComponent`, `KpiComponent`, `messageErreurApi`.
- Produces: `ZonesRisqueApi` avec `preparer(codeProfil: string): Observable<unknown>` (POST `/api/risques/zones/preparer` `{ profil }`), `sites(bbox: string): Observable<GeoJSON.FeatureCollection>` (GET `/api/map/risques-industriels?bbox=&limite=800`), `courbe(gravites: string): Observable<ReponseCourbe>` (GET `/api/risques/exposition/rayon?gravites=`), avec `interface ReponseCourbe { rayon_max_m: number; n_sites: number; courbes: { cle: string; total: number; points: { r: number; p: number; i: number }[] }[] }`.

- [ ] **Step 1: API — test puis implémentation**

Créer `angular/src/app/features/risques/data/zones-risque.api.spec.ts` sur le modèle de `sites-risque.api.spec.ts` (même fichier voisin) : trois tests, un par méthode, qui vérifient méthode HTTP, URL exacte (`/api/risques/zones/preparer` en POST avec le corps `{ profil: 'h1000.2000.5000_b500.1000_a_L0_P1' }` ; `/api/map/risques-industriels?bbox=4.7500,43.3500,5.3000,43.6000&limite=800` en GET ; `/api/risques/exposition/rayon?gravites=seveso_haut` en GET) et que la réponse est rendue telle quelle.

Créer `angular/src/app/features/risques/data/zones-risque.api.ts` :

```ts
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

/** Réponse de GET /api/risques/exposition/rayon (app/api/risques/exposition/rayon/route.ts). */
export interface ReponseCourbe {
  rayon_max_m: number;
  n_sites: number;
  courbes: { cle: string; total: number; points: { r: number; p: number; i: number }[] }[];
}

@Injectable({ providedIn: 'root' })
export class ZonesRisqueApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(HttpBaseService);

  /** Construit (ou retrouve) la géométrie des zones d'un profil, AVANT d'allumer les tuiles. */
  preparer(codeProfil: string): Observable<unknown> {
    return this.http.post(this.base.url('risques/zones/preparer'), { profil: codeProfil });
  }

  /** Sites de la bbox visible — jamais sans bbox (règle I/O de CLAUDE.md). */
  sites(bbox: string): Observable<GeoJSON.FeatureCollection> {
    const params = new HttpParams().set('bbox', bbox).set('limite', '800');
    return this.http.get<GeoJSON.FeatureCollection>(this.base.url('map/risques-industriels'), { params });
  }

  courbe(gravites: string): Observable<ReponseCourbe> {
    const params = new HttpParams().set('gravites', gravites);
    return this.http.get<ReponseCourbe>(this.base.url('risques/exposition/rayon'), { params });
  }
}
```

(Si `GeoJSON` n'est pas un type global dans `angular/`, ajouter `@types/geojson` n'est PAS permis : importer le type depuis `maplibre-gl` — `import type { GeoJSON } from 'geojson'` n'est valable que si le paquet de types est déjà présent via `maplibre-gl`. Le vérifier et le noter.)

Run: `cd angular && npx ng test --watch=false` — Expected: 3 tests PASS.

- [ ] **Step 2: La page d'essai**

Créer `angular/src/app/features/essai-carte/essai-carte.page.ts`. Comportement exigé, et rien de plus :

1. `providers: [ChargementService]` ; en tête de page `<mg-barre-progression />`, pistes déclarées pour « Préparation des zones », « Sites visibles » et « Courbe de couverture ».
2. Une `mg-carte` de 520 px de haut, `cadre` = Étang de Berre `[4.75, 43.35, 5.3, 43.6]` (la vue initiale de `CarteRisque.tsx`).
3. À `prete` :
   - `ZonesRisqueApi.preparer(CODE_PROFIL_DEFAUT)` avec `CODE_PROFIL_DEFAUT = 'h1000.2000.5000_b500.1000_a_L0_P1'` (le profil par défaut du module risque : seuil haut 1/2/5 km, seuil bas 500 m/1 km, PPRT inclus) ; À SA RÉPONSE seulement, ajouter la source vectorielle `zones` (`tiles: [`${location.origin}/api/tiles/zones-risque/{z}/{x}/{y}?profil=${encodeURIComponent(CODE_PROFIL_DEFAUT)}`]`, `minzoom: 4`, `maxzoom: 14`, `source-layer` : le lire dans `app/api/tiles/zones-risque/[z]/[x]/[y]/route.ts` ou la RPC `zones_risque_tuile` — le noter), une couche `fill` (`minzoom: 7`) colorée par `['match', ['get', 'niveau'], 'haut', <haut>, 'bas', <bas>, <autres>]` et d'opacité `['step', ['zoom'], 0.32, 10, <opacité par bande>]` (même règle que `expressionOpaciteSelonZoom` côté React : 0,45 / 0,28 / 0,16 / 0,08 par bande 1 à 4, 0,5 si `bande` est nul), et une couche `line` de contour (`minzoom: 10`).
   - Les sites par `chargerParCadre(carte, (b) => api.sites(bboxEnParametre(b)), (fc) => source.setData(fc))`, source GeoJSON `sites`, couche `circle` de rayon `['interpolate', ['linear'], ['zoom'], 8, 2.5, 13, 5.5]`, colorée par `gravite` (`seveso_haut` → haut, `seveso_bas` → bas, sinon autres), contour de couleur `text-primary`. L'arrêt est appelé à la destruction de la page.
   - Au clic sur un site : une `maplibregl.Popup` dont le contenu est `contenuPopup(nom, lignes)` — lire UNE réponse réelle de `/api/map/risques-industriels` pour connaître les noms de propriétés (nom du site, commune, gravité) et le noter dans le rapport. `setDOMContent`, jamais `setHTML`.
   - Couleurs : `CouleursService.palette({ haut: 'niveau-haut', bas: 'niveau-bas', autres: 'niveau-autres', trait: 'text-primary' })` ; un `effect` qui, quand la palette change (bascule de thème), repose les `paint` par `setPaintProperty` — sans retirer ni recréer ni la carte ni les sources.
4. Sous la carte, la courbe : `ZonesRisqueApi.courbe('seveso_haut')` → une `SerieCourbe` par élément de `courbes` : `cle: '*'` devient « Toutes natures » en jeton `brand-teal`, épaisseur 2 ; les autres gardent leur `cle` comme libellé, jetons `nature-1` … `nature-8` dans l'ordre reçu ; points `[r, p]`. `formaterX` : kilomètres (`5000` → « 5 km », `500` → « 0,5 km ») ; `formaterY` : `Intl.NumberFormat('fr-FR', { notation: 'compact' })` ; `repere` : `{ x: 5000, libelle: 'Rayon 5 km' }` ; `domaineX` : `[100, rayon_max_m]`.
5. Deux `mg-kpi` : « Habitants à moins de 5 km » = `p` du point `r === 5000` de la courbe `*`, formaté `fr-FR` ; « Sites Seveso seuil haut » = `n_sites`. Note de chaque KPI : « Pré-calcul carroyé INSEE, seuil haut seul ».
6. Tout échec de requête s'affiche en message français (`messageErreurApi`) à la place de la partie concernée, jamais un chargement sans fin.

Écrire le gabarit `essai-carte.page.html` et un `essai-carte.page.spec.ts` qui, avec `FABRIQUE_CARTE` et `FABRIQUE_GRAPHIQUE` factices et `HttpTestingController`, vérifie : (a) la page ne demande PAS les sites avant l'événement `load` ; (b) après `load`, `preparer` part AVANT l'ajout de la source de tuiles (la source n'est ajoutée qu'après réponse) ; (c) le KPI « Habitants à moins de 5 km » affiche la valeur `p` du point `r = 5000` de la courbe `*` d'une réponse fabriquée. La carte factice doit alors exposer `addSource`, `addLayer`, `getSource` (rendant un objet avec `setData`), `setPaintProperty` et `on('click', couche, …)` : les AJOUTER à `CarteFactice` (tâche 2) sous forme d'enregistreurs, sans casser ses tests.

- [ ] **Step 3: Route et lien**

Dans `angular/src/app/app.routes.ts`, ajouter sous la coquille la route `essai-carte` (chargement paresseux de `EssaiCartePage`). Dans `coquille.component.html`, ajouter le lien « Essai carte » après « Catalogue », sur le même modèle.

Run: `cd angular && npx ng test --watch=false && npm run build` — Expected: vert ; noter les chunks paresseux de MapLibre et d'ECharts.

- [ ] **Step 4: Épreuve navigateur et comparaison chiffrée**

Base locale démarrée (`docker ps` montre `supabase_db_genesis_app`). Lancer `npm run dev` (racine, :3000, attendre `/login` à 200) et `npm start` (`angular/`, :4200) en arrière-plan. Avec Playwright, se connecter (mémoire `reference_geomatik_credentials.md`, jamais écrit), ouvrir `/essai-carte`, puis :

1. Les zones de risque apparaissent autour de l'Étang de Berre, les sites en points ; dans l'onglet réseau, les tuiles `/api/tiles/zones-risque/...` répondent **200** (preuve que le cookie passe par le proxy) et `/api/map/risques-industriels` part avec `bbox=` — jamais sans.
2. Un panoramique rapide (plusieurs glissements) : UNE requête de sites après l'arrêt, pas une par glissement (compter dans l'onglet réseau).
3. Clic sur un site : la popup affiche son nom et sa commune.
4. La courbe s'affiche avec son repère « Rayon 5 km » ; cliquer une nature dans la légende la masque.
5. **Comparaison chiffrée** : le KPI « Habitants à moins de 5 km » doit être égal à la valeur rendue par la base pour la même question. La mesurer par : `docker exec supabase_db_genesis_app psql -U postgres -Atc "select (pt->>'p')::bigint from lire_couverture_rayon('ind', '{seveso_haut}'::text[]) r, jsonb_array_elements(r->'courbes'->0->'points') pt where (pt->>'r')::int = 5000"`. Mesure de référence du chef de projet le 2026-09-29 : **13 841 288**. Consigner les deux nombres ; tout écart bloque la tâche.
6. Bascule « Thème clair » : zones, sites et courbe changent de couleur SANS rechargement de la carte (les tuiles ne sont pas redemandées — le vérifier dans l'onglet réseau).
7. Captures dans les deux thèmes, rangées dans le dossier de travail du chantier (jamais dans le dépôt). Arrêter les deux serveurs (arbre de processus complet : `netstat -ano | grep -E ":3000 |:4200 " | grep LISTEN`, `taskkill //F //T //PID <pid>`).

- [ ] **Step 5: Documentation**

`ARCHITECTURE.md`, section « Application Angular (depuis le 2026-09-29) », ajouter (Edit ciblés, pas de PowerShell) :

```markdown
- **Carte et graphiques (lot 2, 2026-09-29)** : `mg-carte` (`angular/src/app/carte/`) ne porte que le CYCLE DE VIE de MapLibre — création après rendu, `ResizeObserver`, destruction — et rend la carte au parent, qui pose ses sources. `chargerParCadre` charge une donnée sur la bbox VISIBLE au `moveend` après 350 ms de calme et annule la requête précédente ; `lierCameras` porte le verrou de réentrance de `VueCartesZones.tsx` ; `contenuPopup` construit les popups par `textContent`. `mg-courbe` (`angular/src/app/graphiques/`) repose sur **Apache ECharts** en import modulaire (courbe, grille, infobulle, repère, rendu SVG). MapLibre et ECharts sont dans des chunks PARESSEUX.
- ⚠ **Plus de couleurs recopiées en hexadécimal pour MapLibre et ECharts** : `CouleursService.palette()` lit la valeur CALCULÉE des jetons de `styles/jetons.css`, et suit le thème par `ThemeService.themeApplique` (qui ne change qu'une fois la classe posée sur `<html>`). Côté React, ces valeurs vivaient en double (`lib/carte/palette-*.ts`) sous garde de tests de parité. Un nom de jeton inconnu LÈVE au lieu de peindre en noir.
- Les tuiles MVT restent chargées par MapLibre lui-même (cookie, via le proxy) ; les GeoJSON passent par `HttpClient`, donc par le limiteur de 3 appels et le jeton. Vérifié au navigateur le <date> : tuiles `zones-risque` en 200, une seule requête de sites après un panoramique rapide, KPI « habitants à moins de 5 km » égal à `lire_couverture_rayon` (<valeur mesurée>).
```

Remplacer `<date>` et `<valeur mesurée>` par ce qui a été observé.

Dans la feuille de route, remplacer la ligne du lot 2 du tableau des lots par :

```markdown
| **2 — Carte et graphiques** ✅ 2026-09-29 | `mg-carte` (cycle de vie MapLibre), chargement par cadre visible, caméras liées, popups sûres ; `mg-courbe` sur Apache ECharts (P7 confirmé) ; couleurs lues dans les jetons (plus de tables d'hexadécimaux) | Page `/essai-carte` : vraies zones, vrais sites, vraie courbe, KPI égal à la base | 0, 1 |
```

et dans la table des décisions, à la ligne P7, remplacer « à confirmer par l'épreuve technique du lot 2 » par « confirmé au lot 2 (import modulaire, rendu SVG, chunk paresseux) ».

- [ ] **Step 6: Vérification finale et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run lint 2>&1 | tail -3
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src/app ARCHITECTURE.md docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md
git commit -m "feat(angular): page d'essai carte et courbe sur les vraies données, lot 2 documenté"
```
