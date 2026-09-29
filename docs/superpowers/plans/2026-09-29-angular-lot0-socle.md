# Angular — Lot 0 : le socle — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un espace de travail Angular 21.2.4 standard dans `angular/`, au thème MAGELIAN, où l'on se connecte avec son compte habituel et où une première page lit l'API Next.js existante.

**Architecture:** Application Angular autonome (standalone, zoneless, signals) servie par `ng serve` sur `localhost:4200`, dont le proxy de dev redirige `/api` vers le Next.js de `localhost:3000`. La session Supabase est tenue par `@supabase/ssr` — donc dans des cookies, comme l'application actuelle — et un intercepteur pose en plus le jeton Bearer. La configuration (URL et clé anon Supabase) est lue à l'exécution dans un `config.local.json` généré et ignoré par git.

**Tech Stack:** Angular 21.2.4 (CLI, standalone, zoneless), TypeScript strict, Tailwind CSS 4, Vitest (lanceur par défaut de la CLI), `@supabase/ssr` + `@supabase/supabase-js`.

**Spec:** `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (décisions D1-D7, P1-P7, « Le piège du cookie », « Compatibilité AIDA »).

## Global Constraints

- Angular **épinglé en 21.2.4** : `@angular/*` et `@angular/cli` en version exacte `21.2.4`, sans `^`.
- **Aucun import croisé** : rien dans `angular/` n'importe un fichier hors de `angular/`, et rien hors de `angular/` n'importe un fichier de `angular/`.
- **Aucun secret dans un fichier suivi par git** : la clé anon vit dans `angular/public/config.local.json`, généré et ignoré.
- Textes d'interface **en français, en sentence case**, jamais d'uppercase hors acronymes.
- **Aucune couleur en dur** dans un composant : toujours `var(--jeton)` ou une classe Tailwind adossée à un jeton.
- Polices : Inter (interface) et JetBrains Mono (données) uniquement.
- Règles d'I/O de `CLAUDE.md` : au plus 3 appels API simultanés.
- `npx tsc --noEmit` **à la racine** reste propre, et `npm run test:unit` à la racine reste vert, après CHAQUE tâche.
- Ne pas modifier `middleware.ts` (fichier protégé).
- Ne jamais pousser sur GitHub.
- Sur ce poste, préfixer le PATH pour git : `export PATH="/c/GENESIS/PortableGit/cmd:$PATH"`.

## Review Focus

- **Session expirée pendant l'usage** : la page doit renvoyer vers la connexion, pas rester sur un état « chargement » ni afficher un 401 brut. → test dans la tâche 4 (`messageErreurApi` sur 401) et redirection par le garde dans la tâche 3.
- **`config.local.json` absent** (poste neuf, `.env.development.local` absent) : un message qui nomme la commande à lancer, jamais un écran blanc. → test dans la tâche 3 (`ConfigService` rejette avec un message explicite).
- **API Next.js éteinte** (le proxy répond 504/erreur réseau) : message en français qui dit que l'API ne répond pas. → test dans la tâche 4 (statut 0 et 504).
- **Mauvais mot de passe** : message français, pas le texte anglais de Supabase. → test dans la tâche 3 (`messageErreurConnexion`).
- **Retour après connexion** : l'utilisateur revient sur la page qu'il demandait, et jamais vers une URL externe passée en paramètre. → test dans la tâche 3 (`cibleDeRedirection`).

---

### Task 1: Créer l'espace de travail Angular et l'isoler de la racine

**Files:**
- Create: `angular/` (généré par la CLI)
- Create: `angular/proxy.conf.json`
- Modify: `angular/angular.json` (proxy du serveur de dev)
- Modify: `angular/package.json` (versions exactes, scripts)
- Modify: `angular/.gitignore` (config locale)
- Modify: `tsconfig.json` (racine — exclure `angular`)
- Modify: `.eslintrc.json` (racine — ignorer `angular/`)
- Create: `tests/unit/angular/isolement.test.ts`

**Interfaces:**
- Produces: un espace de travail où `npm start`, `npm test`, `npm run build` fonctionnent depuis `angular/` ; le script `npm start` servira sur `:4200` avec `/api` redirigé vers `:3000`.

- [ ] **Step 1: Générer l'espace de travail**

Depuis la racine du dépôt :

```bash
npx -y @angular/cli@21.2.4 new magelian --directory angular --style tailwind --ssr false --routing true --zoneless true --test-runner vitest --skip-git true --ai-config none --package-manager npm --prefix mg
```

Expected: le dossier `angular/` existe, avec `angular.json`, `package.json`, `src/app/app.ts`, `src/app/app.config.ts`, `src/app/app.routes.ts`, `src/styles.css`, et `npm install` a tourné.

- [ ] **Step 2: Épingler les versions Angular en exact**

Dans `angular/package.json`, remplacer toute version `^21.x.y` ou `~21.x.y` des paquets `@angular/*` et `@angular/cli`/`@angular/build` par `21.2.4` exact. Puis :

```bash
cd angular && npm install && npx ng version
```

Expected: `Angular: 21.2.4` et `@angular/cli 21.2.4`.

Si un paquet `@angular/*` n'existe pas en 21.2.4 exactement (`npm install` échoue en ETARGET), prendre la plus haute version 21.2.x publiée pour ce paquet et le noter dans le rapport de tâche.

- [ ] **Step 3: Ajouter le proxy de dev**

Créer `angular/proxy.conf.json` :

```json
{
  "/api": {
    "target": "http://localhost:3000",
    "secure": false,
    "changeOrigin": false,
    "logLevel": "warn"
  }
}
```

`changeOrigin: false` à dessein : l'en-tête `Host` reste `localhost:4200`, et le navigateur envoie les cookies de session comme pour une requête de même origine.

Dans `angular/angular.json`, sous `projects.magelian.architect.serve.options` (créer `options` s'il n'existe pas), ajouter :

```json
"proxyConfig": "proxy.conf.json"
```

- [ ] **Step 4: Ignorer la configuration locale**

Ajouter à la fin de `angular/.gitignore` :

```
# Configuration locale générée par scripts/ecrire-config.mjs — porte la clé anon.
/public/config.local.json
```

- [ ] **Step 5: Isoler `angular/` de l'outillage de la racine**

Dans `tsconfig.json` à la racine, remplacer le bloc `exclude` par :

```json
  "exclude": [
    "node_modules",
    "angular"
  ]
```

(Garder toute autre entrée déjà présente dans `exclude`.) Sans cela, `"include": ["**/*.ts"]` compile les fichiers Angular avec la configuration Next, et `tsc` comme `next build` cassent.

Dans `.eslintrc.json` à la racine, ajouter la clé :

```json
  "ignorePatterns": ["angular/"]
```

- [ ] **Step 6: Écrire le test d'isolement (échec attendu tant que rien n'est vérifié)**

Créer `tests/unit/angular/isolement.test.ts` :

