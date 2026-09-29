# Angular — Lot 1 : les composants de base — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les briques d'interface dont le module risque (lot 3) a besoin, en Angular standard, visibles sur une page `/catalogue` dans les deux thèmes — plus trois garde-fous transverses reportés du lot 0.

**Architecture:** Des composants autonomes, génériques (aucun vocabulaire du risque), dans `angular/src/app/ui/`, stylés par des classes Tailwind adossées aux jetons. Là où l'élément natif porte la sémantique (`button`, `th`, `td`), on écrit un composant à sélecteur d'attribut (`button[mgPastille]`) plutôt qu'un emballage. Les garde-fous transverses (thème, 3 appels simultanés, fin de session) vivent dans `core/`.

**Tech Stack:** Angular 21.2.4 (signals : `input`, `output`, `computed`, `effect`), Tailwind 4, Vitest.

**Spec:** `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (lot 1, règles de chantier, « À savoir pour les lots suivants »).

**Inventaire qui fonde ce plan (2026-09-29).** Les composants shadcn/ui ne sont PAS utilisés par le module risque : aucun de ses 35 fichiers n'en importe un, et ailleurs ils ne servent presque qu'à la page vitrine `app/design-system`. Le module risque repose sur des primitives MAISON : `Kpi` (`components/risques/Kpi.tsx`), `BarreProgression` + `Perime` (`BarreProgression.tsx`, registre `ContexteChargement.tsx`, règles `lib/risques/chargement.ts`), `FilArianeEtapes`, `FilAriane`/`Pastille`/`Champ`/`Th`/`Td` (`elements.tsx`), la réglette de `RegletteRayons.tsx`. Ce lot porte CELLES-LÀ. Fenêtre modale et notifications ne servent qu'aux campagnes et à l'administration : elles viendront avec les lots 5 et 6.

## Global Constraints

- Angular **21.2.4** exact ; aucune nouvelle dépendance npm dans ce lot.
- **Aucun import croisé** : rien dans `angular/` n'importe hors de `angular/` (`tests/unit/angular/isolement.test.ts`).
- **Aucune couleur en dur** : classes Tailwind adossées aux jetons (`text-primary`, `bg-surface`, `text-teal`, `border-subtle`…) ou `var(--jeton)`. Jamais de hex.
- Textes d'interface **en français, en sentence case**.
- Polices : Inter et JetBrains Mono uniquement (`font-sans`, `font-mono`).
- Les composants de `ui/` sont **génériques** : aucun mot du métier (site, Seveso, rayon, bassin) dans leurs noms, entrées ou textes par défaut. Le métier arrive au lot 3, en les configurant.
- Chaque composant : `ChangeDetectionStrategy.OnPush`, entrées/sorties par `input()`/`output()`, sélecteur préfixé `mg`.
- Accessibilité : chaque comportement clavier ou ARIA du composant React d'origine est conservé (cité dans la tâche).
- **Au plus 3 appels API simultanés** (règle d'I/O de `CLAUDE.md`).
- Ne pas modifier `middleware.ts`. Ne jamais pousser.
- Après chaque tâche : `cd angular && npx ng test --watch=false && npm run build` verts ; à la racine `npx tsc --noEmit` (sans pipe) et `npm run test:unit` verts.
- Git : `export PATH="/c/GENESIS/PortableGit/cmd:$PATH"`.

## Review Focus

- **Stockage indisponible** (navigation privée, stockage bloqué) : le choix de thème ne doit pas faire planter l'application. → test dans la tâche 1 (`themeInitial` et `ThemeService` avec un stockage qui lève).
- **Appel en file d'attente abandonné** (on quitte la page pendant que 3 appels tournent) : sa place ne doit jamais rester réservée, sinon le 4e appel suivant attend pour toujours. → test dans la tâche 2 (désabonnement en attente, puis un nouvel appel passe).
- **Deux 401 simultanés** : une seule redirection vers la connexion. → test dans la tâche 2.
- **Réglette relâchée sans avoir bougé** (clic sans glisser, Tab qui traverse) : aucune validation émise, donc aucun recalcul coûteux. → test dans la tâche 5.
- **Réglette : la valeur validée est corrigée par le parent** (il refuse ou arrondit) : l'affichage retombe sur la valeur du parent, pas sur la position demandée. → test dans la tâche 5.

---

### Task 1: Thème clair/sombre et garde inverse de la connexion

**Files:**
- Create: `angular/src/app/core/theme/theme.ts` + `theme.spec.ts`
- Create: `angular/src/app/core/theme/theme.service.ts` + `theme.service.spec.ts`
- Create: `angular/src/app/core/auth/sans-session.guard.ts` + `sans-session.guard.spec.ts`
- Modify: `angular/src/app/app.ts` (instancier le thème au démarrage)
- Modify: `angular/src/app/app.routes.ts` (garde sur `connexion`)

**Interfaces:**
- Produces: `type Theme = 'dark' | 'light'`, `CLE_THEME = 'magelian-theme'`, `themeInitial(stockage)`, `themeSuivant(t)`, `ThemeService` (`theme: Signal<Theme>`, `basculer(): void`), `sansSessionGuard: CanActivateFn`.

- [ ] **Step 1: Règles pures — test (échec attendu)**

Créer `angular/src/app/core/theme/theme.spec.ts` :

```ts
import { CLE_THEME, themeInitial, themeSuivant } from './theme';

const stockage = (valeur: string | null) => ({ getItem: (k: string) => (k === CLE_THEME ? valeur : null) });

describe('themeInitial', () => {
  it('sombre par défaut', () => {
    expect(themeInitial(null)).toBe('dark');
    expect(themeInitial(stockage(null))).toBe('dark');
  });
  it('reprend le choix enregistré', () => {
    expect(themeInitial(stockage('light'))).toBe('light');
  });
  it('ignore une valeur inconnue', () => {
    expect(themeInitial(stockage('violet'))).toBe('dark');
  });
  it('ne plante pas si le stockage lève (navigation privée)', () => {
    expect(themeInitial({ getItem: () => { throw new Error('bloqué'); } })).toBe('dark');
  });
});

describe('themeSuivant', () => {
  it('alterne', () => {
    expect(themeSuivant('dark')).toBe('light');
    expect(themeSuivant('light')).toBe('dark');
  });
});
```

Run: `cd angular && npx ng test --watch=false` — Expected: FAIL (module introuvable).

- [ ] **Step 2: Règles pures — implémentation**

Créer `angular/src/app/core/theme/theme.ts` :

```ts
/**
 * Règles du thème, identiques à lib/theme/theme-utils.ts côté React — MÊME
 * clé de stockage : les deux applications tournent sur localhost, mais sur
 * deux ports, donc deux stockages distincts ; la clé commune évite seulement
 * deux noms pour une même préférence le jour de la bascule.
 */
export type Theme = 'dark' | 'light';

export const CLE_THEME = 'magelian-theme';

export function themeInitial(stockage: Pick<Storage, 'getItem'> | null): Theme {
  if (!stockage) return 'dark';
  try {
    const brut = stockage.getItem(CLE_THEME);
    return brut === 'light' || brut === 'dark' ? brut : 'dark';
  } catch {
    return 'dark';
  }
}

export function themeSuivant(courant: Theme): Theme {
  return courant === 'dark' ? 'light' : 'dark';
}
```

Run: `cd angular && npx ng test --watch=false` — Expected: 5 tests PASS.

- [ ] **Step 3: ThemeService — test (échec attendu)**

Créer `angular/src/app/core/theme/theme.service.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { CLE_THEME } from './theme';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('pose la classe du thème sur <html>', () => {
    TestBed.inject(ThemeService);
    TestBed.tick();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('bascule, enregistre et change la classe', () => {
    const theme = TestBed.inject(ThemeService);
    theme.basculer();
    TestBed.tick();
    expect(theme.theme()).toBe('light');
    expect(localStorage.getItem(CLE_THEME)).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('ne plante pas si l\'écriture du stockage lève', () => {
    const origine = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('bloqué'); };
    try {
      const theme = TestBed.inject(ThemeService);
      theme.basculer();
      expect(() => TestBed.tick()).not.toThrow();
      expect(document.documentElement.classList.contains('light')).toBe(true);
    } finally {
      Storage.prototype.setItem = origine;
    }
  });
});
```

(Si `TestBed.tick` n'existe pas dans la 21.2.4, utiliser `TestBed.flushEffects()` et le noter.)

- [ ] **Step 4: ThemeService — implémentation**

Créer `angular/src/app/core/theme/theme.service.ts` :

```ts
import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { CLE_THEME, type Theme, themeInitial, themeSuivant } from './theme';

/** Le thème courant. Les jetons clairs vivent sous `html.light` (styles/jetons.css). */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly stockage = this.doc.defaultView?.localStorage ?? null;
  private readonly _theme = signal<Theme>(themeInitial(this.stockage));

  readonly theme = this._theme.asReadonly();

  constructor() {
    effect(() => {
      const t = this._theme();
      const racine = this.doc.documentElement.classList;
      racine.toggle('light', t === 'light');
      racine.toggle('dark', t === 'dark');
      try {
        this.stockage?.setItem(CLE_THEME, t);
      } catch {
        // Stockage bloqué : le thème s'applique quand même, il ne sera
        // simplement pas retenu au prochain chargement.
      }
    });
  }

  basculer(): void {
    this._theme.update(themeSuivant);
  }
}
```

Run: `cd angular && npx ng test --watch=false` — Expected: 3 tests PASS.

- [ ] **Step 5: Instancier le thème au démarrage**

Dans `angular/src/app/app.ts`, dans la classe `App`, ajouter le champ (et l'import) :

```ts
  // Instancié ici pour que le thème s'applique dès le premier écran,
  // connexion comprise.
  private readonly theme = inject(ThemeService);
