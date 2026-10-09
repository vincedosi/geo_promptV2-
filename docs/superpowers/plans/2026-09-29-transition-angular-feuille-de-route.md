# Transition vers Angular — feuille de route

> Document de pilotage. Chaque lot ci-dessous aura SA spécification et SON plan
> détaillé, écrits au moment de le lancer — pas avant : un plan écrit trois
> lots à l'avance décrit un code qui aura changé entre-temps.
>
> Rédigé le 2026-09-29. Chef de projet : Claude (délégation totale de Vincent,
> même date). Les développeurs sont des sous-agents, un par tâche, chacun relu
> par un relecteur distinct avant la tâche suivante.

## Décisions prises (2026-09-28, avec Vincent) — ne pas rouvrir

| # | Décision | Pourquoi |
|---|---|---|
| D1 | **Migration progressive**, module par module | Chaque écran Angular se vérifie contre l'écran React qu'il remplace, chiffre par chiffre, avant qu'on retire ce dernier. Rien ne manque jamais à l'utilisateur |
| D2 | **Projet Angular dans ce dépôt, dossier `angular/`**, son propre `package.json` | Un seul historique : le même commit montre l'écran ajouté et son équivalent retiré. Extractible avec son historique si AIDA exige un dépôt à part |
| D3 | **Aucun import croisé** entre `angular/` et le code React/Next | « 100 % regular » : ce que les devs dentsu relisent ne contient que de l'Angular standard |
| D4 | **L'API Next.js ne change pas** — les 233 routes restent la source de vérité | Seule l'interface est réécrite. Même base, mêmes migrations SQL, mêmes règles d'I/O de `CLAUDE.md` |
| D5 | **Premier module : le risque industriel** (après le socle) | Le plus récent et le plus utilisé, il fait passer toutes les briques difficiles d'un coup : MapLibre, graphiques, export, état dans l'URL |
| D6 | **Tailwind + jetons de `DESIGN_SYSTEM.md` + composants maison sur l'Angular CDK** | Visuellement, rien ne change. `mecha-lib-ui` reste une porte ouverte : ses composants remplaceront les nôtres un par un, SANS toucher aux écrans, le jour où le jeton `read:packages` et sa doc arrivent |
| D7 | **AIDA mis de côté**, mais on ne ferme aucune porte | Voir « Compatibilité AIDA » plus bas |

## Décisions de chef de projet (2026-09-29)

| # | Décision | Pourquoi |
|---|---|---|
| P1 | **Angular épinglé en 21.2.4**, pas « la dernière 21 » | C'est la version qu'impose le shell AIDA. S'en écarter aujourd'hui, c'est une montée de version forcée le jour de l'intégration |
| P2 | Standalone, **zoneless**, signals, TypeScript strict, Vitest (défaut de la CLI 21), pas de SSR | Les défauts de la CLI Angular 21. « Regular » = ce que `ng new` produit, rien d'exotique |
| P3 | **Authentification par `@supabase/ssr` côté Angular**, pas `@supabase/supabase-js` seul | Voir « Le piège du cookie » plus bas. C'est ce qui évite de toucher `middleware.ts`, fichier protégé |
| P4 | **Proxy de dev** : Angular sur `localhost:4200`, `/api` redirigé vers `localhost:3000` | Même origine pour le navigateur : pas de CORS, et les cookies de session suivent |
| P5 | **Gel du module risque côté React à l'ouverture du lot 3**, pas avant | Pendant les lots 0-2, le React peut encore bouger. À partir du lot 3, toute correction du module risque se fait côté Angular ; un correctif urgent côté React est reporté À LA MAIN dans la tâche Angular en cours, et le rapport de lot le mentionne |
| P6 | **Logique métier pure recopiée** dans `angular/` (avec ses tests), pas partagée par un paquet | D3 interdit l'import croisé. La copie ne vit que le temps de la cohabitation : le gel P5 empêche la divergence, et la copie React disparaît avec l'écran React |
| P7 | **Graphiques : Apache ECharts** (utilisé directement, sans `ngx-echarts`) — confirmé au lot 2 (import modulaire, rendu SVG, chunk paresseux) | Recharts est propre à React. ECharts est la bibliothèque la plus répandue côté Angular. ⚠ Comme MapLibre, ECharts ne résout pas `var()` : les couleurs passeront par un service qui lit les jetons CSS calculés, jamais par des hex en dur |