```ts
/**
 * Le projet Angular et le code React/Next ne s'importent JAMAIS l'un l'autre
 * (décision D3 de docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md).
 *
 * Un seul import croisé suffit à faire dépendre l'application Angular du code
 * qu'elle doit remplacer — et le jour où l'écran React est supprimé, elle
 * casse. Ce test lit les SOURCES, pas le graphe de build : il échoue avant
 * que quiconque ait eu à lancer les deux compilations.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(__dirname, '../../..');
const ANGULAR_SRC = path.join(RACINE, 'angular', 'src');

function fichiers(dossier: string, extensions: string[]): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    if (nom === 'node_modules' || nom.startsWith('.')) continue;
    const complet = path.join(dossier, nom);
    if (statSync(complet).isDirectory()) sortie.push(...fichiers(complet, extensions));
    else if (extensions.some((e) => nom.endsWith(e))) sortie.push(complet);
  }
  return sortie;
}

const IMPORT = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function imports(fichier: string): string[] {
  const texte = readFileSync(fichier, 'utf8');
  return [...texte.matchAll(IMPORT)].map((m) => m[1] ?? m[2]);
}

describe('isolement du projet Angular', () => {
  it('aucun fichier Angular n\'importe hors de angular/', () => {
    const fautifs: string[] = [];
    for (const f of fichiers(ANGULAR_SRC, ['.ts'])) {
      for (const cible of imports(f)) {
        if (cible.startsWith('@/')) fautifs.push(`${path.relative(RACINE, f)} → ${cible}`);
        if (cible.startsWith('.')) {
          const resolu = path.resolve(path.dirname(f), cible);
          if (!resolu.startsWith(path.join(RACINE, 'angular'))) {
            fautifs.push(`${path.relative(RACINE, f)} → ${cible}`);
          }
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('aucun fichier React/Next n\'importe depuis angular/', () => {
    const fautifs: string[] = [];
    for (const dossier of ['app', 'components', 'lib']) {
      for (const f of fichiers(path.join(RACINE, dossier), ['.ts', '.tsx'])) {
        for (const cible of imports(f)) {
          if (/(^|\/)angular\//.test(cible) && !cible.startsWith('@angular/')) {
            fautifs.push(`${path.relative(RACINE, f)} → ${cible}`);
          }
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('le test voit bien les sources Angular (garde contre un test vide)', () => {
    expect(fichiers(ANGULAR_SRC, ['.ts']).length).toBeGreaterThan(3);
  });
});
```

- [ ] **Step 7: Lancer le test d'isolement**

Run: `npx vitest run --project unit tests/unit/angular/isolement.test.ts`
Expected: PASS (3 tests). Si le troisième échoue, le chemin `angular/src` est faux.

- [ ] **Step 8: Vérifier les trois commandes Angular et la racine**

```bash
cd angular && npm test -- --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
```

Expected: tests Angular PASS, `ng build` sans erreur, `TSC_EXIT=0`, tests unitaires racine tous verts. (Pas de `| head` sur `tsc` : un pipe rend le code de retour du dernier programme.)