```

- [ ] **Step 6: Garde inverse — test puis implémentation**

Créer `angular/src/app/core/auth/sans-session.guard.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { AuthService } from './auth.service';
import { sansSessionGuard } from './sans-session.guard';

function executer(connecte: boolean) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: { connecte: signal(connecte) } }],
  });
  return TestBed.runInInjectionContext(() =>
    sansSessionGuard({} as ActivatedRouteSnapshot, { url: '/connexion' } as RouterStateSnapshot),
  );
}

describe('sansSessionGuard', () => {
  it('laisse la page de connexion à un visiteur non connecté', () => {
    expect(executer(false)).toBe(true);
  });
  it('renvoie un utilisateur connecté vers l\'accueil', () => {
    const r = executer(true) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/');
  });
});
```

Créer `angular/src/app/core/auth/sans-session.guard.ts` :

```ts
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

/** Page de connexion : un utilisateur déjà connecté n'a rien à y faire. */
export const sansSessionGuard: CanActivateFn = () =>
  inject(AuthService).connecte() ? inject(Router).createUrlTree(['/']) : true;
```

Dans `angular/src/app/app.routes.ts`, sur la route `connexion`, ajouter `canActivate: [sansSessionGuard]` (et l'import).

- [ ] **Step 7: Vérifier et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src/app
git commit -m "feat(angular): thème clair/sombre et garde inverse de la connexion"
```

---

### Task 2: Robustesse HTTP — 3 appels simultanés au plus, une seule redirection, message 403

**Files:**
- Create: `angular/src/app/core/http/semaphore.ts` + `semaphore.spec.ts`
- Create: `angular/src/app/core/http/limiteur.interceptor.ts` + `limiteur.interceptor.spec.ts`
- Modify: `angular/src/app/app.config.ts` (enregistrer le limiteur EN PREMIER)
- Modify: `angular/src/app/core/auth/auth.service.ts` + `auth.service.spec.ts` (redirection dédoublonnée)
- Modify: `angular/src/app/core/http/erreurs.ts` + `erreurs.spec.ts` (403)

**Interfaces:**
- Consumes: `HttpBaseService.apiUrl`, `AuthService.renvoyerVersConnexion()`.
- Produces: `interface Semaphore { acquerir(): Promise<() => void>; enVol(): number; enAttente(): number }`, `creerSemaphore(max: number): Semaphore`, `MAX_APPELS_SIMULTANES = 3`, `SEMAPHORE_API: InjectionToken<Semaphore>`, `limiteurInterceptor: HttpInterceptorFn`.

- [ ] **Step 1: Sémaphore — test (échec attendu)**

Créer `angular/src/app/core/http/semaphore.spec.ts` :

```ts
import { creerSemaphore } from './semaphore';

describe('creerSemaphore', () => {
  it('accorde immédiatement jusqu\'au plafond, puis met en attente', async () => {
    const s = creerSemaphore(2);
    await s.acquerir();
    await s.acquerir();
    let troisieme = false;
    void s.acquerir().then(() => (troisieme = true));
    await Promise.resolve();
    expect(s.enVol()).toBe(2);
    expect(s.enAttente()).toBe(1);
    expect(troisieme).toBe(false);
  });

  it('libérer passe la main au suivant, dans l\'ordre d\'arrivée', async () => {
    const s = creerSemaphore(1);
    const liberer = await s.acquerir();
    const ordre: string[] = [];
    void s.acquerir().then(() => ordre.push('a'));
    void s.acquerir().then(() => ordre.push('b'));
    liberer();
    await Promise.resolve();
    await Promise.resolve();
    expect(ordre).toEqual(['a']);
    expect(s.enVol()).toBe(1);
  });

  it('libérer deux fois ne libère qu\'une place', async () => {
    const s = creerSemaphore(1);
    const liberer = await s.acquerir();
    liberer();
    liberer();
    expect(s.enVol()).toBe(0);
  });
});
```

- [ ] **Step 2: Sémaphore — implémentation**

Créer `angular/src/app/core/http/semaphore.ts` (porté de `lib/campagne/semaphore.ts`, plus `enAttente`) :

```ts
import { InjectionToken } from '@angular/core';

/** Un nombre borné de places ; les demandeurs en trop attendent leur tour. */
export interface Semaphore {
  acquerir(): Promise<() => void>;
  enVol(): number;
  enAttente(): number;
}

export function creerSemaphore(max: number): Semaphore {
  let actifs = 0;
  const attente: (() => void)[] = [];

  function jeton(): () => void {
    let libere = false;
    return function liberer(): void {
      if (libere) return;
      libere = true;
      actifs--;
      const suivant = attente.shift();
      if (suivant) {
        actifs++;
        suivant();
      }
    };
  }

  function acquerir(): Promise<() => void> {
    return new Promise((resolve) => {
      if (actifs < max) {
        actifs++;
        resolve(jeton());
      } else {
        attente.push(() => resolve(jeton()));
      }
    });
  }

  return { acquerir, enVol: () => actifs, enAttente: () => attente.length };
}

/**
 * Règle d'I/O de CLAUDE.md : « Promise.all() > 3 appels Supabase simultanés »
 * est INTERDIT. Côté React elle était tenue écran par écran ; ici un seul
 * sémaphore la tient pour TOUTE l'application.
 */
export const MAX_APPELS_SIMULTANES = 3;

export const SEMAPHORE_API = new InjectionToken<Semaphore>('SEMAPHORE_API', {
  providedIn: 'root',
  factory: () => creerSemaphore(MAX_APPELS_SIMULTANES),
});
```

Run: `cd angular && npx ng test --watch=false` — Expected: 3 tests PASS.

- [ ] **Step 3: Limiteur — test (échec attendu)**

Créer `angular/src/app/core/http/limiteur.interceptor.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpBaseService } from './http-base.service';
import { limiteurInterceptor } from './limiteur.interceptor';
import { SEMAPHORE_API, creerSemaphore } from './semaphore';

const attendre = () => new Promise((r) => setTimeout(r, 0));

function preparer() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([limiteurInterceptor])),
      provideHttpClientTesting(),
      { provide: HttpBaseService, useValue: { apiUrl: '/api' } },
      { provide: SEMAPHORE_API, useValue: creerSemaphore(3) },
    ],
  });
  return { http: TestBed.inject(HttpClient), ctrl: TestBed.inject(HttpTestingController) };
}

describe('limiteurInterceptor', () => {
  it('ne laisse partir que 3 appels à l\'API, le 4e attend la fin d\'un autre', async () => {
    const { http, ctrl } = preparer();
    for (let i = 1; i <= 4; i++) http.get(`/api/a${i}`).subscribe();
    await attendre();
    expect(ctrl.match(() => true).length).toBe(3);
    ctrl.expectOne('/api/a1').flush({});
    await attendre();
    ctrl.expectOne('/api/a4');
  });

  it('un appel abandonné en file d\'attente ne garde pas de place', async () => {
    const { http, ctrl } = preparer();
    const subs = [1, 2, 3].map((i) => http.get(`/api/a${i}`).subscribe());
    const enAttente = http.get('/api/a4').subscribe();
    await attendre();
    enAttente.unsubscribe();
    subs.forEach((s) => s.unsubscribe());
    await attendre();
    for (let i = 5; i <= 7; i++) http.get(`/api/a${i}`).subscribe();
    await attendre();
    expect(ctrl.match((r) => ['/api/a5', '/api/a6', '/api/a7'].includes(r.url)).length).toBe(3);
  });

  it('une erreur libère la place', async () => {
    const { http, ctrl } = preparer();
    for (let i = 1; i <= 4; i++) http.get(`/api/a${i}`).subscribe({ error: () => undefined });
    await attendre();
    ctrl.expectOne('/api/a1').flush('', { status: 500, statusText: 'Erreur' });
    await attendre();
    ctrl.expectOne('/api/a4');
  });

  it('ne limite pas ce qui n\'est pas l\'API', async () => {
    const { http, ctrl } = preparer();
    for (let i = 1; i <= 5; i++) http.get(`/ailleurs/${i}`).subscribe();
    await attendre();
    expect(ctrl.match(() => true).length).toBe(5);
  });
});
```

- [ ] **Step 4: Limiteur — implémentation**

Créer `angular/src/app/core/http/limiteur.interceptor.ts` :