## Le piège du cookie (trouvé le 2026-09-29 — il conditionne tout le socle)

Les routes API s'authentifient de **deux** façons selon leur préfixe :

- **La plupart** (`/api/risques/*`, `/api/zones/*`, `/api/campaigns/*`…) lisent
  le jeton `Authorization: Bearer` par `requireAuth()`.
- **Celles listées dans `PROTECTED_API_PREFIXES` de `middleware.ts`** — dont
  `/api/tiles/*` (donc les tuiles des zones de risque), `/api/ref/*` (le
  référentiel géo du module risque), `/api/map/pois` — sont d'abord filtrées
  par le middleware, qui lit **le cookie de session** et ignore le Bearer.

Une application Angular qui ne poserait qu'un Bearer recevrait donc des 401 sur
les tuiles et le référentiel, sans rien d'anormal dans son code. Et
`middleware.ts` est un fichier protégé.

**Sortie retenue (P3 + P4)** : `@supabase/ssr` n'est pas propre à React ; son
client navigateur range la session dans des **cookies**, au même format que
l'application actuelle. Servi derrière le proxy de dev (même origine), le
navigateur envoie ces cookies avec chaque appel `/api`, et le middleware les
lit. Les cookies ne dépendent pas du port : une session ouverte sur `:3000`
vaut aussi sur `:4200`. En plus, un intercepteur HTTP pose le Bearer pour les
routes `requireAuth()`.

La tâche 3 du lot 0 **prouve** ce point sur les deux familles de routes avant
qu'on bâtisse quoi que ce soit dessus.

## Les lots