- [ ] **Step 9: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular tsconfig.json .eslintrc.json tests/unit/angular/isolement.test.ts
git status --short | grep -E "node_modules|config.local" && echo "STOP: fichier interdit indexé"
git commit -m "feat(angular): espace de travail Angular 21.2.4 isolé de la racine"
```

---

### Task 2: Jetons du design system et thème MAGELIAN

**Files:**
- Create: `angular/src/styles/jetons.css`
- Modify: `angular/src/styles.css`
- Modify: `angular/src/index.html` (polices, titre, classe de thème)
- Create: `angular/public/magelian-icon.svg` (copie de `public/magelian-icon.svg`)
- Create: `tests/unit/angular/jetons-paritaires.test.ts`

**Interfaces:**
- Consumes: l'espace de travail de la tâche 1.
- Produces: les variables CSS MAGELIAN (`--surface`, `--text-primary`, `--brand-teal`, …) identiques à `app/globals.css` dans `:root` (sombre) et `html.light` (clair) ; les classes Tailwind `bg-surface`, `bg-elevated`, `bg-page`, `text-primary`, `text-secondary`, `text-tertiary`, `border-subtle`, `border-default`, `text-teal`, `bg-teal`, `font-sans`, `font-mono`.

- [ ] **Step 1: Écrire le test de parité (échec attendu)**

Créer `tests/unit/angular/jetons-paritaires.test.ts` :

```ts
/**
 * Les jetons MAGELIAN du projet Angular sont ceux de app/globals.css, à la
 * valeur près, dans les deux thèmes.
 *
 * Pendant la cohabitation, un écran Angular est comparé à l'écran React qu'il
 * remplace. Si un gris diffère d'une nuance, la comparaison devient un débat
 * de goût au lieu d'une vérification. Les jetons shadcn/ui (triplets HSL sans
 * fonction, `--background: 0 0% 2%`) sont propres à React et ne sont PAS
 * repris : seules les valeurs qui sont des couleurs ou des longueurs le sont.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(__dirname, '../../..');

/** Les déclarations `--nom: valeur;` du PREMIER bloc qui suit `selecteur {`. */
function bloc(css: string, selecteur: string): Map<string, string> {
  const debut = css.indexOf(`${selecteur} {`);
  if (debut < 0) throw new Error(`bloc ${selecteur} introuvable`);
  let profondeur = 0;
  let fin = debut;
  for (let i = css.indexOf('{', debut); i < css.length; i++) {
    if (css[i] === '{') profondeur++;
    if (css[i] === '}') profondeur--;
    if (profondeur === 0) { fin = i; break; }
  }
  const corps = css.slice(debut, fin).replace(/\/\*[\s\S]*?\*\//g, '');
  const sortie = new Map<string, string>();
  for (const m of corps.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    sortie.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  }
  return sortie;
}

/** Un triplet HSL shadcn (`0 0% 2%`) n'est pas une couleur utilisable seule. */
const estTripletShadcn = (v: string) => /^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/.test(v);

const react = readFileSync(path.join(RACINE, 'app', 'globals.css'), 'utf8');
const angular = readFileSync(path.join(RACINE, 'angular', 'src', 'styles', 'jetons.css'), 'utf8');

describe.each([':root', 'html.light'])('jetons %s', (selecteur) => {
  const source = bloc(react, selecteur);
  const copie = bloc(angular, selecteur);

  it('reprend chaque jeton MAGELIAN de globals.css à la même valeur', () => {
    const ecarts: string[] = [];
    for (const [nom, valeur] of source) {
      if (estTripletShadcn(valeur)) continue;
      if (copie.get(nom) !== valeur) ecarts.push(`${nom}: attendu « ${valeur} », lu « ${copie.get(nom) ?? 'absent'} »`);
    }
    expect(ecarts).toEqual([]);
  });

  it('n\'invente aucun jeton absent de globals.css', () => {
    const inventes = [...copie.keys()].filter((n) => !source.has(n));
    expect(inventes).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run --project unit tests/unit/angular/jetons-paritaires.test.ts`
Expected: FAIL — `ENOENT … angular/src/styles/jetons.css`.

- [ ] **Step 3: Créer `angular/src/styles/jetons.css`**

Structure imposée (le contenu des deux blocs se RECOPIE de `app/globals.css`, blocs `:root {` ligne ~9 et `html.light {` ligne ~235, en retirant chaque déclaration dont la valeur est un triplet HSL shadcn comme `0 0% 2%`) :

```css
/*
 * Jetons MAGELIAN — COPIE de app/globals.css (blocs :root et html.light),
 * sans les triplets HSL de shadcn/ui, propres à React.
 * Verrouillé par tests/unit/angular/jetons-paritaires.test.ts :
 * modifier un jeton ici sans le modifier là-bas (ou l'inverse) fait échouer
 * la suite. Source de vérité : DESIGN_SYSTEM.md.
 */
:root {
  /* … toutes les déclarations --x: valeur; non-shadcn du :root de globals.css … */
}

html.light {
  /* … toutes les déclarations --x: valeur; non-shadcn du html.light de globals.css … */
}
```

Recopier les commentaires de section est permis ; les déclarations doivent être à l'identique.

- [ ] **Step 4: Relancer le test de parité**

Run: `npx vitest run --project unit tests/unit/angular/jetons-paritaires.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Brancher Tailwind sur les jetons**

Remplacer le contenu de `angular/src/styles.css` par :

```css
@import 'tailwindcss';
@import './styles/jetons.css';

/*
 * Tailwind 4 : les utilitaires sont adossés aux jetons, jamais à des hex.
 * `inline` fait écrire `var(--surface)` dans la classe générée, donc la
 * bascule de thème (html.light) s'applique sans rien recompiler.
 */
@theme inline {
  --color-page: var(--bg-level-0);
  --color-surface: var(--surface);
  --color-elevated: var(--elevated);
  --color-overlay: var(--overlay);
  --color-primary: var(--text-primary);
  --color-secondary: var(--text-secondary);
  --color-tertiary: var(--text-tertiary);
  --color-subtle: var(--border-subtle);
  --color-default: var(--border-default);
  --color-hover: var(--border-hover);
  --color-teal: var(--brand-teal);
  --color-teal-hover: var(--brand-teal-hover);
  --color-teal-fg: var(--brand-teal-fg);
  --color-danger: var(--danger);
  --color-warning: var(--warning);
  --color-success: var(--success);
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

html, body {
  height: 100%;
  margin: 0;
}

body {
  background: var(--bg-level-0);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
}

:focus-visible {
  outline: 1px solid var(--brand-teal-50);
  outline-offset: 1px;
}
```

- [ ] **Step 6: Polices, titre et logo**

Dans `angular/src/index.html` : `<title>MAGELIAN</title>`, `lang="fr"` sur `<html>`, et dans `<head>` :

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Inter:wght@400;500;700&display=swap">
```

Copier `public/magelian-icon.svg` (racine) vers `angular/public/magelian-icon.svg` (copie de fichier, pas un import).

- [ ] **Step 7: Vérifier**

```bash
cd angular && npm run build && npm test -- --watch=false
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
```

Expected: build et tests Angular verts, `TSC_EXIT=0`, suite racine verte.

- [ ] **Step 8: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src/styles angular/src/styles.css angular/src/index.html angular/public/magelian-icon.svg tests/unit/angular/jetons-paritaires.test.ts
git commit -m "feat(angular): jetons MAGELIAN et thème Tailwind, paritaires avec globals.css"
```

---

### Task 3: Configuration à l'exécution, session Supabase et page de connexion

**Files:**
- Create: `angular/scripts/ecrire-config.mjs`
- Modify: `angular/package.json` (scripts `prestart`, `config`)
- Create: `angular/src/app/core/config/config.service.ts` + `config.service.spec.ts`
- Create: `angular/src/app/core/auth/supabase.ts`
- Create: `angular/src/app/core/auth/auth.service.ts` + `auth.service.spec.ts`
- Create: `angular/src/app/core/auth/messages.ts` + `messages.spec.ts`
- Create: `angular/src/app/core/auth/auth.guard.ts` + `auth.guard.spec.ts`
- Create: `angular/src/app/features/connexion/connexion.page.ts` + `connexion.page.html`
- Modify: `angular/src/app/app.config.ts`, `angular/src/app/app.routes.ts`

**Interfaces:**
- Consumes: l'espace de travail et le thème des tâches 1-2.
- Produces:
  - `ConfigService` : `charger(): Promise<void>`, getter `valeur: ConfigApplication` (lève si non chargée).
  - `interface ConfigApplication { supabaseUrl: string; supabaseAnonKey: string; apiBaseUrl: string; slug: string }`
  - `SUPABASE: InjectionToken<SupabaseClient>`
  - `AuthService` : signal `session: Signal<Session | null>`, `connecte: Signal<boolean>`, `email: Signal<string | null>`, méthodes `initialiser(): Promise<void>`, `connecter(email: string, motDePasse: string): Promise<string | null>` (rend un message d'erreur français ou `null`), `deconnecter(): Promise<void>`, `jeton(): Promise<string | null>`.
  - `authGuard: CanActivateFn`
  - `messageErreurConnexion(brut: string): string`, `cibleDeRedirection(brut: string | null): string`
  - Constantes de routes : `remoteRoutes: Routes` (routes métier, protégées) et `appRoutes: Routes` (`connexion` + `remoteRoutes`) exportées par `app.routes.ts`.

- [ ] **Step 1: Ajouter les dépendances Supabase**

```bash
cd angular && npm install --save-exact @supabase/ssr@0.5.2 @supabase/supabase-js@$(node -p "require('../node_modules/@supabase/supabase-js/package.json').version")
```

Mêmes versions que l'application actuelle : un changement de format de cookie entre deux versions casserait la session partagée entre `:3000` et `:4200`. (Lire la version via `node -p` ne crée aucun import croisé — c'est une commande ponctuelle.)

- [ ] **Step 2: Script qui écrit la configuration locale**

Créer `angular/scripts/ecrire-config.mjs` :

```js
/**
 * Écrit public/config.local.json depuis le .env.development.local de la racine.
 *
 * La clé anon ne doit vivre dans AUCUN fichier suivi par git
 * (tests/unit/securite/aucun-secret-en-dur.test.ts). L'application la lit à
 * l'exécution, dans ce fichier généré et ignoré.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../../.env.development.local', import.meta.url);
const cible = new URL('../public/config.local.json', import.meta.url);

if (!existsSync(source)) {
  console.error('✗ .env.development.local absent à la racine du dépôt.');
  console.error('  Lancer d\'abord : bash scripts/local/04-env-local.sh');
  process.exit(1);
}

const vars = Object.fromEntries(
  readFileSync(source, 'utf8')
    .replace(/^﻿/, '') // un BOM a déjà cassé le CLI Supabase sur ce poste
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const manquantes = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].filter((k) => !vars[k]);
if (manquantes.length) {
  console.error(`✗ Variables absentes de .env.development.local : ${manquantes.join(', ')}`);
  process.exit(1);
}

const config = {
  supabaseUrl: vars.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: vars.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  apiBaseUrl: '',
  slug: '',
};
writeFileSync(cible, JSON.stringify(config, null, 2) + '\n');
console.log('✓ public/config.local.json écrit');
```

Dans `angular/package.json`, section `scripts`, ajouter :

```json
"config": "node scripts/ecrire-config.mjs",
"prestart": "node scripts/ecrire-config.mjs",
```

Run: `cd angular && npm run config && git check-ignore public/config.local.json`
Expected: `✓ public/config.local.json écrit` puis `public/config.local.json` (le fichier est bien ignoré).

- [ ] **Step 3: Tests du ConfigService (échec attendu)**

Créer `angular/src/app/core/config/config.service.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfigService } from './config.service';

describe('ConfigService', () => {
  let service: ConfigService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ConfigService);
    http = TestBed.inject(HttpTestingController);
  });

  it('charge config.local.json', async () => {
    const promesse = service.charger();
    http.expectOne('/config.local.json').flush({
      supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'cle', apiBaseUrl: '', slug: '',
    });
    await promesse;
    expect(service.valeur.supabaseUrl).toBe('http://127.0.0.1:54321');
  });

  it('nomme la commande à lancer quand le fichier est absent', async () => {
    const promesse = service.charger();
    http.expectOne('/config.local.json').flush('', { status: 404, statusText: 'Not Found' });
    await expect(promesse).rejects.toThrow(/npm run config/);
  });

  it('refuse une configuration incomplète', async () => {
    const promesse = service.charger();
    http.expectOne('/config.local.json').flush({ supabaseUrl: '', supabaseAnonKey: '' });
    await expect(promesse).rejects.toThrow(/incomplète/);
  });

  it('lève si on lit la valeur avant le chargement', () => {
    expect(() => service.valeur).toThrow(/pas encore chargée/);
  });
});
```

Run: `cd angular && npx ng test --watch=false`
Expected: FAIL — `Cannot find module './config.service'`.

- [ ] **Step 4: Implémenter le ConfigService**

Créer `angular/src/app/core/config/config.service.ts` :

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Ce que l'application lit à l'exécution, jamais à la compilation. */
export interface ConfigApplication {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Origine de l'API ; vide = même origine (proxy de dev). AIDA la résoudra depuis le slug. */
  apiBaseUrl: string;
  /** Identifiant de l'application dans AIDA ; vide tant que le groupe ne l'a pas fourni. */
  slug: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly http = inject(HttpClient);
  private config: ConfigApplication | null = null;

  /** Lit /config.local.json. Rejette avec un message qui dit quoi faire. */
  async charger(): Promise<void> {
    let brut: Partial<ConfigApplication>;
    try {
      brut = await firstValueFrom(this.http.get<Partial<ConfigApplication>>('/config.local.json'));
    } catch {
      throw new Error(
        'Configuration locale introuvable. Dans le dossier angular/, lancer : npm run config',
      );
    }
    if (!brut?.supabaseUrl || !brut?.supabaseAnonKey) {
      throw new Error('Configuration locale incomplète : relancer npm run config dans angular/.');
    }
    this.config = {
      supabaseUrl: brut.supabaseUrl,
      supabaseAnonKey: brut.supabaseAnonKey,
      apiBaseUrl: brut.apiBaseUrl ?? '',
      slug: brut.slug ?? '',
    };
  }

  get valeur(): ConfigApplication {
    if (!this.config) throw new Error('Configuration pas encore chargée.');
    return this.config;
  }
}
```

Run: `cd angular && npx ng test --watch=false`
Expected: les 4 tests de `ConfigService` PASS.

- [ ] **Step 5: Tests des messages et de la redirection (échec attendu)**

Créer `angular/src/app/core/auth/messages.spec.ts` :

```ts
import { cibleDeRedirection, messageErreurConnexion } from './messages';

describe('messageErreurConnexion', () => {
  it('traduit les identifiants refusés', () => {
    expect(messageErreurConnexion('Invalid login credentials')).toBe('Adresse ou mot de passe incorrect.');
  });
  it('traduit un compte non confirmé', () => {
    expect(messageErreurConnexion('Email not confirmed')).toBe('Ce compte n\'a pas encore été confirmé.');
  });
  it('dit que le service ne répond pas sur une erreur réseau', () => {
    expect(messageErreurConnexion('Failed to fetch')).toMatch(/ne répond pas/);
  });
  it('ne laisse jamais passer un message anglais inconnu', () => {
    expect(messageErreurConnexion('Something odd')).toBe('La connexion a échoué. Réessayez dans un instant.');
  });
});

describe('cibleDeRedirection', () => {
  it('garde un chemin interne', () => {
    expect(cibleDeRedirection('/risques?etape=2')).toBe('/risques?etape=2');
  });
  it('refuse une URL absolue', () => {
    expect(cibleDeRedirection('https://exemple.test/piege')).toBe('/');
  });
  it('refuse un chemin à double barre (URL relative au protocole)', () => {
    expect(cibleDeRedirection('//exemple.test')).toBe('/');
  });
  it('refuse de revenir sur la page de connexion', () => {
    expect(cibleDeRedirection('/connexion')).toBe('/');
  });
  it('rend l\'accueil quand rien n\'est demandé', () => {
    expect(cibleDeRedirection(null)).toBe('/');
  });
});
```

Run: `cd angular && npx ng test --watch=false`
Expected: FAIL — `Cannot find module './messages'`.

- [ ] **Step 6: Implémenter les messages**

Créer `angular/src/app/core/auth/messages.ts` :

```ts
/** Traduit un message d'erreur GoTrue en une phrase française. Jamais d'anglais à l'écran. */
export function messageErreurConnexion(brut: string): string {
  if (/invalid login credentials/i.test(brut)) return 'Adresse ou mot de passe incorrect.';
  if (/email not confirmed/i.test(brut)) return 'Ce compte n\'a pas encore été confirmé.';
  if (/failed to fetch|network/i.test(brut)) {
    return 'Le service d\'authentification ne répond pas. La base locale est-elle démarrée ?';
  }
  return 'La connexion a échoué. Réessayez dans un instant.';
}

/**
 * La page où renvoyer après connexion. Un chemin INTERNE seulement : un
 * paramètre `redirection` pointant ailleurs ferait de la page de connexion un
 * tremplin vers un site tiers.
 */
export function cibleDeRedirection(brut: string | null): string {
  if (!brut || !brut.startsWith('/') || brut.startsWith('//')) return '/';
  if (brut === '/connexion' || brut.startsWith('/connexion?')) return '/';
  return brut;
}
```

Run: `cd angular && npx ng test --watch=false`
Expected: les 9 tests de messages PASS.

- [ ] **Step 7: Client Supabase et AuthService — tests (échec attendu)**

Créer `angular/src/app/core/auth/supabase.ts` :

```ts
import { InjectionToken, inject } from '@angular/core';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '../config/config.service';

/**
 * Le client Supabase du navigateur, par @supabase/ssr et non supabase-js seul.
 *
 * @supabase/ssr range la session dans des COOKIES, au format de l'application
 * actuelle. C'est indispensable : middleware.ts protège /api/tiles, /api/ref,
 * /api/map/pois… par le cookie de session et ignore le Bearer. Les cookies ne
 * dépendant pas du port, une session ouverte sur :3000 vaut aussi sur :4200.
 * Voir « Le piège du cookie », docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md.
 */
export const SUPABASE = new InjectionToken<SupabaseClient>('SUPABASE', {
  providedIn: 'root',
  factory: () => {
    const { supabaseUrl, supabaseAnonKey } = inject(ConfigService).valeur;
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  },
});
```

Créer `angular/src/app/core/auth/auth.service.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import type { Session } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { SUPABASE } from './supabase';

const session = { access_token: 'jeton-a', user: { email: 'a@exemple.test' } } as unknown as Session;

function fauxClient(opts: { session?: Session | null; erreur?: string } = {}) {
  let rappel: ((evt: string, s: Session | null) => void) | null = null;
  return {
    emettre: (s: Session | null) => rappel?.('SIGNED_IN', s),
    auth: {
      getSession: async () => ({ data: { session: opts.session ?? null }, error: null }),
      onAuthStateChange: (cb: (evt: string, s: Session | null) => void) => {
        rappel = cb;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signInWithPassword: async () => ({ data: {}, error: opts.erreur ? { message: opts.erreur } : null }),
      signOut: async () => ({ error: null }),
    },
  };
}

function creer(client: ReturnType<typeof fauxClient>) {
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: client }] });
  return TestBed.inject(AuthService);
}

describe('AuthService', () => {
  it('reprend la session existante à l\'initialisation', async () => {
    const auth = creer(fauxClient({ session }));
    await auth.initialiser();
    expect(auth.connecte()).toBe(true);
    expect(auth.email()).toBe('a@exemple.test');
    expect(await auth.jeton()).toBe('jeton-a');
  });

  it('n\'est pas connecté sans session', async () => {
    const auth = creer(fauxClient());
    await auth.initialiser();
    expect(auth.connecte()).toBe(false);
    expect(await auth.jeton()).toBeNull();
  });

  it('suit les changements de session', async () => {
    const client = fauxClient();
    const auth = creer(client);
    await auth.initialiser();
    client.emettre(session);
    expect(auth.connecte()).toBe(true);
  });

  it('rend un message français quand la connexion échoue', async () => {
    const auth = creer(fauxClient({ erreur: 'Invalid login credentials' }));
    expect(await auth.connecter('a@exemple.test', 'faux')).toBe('Adresse ou mot de passe incorrect.');
  });

  it('rend null quand la connexion réussit', async () => {
    const auth = creer(fauxClient());
    expect(await auth.connecter('a@exemple.test', 'bon')).toBeNull();
  });
});
```

Run: `cd angular && npx ng test --watch=false`
Expected: FAIL — `Cannot find module './auth.service'`.

- [ ] **Step 8: Implémenter l'AuthService**

Créer `angular/src/app/core/auth/auth.service.ts` :

```ts
import { Injectable, computed, inject, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { messageErreurConnexion } from './messages';
import { SUPABASE } from './supabase';

/** La session de l'utilisateur, exposée en signals. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE);
  private readonly _session = signal<Session | null>(null);

  readonly session = this._session.asReadonly();
  readonly connecte = computed(() => this._session() !== null);
  readonly email = computed(() => this._session()?.user?.email ?? null);

  /** Reprend la session existante (cookie) et suit ses changements. */
  async initialiser(): Promise<void> {
    const { data } = await this.supabase.auth.getSession();
    this._session.set(data.session);
    this.supabase.auth.onAuthStateChange((_evt, s) => this._session.set(s));
  }

  /** @returns un message d'erreur en français, ou `null` si la connexion a réussi. */
  async connecter(email: string, motDePasse: string): Promise<string | null> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password: motDePasse });
    return error ? messageErreurConnexion(error.message) : null;
  }

  async deconnecter(): Promise<void> {
    await this.supabase.auth.signOut();
    this._session.set(null);
  }

  /**
   * Le jeton d'accès courant, relu à chaque appel : getSession() le rafraîchit
   * s'il a expiré. getSession() est LOCAL (pas d'appel réseau vers GoTrue),
   * donc sans risque de 409 sur des appels simultanés (incident du 28/03).
   */
  async jeton(): Promise<string | null> {
    const { data } = await this.supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
}
```

Run: `cd angular && npx ng test --watch=false`
Expected: les 5 tests d'`AuthService` PASS.

- [ ] **Step 9: Garde de route — test puis implémentation**

Créer `angular/src/app/core/auth/auth.guard.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

function executer(connecte: boolean, url: string) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AuthService, useValue: { connecte: signal(connecte) } }],
  });
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
  );
}