```ts
import { inject } from '@angular/core';
import type { HttpEvent, HttpInterceptorFn } from '@angular/common/http';
import { Observable, type Subscription } from 'rxjs';
import { HttpBaseService } from './http-base.service';
import { SEMAPHORE_API } from './semaphore';

/**
 * Au plus MAX_APPELS_SIMULTANES appels à l'API en vol, pour toute
 * l'application. Enregistré EN PREMIER : la place est prise avant que le
 * jeton soit lu, et rendue quand la réponse est complète, en erreur, ou
 * abandonnée.
 *
 * ⚠ Un Observable écrit à la main plutôt que `from(acquerir()).pipe(...)` :
 * un appel abandonné PENDANT son attente recevrait sa place plus tard sans
 * personne pour la rendre, et au bout de trois abandons l'application ne
 * ferait plus aucun appel.
 */
export const limiteurInterceptor: HttpInterceptorFn = (req, next) => {
  const apiUrl = inject(HttpBaseService).apiUrl;
  if (!req.url.startsWith(`${apiUrl}/`)) return next(req);
  const semaphore = inject(SEMAPHORE_API);

  return new Observable<HttpEvent<unknown>>((abonne) => {
    let liberer: (() => void) | null = null;
    let abandonne = false;
    let interne: Subscription | null = null;
    const rendre = () => {
      liberer?.();
      liberer = null;
    };

    void semaphore.acquerir().then((l) => {
      if (abandonne) {
        l();
        return;
      }
      liberer = l;
      interne = next(req).subscribe({
        next: (v) => abonne.next(v),
        error: (e) => {
          rendre();
          abonne.error(e);
        },
        complete: () => {
          rendre();
          abonne.complete();
        },
      });
    });

    return () => {
      abandonne = true;
      interne?.unsubscribe();
      rendre();
    };
  });
};
```

Dans `angular/src/app/app.config.ts`, remplacer la liste d'intercepteurs par :

```ts
    provideHttpClient(withInterceptors([limiteurInterceptor, jetonInterceptor, sessionExpireeInterceptor])),
```

(import `limiteurInterceptor` depuis `./core/http/limiteur.interceptor`), et compléter le commentaire au-dessus : « limiteurInterceptor EN PREMIER : la place est prise avant tout le reste. »

Run: `cd angular && npx ng test --watch=false` — Expected: 4 tests du limiteur PASS, `app.config.spec.ts` toujours vert.

- [ ] **Step 5: Une seule redirection pour plusieurs 401 simultanés — test puis implémentation**

Ajouter à `angular/src/app/core/auth/auth.service.spec.ts` un test (dans le style des tests existants du fichier, avec son faux client et son faux routeur) :

```ts
  it('deux fins de session simultanées ne redirigent qu\'une fois', async () => {
    // Préparer le service comme dans les tests de renvoyerVersConnexion
    // existants, avec un espion sur router.navigate et sur auth.signOut.
    // Puis :
    await Promise.all([auth.renvoyerVersConnexion(), auth.renvoyerVersConnexion()]);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
```

Le développeur réutilise EXACTEMENT les fabriques et espions déjà présents dans ce fichier (lire le fichier avant d'écrire le test) ; les noms `auth`, `navigate`, `signOut` ci-dessus désignent ces espions.

Dans `angular/src/app/core/auth/auth.service.ts`, ajouter le champ `private renvoiEnCours: Promise<void> | null = null;` et remplacer le corps de `renvoyerVersConnexion()` par :

```ts
    // Plusieurs appels en vol peuvent échouer en 401 au même moment : un
    // seul renvoi, les autres attendent le même.
    this.renvoiEnCours ??= (async () => {
      try {
        await this.supabase.auth.signOut({ scope: 'local' });
        this._session.set(null);
        await this.redirigerVersConnexion();
      } finally {
        this.renvoiEnCours = null;
      }
    })();
    return this.renvoiEnCours;
```

- [ ] **Step 6: Message 403 — test puis implémentation**

Ajouter à `angular/src/app/core/http/erreurs.spec.ts` :

```ts
  it('explique un refus de droits sans message serveur', () => {
    expect(messageErreurApi(err(403))).toBe('Votre rôle ne permet pas cette action.');
  });
  it('garde le message serveur d\'un 403 quand il existe', () => {
    expect(messageErreurApi(err(403, { error: 'Réservé au super administrateur.' }))).toBe('Réservé au super administrateur.');
  });
```

Dans `angular/src/app/core/http/erreurs.ts`, juste avant le `return` final (après la lecture de `corps.error`), ajouter :

```ts
  if (erreur.status === 403) return 'Votre rôle ne permet pas cette action.';
```

- [ ] **Step 7: Vérifier et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src/app
git commit -m "feat(angular): 3 appels API simultanés au plus, redirection unique, message 403"
```

---

### Task 3: Chargement partagé — barre de progression et données périmées

**Files:**
- Create: `angular/src/app/core/chargement/chargement.ts` + `chargement.spec.ts`
- Create: `angular/src/app/core/chargement/chargement.service.ts` + `chargement.service.spec.ts`
- Create: `angular/src/app/ui/barre-progression/barre-progression.component.ts` + `.spec.ts`
- Create: `angular/src/app/ui/perime/perime.directive.ts` + `.spec.ts`

**Interfaces:**
- Produces: `interface Piste { cle: string; libelle: string; actif: boolean }`, `interface Chargement { actif: boolean; libelles: string[]; texte: string | null }`, `agregerChargement(pistes: Piste[]): Chargement`, `estPerime(chargeEnCours: boolean, aDesDonnees: boolean): boolean`, `ChargementService` (NON `providedIn: 'root'` : fourni par l'écran) avec `etat: Signal<Chargement>`, `declarer(p: Piste): void`, `retirer(cle: string): void`, `suivre(cle: string, libelle: string, actif: () => boolean): void`, `BarreProgressionComponent` (`mg-barre-progression`), `PerimeDirective` (`[mgPerime]`).

- [ ] **Step 1: Règles pures — test puis implémentation**

Créer `angular/src/app/core/chargement/chargement.spec.ts` :

```ts
import { agregerChargement, estPerime } from './chargement';

describe('agregerChargement', () => {
  it('inactif sans piste active', () => {
    expect(agregerChargement([{ cle: 'a', libelle: 'Calcul', actif: false }]))
      .toEqual({ actif: false, libelles: [], texte: null });
  });
  it('un seul libellé : le texte est ce libellé', () => {
    expect(agregerChargement([{ cle: 'a', libelle: 'Calcul des classes', actif: true }]).texte)
      .toBe('Calcul des classes');
  });
  it('plusieurs : le premier, plus le nombre des autres', () => {
    const c = agregerChargement([
      { cle: 'a', libelle: 'Calcul', actif: true },
      { cle: 'b', libelle: 'Courbe', actif: true },
      { cle: 'c', libelle: 'Sites', actif: true },
    ]);
    expect(c.texte).toBe('Calcul (+2)');
  });
  it('dédoublonne deux pistes au même libellé', () => {
    const c = agregerChargement([
      { cle: 'a', libelle: 'Calcul', actif: true },
      { cle: 'b', libelle: 'Calcul', actif: true },
    ]);
    expect(c.libelles).toEqual(['Calcul']);
    expect(c.texte).toBe('Calcul');
  });
});

describe('estPerime', () => {
  it('seulement quand on recharge ET qu\'une valeur est déjà à l\'écran', () => {
    expect(estPerime(true, true)).toBe(true);
    expect(estPerime(true, false)).toBe(false);
    expect(estPerime(false, true)).toBe(false);
  });
});
```

Créer `angular/src/app/core/chargement/chargement.ts` (porté de `lib/risques/chargement.ts`) :

```ts
/**
 * UNE barre de progression pour tout un écran. Chaque source de données
 * déclare une « piste » ; la barre dit s'il y a du travail en cours, et
 * lequel. Indéterminée à dessein : aucune route ne rend d'avancement, un
 * pourcentage y serait inventé.
 */
export interface Piste {
  cle: string;
  libelle: string;
  actif: boolean;
}

export interface Chargement {
  actif: boolean;
  libelles: string[];
  texte: string | null;
}

export function agregerChargement(pistes: Piste[]): Chargement {
  const libelles: string[] = [];
  for (const p of pistes) {
    if (p.actif && !libelles.includes(p.libelle)) libelles.push(p.libelle);
  }
  if (libelles.length === 0) return { actif: false, libelles: [], texte: null };
  const texte = libelles.length === 1 ? libelles[0] : `${libelles[0]} (+${libelles.length - 1})`;
  return { actif: true, libelles, texte };
}

/**
 * Une valeur à l'écran pendant qu'on recalcule décrit l'état PRÉCÉDENT. Elle
 * s'estompe au lieu de disparaître : un squelette effacerait justement le
 * chiffre qu'on veut comparer au nouveau.
 */
export function estPerime(chargeEnCours: boolean, aDesDonnees: boolean): boolean {
  return chargeEnCours && aDesDonnees;
}
```

Run: `cd angular && npx ng test --watch=false` — Expected: 5 tests PASS.

- [ ] **Step 2: ChargementService — test puis implémentation**

Créer `angular/src/app/core/chargement/chargement.service.spec.ts` :

```ts
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChargementService } from './chargement.service';

@Component({ selector: 'mg-source-essai', template: '' })
class SourceEssai {
  readonly actif = signal(true);
  constructor() {
    inject(ChargementService).suivre('essai', 'Calcul', () => this.actif());
  }
}

@Component({
  selector: 'mg-hote-essai',
  imports: [SourceEssai],
  providers: [ChargementService],
  template: '@if (montee()) { <mg-source-essai /> }',
})
class HoteEssai {
  readonly montee = signal(true);
  readonly chargement = inject(ChargementService);
}