| Lot | Contenu | Livrable vérifiable | Dépend de |
|---|---|---|---|
| **0 — Socle** | Espace de travail Angular, jetons du design system, authentification, client HTTP, coquille (barre latérale, routes), outillage (tests, lint, build), doc | Se connecter sur `:4200`, voir le nombre de sites à risque lu dans `/api/risques/sites/compter` ET une tuile `/api/tiles/...` servie en 200 | — |
| **1 — Composants de base** ✅ 2026-09-29 | Portés depuis les primitives MAISON du module risque (l'inventaire a montré qu'il n'utilise aucun composant shadcn) : tuile KPI, pastille, champ, cellules de tableau, fil d'étapes, fil d'Ariane, réglette validée au relâchement, barre de progression unique et valeurs périmées. Plus : thème clair/sombre, 3 appels API simultanés au plus pour toute l'application, garde inverse de la connexion. Fenêtre modale et notifications reportées aux lots 5-6, seuls à s'en servir | Page `/catalogue` (`/app/catalogue` en autonome depuis le lot AIDA), vérifiée au navigateur dans les deux thèmes | 0 |
| **2 — Carte et graphiques** ✅ 2026-09-30 | `mg-carte` (cycle de vie MapLibre), chargement par cadre visible, caméras liées, popups sûres ; `mg-courbe` sur Apache ECharts (P7 confirmé, sans `ngx-echarts`) ; couleurs lues dans les jetons (plus de tables d'hexadécimaux) | Page `/essai-carte` (`/app/essai-carte` en autonome depuis le lot AIDA) : vraies zones, vrais sites, vraie courbe, KPI égal à la base | 0, 1 |
| **AIDA — Conformité Native Federation** ✅ 2026-09-30 côté MAGELIAN — conforme avec un hôte PAR DÉFAUT (`ignoreUnusedDeps: true`), en développement et en production, depuis les lots « Robustesse dans l'hôte » et « Isolation CSS ». Restent ouvertes les seules questions au siège AIDA : l'authentification dans le shell, le slug, le jeton `read:packages` (`NPM_GITHUB_TOKEN`) et la doc de `mecha-lib-ui`. | Native Federation 21.2.1, `federation.config.js`, `environment.ts`, services qui héritent de `HttpBaseService`, `remoteRoutes` autonome (démarrage, intercepteurs et services portés par la route, liens relatifs), ressources et thème indépendants du shell | Épreuve dans un shell hôte jetable : page stylée, API authentifiée, KPI égal à la base, thème piloté par l'hôte — d'abord avec un hôte qui partage les entrées secondaires d'Angular (NG0203 avec l'hôte par défaut), puis rejouée avec l'hôte par défaut (lot suivant) | 0, 1, 2 |
| **AIDA — Robustesse dans l'hôte** ✅ 2026-09-30 | Retrait de `@angular/core/rxjs-interop` du remote (`versEtat` sur `signal` + `DestroyRef`, désabonnement explicite dans l'essai de carte) et garde des imports partagés (`tests/unit/angular/imports-partages.test.ts`) ; sans session dans l'hôte, message « Session requise… » au lieu d'une navigation vers `/connexion` (`STRATEGIE_SANS_SESSION`, défaut racine `message`, `rediriger` fourni par la route `app` du lancement autonome) ; limiteur de 3 appels mesuré dans l'hôte | Épreuve rejouée avec un hôte PAR DÉFAUT (`ignoreUnusedDeps: true`) et en build de production : les six vérifications fonctionnelles passent aux deux passes (la 7e, la fuite de styles, reste constatée : lot « Isolation CSS »), accueil et essai de carte sans erreur en console, message sans session sans navigation, limiteur mesuré (3 en vol, la 4e après la 1re réponse) | AIDA — Conformité |
| **AIDA — Isolation CSS** ✅ 2026-09-30 | Toute l'interface dans des racines d'ombre (`RacineDistanteComponent`, `ConnexionPage`) qui ADOPTENT `magelian.css`, lue et construite au démarrage, jamais posée dans le document ; `@property` réécrites et retirées, `@import` retirés, `rem` convertis en px ; polices au niveau du document ; `:host` : `all: initial` puis propriétés héritées et `color-scheme` en `!important` (un `*` du shell ne gagne plus) ; jetons sur `:host`/`:host(.light)`, classe recopiée par `ThemeService`, lue par `CouleursService` ; `maplibre.css` dans la racine de la carte ; garde « rien hors de l'ombre » (`tests/unit/angular/portails-hors-ombre.test.ts`). Retenue contre une CSS confinée après épreuve comparée (rapport de la tâche 8) | Dans l'hôte PAR DÉFAUT, prod et dev : 0 différence sur le tableau de la tâche 6, 0 propriété personnalisée sur `<html>`, feuille d'hôte hostile (y compris `*`, `html { font-size }` et une règle sur l'élément hôte) sans effet sur MAGELIAN dans les deux thèmes, héritage d'un ancêtre coupé, `color-scheme` suivant le thème de MAGELIAN, 11 vérifications fonctionnelles sur 11 plus glisser/clic/fermeture de popup ; autonome dans les deux thèmes, connexion → page → déconnexion | AIDA — Conformité |
| **Rendu — Parité visuelle avec React** ✅ 2026-10-03 | Objectif fixé par le propriétaire : « la même chose que Next.js mais Angular ». 80 écarts inventoriés (`docs/superpowers/plans/2026-09-30-inventaire-rendu-react-angular.md`) : base globale, icônes sans dépendance, marque, coquille = `AppSidebar`, routes carte/risque plein écran, connexion en écran partagé, en-têtes, accueil, bandeau KPI, mobilier de carte, courbe, écran d'essai — l'écran d'essai est désormais composé sur le SQUELETTE de l'écran risque React à l'étape ② (en-tête et fils, barre commune, progression, bandeau, panneau 480 px réglable / carte permanente, « Carte seule »). Plan : `docs/superpowers/plans/2026-09-30-angular-lot-rendu.md`. **Écarts restants, justifiés** : (1) le bandeau n'a que deux tuiles et le panneau ② ni le tableau des bandes ni ses quatre chiffres (données de `population_par_classe`, portées au lot 3) ; (2) filtres de la barre, autres étapes, exports, « Voir sur la carte » et puces du résumé de profil rendus à l'identique mais INERTES (« Disponible prochainement », patron du bouton « MAGELIAN ») ; (3) courbe et chiffres de l'essai sur le seuil haut seul (KPI 13 841 288 inchangé) quand React lit les deux seuils ; (4) marge intérieure des popups gardée (arbitrage 3) ; (5) réglette native comme React (V10, écart au DESIGN_SYSTEM hérité) ; (6) défauts de React gardés pour la parité et signalés : pastille « Découpage des zones… » recouverte par « Carte seule » (même place, plan inférieur), logotype quasi invisible en sombre corrigé côté Angular (R2) ; (7) le survol d'un site (anneaux dessinés) et l'interrupteur Rayons / Codes postaux actif relèvent du lot 3 | Captures Angular et React côte à côte, deux thèmes, pour chaque écran ; table de fuite du lot AIDA rejouée en R11 dans l'hôte par défaut (prod et dev) : 0 différence, 0 propriété sur `<html>`, feuille hostile sans effet | AIDA |
| **3 — Module risque** ✅ 2026-10-04 (ouvert le 2026-10-03 — gel P5) | Les cinq étapes ① Sites › ② Rayon › ③ Couverture › ④ Zones › ⑤ Campagne, l'état dans l'URL, les exports, la barre de progression unique. Gel P5 à l'ouverture. Plan : `docs/superpowers/plans/2026-10-03-angular-lot3-module-risque.md` (arbitrages A1-A14). Entrées Angular : lien de développement « Module risque » et tuile des sites de l'accueil. **Parité finale** : huit états d'URL, deux thèmes, tous les nombres de l'écran identiques hors le compte de la légende (A6, ci-dessous). **Écarts restants, justifiés** : (A6) « Voir sur la carte » absent jusqu'au lot 4 — d'où un en-tête plus bas et une carte cadrée un peu autrement, donc « 54 sites affichés » contre « 55 » dans la légende de l'état par défaut (61 contre 62 tiroir ouvert) ; (A7) Fermer ramène à l'accueil, pas à `/map` ; (A5) la mention « Types de risque filtrés depuis le panneau Calques » n'existe pas (les natures viennent de l'URL) ; zones peintes SOUS les sites ; cadre initial stable de la carte de ⑤ ; défauts de React gardés pour la parité et signalés (« Autres régimes » qui reçoit les anneaux du seuil haut quand les niveaux sont liés, accords « régions exposés », libellé de champ englobant ses boutons) | Chaque étape comparée à l'écran React sur le même état d'URL, chiffres identiques. ⚠ **Le module React N'EST PAS retiré au lot 3** (arbitrage de Vincent, 2026-09-30) : les deux écrans cohabitent jusqu'à la fin de la migration, et Next.js ne perd ses pages qu'au lot 7 | 0, 1, 2 |
| **4 — Carte principale** (ouvert le 2026-10-04 — gel P5 étendu à /map : `app/map/**`, `components/map/**`, `components/custom-geo/**`, `lib/carte/**`, `lib/navigation/**`, `lib/custom-geo/**`, `app/copilote/_hooks/useMapInit.ts`, `useMapLayers.ts`) | `/map`, rail des cinq thèmes, panneaux Filtre/Calques/Analyse/Zones. Plan : `docs/superpowers/plans/2026-10-04-angular-lot4-carte-principale.md` (arbitrages B1-B17) | Parcours complet du rail | 3 |
| **5 — Campagnes** | Overlay MAGELIAN : Stratégie (wizard), Activation, Suivi V2, Aperçu | Une campagne créée, activée (pré-vol) et suivie depuis Angular | 4 |
| **6 — Administration** (ouvert le 2026-10-06 — gel P5 étendu à l'administration : `app/admin/**`, `app/dashboard/iris-crawler/**`, `lib/admin-fetch.ts` ; les modules purs recopiés qui servent aussi l'API — `lib/auth/roles.ts`, `lib/version.ts`, `lib/import/types.ts`, `lib/donnees/registre-fraicheur.ts`, `types/{admin,dsp,campaign}.ts` — sont tenus par `tests/unit/angular/admin-logique-paritaire.test.ts` (T1), pas gelés ; tout correctif urgent côté React est reporté à la main dans la tâche Angular en cours) | Pages `/admin/*`, imports avec progression NDJSON. Plan : `docs/superpowers/plans/2026-10-06-angular-lot6-administration.md` (arbitrages C1-C17), en parallèle du lot 4 (fichiers partagés et règle de conflit dans le plan) | Chaque import rejoué depuis Angular | 0, 1 |
| **7 — Bascule** | Retrait de l'interface React ; Next.js ne sert plus que l'API. Intégration AIDA (federation) si le jeton et le slug sont arrivés | `npm run build` côté Next ne contient plus aucune page ; `ng build` produit l'application complète | tous |