describe('authGuard', () => {
  it('laisse passer un utilisateur connecté', () => {
    expect(executer(true, '/')).toBe(true);
  });

  it('renvoie vers la connexion en gardant la page demandée', () => {
    const r = executer(false, '/risques?etape=2') as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(r)).toBe('/connexion?redirection=%2Frisques%3Fetape%3D2');
  });
});
```

Créer `angular/src/app/core/auth/auth.guard.ts` :

```ts
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

/** Page protégée : sans session, renvoie vers /connexion en gardant la cible. */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthService).connecte()) return true;
  return inject(Router).createUrlTree(['/connexion'], { queryParams: { redirection: state.url } });
};
```

Run: `cd angular && npx ng test --watch=false`
Expected: les 2 tests du garde PASS.

- [ ] **Step 10: Page de connexion**

Créer `angular/src/app/features/connexion/connexion.page.ts` :

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { cibleDeRedirection } from '../../core/auth/messages';

@Component({
  selector: 'mg-connexion',
  imports: [FormsModule],
  templateUrl: './connexion.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnexionPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly email = signal('');
  protected readonly motDePasse = signal('');
  protected readonly erreur = signal<string | null>(null);
  protected readonly enCours = signal(false);

  protected async envoyer(): Promise<void> {
    this.enCours.set(true);
    this.erreur.set(null);
    const message = await this.auth.connecter(this.email(), this.motDePasse());
    this.enCours.set(false);
    if (message) {
      this.erreur.set(message);
      return;
    }
    const cible = cibleDeRedirection(this.route.snapshot.queryParamMap.get('redirection'));
    await this.router.navigateByUrl(cible);
  }
}
```