describe('ChargementService', () => {
  it('déclare, met à jour et retire une piste', () => {
    const s = new ChargementService();
    s.declarer({ cle: 'a', libelle: 'Calcul', actif: true });
    expect(s.etat().texte).toBe('Calcul');
    s.declarer({ cle: 'a', libelle: 'Calcul', actif: false });
    expect(s.etat().actif).toBe(false);
    s.retirer('a');
    expect(s.etat()).toEqual({ actif: false, libelles: [], texte: null });
  });

  it('suit un signal et retire la piste quand la source est détruite', async () => {
    const f = TestBed.createComponent(HoteEssai);
    await f.whenStable();
    expect(f.componentInstance.chargement.etat().texte).toBe('Calcul');
    f.componentInstance.montee.set(false);
    await f.whenStable();
    expect(f.componentInstance.chargement.etat().actif).toBe(false);
  });
});
```

Créer `angular/src/app/core/chargement/chargement.service.ts` :

```ts
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { type Chargement, type Piste, agregerChargement } from './chargement';

/**
 * Registre des pistes de chargement d'UN écran. Pas `providedIn: 'root'` :
 * l'écran le fournit (`providers: [ChargementService]`), et ses composants
 * enfants y déclarent leurs pistes. Équivalent de ContexteChargement côté React.
 */
@Injectable()
export class ChargementService {
  private readonly pistes = signal<Piste[]>([]);

  readonly etat = computed<Chargement>(() => agregerChargement(this.pistes()));

  declarer(p: Piste): void {
    this.pistes.update((liste) => {
      const i = liste.findIndex((x) => x.cle === p.cle);
      if (i >= 0 && liste[i].actif === p.actif && liste[i].libelle === p.libelle) return liste;
      if (i < 0) return [...liste, p];
      const copie = [...liste];
      copie[i] = p;
      return copie;
    });
  }

  retirer(cle: string): void {
    this.pistes.update((liste) => (liste.some((x) => x.cle === cle) ? liste.filter((x) => x.cle !== cle) : liste));
  }

  /**
   * Déclare une piste qui suit `actif` et disparaît avec le composant appelant.
   * À appeler dans un contexte d'injection (constructeur ou initialiseur de champ).
   */
  suivre(cle: string, libelle: string, actif: () => boolean): void {
    effect(() => this.declarer({ cle, libelle, actif: actif() }));
    inject(DestroyRef).onDestroy(() => this.retirer(cle));
  }
}
```

Run: `cd angular && npx ng test --watch=false` — Expected: 2 tests PASS. (Si `inject(DestroyRef)` rend celui du service plutôt que celui du composant appelant, le second test échoue : dans ce cas faire de `suivre` une fonction libre `suivreChargement(cle, libelle, actif)` qui injecte `ChargementService` et `DestroyRef` depuis le contexte de l'appelant, l'exporter depuis le même fichier, adapter `SourceEssai` et le noter dans le rapport.)

- [ ] **Step 3: Barre de progression — test puis implémentation**

Créer `angular/src/app/ui/barre-progression/barre-progression.component.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { ChargementService } from '../../core/chargement/chargement.service';
import { BarreProgressionComponent } from './barre-progression.component';

async function rendre() {
  TestBed.configureTestingModule({ imports: [BarreProgressionComponent], providers: [ChargementService] });
  const f = TestBed.createComponent(BarreProgressionComponent);
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement, chargement: TestBed.inject(ChargementService) };
}

describe('BarreProgressionComponent', () => {
  it('reste montée et muette sans travail en cours', async () => {
    const { el } = await rendre();
    const barre = el.querySelector('[role="progressbar"]')!;
    expect(barre.getAttribute('aria-busy')).toBe('false');
    expect(barre.getAttribute('aria-label')).toBe('Aucun calcul en cours');
  });

  it('annonce le travail en cours', async () => {
    const { f, el, chargement } = await rendre();
    chargement.declarer({ cle: 'a', libelle: 'Calcul des classes', actif: true });
    await f.whenStable();
    const barre = el.querySelector('[role="progressbar"]')!;
    expect(barre.getAttribute('aria-busy')).toBe('true');
    expect(barre.getAttribute('aria-label')).toBe('Calcul des classes');
    expect(el.textContent).toContain('Calcul des classes');
  });
});
```

Créer `angular/src/app/ui/barre-progression/barre-progression.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ChargementService } from '../../core/chargement/chargement.service';

/**
 * UNE barre pour tout l'écran, lue dans le ChargementService fourni par
 * l'écran. TOUJOURS montée, seule l'opacité change : la démonter relancerait
 * l'animation et ferait sauter la mise en page à chaque calcul.
 */
@Component({
  selector: 'mg-barre-progression',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="progressbar"
         [attr.aria-busy]="etat().actif"
         [attr.aria-label]="etat().texte ?? 'Aucun calcul en cours'"
         class="relative h-[3px] overflow-hidden transition-opacity duration-150"
         [class.bg-overlay]="etat().actif"
         [class.opacity-0]="!etat().actif">
      @if (etat().actif) {
        <span class="curseur" aria-hidden="true"></span>
        <span class="absolute top-1.5 left-5 whitespace-nowrap pointer-events-none text-[10.5px] text-tertiary">
          {{ etat().texte }}
        </span>
      }
    </div>
  `,
  styles: `
    .curseur {
      position: absolute; top: 0; left: 0; height: 100%; width: 25%;
      background: var(--brand-teal);
      animation: glisse 1.1s ease-in-out infinite;
    }
    @keyframes glisse {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .curseur { animation: none; width: 100%; opacity: 0.45; }
    }
  `,
})
export class BarreProgressionComponent {
  protected readonly etat = computed(() => this.chargement.etat());
  private readonly chargement = inject(ChargementService);
}
```

(Déclarer `chargement` AVANT `etat` si l'ordre d'initialisation des champs l'exige — `computed` est paresseux, donc l'ordre ci-dessus fonctionne, mais le développeur peut réordonner pour la lisibilité.)

- [ ] **Step 4: Directive « périmé » — test puis implémentation**

Créer `angular/src/app/ui/perime/perime.directive.spec.ts` :

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PerimeDirective } from './perime.directive';

@Component({
  imports: [PerimeDirective],
  template: '<div [mgPerime]="perime()"><button>Garder le clic</button></div>',
})
class Hote { readonly perime = signal(false); }

describe('PerimeDirective', () => {
  it('estompe sans bloquer les clics, et le dit aux lecteurs d\'écran', async () => {
    const f = TestBed.createComponent(Hote);
    await f.whenStable();
    const div = (f.nativeElement as HTMLElement).querySelector('div')!;
    expect(div.style.opacity).toBe('1');
    f.componentInstance.perime.set(true);
    await f.whenStable();
    expect(div.style.opacity).toBe('0.42');
    expect(div.getAttribute('aria-busy')).toBe('true');
    expect(div.style.pointerEvents).not.toBe('none');
  });
});
```

Créer `angular/src/app/ui/perime/perime.directive.ts` :

```ts
import { Directive, input } from '@angular/core';

/** Estompe une valeur qui décrit l'état précédent pendant un recalcul (voir `estPerime`). */
@Directive({
  selector: '[mgPerime]',
  host: {
    '[style.opacity]': 'mgPerime() ? 0.42 : 1',
    '[style.transition]': '"opacity 160ms linear"',
    '[attr.aria-busy]': 'mgPerime()',
  },
})
export class PerimeDirective {
  readonly mgPerime = input.required<boolean>();
}
```

- [ ] **Step 5: Vérifier et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src/app
git commit -m "feat(angular): barre de progression unique et valeurs périmées estompées"
```

---

### Task 4: Primitives d'affichage — tuile KPI, pastille, champ, cellules de tableau

**Files:**
- Create: `angular/src/app/ui/kpi/kpi.component.ts` + `.spec.ts`
- Create: `angular/src/app/ui/pastille/pastille.component.ts` + `.spec.ts`
- Create: `angular/src/app/ui/champ/champ.component.ts` + `.spec.ts`
- Create: `angular/src/app/ui/tableau/cellules.ts` + `cellules.spec.ts`

**Interfaces:**
- Produces: `KpiComponent` (`mg-kpi`, entrées `valeur`, `libelle`, `note` requises, `accent?: boolean`, `taille?: 22 | 24`), `PastilleComponent` (`button[mgPastille]`, entrée `actif` requise), `ChampComponent` (`mg-champ`, entrée `libelle` requise, contenu projeté), `EnteteCellule` (`th[mgTh]`, entrées `alignement?: 'gauche' | 'droite'` défaut `'droite'`, `explication?: string`), `Cellule` (`td[mgTd]`, entrées `fort?: boolean`, `attenue?: boolean`).

- [ ] **Step 1: Tests des quatre primitives (échec attendu)**

Créer `angular/src/app/ui/kpi/kpi.component.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { KpiComponent } from './kpi.component';

async function rendre(entrees: Record<string, unknown>) {
  const f = TestBed.createComponent(KpiComponent);
  for (const [k, v] of Object.entries(entrees)) f.componentRef.setInput(k, v);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('KpiComponent', () => {
  it('affiche la valeur, le libellé et la note', async () => {
    const el = await rendre({ valeur: '13 585 817', libelle: 'Habitants', note: 'Carroyage INSEE 2021' });
    expect(el.textContent).toContain('13 585 817');
    expect(el.textContent).toContain('Habitants');
    expect(el.textContent).toContain('Carroyage INSEE 2021');
  });
  it('met la valeur en accent sur demande', async () => {
    const el = await rendre({ valeur: '1', libelle: 'l', note: 'n', accent: true });
    expect(el.querySelector('[data-role="valeur"]')!.classList).toContain('text-teal');
  });
  it('taille 22 : valeur 22 px, libellé 11 px', async () => {
    const el = await rendre({ valeur: '1', libelle: 'l', note: 'n', taille: 22 });
    expect(el.querySelector('[data-role="valeur"]')!.classList).toContain('text-[22px]');
    expect(el.querySelector('[data-role="libelle"]')!.classList).toContain('text-[11px]');
  });
});
```

Créer `angular/src/app/ui/pastille/pastille.component.spec.ts` :

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PastilleComponent } from './pastille.component';