Le lot 6 peut tourner en parallèle des lots 3 à 5 : il ne partage que le socle.

**Réserve sur le lot « AIDA — Conformité » (épreuve du 2026-09-30).** La
première épreuve ne passait que dans un hôte qui partage les entrées
secondaires d'Angular (`ignoreUnusedDeps: false`) : avec l'hôte tel que le
génère le schématique (`ignoreUnusedDeps: true`), la page plantait en
`NG0203`, l'hôte ne partageant pas `@angular/core/rxjs-interop` dont la copie
du remote importe les morceaux PRIVÉS de `@angular/core`. **Levée par le lot
« Robustesse dans l'hôte »** : rxjs-interop retiré, interdit par une garde,
et l'épreuve rejouée avec l'hôte PAR DÉFAUT en développement ET en
production, limiteur compris. La fuite de styles, qui restait bloquante, est
levée par le lot « Isolation CSS » (racines d'ombre, mesuré dans le même hôte).

## Règles de chantier (valent pour chaque tâche de chaque lot)

1. **Une tâche = un sous-agent développeur**, qui reçoit le texte complet de sa
   tâche et le contexte nécessaire, jamais « lis le plan ».
2. **Chaque tâche est relue** par un sous-agent distinct avant la suivante :
   conformité au plan, puis qualité du code. Une tâche refusée est corrigée
   par son développeur, puis relue à nouveau.
3. **Critère de sortie d'une tâche** : tests Angular verts (`npm test` dans
   `angular/`), `ng build` propre, `npx tsc --noEmit` à la racine toujours
   propre, et les tests unitaires de la racine toujours verts.