Créer `angular/src/app/features/connexion/connexion.page.html` :

```html
<main class="min-h-full flex items-center justify-center bg-page">
  <form class="w-80 flex flex-col gap-4 bg-surface border border-subtle rounded-lg p-6"
        (ngSubmit)="envoyer()">
    <img src="magelian-icon.svg" alt="MAGELIAN" class="h-5 self-start" />
    <h1 class="text-lg font-medium text-primary">Connexion</h1>

    <label class="flex flex-col gap-1 text-xs text-tertiary">
      Adresse e-mail
      <input type="email" name="email" autocomplete="username" required
             class="bg-elevated border border-subtle rounded-md px-3 py-2 text-[13px] text-primary"
             [ngModel]="email()" (ngModelChange)="email.set($event)" />
    </label>

    <label class="flex flex-col gap-1 text-xs text-tertiary">
      Mot de passe
      <input type="password" name="motDePasse" autocomplete="current-password" required
             class="bg-elevated border border-subtle rounded-md px-3 py-2 text-[13px] text-primary"
             [ngModel]="motDePasse()" (ngModelChange)="motDePasse.set($event)" />
    </label>

    @if (erreur(); as message) {
      <p role="alert" class="text-xs text-danger">{{ message }}</p>
    }

    <button type="submit" [disabled]="enCours()"
            class="bg-primary text-page rounded-md px-4 py-2.5 text-[13px] font-medium disabled:opacity-50">
      {{ enCours() ? 'Connexion…' : 'Se connecter' }}
    </button>
  </form>
</main>
```

- [ ] **Step 11: Routes et configuration de l'application**

Remplacer `angular/src/app/app.routes.ts` par :

```ts
import type { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

/**
 * Les routes MÉTIER, toutes protégées. Nommée `remoteRoutes` parce que c'est
 * la constante que le shell AIDA chargera le jour de l'intégration (voir
 * « Compatibilité AIDA » dans la feuille de route) : sa FORME ne change pas
 * sans concertation, son contenu grandit à chaque lot.
 */
export const remoteRoutes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/accueil/accueil.page').then((m) => m.AccueilPage),
  },
];

/** Lancement autonome, hors AIDA : la connexion + les routes métier. */
export const appRoutes: Routes = [
  {
    path: 'connexion',
    loadComponent: () => import('./features/connexion/connexion.page').then((m) => m.ConnexionPage),
  },
  ...remoteRoutes,
  { path: '**', redirectTo: '' },
];
```

Tant que la tâche 4 n'a pas créé `features/accueil/accueil.page.ts`, créer un fichier provisoire minimal pour que le build passe :

```ts
// angular/src/app/features/accueil/accueil.page.ts — remplacé par la tâche 4.
import { Component } from '@angular/core';

@Component({ selector: 'mg-accueil', template: '<p class="p-6">Connecté.</p>' })
export class AccueilPage {}
```

Remplacer `angular/src/app/app.config.ts` par :

```ts
import { type ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { appRoutes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { ConfigService } from './core/config/config.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(),
    // La configuration AVANT la session : le client Supabase en a besoin.
    provideAppInitializer(async () => {
      await inject(ConfigService).charger();
      await inject(AuthService).initialiser();
    }),
  ],
};
```