@Component({
  imports: [PastilleComponent],
  template: '<button mgPastille [actif]="actif()" (click)="actif.set(!actif())">Seuil haut</button>',
})
class Hote { readonly actif = signal(false); }

describe('PastilleComponent', () => {
  it('reste un vrai bouton, et dit son état', async () => {
    const f = TestBed.createComponent(Hote);
    await f.whenStable();
    const b = (f.nativeElement as HTMLElement).querySelector('button')!;
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    b.click();
    await f.whenStable();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.classList).toContain('text-teal');
  });
});
```

Créer `angular/src/app/ui/champ/champ.component.spec.ts` :

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChampComponent } from './champ.component';

@Component({
  imports: [ChampComponent],
  template: '<mg-champ libelle="Territoire"><select><option>France</option></select></mg-champ>',
})
class Hote {}

describe('ChampComponent', () => {
  it('lie le libellé au contrôle projeté par un <label>', async () => {
    const f = TestBed.createComponent(Hote);
    await f.whenStable();
    const label = (f.nativeElement as HTMLElement).querySelector('label')!;
    expect(label.textContent).toContain('Territoire');
    expect(label.querySelector('select')).not.toBeNull();
  });
});
```

Créer `angular/src/app/ui/tableau/cellules.spec.ts` :

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Cellule, EnteteCellule } from './cellules';

@Component({
  imports: [EnteteCellule, Cellule],
  template: `
    <table><thead><tr>
      <th mgTh alignement="gauche">Territoire</th>
      <th mgTh explication="Somme des carreaux de 200 m">Habitants</th>
    </tr></thead>
    <tbody><tr><td mgTd fort>Total</td><td mgTd attenue>—</td></tr></tbody></table>`,
})
class Hote {}

describe('cellules de tableau', () => {
  it('garde la sémantique native et porte l\'explication en info-bulle', async () => {
    const f = TestBed.createComponent(Hote);
    await f.whenStable();
    const [gauche, aide] = Array.from((f.nativeElement as HTMLElement).querySelectorAll('th'));
    expect(gauche.classList).toContain('text-left');
    expect(aide.classList).toContain('text-right');
    expect(aide.getAttribute('title')).toBe('Somme des carreaux de 200 m');
    expect(aide.classList).toContain('cursor-help');
    expect(gauche.getAttribute('title')).toBeNull();
    const [fort, attenue] = Array.from((f.nativeElement as HTMLElement).querySelectorAll('td'));
    expect(fort.classList).toContain('text-primary');
    expect(attenue.classList).toContain('text-tertiary');
  });
});
```

Run: `cd angular && npx ng test --watch=false` — Expected: FAIL (modules introuvables).

- [ ] **Step 2: Implémenter**

Créer `angular/src/app/ui/kpi/kpi.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Une tuile de chiffre clé. La `note` est OBLIGATOIRE, à dessein (même règle
 * que components/risques/Kpi.tsx) : un chiffre sans sa limite de lecture se
 * recopie dans une présentation sans elle.
 */
@Component({
  selector: 'mg-kpi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-px">
      <span data-role="valeur" class="font-mono leading-[1.1]"
            [class.text-[24px]]="taille() === 24" [class.text-[22px]]="taille() === 22"
            [class.text-teal]="accent()" [class.text-primary]="!accent()">{{ valeur() }}</span>
      <span data-role="libelle" class="text-secondary"
            [class.text-xs]="taille() === 24" [class.text-[11px]]="taille() === 22">{{ libelle() }}</span>
      <span class="text-[10px] text-tertiary">{{ note() }}</span>
    </div>
  `,
})
export class KpiComponent {
  readonly valeur = input.required<string>();
  readonly libelle = input.required<string>();
  readonly note = input.required<string>();
  readonly accent = input(false);
  readonly taille = input<22 | 24>(24);
}
```

Créer `angular/src/app/ui/pastille/pastille.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Un bouton-bascule en forme de pastille. Reste un vrai `<button>`, avec `aria-pressed`. */
@Component({
  selector: 'button[mgPastille]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    type: 'button',
    '[attr.aria-pressed]': 'actif()',
    class: 'rounded-md px-[11px] py-1.5 text-xs cursor-pointer border-[0.5px] transition-colors duration-200',
    '[class.bg-teal-10]': 'actif()',
    '[class.border-teal]': 'actif()',
    '[class.text-teal]': 'actif()',
    '[class.border-subtle]': '!actif()',
    '[class.text-secondary]': '!actif()',
  },
})
export class PastilleComponent {
  readonly actif = input.required<boolean>();
}
```

Ajouter à `@theme inline` de `angular/src/styles.css` la ligne `--color-teal-10: var(--brand-teal-10);` (la classe `bg-teal-10` en a besoin ; le jeton existe déjà dans `jetons.css`).

Créer `angular/src/app/ui/champ/champ.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Un libellé au-dessus de son contrôle, liés par un `<label>` englobant. */
@Component({
  selector: 'mg-champ',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="flex flex-col gap-[5px]">
      <span class="text-[10px] text-tertiary">{{ libelle() }}</span>
      <ng-content />
    </label>
  `,
})
export class ChampComponent {
  readonly libelle = input.required<string>();
}
```

Créer `angular/src/app/ui/tableau/cellules.ts` :

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * En-tête de colonne. `explication` rend un soulignement pointillé et une
 * info-bulle : un en-tête qui a besoin d'être expliqué doit le montrer.
 */
@Component({
  selector: 'th[mgTh]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    class: 'px-2 py-1.5 font-normal text-[10px] text-tertiary',
    '[class.text-left]': 'alignement() === "gauche"',
    '[class.text-right]': 'alignement() === "droite"',
    '[attr.title]': 'explication() ?? null',
    '[class.cursor-help]': '!!explication()',
    '[class.border-b]': '!!explication()',
    '[class.border-dotted]': '!!explication()',
    '[class.border-default]': '!!explication()',
  },
})
export class EnteteCellule {
  readonly alignement = input<'gauche' | 'droite'>('droite');
  readonly explication = input<string>();
}

/** Cellule de chiffre : alignée à droite, en police à chasse fixe. */
@Component({
  selector: 'td[mgTd]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    class: 'text-right px-2 py-[7px] font-mono text-[11px]',
    '[class.text-primary]': 'fort()',
    '[class.text-tertiary]': '!fort() && attenue()',
    '[class.text-secondary]': '!fort() && !attenue()',
  },
})
export class Cellule {
  readonly fort = input(false, { transform: (v: boolean | '') => v === '' || v === true });
  readonly attenue = input(false, { transform: (v: boolean | '') => v === '' || v === true });
}
```