4. **Critère de sortie d'un écran migré** : comparaison chiffrée avec l'écran
   React, sur le même état. Un écart inexpliqué bloque le retrait.
5. **Les règles d'I/O de `CLAUDE.md` valent côté Angular** : au plus 3 appels
   simultanés, calcul au relâchement d'une réglette, cache avant tout appel,
   jamais la France entière au premier chargement.
6. **Documentation dans le même commit** (`ARCHITECTURE.md`), comme pour le
   reste du dépôt.
7. **Aucun secret dans un fichier suivi** : la clé anon locale est écrite dans
   un fichier d'environnement généré et ignoré par git.
8. **Rien n'est poussé sur GitHub par un agent** : Vincent pousse (ce poste n'a
   pas d'identifiants git en ligne de commande).

## Compatibilité AIDA — état constaté le 2026-09-30

La doc AIDA (`docs/documentation-remote-app-native-federation-aida.pdf`) impose
ses exigences à une application intégrée. État après le lot « AIDA —
Conformité », vérifié dans un shell hôte jetable (détail : `ARCHITECTURE.md`
§ Application Angular) :

| Exigence AIDA | État constaté |
|---|---|
| Angular 21.2.4 | P1 ; l'hôte jetable était lui aussi épinglé en 21.2.4 |
| Native Federation, `remoteEntry.json` exposant `./Routes` | NF 21.2.1 (+ `es-module-shims` 1.10.1), `federation.config.js` (`name: 'magelian'`, `exposes['./Routes']`) ; l'hôte charge `remoteRoutes` par `loadRemoteModule` |
| Tous les appels passent par un service de base qui construit l'adresse de l'API | Les services HÉRITENT de `HttpBaseService`, qui hérite d'une doublure provisoire de `MechaRemoteAppHttpBaseService` — la bascule vers le vrai paquet suit une liste de dix points (`ARCHITECTURE.md` § Application Angular, « Liste de bascule »), dont l'import n'est qu'un seul |
| Une constante `remoteRoutes` exposée par `app.routes.ts` | `remoteRoutes` AUTONOME : démarrage, intercepteurs et services d'API portés par la route racine, liens relatifs. Prouvé sous `/outils/magelian` dans un hôte PAR DÉFAUT (`ignoreUnusedDeps: true`), remote en développement et en production ; sans session, message « Session requise… » sans navigation |
| Un `slug` dans l'environnement | `environment.ts`, `slug: ''` tant que le siège ne l'a pas fourni |
| Rien dans `index.html` ni `app.config.ts` (le shell ne les exécute pas) | Styles, configuration et polices résolus contre l'application distante ; thème qui SUIT la classe que le shell pose sur `<html>` et n'y écrit JAMAIS dans un hôte (`ECRIRE_HTML`, revue finale — prouvé dans l'hôte par défaut avec un `<html>` sans classe) |
| Ne pas restyler le shell, ne pas être restylé par lui | Interface en racines d'ombre (lot « Isolation CSS ») : 0 différence mesurée sur les éléments de l'hôte, 0 propriété sur `<html>`. Vont au document : les `@font-face` des polices, et les `<style>` des composants qu'Angular (SharedStylesHost) y recopie, confinés par attribut (`::ng-deep` et `ViewEncapsulation.None` interdits par une garde). ⚠ Exigences de déploiement (CORS, revalidation, CSP des polices) : voir ci-dessous |

Ouvert côté MAGELIAN après l'épreuve : les **exigences de déploiement**,
à tenir au premier déploiement (aucun n'existe) — `ARCHITECTURE.md`
§ Application Angular, « Exigences de déploiement » : `Cache-Control: no-cache`
sur `magelian.css`, `magelian-polices.css`, `maplibre.css`,
`config.local.json` et `remoteEntry.json` (chargés sans empreinte dans leur
nom) ; CORS sur ces fichiers et sur les chunks ; CSP du shell ouverte à
`fonts.googleapis.com` / `fonts.gstatic.com`. Le retrait de
`@angular/core/rxjs-interop`, le comportement sans session (lot « Robustesse
dans l'hôte ») et l'isolation CSS sont faits. L'authentification dans AIDA
reste une question AU SIÈGE : sans session, le remote affiche « Session
requise… » ; la connexion elle-même relève du shell.

⚠ **Doc AIDA relue en entier le 2026-09-30** : le socle ne suivait PAS la doc sur cinq points (services qui injectent au lieu d'hériter, slug hors d'`environment.ts`, forme d'`appRoutes`, fédération absente, et surtout tout ce que porte `app.config.ts` — intercepteurs, démarrage, styles — que le shell n'exécute pas). D'où le lot « AIDA — Conformité » inséré avant le lot 3.

Ce qui manque et que seul le siège peut fournir : le jeton `read:packages`
(`NPM_GITHUB_TOKEN`), la doc de `mecha-lib-ui`, le slug, et le fonctionnement
de l'authentification dans AIDA (sans session, le remote affiche « Session
requise… » sans naviguer ; la connexion elle-même relève du shell).

## Risques suivis

| Risque | Parade |
|---|---|
| Cookies de session non transmis, donc 401 sur tuiles et référentiel | Épreuve dès la tâche 3 du lot 0, sur les deux familles de routes |
| La config TypeScript de la racine (`"include": ["**/*.ts"]`) compile `angular/` et casse `tsc`/`next build` | Exclusion dans la tâche 1 du lot 0, vérifiée par `tsc` racine |
| Divergence entre la logique React et sa copie Angular | Gel P5 ; la copie ne vit que le temps de la cohabitation |
| ECharts ne couvre pas un graphique existant | Épreuve technique au lot 2, avant le module risque ; repli : D3 ciblé |
| Deux serveurs de dev sur un poste à 15,5 Go de RAM | Mesurer au lot 0 ; Angular en `ng serve` sans SSR reste léger |

## À savoir pour les lots suivants (revue finale du lot 0)

- **Les requêtes de MapLibre ne passent PAS par l'intercepteur.** MapLibre fait
  ses propres appels `fetch`, hors du `HttpClient` Angular — `jetonInterceptor`
  ne les voit jamais. Une source de carte servie par une route `requireAuth()`
  a besoin d'un `transformRequest` posant le Bearer à la main ; les routes au
  cookie seul (`/api/tiles`, `/api/ref`) n'en ont pas besoin, le cookie voyage
  avec toute requête `fetch` de même origine.
- **`ConfigService` doit garder son client bâti sur `HttpBackend`.** Le faire
  passer par le `HttpClient` intercepté recréerait le cycle
  `jetonInterceptor` → `HttpBaseService.baseUrl` (ex-`apiUrl`) → `ConfigService.valeur`
  décrit dans `ARCHITECTURE.md` § Application Angular — voir aussi
  `angular/src/app/app.config.spec.ts`.
- **`@supabase/ssr` se met à jour à la racine ET dans `angular/` ENSEMBLE.**
  Les deux clients lisent et écrivent le même cookie de session ; une version
  qui change son format sans l'autre casserait la session partagée entre
  `:3000` et `:4200` en silence.
- **Les dossiers d'accès aux données restent sous `angular/src/**/data/`** —
  c'est le motif que l'exception du `.gitignore` racine attend
  (`!angular/src/**/data/`, voir ARCHITECTURE.md). Un dossier `data/` posé
  ailleurs dans `angular/` resterait suivi par erreur ou, pire, tomberait sous
  le motif `data/` général et serait ignoré en silence.

### À savoir pour les lots suivants (revue finale du lot 1)

- **Tout écran qui monte `mg-barre-progression` ou appelle `ChargementService.suivre()`
  doit déclarer `providers: [ChargementService]`.** Le service n'est pas
  `providedIn: 'root'` — sans ce provider par écran, l'injection remonte à la
  racine et lève un `NullInjectorError`. Et les clés de piste passées à
  `suivre(cle, …)` doivent être UNIQUES par écran : deux pistes qui partagent
  une clé s'écrasent l'une l'autre dans le même service.
- **`ThemeService` écrit sur `document.documentElement`** — dans le shell
  AIDA, ce sera le `<html>` DU SHELL, pas celui d'un Angular isolé. La
  propriété du thème (qui pose la classe en premier : le script inline de
  `index.html`, ou `ThemeService`, ou le shell lui-même) est à décider AVANT
  cette intégration, pas pendant. **Tranché au lot AIDA (2026-09-30)** : le
  shell pose la classe, MAGELIAN la suit ; **et depuis la revue finale du lot,
  MAGELIAN n'écrit JAMAIS `<html>` dans un hôte** — seul le lancement autonome
  l'y autorise (`ECRIRE_HTML`, voir la section du lot AIDA ci-dessous et
  `ARCHITECTURE.md`).
- **La limite de 3 appels simultanés ne couvre que `HttpClient`.** Les tuiles
  et le GeoJSON de MapLibre lui échappent (déjà noté au lot 0) — la
  discipline « bbox = carte visible » reste donc la responsabilité du
  composant de carte, pas de `limiteurInterceptor`.

Reporté au lot 3 : `button[mgPastille]` fixe `type="button"` en dur dans son
`host` — sûr pour ses usages actuels (aucun n'est dans un `<form>`), mais un
futur usage voulant un VRAI bouton de soumission (`type="submit"`) à
l'intérieur d'un formulaire se heurtera à ce `type` figé. À vérifier au
premier usage réel dans un `<form>`, pas avant.

### À savoir pour les lots suivants (revue finale du lot AIDA)

Chaque règle ci-dessous a coûté une correction pendant le lot AIDA ; la plupart
sont verrouillées par une garde (`tests/unit/angular/`), les autres ne tiennent
que par la revue. Détail : `ARCHITECTURE.md` § Application Angular.

- **Services d'API** : `@Injectable()` SANS `providedIn`, fournis par une
  route sous `remoteRoutes` (aujourd'hui `FOURNISSEURS_DISTANTS` de la route
  racine), héritant de `HttpBaseService`. Un service racine recevrait le
  `HttpClient` du shell, sans jeton ni limiteur. Garde : `modele-aida.test.ts`.
- **Dépendances** : aucune entrée `@angular/*` hors de la liste de
  `imports-partages.test.ts`. Toute NOUVELLE dépendance à l'exécution impose
  de rejouer l'épreuve dans l'hôte PAR DÉFAUT (`ignoreUnusedDeps: true`) :
  c'est ainsi que `rxjs-interop` faisait lever `NG0203`, et une dépendance
  transitive échappe à la garde.
- **Navigation** : liens et navigations RELATIFS ; jamais `/connexion` (ni
  aucun chemin absolu) en dur — le préfixe de montage appartient au shell, et
  la redirection sans session passe par `STRATEGIE_SANS_SESSION`.
- **Ressources et icônes** : tout fichier servi par l'application passe par
  `urlRessourceDistante` (jamais une adresse relative au document, qui viserait
  le shell) ; les icônes sont des SVG en ligne.
- **Racine d'ombre** : rien ne s'affiche hors de la racine — une fenêtre
  modale ou un menu flottant = `<dialog>` natif ou API popover, jamais un
  portail vers `document.body` ni un overlay du CDK. Aucun `rem` dans les
  styles de composant (`gardes-styles.test.ts`) : la taille de police de
  `<html>` appartient au shell. Gardes : `portails-hors-ombre.test.ts`,
  `gardes-styles.test.ts`.
- **Couleurs** : MapLibre et ECharts reçoivent leurs couleurs par
  `CouleursService.palette()` — jamais un hexadécimal recopié, jamais `var()`
  dans une expression `paint`.
- **`<html>`** : ne jamais l'écrire hors du lancement autonome. Tout code qui
  voudrait y poser une classe, un style ou un attribut passe par
  `ECRIRE_HTML` (défaut `false` dans un hôte).
- **Zone** : MapLibre et ECharts sont créés via `NgZone.runOutsideAngular`
  quand une zone existe — indifférent en zoneless, mais cela protège un shell
  qui tournerait encore sous zone.js d'une détection de changement à chaque
  mouvement de souris. Tenu aujourd'hui par `afterNextRender`, qu'Angular
  exécute lui-même via `runOutsideAngular` ; verrouillé par
  `carte.component.spec.ts` et `courbe.component.spec.ts`. Une création qui
  sortirait d'`afterNextRender` devra l'envelopper elle-même.
- **Appels** : au plus 3 appels `HttpClient` simultanés (limiteur) ; le trafic
  de MapLibre y échappe, donc la discipline « bbox = carte visible » reste
  dans le composant de carte.
- **`versEtat`** : toujours appelé en contexte d'injection et HORS de tout
  contexte réactif (`computed`, `effect`, gabarit) — il lève `NG0602` sinon.

### À savoir pour les lots suivants (revue finale du lot 3)

Le module risque Angular est complet ; ce qui suit est ce que les lots 4 et 5
devront tenir pour ne pas le casser.

- **Lot 4 — natures** : React passe les natures de risque au module par la
  prop `typesRisque` du panneau Calques ; Angular les lit dans `etat.natures`
  (A5). Le panneau Calques porté au lot 4 doit ÉCRIRE `natures` dans
  `risque=` (par `ecrireEtatUrl`, une URL React se colle telle quelle) AVANT
  d'ouvrir `risques` — sinon le module s'ouvre sur toutes les natures.
- **Lot 4 — « Voir sur la carte »** (`BoutonVoirCarte.tsx`, A6) : à porter
  avec la couche `ZonesRisqueLayer` de `/map`. Il rendra aussi à l'en-tête sa
  hauteur React, donc le même cadrage initial et le même compte « N sites
  affichés » dans la légende.
- **Lot 4 — Fermer** (A7) : la croix et Échap ramènent aujourd'hui au parent
  RELATIF (l'accueil). Quand `/map` existera, le parent devra être la carte.
- **État** : un seul paramètre `risque`, écrit par le `Router` en
  `replaceUrl` (A2). Ne jamais écrire `history` à la main : dans un hôte, le
  routeur appartient au shell.
- **Cartes** : trois instances MapLibre au plus, jamais démontées entre les
  étapes ; une bascule de thème repeint sans recréer de source. Toute couche
  ajoutée doit suivre la même règle (verrouillée par les specs
  `risque.page`, `carte-codes-postaux`, `carte-campagne`).
- **Écritures en base pendant les vérifications** : uniquement sur un jeu
  jetable « [TEST] … », supprimé en fin de tâche et vérifié par SQL. Les jeux
  `0b7ece33…` et `d9b81560…` servent de référence en lecture seule.
- **Flux NDJSON dans un hôte** : mesuré au lot 3, l'hôte jetable (proxy de
  `ng serve`) ne bufferise pas — la progression avance avant la fin du flux.
  À revérifier dans le VRAI shell AIDA (sa passerelle peut bufferiser) ; le
  repli prévu est un `fetch` dans le service d'API, Bearer posé à la main (A9).
- **Hébergement — message d'erreur réseau** : `messageErreurApi`
  (`angular/src/app/core/http/erreurs.ts`) rend, quand l'API ne répond pas,
  une phrase de DÉVELOPPEMENT (« Le serveur Next.js (npm run dev, port 3000)
  est-il démarré ? »). Dans AIDA, un utilisateur la lirait. À corriger à
  l'étape d'hébergement (message neutre en production) — aucun changement de
  code au lot 3.
