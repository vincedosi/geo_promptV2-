# Lot AIDA — conformité Native Federation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre l'application Angular `angular/` conforme à la documentation AIDA « Création d'une Remote App (Native Federation Angular) », et PROUVER qu'elle fonctionne quand un shell hôte ne charge que `remoteRoutes` — avant que le lot 3 ne multiplie les écrans.

**Architecture:** Native Federation 21.2.1 expose `./Routes` (`app.routes.ts`). Tout ce que l'application exige pour fonctionner — intercepteurs HTTP, chargement de la configuration et de la session, feuilles de style, services d'API — est porté PAR `remoteRoutes` lui-même (fournisseurs de route, garde de démarrage, composant racine distant), jamais par `app.config.ts` ni `index.html`, que le shell n'exécute pas. Les services métier HÉRITENT de `HttpBaseService` comme l'impose la doc ; `HttpBaseService` hérite d'une DOUBLURE PROVISOIRE de `MechaRemoteAppHttpBaseService` (paquet inaccessible sans le jeton du siège) de même surface publique.

**Tech Stack:** Angular 21.2.4 (zoneless, signals), `@angular-architects/native-federation` 21.2.1, Vitest (`@angular/build:unit-test`), MapLibre 5.18.0, ECharts 6.1.0.

**Spec:** `docs/documentation-remote-app-native-federation-aida.pdf` (doc PRIVÉE — la lire, ne JAMAIS la stager ni la citer dans un fichier suivi au-delà de son nom) et `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (§ « Compatibilité AIDA »). Exigences de la doc, verbatim :
- Versions : Angular 21.2.4 · `@angular-architects/native-federation` 21.2.1 · `@gdo-rd-france/mecha-lib-ui` 0.0.81.
- `.npmrc` : `@gdo-rd-france:registry=https://npm.pkg.github.com` · `//npm.pkg.github.com/:_authToken=${NPM_GITHUB_TOKEN}` · `legacy-peer-deps=true`. « Ne jamais committer de token en clair. »
- `environment.ts` : `export const environment = { slug: '<nom de l'app remote>' };` — « Le slug doit correspondre exactement au nom d'app attendu par l'environnement AIDA (fourni en amont — ne pas l'inventer). »
- `http-base.service.ts` : `export class HttpBaseService extends MechaRemoteAppHttpBaseService { constructor() { super(environment.slug); } public override get baseUrl(): string { return super.baseUrl + '/api'; } }`.
- « Tout service métier consommant l'API de la remote app doit étendre `HttpBaseService` plutôt que d'injecter directement HttpClient et de reconstruire l'URL de base » ; appels `this.httpClient.get(`${this.baseUrl}/…`)`.
- `app.routes.ts` : `export const remoteRoutes: Routes = [{ path: '', component: <Shell>, children: [] }]` et `export const appRoutes: Routes = [{ path: '', redirectTo: 'app', pathMatch: 'full' }, { path: 'app', component: App, children: remoteRoutes }]`. « Le contrat remoteRoutes (forme et point d'exposition) ne doit pas être modifié sans concertation — seul son contenu (routes enfants) peut évoluer. »
- `federation.config.js` : `withNativeFederation({ name, exposes: { './Routes': './src/app/app.routes.ts' }, shared: { ...shareAll({ singleton: true, strictVersion: false, requiredVersion: 'auto' }) }, skip: ['rxjs/ajax','rxjs/fetch','rxjs/testing','rxjs/webSocket'], features: { ignoreUnusedDeps: true } })`.

## Global Constraints

- Angular **21.2.4** exact (inchangé). Nouvelle dépendance, et SEULEMENT celle-ci : `@angular-architects/native-federation` **21.2.1** exact. **Pas** de `@gdo-rd-france/mecha-lib-ui` (jeton absent) : une doublure provisoire en tient lieu.
- **Aucun secret, aucun jeton** dans un fichier suivi. `NPM_GITHUB_TOKEN` n'apparaît que sous la forme littérale `${NPM_GITHUB_TOKEN}`.
- **Le slug n'est pas inventé** : `slug: ''` tant que le siège ne l'a pas fourni. Le `name` de `federation.config.js` vaut `'magelian'` (identifiant technique de fédération, pas le slug) avec un commentaire qui dit de l'aligner sur la réponse du siège.
- **Rien dans `angular/` n'importe hors de `angular/`** (`tests/unit/angular/isolement.test.ts`).
- Règles d'I/O de `CLAUDE.md` : au plus 3 appels simultanés — le limiteur DOIT s'appliquer aussi quand l'application est chargée par un shell.
- Aucune couleur en dur ; textes d'interface en français, sentence case ; `OnPush`, `input()`/`output()`, préfixe `mg`.
- La doc AIDA (`docs/documentation-remote-app-native-federation-aida.pdf`) n'est JAMAIS stagée : `git add` avec des chemins explicites uniquement, jamais `git add -A` ni `git add .`.
- Ne pas modifier `middleware.ts`. Ne jamais pousser. Git : `export PATH="/c/GENESIS/PortableGit/cmd:$PATH"`.
- Après chaque tâche : `cd angular && npx ng test --watch=false && npm run build` verts ; à la racine `npx tsc --noEmit` (code de retour lu DIRECTEMENT, jamais derrière un pipe) et `npm run test:unit` verts.
- Toute tâche qui touche l'affichage : preuve au NAVIGATEUR dans les deux thèmes (captures dans le dossier de travail du chantier, jamais dans le dépôt).

## Review Focus

- **Montage sous un chemin inconnu** : le shell monte `remoteRoutes` sous un préfixe qu'il choisit (ex. `/outils/magelian/`). Tout lien et toute navigation interne doivent rester dans ce préfixe. → test de la tâche 3 (hôte simulé monté sous `hote/magelian`, lien « Catalogue » → `/hote/magelian/catalogue`).
- **Le shell ne charge QUE `remoteRoutes`** : sans `app.config.ts`, les intercepteurs (limiteur, jeton, session expirée), la configuration et la session doivent quand même s'appliquer. → test de la tâche 3 (hôte simulé SANS intercepteurs à la racine : l'appel des sites porte le Bearer, un 4e appel simultané attend).
- **Ressources résolues contre le shell** : `config.local.json`, `maplibre.css`, la feuille de style globale et les polices doivent être cherchés à l'adresse DE L'APPLICATION distante, pas à celle du shell. → tests de la tâche 4 (base différente de `document.baseURI`) + épreuve réelle de la tâche 6.
- **Thème posé par le shell** : si le shell bascule la classe `light`/`dark` de `<html>`, les couleurs de carte et de courbe suivent. → test de la tâche 5.
- **Poste sans jeton** : `npm install` / `npm start` dans `angular/` ne doivent pas casser tant que `NPM_GITHUB_TOKEN` n'existe pas. → vérification de la tâche 1.

---

### Task 1: Native Federation installée, `federation.config.js` et `.npmrc` conformes

**Files:**
- Modify: `angular/package.json`, `angular/package-lock.json`, `angular/angular.json`, `angular/src/main.ts`
- Create: `angular/federation.config.js`, `angular/src/bootstrap.ts` (créé par le schéma), `angular/.npmrc` (ou `angular/.npmrc.aida`, voir étape 4)

**Interfaces:**
- Produces: un build qui émet `remoteEntry.json` exposant `./Routes` → `src/app/app.routes.ts`. `main.ts` = `initFederation()` puis `import('./bootstrap')` ; `bootstrap.ts` = l'ancien contenu de `main.ts` (bootstrap + `afficherErreurDemarrage`).

- [ ] **Step 1: Installer le paquet, version exacte**

```bash
cd angular && npm install --save-exact @angular-architects/native-federation@21.2.1
```
Vérifier `package.json` : `"@angular-architects/native-federation": "21.2.1"` (sans `^`).

- [ ] **Step 2: Initialiser en mode remote**

```bash
cd angular && npx ng g @angular-architects/native-federation:init --project magelian --port 4200 --type remote
```
Lire le diff produit sur `angular.json`, `main.ts`, `bootstrap.ts`, `federation.config.js`. Consigner dans le rapport ce que le schéma a changé (builders de `build` et `serve`, cible `esbuild`), et vérifier que :
- le `proxyConfig: "proxy.conf.json"` du `serve` est CONSERVÉ (sinon `/api` ne va plus sur :3000) ;
- l'entrée `styles` avec `maplibre-gl.css` en `inject: false` / `bundleName: "maplibre"` est CONSERVÉE ;
- les `budgets` de production sont CONSERVÉS ;
- la cible `test` (`@angular/build:unit-test`) marche toujours.
Toute perte → la rétablir à la main, et le dire.

- [ ] **Step 3: `federation.config.js` = celui de la doc**

Remplacer le fichier généré par :

```js
const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');

/**
 * Contrat de fédération AIDA (doc « Création d'une Remote App », §4.5).
 * `name` : identifiant technique du remote dans la fédération. ⚠ À aligner sur
 * le nom attendu par AIDA quand le siège l'aura fourni (avec le slug).
 * `exposes./Routes` : c'est CE module que le shell importe — il contient
 * `remoteRoutes`, dont la forme ne change pas sans concertation.
 */
module.exports = withNativeFederation({
  name: 'magelian',

  exposes: {
    './Routes': './src/app/app.routes.ts',
  },

  shared: {
    ...shareAll({ singleton: true, strictVersion: false, requiredVersion: 'auto' }),
  },

  skip: [
    'rxjs/ajax',
    'rxjs/fetch',
    'rxjs/testing',
    'rxjs/webSocket',
  ],

  features: {
    ignoreUnusedDeps: true,
  },
});
```

- [ ] **Step 4: `.npmrc` — mesurer avant de décider**

Écrire `angular/.npmrc` :

```
@gdo-rd-france:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_GITHUB_TOKEN}
legacy-peer-deps=true
```

Puis, SANS `NPM_GITHUB_TOKEN` dans l'environnement (`unset NPM_GITHUB_TOKEN`), lancer dans `angular/` : `npm ls --depth=0`, `npm run config`, `npm ci --dry-run`. Consigner les sorties.
- Si tout passe (au plus un avertissement) → garder `angular/.npmrc`.
- Si npm ÉCHOUE sur la variable absente → renommer en `angular/.npmrc.aida`, et ajouter dans `angular/README.md` : « Le jour où le jeton `NPM_GITHUB_TOKEN` est fourni : `export NPM_GITHUB_TOKEN=…` puis `mv .npmrc.aida .npmrc` avant `npm install @gdo-rd-france/mecha-lib-ui@0.0.81`. » (Un `.npmrc` qui casse `npm` sur tous les postes sans jeton bloquerait tout le développement pour un paquet qu'on ne peut pas encore installer.)
- `legacy-peer-deps=true` ne doit PAS modifier le `package-lock.json` existant : vérifier par `git diff --stat angular/package-lock.json` après `npm ci --dry-run`.

- [ ] **Step 5: Vérifier le build fédéré**

```bash
cd angular && npx ng test --watch=false && npm run build
ls dist/magelian/browser | head -50
cat dist/magelian/browser/remoteEntry.json
```
Attendu : tests verts ; `remoteEntry.json` présent, `exposes` contient `./Routes` ; `maplibre.css` toujours émis et NON référencé par `index.html` (`grep -c maplibre dist/magelian/browser/index.html` → 0) ; aucun avertissement de budget. Consigner : taille du paquet initial, liste des fichiers partagés (`shared`), et si MapLibre/ECharts restent hors du chargement initial (ils ne doivent apparaître dans aucun `modulepreload` d'`index.html`).

- [ ] **Step 6: Vérifier le lancement autonome au navigateur**

Base locale démarrée (`docker ps` montre `supabase_db_genesis_app` ; sinon `bash scripts/local/00-docker-up.sh` puis `bash scripts/local/01-supabase-up.sh`). `npm run dev` à la racine (:3000, attendre `/login` à 200) et `npm start` dans `angular/` (:4200). Se connecter (identifiants : `C:/Users/LA_vsidol01/.claude/projects/C--GENESIS-genesis-app/memory/reference_geomatik_credentials.md`, jamais recopiés), ouvrir `/essai-carte` : carte, sites, courbe, KPI « Habitants à moins de 5 km » = **13 841 288**. Capture. Arrêter les deux serveurs (arbre complet : `netstat -ano | grep -E ":3000 |:4200 " | grep LISTEN`, `taskkill //F //T //PID <pid>`).

- [ ] **Step 7: Commit**

```bash
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add angular/package.json angular/package-lock.json angular/angular.json angular/src/main.ts angular/src/bootstrap.ts angular/federation.config.js angular/.npmrc   # ou angular/.npmrc.aida + angular/README.md
git commit -m "feat(angular): Native Federation 21.2.1, contrat d'exposition AIDA"
```

---

### Task 2: `environment.ts`, `HttpBaseService` selon la doc, services qui en héritent

**Files:**
- Create: `angular/src/environments/environment.ts`, `angular/src/app/core/http/mecha-remote-app-http-base.provisoire.ts`
- Modify: `angular/src/app/core/http/http-base.service.ts` + `.spec.ts`, `angular/src/app/core/http/jeton.interceptor.ts` + `.spec.ts`, `angular/src/app/core/config/config.service.ts` + `.spec.ts`, `angular/scripts/ecrire-config.mjs`, `angular/src/app/features/risques/data/sites-risque.api.ts` + `.spec.ts`, `angular/src/app/features/risques/data/zones-risque.api.ts` + `.spec.ts`, et tout autre fichier qui appelait `HttpBaseService.url()` / `.apiUrl` (les trouver : `grep -rn "apiUrl\|\.url(" angular/src/app`).

**Interfaces:**
- Produces:
  - `environment.slug: string` (vide).
  - `MechaRemoteAppHttpBaseServiceProvisoire` : classe abstraite, `protected constructor(slug: string)`, `protected readonly httpClient: HttpClient`, `get baseUrl(): string` (origine de l'API, SANS `/api`).
  - `HttpBaseService extends MechaRemoteAppHttpBaseServiceProvisoire` : `get baseUrl(): string` (AVEC `/api`, sans barre finale) ; `protected urlAbsolue(chemin: string): string`. `url()` et `apiUrl` DISPARAISSENT.
  - `SitesRisqueApi extends HttpBaseService`, `ZonesRisqueApi extends HttpBaseService` — mêmes méthodes publiques qu'avant (`compter()`, `preparer()`, `urlTuilesZones()`, `sites()`, `courbe()`), mêmes URL émises.

- [ ] **Step 1: Tests d'abord**

Dans `http-base.service.spec.ts`, remplacer les tests de `url()`/`apiUrl` par :

```ts
it('baseUrl = origine configurée + /api, sans barre en double', () => {
  configurer({ apiBaseUrl: 'https://api.exemple.fr/' });
  expect(TestBed.inject(HttpBaseService).baseUrl).toBe('https://api.exemple.fr/api');
});

it('baseUrl relatif quand l'origine est vide (même origine, proxy de dev)', () => {
  configurer({ apiBaseUrl: '' });
  expect(TestBed.inject(HttpBaseService).baseUrl).toBe('/api');
});

it('transmet le slug d'environment au service parent', () => {
  configurer({ apiBaseUrl: '' });
  expect((TestBed.inject(HttpBaseService) as unknown as { slug: string }).slug).toBe(environment.slug);
});
```
(`configurer` = l'aide existante du fichier qui fournit un `ConfigService` factice ; l'adapter si elle porte encore `slug`.) Les trois tests de `urlAbsolue` existants passent par une sous-classe de test (`class Sonde extends HttpBaseService { absolue(c: string) { return this.urlAbsolue(c); } }`) puisque la méthode devient protégée ; leurs attentes ne changent pas.

Dans `sites-risque.api.spec.ts` et `zones-risque.api.spec.ts` : les attentes d'URL/méthode/corps restent IDENTIQUES — c'est la preuve que l'héritage ne change rien à ce qui part sur le réseau.

Run: `cd angular && npx ng test --watch=false` — Expected: FAIL (compilation : `baseUrl` absent, `environment` introuvable).

- [ ] **Step 2: `environment.ts`**

```ts
/**
 * Environnement de la remote app AIDA (doc AIDA §4.1).
 * `slug` : identifiant UNIQUE de MAGELIAN dans l'écosystème AIDA. Il est FOURNI
 * par le siège et ne s'invente pas (doc §7) — vide tant qu'il n'est pas
 * attribué. Question posée le 2026-09-30.
 */
export const environment = {
  slug: '',
};
```
Retirer `slug` de `ConfigApplication`, de `ConfigService.charger()`, de `scripts/ecrire-config.mjs` et des specs (une seule source : ce fichier).

- [ ] **Step 3: La doublure provisoire**

`core/http/mecha-remote-app-http-base.provisoire.ts` :

```ts
import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { ConfigService } from '../config/config.service';

/**
 * DOUBLURE PROVISOIRE de `MechaRemoteAppHttpBaseService`
 * (`@gdo-rd-france/mecha-lib-ui` 0.0.81), inaccessible tant que le siège n'a pas
 * fourni le jeton `NPM_GITHUB_TOKEN`. Elle reproduit la SEULE surface que la doc
 * AIDA montre : un constructeur qui reçoit le slug, `httpClient`, `baseUrl`.
 *
 * Le jour où le paquet est installé, `http-base.service.ts` change UNE ligne
 * (son import) et ce fichier est supprimé. Ce que le vrai service fait de plus
 * (en-têtes ? session ?) est une question posée au siège le 2026-09-30.
 *
 * `baseUrl` rend l'ORIGINE de l'API, sans `/api` : c'est `HttpBaseService` qui
 * l'ajoute, exactement comme dans la doc (`super.baseUrl + '/api'`).
 */
export abstract class MechaRemoteAppHttpBaseServiceProvisoire {
  protected readonly httpClient = inject(HttpClient);
  private readonly configuration = inject(ConfigService);

  protected constructor(protected readonly slug: string) {}

  get baseUrl(): string {
    return this.configuration.valeur.apiBaseUrl.replace(/\/+$/, '');
  }
}
```

- [ ] **Step 4: `HttpBaseService` selon la doc**

```ts
import { DOCUMENT, Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { MechaRemoteAppHttpBaseServiceProvisoire } from './mecha-remote-app-http-base.provisoire';

/**
 * Base de TOUS les services d'API (doc AIDA §4.2-4.3) : un service métier
 * HÉRITE de cette classe et appelle `this.httpClient` avec `${this.baseUrl}/…`,
 * jamais un `HttpClient` injecté à part ni une URL recomposée.
 */
@Injectable({ providedIn: 'root' })
export class HttpBaseService extends MechaRemoteAppHttpBaseServiceProvisoire {
  private readonly document = inject(DOCUMENT);

  constructor() {
    super(environment.slug);
  }

  public override get baseUrl(): string {
    return super.baseUrl + '/api';
  }

  /**
   * Adresse ABSOLUE d'une ressource de l'API : MapLibre lit ses tuiles dans un
   * worker, où une adresse relative ne se résout contre rien. Résolue contre
   * `document.baseURI` ; les jetons `{z}/{x}/{y}` sont rétablis (`URL` les
   * encode en `%7B…%7D`, et MapLibre ne les reconnaîtrait plus).
   */
  protected urlAbsolue(chemin: string): string {
    return new URL(`${this.baseUrl}/${chemin.replace(/^\/+/, '')}`, this.document.baseURI).href
      .replace(/%7B(z|x|y)%7D/gi, (_, c: string) => `{${c.toLowerCase()}}`);
  }
}
```
`jetonInterceptor` lit désormais `inject(HttpBaseService).baseUrl` à la place de `apiUrl` (le reste inchangé) ; mettre à jour sa spec en conséquence.

- [ ] **Step 5: Les deux services héritent**

```ts
@Injectable({ providedIn: 'root' })
export class SitesRisqueApi extends HttpBaseService {
  compter(): Observable<CompteSites> {
    return this.httpClient.get<CompteSites>(`${this.baseUrl}/risques/sites/compter`);
  }
}
```

```ts
@Injectable({ providedIn: 'root' })
export class ZonesRisqueApi extends HttpBaseService {
  preparer(codeProfil: string): Observable<unknown> {
    return this.httpClient.post(`${this.baseUrl}/risques/zones/preparer`, { profil: codeProfil });
  }

  urlTuilesZones(codeProfil: string): string {
    return `${this.urlAbsolue('tiles/zones-risque/{z}/{x}/{y}')}?profil=${encodeURIComponent(codeProfil)}`;
  }

  sites(bbox: string): Observable<GeoJSON.FeatureCollection> {
    const params = new HttpParams().set('bbox', bbox).set('limite', '800');
    return this.httpClient.get<GeoJSON.FeatureCollection>(`${this.baseUrl}/map/risques-industriels`, { params });
  }

  courbe(gravites: string): Observable<ReponseCourbe> {
    const params = new HttpParams().set('gravites', gravites);
    return this.httpClient.get<ReponseCourbe>(`${this.baseUrl}/risques/exposition/rayon`, { params });
  }
}
```
(Garder les commentaires JSDoc et l'interface `ReponseCourbe` existants.) Pas de `constructor() { super(); }` explicite : TypeScript l'hérite, la doc ne l'écrit que par habitude.

- [ ] **Step 6: Tests verts, garde-fou contre le retour de l'ancien modèle**

Ajouter `angular/src/app/core/http/modele-aida.spec.ts` : il lit (par `import.meta.glob` si disponible, sinon par une liste tenue à jour) les fichiers `*.api.ts` de `src/app` et vérifie qu'aucun n'injecte `HttpClient` ni `HttpBaseService` (motifs `inject(HttpClient)` et `inject(HttpBaseService)`) et que chacun contient `extends HttpBaseService`. Si `import.meta.glob` n'est pas disponible sous le runner, écrire le test à la RACINE du dépôt (`tests/unit/angular/modele-aida.test.ts`, Node `fs`, sur le modèle de `tests/unit/angular/isolement.test.ts`) — le dire dans le rapport.

Run: `cd angular && npx ng test --watch=false && npm run build` puis, racine, `npx tsc --noEmit` et `npm run test:unit` — Expected: vert.

- [ ] **Step 7: Commit**

```bash
git add angular/src/environments angular/src/app/core angular/src/app/features/risques angular/scripts/ecrire-config.mjs   # + le test de garde s'il est à la racine
git commit -m "feat(angular): HttpBaseService et services d'API selon le modèle AIDA, slug dans environment"
```

---

### Task 3: `remoteRoutes` autonome — fournisseurs de route, démarrage, navigation relative

**Files:**
- Create: `angular/src/app/core/demarrage/demarrage.service.ts` + `.spec.ts`, `angular/src/app/core/demarrage/demarrage.guard.ts`, `angular/src/app/layout/racine-distante.component.ts`, `angular/src/app/core/auth/chemin-connexion.ts`, `angular/src/app/remote.spec.ts`
- Modify: `angular/src/app/app.routes.ts`, `angular/src/app/app.config.ts` + `app.config.spec.ts`, `angular/src/app/core/auth/auth.guard.ts` + spec, `angular/src/app/core/auth/sans-session.guard.ts` + spec, `angular/src/app/core/auth/auth.service.ts` + spec, `angular/src/app/core/auth/messages.ts` + spec, `angular/src/app/layout/coquille.component.html` + `.ts`, `angular/src/app/features/connexion/connexion.page.ts`, `angular/src/app/features/risques/data/*.api.ts` (retrait de `providedIn`)

**Interfaces:**
- Consumes: `HttpBaseService`, `SitesRisqueApi`, `ZonesRisqueApi` (tâche 2), `ConfigService.charger()`, `AuthService.initialiser()`, `limiteurInterceptor`, `jetonInterceptor`, `sessionExpireeInterceptor`, `afficherErreurDemarrage` (reste utilisé par `bootstrap.ts` pour le lancement autonome seulement).
- Produces:
  - `DemarrageService` (`providedIn: 'root'`) : `demarrer(): Promise<void>` idempotent (une seule promesse partagée : config PUIS session), `erreur: Signal<string | null>`.
  - `demarrageGuard: CanActivateFn` : attend `demarrer()`, rend TOUJOURS `true` (l'erreur est affichée par `RacineDistanteComponent`).
  - `RacineDistanteComponent` (`mg-racine-distante`) : affiche le message de `DemarrageService.erreur()` s'il existe, sinon `<router-outlet />`.
  - `CHEMIN_CONNEXION: InjectionToken<string>` (défaut `'/connexion'`) — lu par `authGuard`, `AuthService.renvoyerVersConnexion()` et la déconnexion de la coquille.
  - `FOURNISSEURS_DISTANTS: (Provider | EnvironmentProviders)[]` dans `app.routes.ts`.

- [ ] **Step 1: Le test qui simule le shell — il échoue aujourd'hui**

`angular/src/app/remote.spec.ts` : un hôte qui ne sait RIEN de `app.config.ts`.

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { remoteRoutes } from './app.routes';
import { AuthService } from './core/auth/auth.service';

/**
 * Le shell AIDA ne charge QUE `remoteRoutes` (doc §4.4-4.5) : ni app.config.ts,
 * ni index.html, ni APP_INITIALIZER. Cet hôte simulé fournit ce qu'un shell
 * fournit a priori — un routeur, un HttpClient SANS nos intercepteurs — et
 * monte l'application sous un préfixe qu'elle ne connaît pas.
 */
function hote() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([{ path: 'hote/magelian', children: remoteRoutes }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: authFactice() },
    ],
  });
}
```
(`authFactice()` : un objet avec `connecte: () => true`, `jeton: async () => 'jeton-test'`, `initialiser: async () => {}`, `email: () => 'test@exemple.fr'`, `deconnecter: async () => {}`, `renvoyerVersConnexion: async () => {}` — compléter selon la surface réelle d'`AuthService` que les composants lisent.)

Trois tests :
1. **La configuration et la session sont chargées par la route** : `await harness.navigateByUrl('/hote/magelian')` → une requête `GET` dont l'URL finit par `config.local.json` est attendue (`httpMock.expectOne(r => r.url.endsWith('config.local.json')).flush({ supabaseUrl: 'http://x', supabaseAnonKey: 'k', apiBaseUrl: '' })`) ; puis `initialiser` a été appelé une fois.
2. **Les intercepteurs s'appliquent sans app.config** : après démarrage, l'accueil appelle `SitesRisqueApi.compter()` → `httpMock.expectOne('/api/risques/sites/compter').request.headers.get('Authorization')` vaut `'Bearer jeton-test'`.
3. **Les liens restent dans le préfixe** : le lien « Catalogue » de la coquille a `href` = `/hote/magelian/catalogue` ; cliquer navigue vers `/hote/magelian/catalogue` (`TestBed.inject(Router).url`).

Un quatrième test porte sur le limiteur : depuis l'injecteur de la page chargée (`harness.routeDebugElement!.injector.get(SitesRisqueApi)`), lancer 4 `compter()` en parallèle → `httpMock.match('/api/risques/sites/compter').length` vaut **3** ; `flush` d'un des trois → le 4e part.

Run: `cd angular && npx ng test --watch=false` — Expected: FAIL (aucune requête de config : elle vit dans l'APP_INITIALIZER ; pas de Bearer : les intercepteurs vivent dans app.config ; `href` = `/catalogue`).

- [ ] **Step 2: `DemarrageService`, `demarrageGuard`, `RacineDistanteComponent`**

```ts
// core/demarrage/demarrage.service.ts
import { EnvironmentInjector, Injectable, inject, runInInjectionContext, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '../config/config.service';

/**
 * Démarrage de l'application : configuration PUIS session — dans cet ordre,
 * le client Supabase lisant la configuration à sa construction. Il vivait dans
 * un APP_INITIALIZER, que le shell AIDA n'exécute pas : il est désormais
 * déclenché par la route racine de `remoteRoutes`, donc dans les deux modes.
 * Une seule promesse, partagée : naviguer dix fois ne recharge rien.
 */
@Injectable({ providedIn: 'root' })
export class DemarrageService {
  private readonly config = inject(ConfigService);
  private readonly injecteur = inject(EnvironmentInjector);
  private enCours: Promise<void> | null = null;
  private readonly _erreur = signal<string | null>(null);
  readonly erreur = this._erreur.asReadonly();

  demarrer(): Promise<void> {
    this.enCours ??= (async () => {
      try {
        await this.config.charger();
        // AuthService injecté APRÈS le chargement : son client Supabase lit
        // la configuration dans sa fabrique (même raison que l'ancien app.config).
        const auth = runInInjectionContext(this.injecteur, () => inject(AuthService));
        await auth.initialiser();
      } catch (e) {
        this._erreur.set(e instanceof Error ? e.message : 'Démarrage impossible.');
      }
    })();
    return this.enCours;
  }
}
```

```ts
// core/demarrage/demarrage.guard.ts
import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { DemarrageService } from './demarrage.service';

/** Attend le démarrage ; laisse TOUJOURS passer — RacineDistanteComponent affiche l'erreur. */
export const demarrageGuard: CanActivateFn = async () => {
  await inject(DemarrageService).demarrer();
  return true;
};
```

```ts
// layout/racine-distante.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DemarrageService } from '../core/demarrage/demarrage.service';

/**
 * Racine de `remoteRoutes` — le « BuilderShell » de la doc AIDA : le premier
 * composant que le shell monte. Il n'affiche ses enfants qu'une fois
 * l'application démarrée ; sinon un message, JAMAIS un écran blanc — et
 * surtout jamais un remplacement du `<body>`, qui effacerait le shell.
 */
@Component({
  selector: 'mg-racine-distante',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (demarrage.erreur(); as message) {
      <p role="alert" class="m-6 rounded border border-danger bg-surface p-4 text-sm text-danger">{{ message }}</p>
    } @else {
      <router-outlet />
    }
  `,
})
export class RacineDistanteComponent {
  protected readonly demarrage = inject(DemarrageService);
}
```

Specs de `DemarrageService` : ordre config puis session ; deux appels = une seule exécution ; échec de config → `erreur()` porte le message, `initialiser` jamais appelé.

- [ ] **Step 3: `CHEMIN_CONNEXION` et gardes**

```ts
// core/auth/chemin-connexion.ts
import { InjectionToken } from '@angular/core';

/**
 * Où envoyer un utilisateur sans session. `/connexion` en lancement autonome.
 * ⚠ Dans AIDA, la connexion est peut-être assurée par le shell : question
 * posée au siège le 2026-09-30. Ce jeton est le seul point à changer.
 */
export const CHEMIN_CONNEXION = new InjectionToken<string>('CHEMIN_CONNEXION', {
  providedIn: 'root',
  factory: () => '/connexion',
});
```
`authGuard` : si `inject(DemarrageService).erreur()` → `true` (la racine affiche l'erreur, rien ne s'affiche dessous) ; sinon comportement actuel avec `inject(CHEMIN_CONNEXION)` au lieu du littéral. `AuthService.renvoyerVersConnexion()` et la déconnexion de la coquille : idem. `sansSessionGuard` et `connexion.page.ts` / `messages.ts` : la cible par défaut devient `'/app'` (et non `'/'`), puisque `''` redirige vers `app`.

- [ ] **Step 4: Routes conformes à la doc**

```ts
import type { EnvironmentProviders, Provider } from '@angular/core';
import { provideHttpClient, withInterceptors, withRequestsMadeViaParent } from '@angular/common/http';
import type { Routes } from '@angular/router';
import { App } from './app';
import { authGuard } from './core/auth/auth.guard';
import { sansSessionGuard } from './core/auth/sans-session.guard';
import { demarrageGuard } from './core/demarrage/demarrage.guard';
import { jetonInterceptor } from './core/http/jeton.interceptor';
import { limiteurInterceptor } from './core/http/limiteur.interceptor';
import { sessionExpireeInterceptor } from './core/http/session-expiree.interceptor';
import { SitesRisqueApi } from './features/risques/data/sites-risque.api';
import { ZonesRisqueApi } from './features/risques/data/zones-risque.api';
import { RacineDistanteComponent } from './layout/racine-distante.component';

/**
 * Ce que l'application exige pour fonctionner, porté PAR la route — le shell
 * AIDA ne charge que `remoteRoutes`, jamais app.config.ts.
 * - `provideHttpClient` de route : nos intercepteurs s'appliquent quel que soit
 *   l'hôte. `withRequestsMadeViaParent` : la requête continue ensuite par le
 *   HttpClient de l'hôte (ses propres intercepteurs, son backend).
 * - Les services d'API sont fournis ICI et non en `providedIn: 'root'` : un
 *   service racine recevrait le HttpClient de l'hôte, sans nos intercepteurs.
 * Ordre des intercepteurs : limiteur en premier, session expirée après le jeton.
 */
const FOURNISSEURS_DISTANTS: (Provider | EnvironmentProviders)[] = [
  provideHttpClient(
    withInterceptors([limiteurInterceptor, jetonInterceptor, sessionExpireeInterceptor]),
    withRequestsMadeViaParent(),
  ),
  SitesRisqueApi,
  ZonesRisqueApi,
];

/**
 * Contrat de fédération AIDA (doc §4.4) : la FORME de cette constante et son
 * point d'exposition (`./Routes`) ne changent pas sans concertation ; seul son
 * contenu grandit à chaque lot. Tout lien interne est RELATIF : le shell monte
 * ces routes sous un préfixe qu'on ne connaît pas.
 */
export const remoteRoutes: Routes = [
  {
    path: '',
    component: RacineDistanteComponent,
    providers: FOURNISSEURS_DISTANTS,
    canActivate: [demarrageGuard],
    children: [
      {
        path: '',
        canActivate: [authGuard],
        loadComponent: () => import('./layout/coquille.component').then((m) => m.CoquilleComponent),
        children: [
          { path: '', loadComponent: () => import('./features/accueil/accueil.page').then((m) => m.AccueilPage) },
          { path: 'catalogue', loadComponent: () => import('./features/catalogue/catalogue.page').then((m) => m.CataloguePage) },
          { path: 'essai-carte', loadComponent: () => import('./features/essai-carte/essai-carte.page').then((m) => m.EssaiCartePage) },
        ],
      },
    ],
  },
];

/** Lancement autonome, hors AIDA (doc §4.4) — `/connexion` n'existe que dans ce mode. */
export const appRoutes: Routes = [
  { path: '', redirectTo: 'app', pathMatch: 'full' },
  { path: 'connexion', canActivate: [demarrageGuard, sansSessionGuard], loadComponent: () => import('./features/connexion/connexion.page').then((m) => m.ConnexionPage) },
  { path: 'app', component: App, children: remoteRoutes },
  { path: '**', redirectTo: 'app' },
];
```
Les deux services perdent `providedIn: 'root'` (`@Injectable()` seul). ⚠ `App` est aussi le composant d'amorçage : il est donc monté deux fois (racine puis route `app`), comme dans l'exemple de la doc — vérifier que `App` ne fait rien qu'un double montage casserait (aujourd'hui il n'injecte que `ThemeService`, un singleton : sans effet).

`app.config.ts` ne garde que : `provideBrowserGlobalErrorListeners()`, `provideZonelessChangeDetection()`, `provideRouter(appRoutes, withComponentInputBinding())`, `provideHttpClient()` (SANS intercepteurs — le `ConfigService` et le HttpClient parent en ont besoin). L'`provideAppInitializer` disparaît. Adapter `app.config.spec.ts` : il démarre l'application comme `bootstrap.ts` et doit désormais prouver qu'on arrive sur `/app` avec la config chargée par la route.

- [ ] **Step 5: Navigation relative dans la coquille**

`coquille.component.html` : `routerLink="./"`, `routerLink="catalogue"`, `routerLink="essai-carte"` — relatifs à la route de la coquille (le `RouterLink` d'un composant routé se résout contre SA route). Vérifier `routerLinkActive` + `[routerLinkActiveOptions]="{ exact: true }"` sur l'accueil. Profiter du passage pour le logo de la coquille, presque invisible en thème sombre (constat du 2026-09-30 sur capture) : le rendre lisible avec les jetons existants, et le vérifier dans les deux thèmes.

Run: `cd angular && npx ng test --watch=false && npm run build` — Expected: les quatre tests de `remote.spec.ts` passent, tout le reste aussi.

- [ ] **Step 6: Navigateur, lancement autonome**

Mêmes serveurs qu'en tâche 1. Vérifier : `/` redirige vers `/app` ; sans session → `/connexion` puis retour sur la page demandée ; liens Accueil/Catalogue/Essai carte ; `/app/essai-carte` KPI **13 841 288** ; déconnexion → `/connexion`. Captures dans les deux thèmes. Arrêter les serveurs.

- [ ] **Step 7: Commit**

```bash
git add angular/src/app
git commit -m "feat(angular): remoteRoutes autonome — démarrage, intercepteurs et services portés par la route, liens relatifs"
```

---

### Task 4: Ressources résolues contre l'application distante, pas contre le shell

**Files:**
- Create: `angular/src/app/core/ressources/ressource-distante.ts` + `.spec.ts`, `angular/src/app/core/ressources/feuilles.ts` + `.spec.ts`
- Modify: `angular/angular.json` (styles), `angular/src/styles.css` (polices), `angular/src/index.html` (retrait du lien des polices), `angular/src/app/core/config/config.service.ts` + spec, `angular/src/app/carte/feuille-maplibre.ts` + spec, `angular/src/app/core/demarrage/demarrage.service.ts` + spec

**Interfaces:**
- Consumes: `DemarrageService.demarrer()` (tâche 3).
- Produces:
  - `urlRessourceDistante(nom: string, base?: string): string` — `new URL(nom, base ?? BASE_DISTANTE).href`, où `BASE_DISTANTE = import.meta.url` (le module est empaqueté dans un fichier à la racine du dossier de build, comme `maplibre.css` et `config.local.json`).
  - `chargerFeuille(doc: Document, attribut: string, href: string): Promise<void>` — pose un `<link rel="stylesheet">` une seule fois (repéré par `attribut`), résout à `load`, REJETTE à `error` avec un message français qui nomme le fichier.

- [ ] **Step 1: Mesurer où vivent les fichiers**

Après le build de la tâche 1 : `ls dist/magelian/browser` — noter où sont `main-*.js`, les `chunk-*.js`, `maplibre.css`, `config.local.json`, `remoteEntry.json`. Sous `npm start`, ouvrir la page et lire `import.meta.url` du module qui contient `ConfigService` (point d'arrêt ou `console.log` temporaire, retiré avant commit). **La stratégie `import.meta.url` n'est valable que si ces fichiers partagent un même dossier** ; sinon, s'arrêter et rendre compte (BLOCKED) avec ce qui a été mesuré.

- [ ] **Step 2: Tests d'abord**

```ts
describe('urlRessourceDistante', () => {
  it('résout contre la base de l'application distante, pas contre le document', () => {
    expect(urlRessourceDistante('config.local.json', 'https://distante.exemple/magelian/chunk-ABC.js'))
      .toBe('https://distante.exemple/magelian/config.local.json');
  });
});

describe('chargerFeuille', () => {
  it('pose le lien une seule fois et résout au chargement', async () => { /* deux appels → un seul <link>, promesse résolue après dispatch de 'load' */ });
  it('rejette avec le nom du fichier si la feuille ne charge pas', async () => { /* dispatch 'error' → rejet /magelian\.css/ */ });
});
```
Spec de `ConfigService` : la requête part vers `urlRessourceDistante('config.local.json')` (injecter la base pour le test — un `InjectionToken<string>` `BASE_RESSOURCES` de défaut `import.meta.url` est acceptable). Spec de `DemarrageService` : la feuille globale est chargée pendant `demarrer()` ; son échec renseigne `erreur()`.

Run: FAIL attendu.

- [ ] **Step 3: Implémenter**

- `ConfigService.charger()` lit `urlRessourceDistante('config.local.json')` au lieu de `'/config.local.json'`.
- `feuille-maplibre.ts` : `href = urlRessourceDistante('maplibre.css')`, et un `onerror` qui fait remonter le problème par la sortie `erreur` de `mg-carte` (message : « La feuille de style de la carte n'a pas pu être chargée. »).
- `angular.json` : `src/styles.css` devient `{ "input": "src/styles.css", "bundleName": "magelian", "inject": false }`. `DemarrageService.demarrer()` appelle `chargerFeuille(document, 'data-mg-styles', urlRessourceDistante('magelian.css'))` AVANT la config (une page sans ses styles ne doit pas s'afficher, même le message d'erreur a besoin des jetons ; si la feuille elle-même échoue, le message s'affiche sans style — accepté et dit).
- Polices : retirer le `<link>` Google Fonts d'`index.html` et le mettre en `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Inter:wght@400;500;700&display=swap');` EN TÊTE de `styles.css` (avant tout autre `@import`, y compris celui de Tailwind). Vérifier que le build ne le déplace pas après d'autres règles (sinon il serait ignoré — lire le `magelian.css` émis).
- Les `preconnect` d'`index.html` peuvent rester (sans effet dans AIDA, utiles en autonome).

- [ ] **Step 4: Vérifier**

`cd angular && npx ng test --watch=false && npm run build` ; `grep -c 'magelian.css\|maplibre.css' dist/magelian/browser/index.html` → **0** ; les deux fichiers sont bien émis. Navigateur (autonome) : pas de flash sans style au démarrage, polices Inter/JetBrains Mono effectivement appliquées (onglet réseau : `fonts.googleapis.com` sollicité), carte avec son style, deux thèmes, captures. Rapport : taille de `magelian.css`, paquet initial.

- [ ] **Step 5: Commit**

```bash
git add angular/angular.json angular/src
git commit -m "feat(angular): configuration, styles et polices chargés depuis l'application distante"
```

---

### Task 5: Le thème suit la classe de `<html>`, qui que ce soit qui la pose

**Files:**
- Modify: `angular/src/app/core/theme/theme.service.ts` + `theme.service.spec.ts`, `angular/src/app/core/theme/couleurs.service.spec.ts`

**Interfaces:**
- Consumes: `ThemeService.theme`, `themeApplique` (inchangés), `CouleursService.palette`.
- Produces: `ThemeService` observe `document.documentElement` (`MutationObserver`, `attributeFilter: ['class']`). Si la classe passe à `light` ou `dark` sans que le service l'ait posée, `theme` ET `themeApplique` prennent cette valeur, et le choix n'est PAS écrit dans `localStorage` (ce n'est pas l'utilisateur de MAGELIAN qui l'a demandé). `basculer()` continue de poser la classe ; la mutation qu'il provoque ne doit pas relancer une écriture (pas de boucle).

- [ ] **Step 1: Tests d'abord**

```ts
it('suit une classe posée par le shell hôte', async () => {
  const service = TestBed.inject(ThemeService);
  TestBed.tick();
  document.documentElement.classList.remove('dark');
  document.documentElement.classList.add('light');
  await Promise.resolve(); // les MutationObserver sont des micro-tâches
  TestBed.tick();
  expect(service.theme()).toBe('light');
  expect(service.themeApplique()).toBe('light');
});

it('ne mémorise pas un thème imposé par le shell', async () => { /* setItem jamais appelé avec la valeur imposée */ });

it('basculer() ne boucle pas avec l'observateur', async () => { /* une bascule = un setItem, themeApplique stable après deux ticks */ });

it('débranche l'observateur à la destruction de l'injecteur', () => { /* TestBed.resetTestingModule() puis mutation → aucun effet, aucune erreur */ });
```
Et dans `couleurs.service.spec.ts` : une mutation de classe externe fait recalculer une palette (valeurs différentes entre `light` et `dark` via les jetons de test existants).

Run: FAIL attendu.

- [ ] **Step 2: Implémenter**

Dans le constructeur : un `MutationObserver` sur `documentElement` ; au rappel, lire la classe (`light` si présente, sinon `dark` si présente, sinon ne rien faire) ; si elle diffère de `_theme()`, mettre à jour `_theme` et `_themeApplique` en marquant l'origine « externe » pour que l'`effect` existant ne réécrive pas `localStorage` (drapeau privé consommé une fois). Déconnexion par `inject(DestroyRef).onDestroy(() => observateur.disconnect())`. Mettre à jour le JSDoc de la classe : la phrase « la propriété du thème sera à redécider à cette intégration » devient la règle : **le shell peut poser la classe, MAGELIAN la suit ; MAGELIAN ne la pose que quand son utilisateur bascule**.

Run: `cd angular && npx ng test --watch=false && npm run build` — vert.

- [ ] **Step 3: Navigateur**

Autonome : ouvrir `/app/essai-carte`, exécuter dans la console `document.documentElement.classList.replace('dark','light')` → zones, sites et courbe changent de couleur sans rechargement (aucune tuile redemandée), captures avant/après.

- [ ] **Step 4: Commit**

```bash
git add angular/src/app/core/theme
git commit -m "feat(angular): le thème suit la classe de <html>, y compris posée par le shell"
```

---

### Task 6: Épreuve réelle dans un shell hôte jetable, et documentation

**Files:**
- Create (HORS du dépôt, dans le dossier de travail du chantier) : un projet hôte Angular 21.2.4 + Native Federation 21.2.1 en mode `dynamic-host`.
- Modify: `ARCHITECTURE.md` (§ « Application Angular »), `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (§ « Compatibilité AIDA » et tableau des lots).

**Interfaces:**
- Consumes: le build fédéré des tâches 1-5.

- [ ] **Step 1: Monter l'hôte jetable**

Dans le dossier de travail du chantier (jamais dans le dépôt) :
```bash
npx @angular/cli@21.2.4 new hote --minimal --routing --style=css --skip-git --skip-tests --ssr=false
cd hote && npm install --save-exact @angular-architects/native-federation@21.2.1
npx ng g @angular-architects/native-federation:init --project hote --port 4300 --type dynamic-host
```
Manifeste : `{ "magelian": "http://localhost:4201/remoteEntry.json" }`. Route de l'hôte : `{ path: 'outils/magelian', loadChildren: () => loadRemoteModule('magelian', './Routes').then((m) => m.remoteRoutes) }`. Un bouton de l'hôte bascule `light`/`dark` sur `<html>`. Proxy de dev de l'hôte : `/api` → `http://localhost:3000` (l'API résolue à partir d'une origine vide pointe sur l'origine du document, donc celle de l'hôte). Le remote est servi par `npx ng serve --port 4201` dans `angular/` (CORS : le dire si la configuration par défaut du builder fédéré ne l'autorise pas, et comment c'est réglé — sans rien committer de propre à l'épreuve).

- [ ] **Step 2: Parcours**

Base locale démarrée, `npm run dev` à la racine (:3000). Se connecter d'abord en autonome sur `http://localhost:4201/connexion` (les cookies de `localhost` sont partagés entre ports — le vérifier et le noter), puis ouvrir `http://localhost:4300/outils/magelian/essai-carte`. Vérifier et consigner, avec preuve (onglet réseau, captures) :
1. La page s'affiche, stylée, polices appliquées, dans le cadre de l'hôte.
2. `config.local.json`, `magelian.css`, `maplibre.css` sont demandés sur **:4201**, jamais sur :4300.
3. Tuiles `zones-risque` en 200, `/api/map/risques-industriels` avec `bbox=`, appels d'API avec `Authorization: Bearer`.
4. Le lien « Catalogue » mène à `/outils/magelian/catalogue`.
5. KPI « Habitants à moins de 5 km » = **13 841 288**.
6. Bouton de thème de l'HÔTE → la carte et la courbe changent de couleur.
7. **Fuite de styles vers l'hôte** : comparer les styles calculés d'un élément de l'hôte (police, marges d'un `h1`, fond du `body`) avant et après le chargement de MAGELIAN. Toute différence est consignée : c'est une question pour le siège (le « preflight » de Tailwind réinitialise les styles de TOUTE la page).
Arrêter tous les serveurs (arbre complet).

- [ ] **Step 3: Documentation**

`ARCHITECTURE.md`, section « Application Angular » : remplacer les puces « Préparé pour AIDA sans l'activer » et la note sur `maplibre.css` relatif par l'état réel — Native Federation 21.2.1, `federation.config.js`, `remoteEntry.json` exposant `./Routes` ; `environment.ts` (slug vide, fourni par le siège) ; services qui héritent de `HttpBaseService`, doublure provisoire de `MechaRemoteAppHttpBaseService` ; `remoteRoutes` autonome (fournisseurs de route, `withRequestsMadeViaParent`, `DemarrageService`, `RacineDistanteComponent`, liens relatifs, `CHEMIN_CONNEXION`) ; ressources résolues contre l'application distante ; thème qui suit `<html>` ; `.npmrc` (ou `.npmrc.aida`) ; résultat de l'épreuve hôte, avec la date et ce qui reste ouvert (fuite de styles le cas échéant, authentification dans AIDA, slug, jeton).

Feuille de route : dans le tableau des lots, REMPLACER la ligne « AIDA — Conformité Native Federation » (posée « en cours » à l'ouverture du lot) par :
```markdown
| **AIDA — Conformité Native Federation** ✅ <date> | Native Federation 21.2.1, `federation.config.js`, `environment.ts`, services qui héritent de `HttpBaseService`, `remoteRoutes` autonome (démarrage, intercepteurs et services portés par la route, liens relatifs), ressources et thème indépendants du shell | Épreuve dans un shell hôte jetable : page stylée, API authentifiée et limitée, KPI égal à la base, thème piloté par l'hôte | 0, 1, 2 |
```
et dans § « Compatibilité AIDA », remplacer « ce que le socle prépare sans l'activer » par l'état constaté, en gardant la liste de ce que seul le siège peut fournir (jeton, slug, fonctionnement de l'authentification, documentation de `mecha-lib-ui`).

- [ ] **Step 4: Vérification finale et commit**

```bash
cd angular && npx ng test --watch=false && npm run build
cd .. && npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:unit 2>&1 | tail -5
export PATH="/c/GENESIS/PortableGit/cmd:$PATH"
git add ARCHITECTURE.md docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md
git commit -m "docs(angular): conformité AIDA prouvée dans un shell hôte, lot documenté"
```