(Le `transform` permet d'écrire `<td mgTd fort>` sans valeur, comme un attribut booléen HTML. Si le développeur préfère `booleanAttribute` de `@angular/core`, c'est l'équivalent standard : l'utiliser, et l'appliquer aussi à `accent` du KPI pour la cohérence.)

Run: `cd angular && npx ng test --watch=false` — Expected: tous les tests de la tâche PASS.

- [ ] **Step 3: Vérifier et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src
git commit -m "feat(angular): tuile KPI, pastille, champ et cellules de tableau"
```

---

### Task 5: Navigation et réglette — fil d'étapes, fil d'Ariane, réglette validée au relâchement

**Files:**
- Create: `angular/src/app/ui/fil-etapes/fil-etapes.component.ts` + `.spec.ts`
- Create: `angular/src/app/ui/fil-ariane/fil-ariane.component.ts` + `.spec.ts`
- Create: `angular/src/app/ui/reglette/reglette.component.ts` + `.spec.ts`

**Interfaces:**
- Produces:
  - `interface EtapeAffichee { cle: string; rang: number; libelle: string; renseignee: boolean }`; `FilEtapesComponent` (`mg-fil-etapes`, entrées `etapes: EtapeAffichee[]`, `courante: string`, sortie `choisir: string`).
  - `interface SegmentAriane { cle: string; libelle: string; titre?: string }`; `FilArianeComponent` (`mg-fil-ariane`, entrées `segments: SegmentAriane[]` — le premier est la racine —, `precision?: string`, sortie `remonter: number` = index du segment choisi).
  - `RegletteComponent` (`mg-reglette`, entrées `libelle`, `valeur`, `min`, `max`, `pas` requises, `formater?: (n: number) => string`, `complement?: string`, `descriptionAccessible?: string` ; sorties `apercu: number | null`, `valider: number`).

- [ ] **Step 1: Fil d'étapes — test puis implémentation**

Créer `angular/src/app/ui/fil-etapes/fil-etapes.component.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { FilEtapesComponent, type EtapeAffichee } from './fil-etapes.component';

const ETAPES: EtapeAffichee[] = [
  { cle: 'a', rang: 1, libelle: 'Premier', renseignee: true },
  { cle: 'b', rang: 2, libelle: 'Deuxième', renseignee: true },
  { cle: 'c', rang: 3, libelle: 'Troisième', renseignee: false },
];

async function rendre(courante: string) {
  const f = TestBed.createComponent(FilEtapesComponent);
  f.componentRef.setInput('etapes', ETAPES);
  f.componentRef.setInput('courante', courante);
  const choix: string[] = [];
  f.componentInstance.choisir.subscribe((c) => choix.push(c));
  await f.whenStable();
  return { el: f.nativeElement as HTMLElement, choix };
}

describe('FilEtapesComponent', () => {
  it('marque l\'étape courante et les étapes renseignées, sauf la courante', async () => {
    const { el } = await rendre('b');
    const boutons = el.querySelectorAll('button');
    expect(boutons[1].getAttribute('aria-current')).toBe('step');
    expect(boutons[0].getAttribute('aria-current')).toBeNull();
    expect(boutons[0].querySelector('[aria-label="renseignée"]')).not.toBeNull();
    expect(boutons[1].querySelector('[aria-label="renseignée"]')).toBeNull();
    expect(boutons[2].querySelector('[aria-label="renseignée"]')).toBeNull();
  });

  it('chaque étape reste cliquable, dans les deux sens', async () => {
    const { el, choix } = await rendre('b');
    el.querySelectorAll('button')[0].click();
    el.querySelectorAll('button')[2].click();
    expect(choix).toEqual(['a', 'c']);
  });

  it('flèches, Début et Fin déplacent l\'étape et le focus, bornés', async () => {
    const { el, choix } = await rendre('a');
    const boutons = el.querySelectorAll('button');
    const touche = (b: Element, key: string) => b.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    touche(boutons[0], 'ArrowLeft');
    touche(boutons[0], 'ArrowRight');
    touche(boutons[1], 'End');
    touche(boutons[2], 'Home');
    expect(choix).toEqual(['a', 'b', 'c', 'a']);
    expect(document.activeElement).toBe(boutons[0]);
  });
});
```

Note : le test du focus exige que le composant soit attaché au document ; si `document.activeElement` ne suit pas dans l'environnement de test, ajouter `document.body.appendChild(f.nativeElement)` dans `rendre` et le noter.

Créer `angular/src/app/ui/fil-etapes/fil-etapes.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, type ElementRef, input, output, viewChildren } from '@angular/core';

export interface EtapeAffichee {
  cle: string;
  rang: number;
  libelle: string;
  /** On a posé un choix à cette étape. Jamais « validée » : le parcours n'est pas un tunnel. */
  renseignee: boolean;
}

/**
 * Le fil des étapes d'un parcours (porté de components/risques/FilArianeEtapes.tsx).
 * Chaque étape reste cliquable dans les deux sens ; flèches, Début et Fin
 * déplacent l'étape ET le focus.
 */
@Component({
  selector: 'mg-fil-etapes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Étapes du parcours" class="flex items-center gap-0.5 ml-1">
      @for (e of etapes(); track e.cle; let i = $index) {
        @if (i > 0) { <span aria-hidden="true" class="text-[11px] text-tertiary">›</span> }
        <button #bouton type="button"
                (click)="choisir.emit(e.cle)" (keydown)="auClavier($event, i)"
                [attr.aria-current]="e.cle === courante() ? 'step' : null"
                class="inline-flex items-center gap-[5px] px-2.5 pt-1 pb-1.5 text-xs cursor-pointer border-b-2"
                [class.font-medium]="e.cle === courante()"
                [class.text-primary]="e.cle === courante()"
                [class.border-teal]="e.cle === courante()"
                [class.text-tertiary]="e.cle !== courante()"
                [class.border-transparent]="e.cle !== courante()">
          <span aria-hidden="true" class="text-[10px]"
                [class.text-teal]="e.cle === courante()">{{ e.rang }}</span>
          {{ e.libelle }}
          @if (e.renseignee && e.cle !== courante()) {
            <span aria-label="renseignée" title="Vous avez posé un choix à cette étape."
                  class="size-[5px] rounded-full bg-teal"></span>
          }
        </button>
      }
    </nav>
  `,
})
export class FilEtapesComponent {
  readonly etapes = input.required<EtapeAffichee[]>();
  readonly courante = input.required<string>();
  readonly choisir = output<string>();

  private readonly boutons = viewChildren<ElementRef<HTMLButtonElement>>('bouton');

  protected auClavier(ev: KeyboardEvent, i: number): void {
    const n = this.etapes().length;
    const cible =
      ev.key === 'ArrowLeft' ? i - 1
        : ev.key === 'ArrowRight' ? i + 1
          : ev.key === 'Home' ? 0
            : ev.key === 'End' ? n - 1
              : null;
    if (cible === null) return;
    ev.preventDefault();
    const borne = Math.max(0, Math.min(n - 1, cible));
    this.choisir.emit(this.etapes()[borne].cle);
    this.boutons()[borne]?.nativeElement.focus();
  }
}
```

- [ ] **Step 2: Fil d'Ariane — test puis implémentation**

Créer `angular/src/app/ui/fil-ariane/fil-ariane.component.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { FilArianeComponent } from './fil-ariane.component';

describe('FilArianeComponent', () => {
  it('chaque segment franchi remonte ; le dernier est désactivé', async () => {
    const f = TestBed.createComponent(FilArianeComponent);
    f.componentRef.setInput('segments', [
      { cle: 'fr', libelle: 'France entière' },
      { cle: 'r93', libelle: 'Provence-Alpes-Côte d\'Azur', titre: 'Région 93' },
      { cle: 'd13', libelle: 'Bouches-du-Rhône', titre: 'Département 13' },
    ]);
    f.componentRef.setInput('precision', 'Commune');
    const remontees: number[] = [];
    f.componentInstance.remonter.subscribe((i) => remontees.push(i));
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const boutons = el.querySelectorAll('button');
    boutons[0].click();
    boutons[1].click();
    expect(remontees).toEqual([0, 1]);
    expect(boutons[2].disabled).toBe(true);
    expect(boutons[1].getAttribute('title')).toBe('Région 93');
    expect(el.textContent).toContain('commune');
  });

  it('un seul segment : il est courant, donc désactivé', async () => {
    const f = TestBed.createComponent(FilArianeComponent);
    f.componentRef.setInput('segments', [{ cle: 'fr', libelle: 'France entière' }]);
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).querySelector('button')!.disabled).toBe(true);
  });
});
```

Créer `angular/src/app/ui/fil-ariane/fil-ariane.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface SegmentAriane {
  cle: string;
  libelle: string;
  /** Précision au survol — par exemple le niveau et le code INSEE, qui se recouvrent entre régions et départements. */
  titre?: string;
}

/** OÙ JE REGARDE (racine › … › courant). À ne pas confondre avec le fil d'étapes, qui dit OÙ J'EN SUIS. */
@Component({
  selector: 'mg-fil-ariane',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Fil d’Ariane" class="flex items-center gap-[7px] text-xs">
      @for (s of segments(); track s.cle; let i = $index, dernier = $last) {
        @if (i > 0) { <span aria-hidden="true" class="text-tertiary">&rsaquo;</span> }
        <button type="button" [disabled]="dernier" (click)="remonter.emit(i)"
                [attr.title]="s.titre ?? null"
                class="p-0 underline-offset-[3px]"
                [class.text-primary]="dernier" [class.cursor-default]="dernier"
                [class.text-teal]="!dernier" [class.underline]="!dernier" [class.cursor-pointer]="!dernier">
          {{ s.libelle }}
        </button>
      }
      @if (precision(); as p) {
        <span class="ml-0.5 font-mono text-[10px] text-tertiary">· {{ p.toLowerCase() }}</span>
      }
    </nav>
  `,
})
export class FilArianeComponent {
  readonly segments = input.required<SegmentAriane[]>();
  readonly precision = input<string>();
  readonly remonter = output<number>();
}
```

- [ ] **Step 3: Réglette — test puis implémentation**

Créer `angular/src/app/ui/reglette/reglette.component.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { RegletteComponent } from './reglette.component';

async function rendre() {
  const f = TestBed.createComponent(RegletteComponent);
  f.componentRef.setInput('libelle', 'Seuil haut');
  f.componentRef.setInput('valeur', 1000);
  f.componentRef.setInput('min', 100);
  f.componentRef.setInput('max', 10000);
  f.componentRef.setInput('pas', 100);
  f.componentRef.setInput('formater', (n: number) => (n >= 1000 ? `${n / 1000} km` : `${n} m`));
  const apercus: (number | null)[] = [];
  const validations: number[] = [];
  f.componentInstance.apercu.subscribe((v) => apercus.push(v));
  f.componentInstance.valider.subscribe((v) => validations.push(v));
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const curseur = el.querySelector('input[type="range"]') as HTMLInputElement;
  const glisser = async (v: number) => {
    curseur.value = String(v);
    curseur.dispatchEvent(new Event('input'));
    await f.whenStable();
  };
  const relacher = async () => {
    curseur.dispatchEvent(new Event('pointerup'));
    await f.whenStable();
  };
  return { f, el, curseur, glisser, relacher, apercus, validations };
}