(La tâche 4 ajoutera l'intercepteur à `provideHttpClient`.)

Si `ng new` a généré un `app.spec.ts` qui teste le titre de la page par défaut, le supprimer, ainsi que le contenu d'exemple de `app.html` : `app.html` ne contient plus que `<router-outlet />`, et `app.ts` importe `RouterOutlet`.

- [ ] **Step 12: Vérifier**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
```

Expected: tous les tests Angular PASS (ConfigService 4, messages 9, AuthService 5, garde 2), build propre, `TSC_EXIT=0`, suite racine verte.

- [ ] **Step 13: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/scripts angular/package.json angular/package-lock.json angular/src/app
git status --short | grep config.local && echo "STOP: la config locale ne doit pas être indexée"
git commit -m "feat(angular): configuration à l'exécution, session Supabase en cookies et connexion"
```

---

### Task 4: Client HTTP, intercepteur, coquille et première page reliée à l'API

**Files:**
- Create: `angular/src/app/core/http/http-base.service.ts` + `http-base.service.spec.ts`
- Create: `angular/src/app/core/http/jeton.interceptor.ts` + `jeton.interceptor.spec.ts`
- Create: `angular/src/app/core/http/erreurs.ts` + `erreurs.spec.ts`
- Create: `angular/src/app/core/etat/etat-chargement.ts`
- Create: `angular/src/app/features/risques/data/sites-risque.api.ts` + `sites-risque.api.spec.ts`
- Create: `angular/src/app/layout/coquille.component.ts` + `coquille.component.html`
- Replace: `angular/src/app/features/accueil/accueil.page.ts` + create `accueil.page.html` + `accueil.page.spec.ts`
- Modify: `angular/src/app/app.config.ts`, `angular/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `ConfigService.valeur` (`apiBaseUrl`), `AuthService.jeton()`, `AuthService.email`, `AuthService.deconnecter()`, `remoteRoutes`/`appRoutes` de la tâche 3.
- Produces:
  - `HttpBaseService` : `apiUrl: string` (getter), `url(chemin: string): string`.
  - `jetonInterceptor: HttpInterceptorFn`
  - `messageErreurApi(erreur: unknown): string`
  - `type EtatChargement<T> = { statut: 'chargement' } | { statut: 'echec'; message: string } | { statut: 'pret'; valeur: T }`
  - `interface CompteSites { retenus: number; total: number; par_nature: Record<string, number> }`
  - `SitesRisqueApi.compter(): Observable<CompteSites>`
  - `CoquilleComponent` (barre latérale 240 px + `<router-outlet />`)

- [ ] **Step 1: Tests du HttpBaseService (échec attendu)**

Créer `angular/src/app/core/http/http-base.service.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../config/config.service';
import { HttpBaseService } from './http-base.service';

function creer(apiBaseUrl: string) {
  TestBed.configureTestingModule({
    providers: [{ provide: ConfigService, useValue: { valeur: { apiBaseUrl } } }],
  });
  return TestBed.inject(HttpBaseService);
}

describe('HttpBaseService', () => {
  it('reste en même origine quand apiBaseUrl est vide (proxy de dev)', () => {
    expect(creer('').url('risques/sites/compter')).toBe('/api/risques/sites/compter');
  });
  it('préfixe une origine explicite, sans double barre', () => {
    expect(creer('https://magelian.exemple.test/').url('/risques/sites/compter'))
      .toBe('https://magelian.exemple.test/api/risques/sites/compter');
  });
});
```

Run: `cd angular && npx ng test --watch=false`
Expected: FAIL — module introuvable.

- [ ] **Step 2: Implémenter le HttpBaseService**

Créer `angular/src/app/core/http/http-base.service.ts` :

```ts
import { Injectable, inject } from '@angular/core';
import { ConfigService } from '../config/config.service';

/**
 * Construit TOUTES les adresses de l'API. Aucun service ne compose une URL
 * lui-même : le jour de l'intégration AIDA, cette classe héritera de
 * `MechaRemoteAppHttpBaseService` (qui résout l'origine depuis le slug) et
 * aucun service métier ne changera.
 */
@Injectable({ providedIn: 'root' })
export class HttpBaseService {
  private readonly config = inject(ConfigService);

  get apiUrl(): string {
    return `${this.config.valeur.apiBaseUrl.replace(/\/+$/, '')}/api`;
  }

  url(chemin: string): string {
    return `${this.apiUrl}/${chemin.replace(/^\/+/, '')}`;
  }
}
```

Run: `cd angular && npx ng test --watch=false`
Expected: 2 tests PASS.

- [ ] **Step 3: Tests de l'intercepteur (échec attendu)**

Créer `angular/src/app/core/http/jeton.interceptor.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../auth/auth.service';
import { HttpBaseService } from './http-base.service';
import { jetonInterceptor } from './jeton.interceptor';

function preparer(jeton: string | null) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([jetonInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { jeton: async () => jeton } },
      { provide: HttpBaseService, useValue: { apiUrl: '/api' } },
    ],
  });
  return { http: TestBed.inject(HttpClient), ctrl: TestBed.inject(HttpTestingController) };
}

const attendre = () => new Promise((r) => setTimeout(r, 0));

describe('jetonInterceptor', () => {
  it('pose le Bearer sur un appel à l\'API', async () => {
    const { http, ctrl } = preparer('jeton-a');
    http.get('/api/risques/sites/compter').subscribe();
    await attendre();
    expect(ctrl.expectOne('/api/risques/sites/compter').request.headers.get('Authorization')).toBe('Bearer jeton-a');
  });

  it('ne pose rien sans session', async () => {
    const { http, ctrl } = preparer(null);
    http.get('/api/risques/sites/compter').subscribe();
    await attendre();
    expect(ctrl.expectOne('/api/risques/sites/compter').request.headers.has('Authorization')).toBe(false);
  });

  it('n\'envoie jamais le jeton hors de l\'API', async () => {
    const { http, ctrl } = preparer('jeton-a');
    http.get('/config.local.json').subscribe();
    await attendre();
    expect(ctrl.expectOne('/config.local.json').request.headers.has('Authorization')).toBe(false);
  });
});
```

Run: `cd angular && npx ng test --watch=false`
Expected: FAIL — module introuvable.

- [ ] **Step 4: Implémenter l'intercepteur**

Créer `angular/src/app/core/http/jeton.interceptor.ts` :

```ts
import { inject } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';
import { from, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { HttpBaseService } from './http-base.service';

/**
 * Pose `Authorization: Bearer` sur les appels à l'API, et SEULEMENT sur eux :
 * les routes lues par requireAuth() l'exigent. Les routes protégées par
 * middleware.ts lisent, elles, le cookie de session — posé par @supabase/ssr.
 */
export const jetonInterceptor: HttpInterceptorFn = (req, next) => {
  const apiUrl = inject(HttpBaseService).apiUrl;
  if (!req.url.startsWith(`${apiUrl}/`)) return next(req);
  const auth = inject(AuthService);
  return from(auth.jeton()).pipe(
    switchMap((jeton) =>
      next(jeton ? req.clone({ setHeaders: { Authorization: `Bearer ${jeton}` } }) : req),
    ),
  );
};
```

Run: `cd angular && npx ng test --watch=false`
Expected: 3 tests PASS.

- [ ] **Step 5: Messages d'erreur d'API — tests puis implémentation**

Créer `angular/src/app/core/http/erreurs.spec.ts` :

```ts
import { HttpErrorResponse } from '@angular/common/http';
import { messageErreurApi } from './erreurs';

const err = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

describe('messageErreurApi', () => {
  it('reprend le message français de l\'API', () => {
    expect(messageErreurApi(err(500, { error: 'Comptage des sites indisponible.' }))).toBe('Comptage des sites indisponible.');
  });
  it('dit que la session a expiré sur un 401', () => {
    expect(messageErreurApi(err(401))).toMatch(/session a expiré/);
  });
  it('dit que l\'API ne répond pas sur une erreur réseau', () => {
    expect(messageErreurApi(err(0))).toMatch(/API ne répond pas/);
  });
  it('dit que l\'API ne répond pas quand le proxy expire', () => {
    expect(messageErreurApi(err(504))).toMatch(/API ne répond pas/);
  });
  it('dit d\'attendre sur un quota', () => {
    expect(messageErreurApi(err(429))).toMatch(/Trop de demandes/);
  });
  it('a un repli pour tout le reste', () => {
    expect(messageErreurApi(new Error('x'))).toBe('Une erreur inattendue est survenue.');
  });
});
```

Créer `angular/src/app/core/http/erreurs.ts` :

```ts
import { HttpErrorResponse } from '@angular/common/http';

/** Une phrase française pour l'écran, quelle que soit l'erreur. */
export function messageErreurApi(erreur: unknown): string {
  if (!(erreur instanceof HttpErrorResponse)) return 'Une erreur inattendue est survenue.';
  if (erreur.status === 0 || erreur.status === 502 || erreur.status === 504) {
    return 'L\'API ne répond pas. Le serveur Next.js (npm run dev, port 3000) est-il démarré ?';
  }
  if (erreur.status === 401) return 'Votre session a expiré. Reconnectez-vous.';
  if (erreur.status === 429) return 'Trop de demandes rapprochées. Réessayez dans une minute.';
  const corps = erreur.error as { error?: unknown } | null;
  if (corps && typeof corps.error === 'string' && corps.error) return corps.error;
  return 'Une erreur inattendue est survenue.';
}
```

Run: `cd angular && npx ng test --watch=false`
Expected: 6 tests PASS.

- [ ] **Step 6: État de chargement et service de l'API des sites — test puis implémentation**

Créer `angular/src/app/core/etat/etat-chargement.ts` :

```ts
/**
 * L'état d'une donnée chargée, porté À CÔTÉ de la donnée. Même convention que
 * components/campagne/suivi-v2/etat-section.ts côté React : un tableau vide
 * confondait « en cours », « en échec » et « vraiment vide ».
 */
export type EtatChargement<T> =
  | { statut: 'chargement' }
  | { statut: 'echec'; message: string }
  | { statut: 'pret'; valeur: T };
```

Créer `angular/src/app/features/risques/data/sites-risque.api.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpBaseService } from '../../../core/http/http-base.service';
import { SitesRisqueApi } from './sites-risque.api';