describe('RegletteComponent', () => {
  it('prévisualise pendant le glissement, sans valider', async () => {
    const r = await rendre();
    await r.glisser(1500);
    await r.glisser(2000);
    expect(r.apercus).toEqual([1500, 2000]);
    expect(r.validations).toEqual([]);
    expect(r.el.textContent).toContain('2 km');
  });

  it('valide UNE fois au relâchement, puis éteint l\'aperçu', async () => {
    const r = await rendre();
    await r.glisser(2000);
    await r.relacher();
    expect(r.validations).toEqual([2000]);
    expect(r.apercus.at(-1)).toBeNull();
  });

  it('relâcher sans avoir bougé ne valide rien (aucun recalcul)', async () => {
    const r = await rendre();
    await r.relacher();
    r.curseur.dispatchEvent(new Event('blur'));
    await r.f.whenStable();
    expect(r.validations).toEqual([]);
  });

  it('après validation, l\'affichage retombe sur la valeur du parent, même corrigée', async () => {
    const r = await rendre();
    await r.glisser(3000);
    await r.relacher();
    r.f.componentRef.setInput('valeur', 2500); // le parent a arrondi ou refusé
    await r.f.whenStable();
    expect(r.curseur.value).toBe('2500');
    expect(r.el.textContent).toContain('2.5 km');
  });

  it('décrit sa plage aux lecteurs d\'écran', async () => {
    const r = await rendre();
    expect(r.curseur.getAttribute('aria-label')).toBe('Seuil haut, de 100 m à 10 km');
  });
});
```

Créer `angular/src/app/ui/reglette/reglette.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

/**
 * Une réglette qui PRÉVISUALISE pendant le glissement et ne VALIDE qu'au
 * relâchement (portée de components/risques/RegletteRayons.tsx).
 *
 * Le calcul que déclenche une validation coûte plusieurs secondes : une
 * requête par pixel glissé serait la famille de l'incident du 28/03
 * (CLAUDE.md). Mesuré côté React : zéro requête sur vingt positions, une seule
 * au relâchement.
 *
 * Après validation, l'affichage retombe sur `valeur` — celle du PARENT, qui a
 * pu corriger la demande. Sinon le curseur montrerait la position demandée
 * pendant que les chiffres décrivent autre chose.
 */
@Component({
  selector: 'mg-reglette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-1 min-w-[210px]">
      <div class="flex items-baseline gap-1.5">
        <span class="text-[11px] text-tertiary">{{ libelle() }}</span>
        @if (complement(); as c) {
          <span class="font-mono text-[11px] text-tertiary">{{ c }}</span>
        }
        <span class="font-mono text-xs text-teal">{{ formater()(affiche()) }}</span>
      </div>
      <input type="range" class="w-full accent-[var(--brand-teal)]"
             [min]="min()" [max]="max()" [step]="pas()" [value]="affiche()"
             [attr.aria-label]="descriptionAccessible() ?? libelle() + ', de ' + formater()(min()) + ' à ' + formater()(max())"
             (input)="glisser($event)"
             (pointerup)="poser()" (keyup)="poser()" (blur)="poser()" />
    </div>
  `,
})
export class RegletteComponent {
  readonly libelle = input.required<string>();
  readonly valeur = input.required<number>();
  readonly min = input.required<number>();
  readonly max = input.required<number>();
  readonly pas = input.required<number>();
  readonly formater = input<(n: number) => string>((n) => String(n));
  /** Texte discret à côté du libellé (par exemple des valeurs réglées ailleurs). */
  readonly complement = input<string>();
  readonly descriptionAccessible = input<string>();

  readonly apercu = output<number | null>();
  readonly valider = output<number>();

  /** `null` = rien en cours de glissement : on affiche la valeur du parent. */
  private readonly glisse = signal<number | null>(null);
  protected readonly affiche = computed(() => this.glisse() ?? this.valeur());

  protected glisser(ev: Event): void {
    const v = Number((ev.target as HTMLInputElement).value);
    this.glisse.set(v);
    this.apercu.emit(v);
  }

  protected poser(): void {
    const v = this.glisse();
    if (v === null) return;
    this.glisse.set(null);
    // L'aperçu s'éteint AVANT le résultat : pendant le calcul, garder
    // l'ancien et l'aperçu côte à côte montrerait deux valeurs pour un réglage.
    this.apercu.emit(null);
    this.valider.emit(v);
  }
}
```

Note : la classe `accent-[var(--brand-teal)]` est une valeur arbitraire Tailwind qui référence un jeton — conforme à « aucune couleur en dur ».

Run: `cd angular && npx ng test --watch=false` — Expected: tous les tests de la tâche PASS.

- [ ] **Step 4: Vérifier et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src/app
git commit -m "feat(angular): fil d'étapes, fil d'Ariane et réglette validée au relâchement"
```

---

### Task 6: Page catalogue, bascule de thème, épreuve navigateur et documentation

**Files:**
- Create: `angular/src/app/features/catalogue/catalogue.page.ts` + `catalogue.page.html` + `catalogue.page.spec.ts`
- Modify: `angular/src/app/app.routes.ts` (route `catalogue` sous la coquille)
- Modify: `angular/src/app/layout/coquille.component.ts` + `.html` (lien Catalogue, bouton de thème)
- Modify: `ARCHITECTURE.md` (section Application Angular)
- Modify: `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (lot 1 fait, avancement)

**Interfaces:**
- Consumes: tous les composants des tâches 1 à 5, `ThemeService`.

- [ ] **Step 1: La page catalogue**

Créer `angular/src/app/features/catalogue/catalogue.page.ts` :

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ChargementService } from '../../core/chargement/chargement.service';
import { BarreProgressionComponent } from '../../ui/barre-progression/barre-progression.component';
import { ChampComponent } from '../../ui/champ/champ.component';
import { type EtapeAffichee, FilEtapesComponent } from '../../ui/fil-etapes/fil-etapes.component';
import { FilArianeComponent, type SegmentAriane } from '../../ui/fil-ariane/fil-ariane.component';
import { KpiComponent } from '../../ui/kpi/kpi.component';
import { PastilleComponent } from '../../ui/pastille/pastille.component';
import { PerimeDirective } from '../../ui/perime/perime.directive';
import { RegletteComponent } from '../../ui/reglette/reglette.component';
import { Cellule, EnteteCellule } from '../../ui/tableau/cellules';

/**
 * Chaque composant de ui/, dans son état réel, avec des données d'exemple
 * génériques. Sert à la relecture visuelle dans les deux thèmes, et de mode
 * d'emploi pour les lots suivants.
 */
@Component({
  selector: 'mg-catalogue',
  imports: [
    BarreProgressionComponent, ChampComponent, FilEtapesComponent, FilArianeComponent,
    KpiComponent, PastilleComponent, PerimeDirective, RegletteComponent, Cellule, EnteteCellule,
  ],
  providers: [ChargementService],
  templateUrl: './catalogue.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CataloguePage {
  private readonly chargement = inject(ChargementService);

  protected readonly enCalcul = signal(false);
  protected readonly pastilles = signal<Record<string, boolean>>({ premier: true, second: false });
  protected readonly etapeCourante = signal('deux');
  protected readonly etapes: EtapeAffichee[] = [
    { cle: 'un', rang: 1, libelle: 'Choisir', renseignee: true },
    { cle: 'deux', rang: 2, libelle: 'Régler', renseignee: true },
    { cle: 'trois', rang: 3, libelle: 'Comparer', renseignee: false },
  ];
  protected readonly segments = signal<SegmentAriane[]>([
    { cle: 'racine', libelle: 'Ensemble' },
    { cle: 'groupe', libelle: 'Groupe A', titre: 'Niveau 1 — code A' },
    { cle: 'element', libelle: 'Élément 12', titre: 'Niveau 2 — code 12' },
  ]);
  protected readonly valeurReglette = signal(1000);
  protected readonly apercuReglette = signal<number | null>(null);

  constructor() {
    this.chargement.suivre('catalogue', 'Calcul d’exemple', () => this.enCalcul());
  }

  protected basculerPastille(cle: string): void {
    this.pastilles.update((p) => ({ ...p, [cle]: !p[cle] }));
  }

  protected remonter(i: number): void {
    this.segments.update((s) => s.slice(0, i + 1));
  }

  protected formaterMetres(n: number): string {
    return n >= 1000 ? `${(n / 1000).toLocaleString('fr-FR')} km` : `${n} m`;
  }
}
```

(Si la tâche 3 a remplacé `ChargementService.suivre` par une fonction libre `suivreChargement`, utiliser celle-ci.)

Créer `angular/src/app/features/catalogue/catalogue.page.html` :

```html
<mg-barre-progression />
<section class="p-6 flex flex-col gap-8 max-w-4xl">
  <h1 class="text-lg font-medium text-primary tracking-tight">Catalogue des composants</h1>

  <div class="flex flex-col gap-3">
    <h2 class="text-xs font-medium text-primary">Barre de progression et valeurs périmées</h2>
    <button type="button" mgPastille [actif]="enCalcul()" (click)="enCalcul.set(!enCalcul())">
      {{ enCalcul() ? 'Arrêter le calcul' : 'Lancer un calcul' }}
    </button>
    <div [mgPerime]="enCalcul()" class="flex gap-8">
      <mg-kpi valeur="12 480" libelle="Valeur principale" note="Estompée pendant le calcul" />
    </div>
  </div>

  <div class="flex flex-col gap-3">
    <h2 class="text-xs font-medium text-primary">Tuiles de chiffre clé</h2>
    <div class="flex gap-8">
      <mg-kpi valeur="1 259" libelle="Taille 24" note="Note obligatoire" />
      <mg-kpi valeur="72,3 %" libelle="Accent" note="Valeur en teal" [accent]="true" />
      <mg-kpi valeur="580" libelle="Taille 22" note="Libellé plus petit" [taille]="22" />
    </div>
  </div>

  <div class="flex flex-col gap-3">
    <h2 class="text-xs font-medium text-primary">Pastilles et champ</h2>
    <div class="flex gap-2">
      <button type="button" mgPastille [actif]="pastilles()['premier']" (click)="basculerPastille('premier')">Premier choix</button>
      <button type="button" mgPastille [actif]="pastilles()['second']" (click)="basculerPastille('second')">Second choix</button>
    </div>
    <mg-champ libelle="Un champ">
      <select class="bg-elevated border border-subtle rounded-md px-3 py-2 text-[13px] text-primary w-60">
        <option>Option A</option>
        <option>Option B</option>
      </select>
    </mg-champ>
  </div>

  <div class="flex flex-col gap-3">
    <h2 class="text-xs font-medium text-primary">Fil d’étapes et fil d’Ariane</h2>
    <mg-fil-etapes [etapes]="etapes" [courante]="etapeCourante()" (choisir)="etapeCourante.set($event)" />
    <mg-fil-ariane [segments]="segments()" precision="Détail" (remonter)="remonter($event)" />
  </div>

  <div class="flex flex-col gap-3">
    <h2 class="text-xs font-medium text-primary">Réglette</h2>
    <mg-reglette libelle="Un réglage" [valeur]="valeurReglette()" [min]="100" [max]="10000" [pas]="100"
                 [formater]="formaterMetres" complement="500 m · 1 km ·"
                 (apercu)="apercuReglette.set($event)" (valider)="valeurReglette.set($event)" />
    <p class="font-mono text-[11px] text-tertiary">
      Validé : {{ formaterMetres(valeurReglette()) }} · aperçu : {{ apercuReglette() === null ? '—' : formaterMetres(apercuReglette()!) }}
    </p>
  </div>

  <div class="flex flex-col gap-3">
    <h2 class="text-xs font-medium text-primary">Cellules de tableau</h2>
    <table class="w-96 border-collapse">
      <thead><tr>
        <th mgTh alignement="gauche">Ligne</th>
        <th mgTh explication="Une explication au survol">Valeur</th>
      </tr></thead>
      <tbody>
        <tr><td mgTd class="!text-left">Alpha</td><td mgTd>1 204</td></tr>
        <tr><td mgTd class="!text-left" attenue>Beta</td><td mgTd attenue>—</td></tr>
        <tr><td mgTd class="!text-left" fort>Total</td><td mgTd fort>1 204</td></tr>
      </tbody>
    </table>
  </div>
</section>
```

Note : `formaterMetres` est passée comme référence de méthode ; elle n'utilise pas `this`, donc sa liaison ne pose pas de problème. Si le développeur la rend dépendante de `this`, la déclarer en propriété fléchée.

Créer `angular/src/app/features/catalogue/catalogue.page.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { CataloguePage } from './catalogue.page';

describe('CataloguePage', () => {
  it('rend chaque famille de composants', async () => {
    const f = TestBed.createComponent(CataloguePage);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    for (const s of ['mg-barre-progression', 'mg-kpi', 'button[mgpastille]', 'mg-champ', 'mg-fil-etapes', 'mg-fil-ariane', 'mg-reglette', 'th[mgth]', 'td[mgtd]']) {
      expect(el.querySelector(s), s).not.toBeNull();
    }
  });

  it('lancer un calcul allume la barre', async () => {
    const f = TestBed.createComponent(CataloguePage);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    (el.querySelector('button[mgpastille]') as HTMLButtonElement).click();
    await f.whenStable();
    expect(el.querySelector('[role="progressbar"]')!.getAttribute('aria-busy')).toBe('true');
  });
});
```

(Les sélecteurs d'attributs sont en minuscules dans le DOM ; si `querySelector('button[mgPastille]')` ne trouve rien, c'est la forme minuscule qui fait foi.)

- [ ] **Step 2: Route, lien et bouton de thème**

Dans `angular/src/app/app.routes.ts`, ajouter aux `children` de la coquille :

```ts
      {
        path: 'catalogue',
        loadComponent: () => import('./features/catalogue/catalogue.page').then((m) => m.CataloguePage),
      },
```

Dans `angular/src/app/layout/coquille.component.ts`, injecter `ThemeService` (`protected readonly theme = inject(ThemeService);`).

Dans `angular/src/app/layout/coquille.component.html`, ajouter après le lien Accueil :

```html
    <a routerLink="/catalogue" routerLinkActive="bg-overlay text-primary border-l-2 border-primary"
       class="px-4 py-2 text-[13px] text-secondary border-l-2 border-transparent">
      Catalogue
    </a>
```

et, dans le pied de la barre, avant « Se déconnecter » :

```html
      <button type="button" (click)="theme.basculer()"
              class="self-start text-xs text-secondary hover:text-primary">
        {{ theme.theme() === 'dark' ? 'Thème clair' : 'Thème sombre' }}
      </button>
```

Run: `cd angular && npx ng test --watch=false && npm run build` — Expected: vert.

- [ ] **Step 3: Épreuve navigateur**

La base locale doit tourner (`docker ps` montre `supabase_db_genesis_app`). Lancer en arrière-plan `npm run dev` à la racine (:3000, attendre `curl http://localhost:3000/login` à 200) et `npm start` dans `angular/` (:4200). Avec l'outil navigateur (Playwright) : se connecter (compte de dev local : mémoire `reference_geomatik_credentials.md`, jamais écrit dans un fichier), ouvrir `/catalogue`, puis :
1. « Lancer un calcul » : la barre apparaît avec « Calcul d’exemple », la tuile s'estompe ; « Arrêter » : tout revient.
2. Réglette : glisser au clavier (flèche droite plusieurs fois, focus sur le curseur) — l'aperçu change, « Validé » ne change qu'au relâchement de la touche.
3. Fil d'étapes : cliquer une étape, puis flèches gauche/droite.
4. Fil d'Ariane : cliquer « Ensemble » réduit le fil à un segment.
5. Bouton « Thème clair » : l'écran bascule ; recharger la page : le thème est conservé.
6. Captures d'écran de `/catalogue` en sombre ET en clair, rangées dans le dossier de travail du chantier (jamais dans le dépôt).
7. Arrêter les deux serveurs de dev (arbre de processus complet : `netstat -ano | grep -E ":3000|:4200" | grep LISTEN`, puis `taskkill //F //T //PID <pid>`).

Consigner chaque observation dans le rapport de tâche.

- [ ] **Step 4: Documentation**

Dans `ARCHITECTURE.md`, section « Application Angular (depuis le 2026-09-29) », ajouter (Edit ciblés, jamais de réécriture, pas de PowerShell sur ce fichier) :

```markdown
- **Composants de base (lot 1, 2026-09-29)** dans `angular/src/app/ui/` : `mg-kpi`, `button[mgPastille]`, `mg-champ`, `th[mgTh]`/`td[mgTd]`, `mg-fil-etapes`, `mg-fil-ariane`, `mg-reglette` (validée au RELÂCHEMENT, jamais par pixel), `mg-barre-progression` + `[mgPerime]` alimentées par un `ChargementService` fourni par l'écran. Tous GÉNÉRIQUES : le vocabulaire du risque arrive au lot 3 en les configurant. Démonstration : page `/catalogue`. ⚠ **Portés depuis les primitives MAISON du module risque, pas depuis shadcn/ui** — inventaire du 2026-09-29 : aucun des 35 fichiers de `components/risques/` n'importe un composant shadcn.
- **3 appels API simultanés au plus, pour toute l'application** (`limiteurInterceptor` + `SEMAPHORE_API`, `core/http/`), enregistré en PREMIER. Côté React la règle était tenue écran par écran ; ici elle ne dépend plus de la discipline de chaque écran. ⚠ Il ne voit que `HttpClient` : les requêtes de MapLibre (tuiles, GeoJSON) lui échappent.
- **Thème** : `ThemeService` (`core/theme/`), classe `light`/`dark` sur `<html>`, même clé de stockage que React (`magelian-theme`), tolérant à un stockage bloqué.
```

Dans `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md`, dans le tableau des lots, remplacer la ligne du lot 1 par :

```markdown
| **1 — Composants de base** ✅ 2026-09-29 | Portés depuis les primitives MAISON du module risque (l'inventaire a montré qu'il n'utilise aucun composant shadcn) : tuile KPI, pastille, champ, cellules de tableau, fil d'étapes, fil d'Ariane, réglette validée au relâchement, barre de progression unique et valeurs périmées. Plus : thème clair/sombre, 3 appels API simultanés au plus pour toute l'application, garde inverse de la connexion. Fenêtre modale et notifications reportées aux lots 5-6, seuls à s'en servir | Page `/catalogue`, vérifiée au navigateur dans les deux thèmes | 0 |
```

et, dans « À savoir pour les lots suivants », retirer la ligne sur le sémaphore à porter (c'est fait) et retirer les deux éléments reportés traités ici (garde inverse, message 403).

- [ ] **Step 5: Vérification finale et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run lint 2>&1 | tail -3
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src/app ARCHITECTURE.md docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md
git commit -m "feat(angular): page catalogue, bascule de thème, lot 1 documenté"
```