describe('SitesRisqueApi', () => {
  it('lit /api/risques/sites/compter', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: HttpBaseService, useValue: { url: (c: string) => `/api/${c}` } },
      ],
    });
    let lu: unknown;
    TestBed.inject(SitesRisqueApi).compter().subscribe((v) => (lu = v));
    TestBed.inject(HttpTestingController)
      .expectOne('/api/risques/sites/compter')
      .flush({ retenus: 1259, total: 1259, par_nature: {} });
    expect(lu).toEqual({ retenus: 1259, total: 1259, par_nature: {} });
  });
});
```

Créer `angular/src/app/features/risques/data/sites-risque.api.ts` :

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

/** Réponse de GET /api/risques/sites/compter (app/api/risques/sites/compter/route.ts). */
export interface CompteSites {
  /** Sites retenus par les filtres. */
  retenus: number;
  /** Sites du même périmètre, sans filtre de risque. */
  total: number;
  par_nature: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class SitesRisqueApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(HttpBaseService);

  compter(): Observable<CompteSites> {
    return this.http.get<CompteSites>(this.base.url('risques/sites/compter'));
  }
}
```

Run: `cd angular && npx ng test --watch=false`
Expected: 1 test PASS.

- [ ] **Step 7: Page d'accueil — test puis implémentation**

Créer `angular/src/app/features/accueil/accueil.page.spec.ts` :

```ts
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { SitesRisqueApi } from '../risques/data/sites-risque.api';
import { AccueilPage } from './accueil.page';

async function rendre(api: Partial<SitesRisqueApi>): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [AccueilPage],
    providers: [{ provide: SitesRisqueApi, useValue: api }],
  });
  const f = TestBed.createComponent(AccueilPage);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('AccueilPage', () => {
  it('affiche le nombre de sites, formaté en français', async () => {
    const el = await rendre({ compter: () => of({ retenus: 1259, total: 99152, par_nature: {} }) });
    expect(el.textContent?.replace(/\s/g, ' ')).toContain('1 259');
  });

  it('affiche le message de l\'erreur, jamais un chargement sans fin', async () => {
    const el = await rendre({
      compter: () => throwError(() => new HttpErrorResponse({ status: 504 })),
    });
    expect(el.querySelector('[role="alert"]')?.textContent).toMatch(/API ne répond pas/);
  });
});
```

Remplacer `angular/src/app/features/accueil/accueil.page.ts` par :

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, startWith } from 'rxjs';
import type { EtatChargement } from '../../core/etat/etat-chargement';
import { messageErreurApi } from '../../core/http/erreurs';
import { type CompteSites, SitesRisqueApi } from '../risques/data/sites-risque.api';

/**
 * Première page reliée à l'API : elle prouve la chaîne entière — session,
 * proxy, Bearer, route Next.js, base locale. Le module risque la remplacera.
 */
@Component({
  selector: 'mg-accueil',
  templateUrl: './accueil.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccueilPage {
  private readonly api = inject(SitesRisqueApi);
  private readonly nombre = new Intl.NumberFormat('fr-FR');

  protected readonly etat = toSignal(
    this.api.compter().pipe(
      map((valeur): EtatChargement<CompteSites> => ({ statut: 'pret', valeur })),
      catchError((e) => of<EtatChargement<CompteSites>>({ statut: 'echec', message: messageErreurApi(e) })),
      startWith<EtatChargement<CompteSites>>({ statut: 'chargement' }),
    ),
    { requireSync: true },
  );

  protected formater(n: number): string {
    return this.nombre.format(n);
  }
}
```

Créer `angular/src/app/features/accueil/accueil.page.html` :

```html
<section class="p-6 flex flex-col gap-4">
  <h1 class="text-lg font-medium text-primary tracking-tight">Accueil</h1>

  <div class="w-72 bg-surface border border-subtle rounded-lg p-4">
    <p class="text-xs text-tertiary">Sites à risque industriel en base</p>
    @switch (etat().statut) {
      @case ('chargement') {
        <p class="font-mono text-base text-secondary">…</p>
      }
      @case ('echec') {
        @if (etat(); as e) {
          @if (e.statut === 'echec') {
            <p role="alert" class="text-xs text-danger">{{ e.message }}</p>
          }
        }
      }
      @case ('pret') {
        @if (etat(); as e) {
          @if (e.statut === 'pret') {
            <p class="font-mono text-base text-primary">{{ formater(e.valeur.retenus) }}</p>
          }
        }
      }
    }
  </div>
</section>
```

Note : `Intl.NumberFormat('fr-FR')` sépare les milliers par une espace fine insécable (U+202F) ; le test remplace tout blanc par une espace avant de comparer.

Run: `cd angular && npx ng test --watch=false`
Expected: 2 tests PASS.

- [ ] **Step 8: La coquille (barre latérale)**

Créer `angular/src/app/layout/coquille.component.ts` :

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';

/** Barre latérale MAGELIAN (DESIGN_SYSTEM.md § 6) autour des pages métier. */
@Component({
  selector: 'mg-coquille',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './coquille.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoquilleComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly email = this.auth.email;

  protected async deconnecter(): Promise<void> {
    await this.auth.deconnecter();
    await this.router.navigateByUrl('/connexion');
  }
}
```

Créer `angular/src/app/layout/coquille.component.html` :

```html
<div class="flex h-full">
  <nav class="w-60 shrink-0 flex flex-col bg-surface border-r border-subtle" aria-label="Navigation principale">
    <div class="px-4 py-4">
      <img src="magelian-icon.svg" alt="MAGELIAN" class="h-[18px]" />
    </div>
    <a routerLink="/" routerLinkActive="bg-overlay text-primary border-l-2 border-primary"
       [routerLinkActiveOptions]="{ exact: true }"
       class="px-4 py-2 text-[13px] text-secondary border-l-2 border-transparent">
      Accueil
    </a>
    <div class="mt-auto px-4 py-3 border-t border-subtle flex flex-col gap-2">
      <span class="font-mono text-[11px] text-tertiary truncate">{{ email() }}</span>
      <button type="button" (click)="deconnecter()"
              class="self-start text-xs text-secondary hover:text-primary">
        Se déconnecter
      </button>
    </div>
  </nav>
  <main class="flex-1 min-w-0 overflow-auto bg-page">
    <router-outlet />
  </main>
</div>
```

- [ ] **Step 9: Brancher intercepteur et coquille**

Dans `angular/src/app/app.config.ts`, remplacer `provideHttpClient()` par :

```ts
provideHttpClient(withInterceptors([jetonInterceptor])),
```

avec les imports `withInterceptors` (depuis `@angular/common/http`) et `jetonInterceptor` (depuis `./core/http/jeton.interceptor`).

Dans `angular/src/app/app.routes.ts`, remplacer `remoteRoutes` par :

```ts
export const remoteRoutes: Routes = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/coquille.component').then((m) => m.CoquilleComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./features/accueil/accueil.page').then((m) => m.AccueilPage),
      },
    ],
  },
];
```

- [ ] **Step 10: Vérifier**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
```

Expected: tous les tests Angular PASS, build propre, `TSC_EXIT=0`, suite racine verte.

- [ ] **Step 11: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/src/app
git commit -m "feat(angular): client HTTP, jeton Bearer, coquille et première page reliée à l'API"
```

---

### Task 5: Épreuve de bout en bout, documentation et lanceur

**Files:**
- Modify: `ARCHITECTURE.md` (stack technique, arborescence, section « Application Angular »)
- Modify: `CLAUDE.md` (commandes)
- Create: `angular/README.md` (remplacer celui généré par la CLI)

**Interfaces:**
- Consumes: tout le lot 0.
- Produces: la preuve écrite que la chaîne fonctionne, et une doc qui la décrit.

- [ ] **Step 1: Démarrer les deux serveurs**

La base locale doit tourner (`docker ps` montre `supabase_db_genesis_app`). Puis, en arrière-plan :

```bash
cd /c/GENESIS/genesis_app && npm run dev          # :3000, s'il ne tourne pas déjà
cd /c/GENESIS/genesis_app/angular && npm start    # :4200
```

Expected: `ng serve` affiche `Local: http://localhost:4200/`.

- [ ] **Step 2: Parcours navigateur (Playwright)**

Avec l'outil navigateur :
1. Ouvrir `http://localhost:4200/` → redirigé vers `/connexion?redirection=%2F`.
2. Se connecter avec le compte de dev local (`admin@geoprompt.com` ; le mot de passe est dans la mémoire du projet, `reference_geomatik_credentials.md` — ne pas l'écrire dans un fichier).
3. Attendu : la coquille, et « Sites à risque industriel en base » avec un nombre (> 0).
4. Dans la console du navigateur, exécuter :

```js
await Promise.all([
  fetch('/api/ref/geo').then(r => r.status),
  fetch('/api/risques/sites/compter').then(r => r.status),
])
```

Expected: `[200, 401]` — `/api/ref/geo` passe par le COOKIE (middleware), et `/api/risques/sites/compter` sans Bearer est refusé, ce qui prouve que c'est bien l'intercepteur qui l'autorise dans la page. Si le premier vaut 401, le piège du cookie n'est pas levé : STOP, le signaler, ne pas contourner en touchant `middleware.ts`.
5. Faire une capture d'écran de l'accueil.
6. Cliquer « Se déconnecter » → retour sur `/connexion`.

- [ ] **Step 3: Mesurer la mémoire des deux serveurs**

```powershell
Get-Process node | Sort-Object WorkingSet64 -Descending | Select-Object -First 4 Id, @{n='Mo';e={[int]($_.WorkingSet64/1MB)}}
```

Noter les chiffres dans le rapport de tâche (risque « deux serveurs sur 15,5 Go » de la feuille de route).

- [ ] **Step 4: `angular/README.md`**

Remplacer le README généré par :

```markdown
# MAGELIAN — application Angular

Interface Angular de MAGELIAN, en cours de migration depuis React
(`docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md`).
Elle appelle l'API Next.js existante, qui reste la seule source de vérité.

## Démarrer

    # 1. la base locale et l'API (à la racine du dépôt)
    bash scripts/local/00-docker-up.sh && bash scripts/local/01-supabase-up.sh
    npm run dev                  # API sur :3000

    # 2. l'application Angular
    cd angular
    npm install
    npm start                    # :4200, écrit d'abord public/config.local.json

Se connecter avec le même compte que sur :3000 — la session est dans un cookie
partagé par les deux.

## Commandes

    npm start          # serveur de dev, /api redirigé vers :3000
    npm test           # tests (Vitest)
    npm run build      # build de production
    npm run config     # régénère public/config.local.json

## Règles

- Aucun import hors de `angular/` (verrouillé par `tests/unit/angular/isolement.test.ts`).
- Jetons de couleur copiés de `app/globals.css`, jamais modifiés ici seuls
  (`tests/unit/angular/jetons-paritaires.test.ts`).
- Toute adresse d'API passe par `HttpBaseService`.
```

- [ ] **Step 5: `ARCHITECTURE.md`**

1. Dans le tableau « Stack technique », ajouter une ligne :

```markdown
| Interface Angular (migration en cours) | **Angular 21.2.4** épinglé (standalone, zoneless, signals), Tailwind 4, Vitest, `@supabase/ssr` — dossier `angular/`, application séparée servie sur `:4200` et reliée à l'API Next.js par le proxy de dev. Aucun import croisé avec le code React (`tests/unit/angular/isolement.test.ts`). Feuille de route : `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` | 21.2.4 |
```

2. Dans l'arborescence, sous `genesis_app/`, ajouter :

```
├── angular/                    # Application Angular (migration progressive, lot par lot)
│   ├── proxy.conf.json         # /api -> localhost:3000 (même origine : les cookies suivent)
│   ├── scripts/ecrire-config.mjs # public/config.local.json depuis .env.development.local (ignoré par git)
│   └── src/app/
│       ├── core/               # config, auth (@supabase/ssr), http (HttpBaseService, intercepteur)
│       ├── layout/             # coquille (barre latérale)
│       └── features/           # un dossier par module migré
```

3. Ajouter, avant la section « Commandes », une section :

```markdown
## Application Angular (depuis le 2026-09-29)

Migration progressive de l'interface, module par module, sans toucher à l'API
(feuille de route : `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md`).

- **Deux applications, une API.** React sur `:3000`, Angular sur `:4200` ; le
  proxy de dev d'Angular redirige `/api` vers `:3000`.
- ⚠ **L'authentification est DOUBLE, et c'est ce qui a imposé `@supabase/ssr`.**
  Les routes lues par `requireAuth()` exigent le Bearer ; celles de
  `PROTECTED_API_PREFIXES` (`/api/tiles`, `/api/ref`, `/api/map/pois`…) sont
  d'abord filtrées par `middleware.ts`, qui lit le COOKIE et ignore le
  Bearer. `@supabase/ssr` range la session en cookies au format de
  l'application React, et l'intercepteur `jetonInterceptor` pose le Bearer.
  Vérifié au navigateur le <date de l'épreuve> : `/api/ref/geo` 200 par le
  seul cookie.
- **La clé anon n'est dans aucun fichier suivi** : `npm start` écrit
  `angular/public/config.local.json` depuis `.env.development.local`, lu à
  l'exécution par `ConfigService`.
- **Préparé pour AIDA sans l'activer** : `HttpBaseService` construit toutes les
  adresses (il héritera de `MechaRemoteAppHttpBaseService`), et les routes
  métier vivent dans `remoteRoutes` (`angular/src/app/app.routes.ts`).
- Le `tsconfig.json` et l'`.eslintrc.json` de la racine EXCLUENT `angular/` :
  leur `**/*.ts` compilait sinon le projet Angular avec la configuration Next.
```

Remplacer `<date de l'épreuve>` par la date réelle du Step 2.

- [ ] **Step 6: `CLAUDE.md`**

Dans le bloc « Commandes », ajouter à la fin :

```bash
cd angular && npm start  # Interface Angular (localhost:4200), /api -> :3000
cd angular && npm test   # Tests Angular (Vitest)
```

- [ ] **Step 7: Vérification finale complète**

```bash
cd /c/GENESIS/genesis_app/angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run lint 2>&1 | tail -3
npm run test:unit 2>&1 | tail -5
```

Expected: tout vert, `TSC_EXIT=0`. En particulier `tests/unit/docs/derive-documentation.test.ts` et `tests/unit/securite/aucun-secret-en-dur.test.ts` passent.

- [ ] **Step 8: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add ARCHITECTURE.md CLAUDE.md angular/README.md
git commit -m "docs(angular): socle documenté, authentification double vérifiée au navigateur"
```
