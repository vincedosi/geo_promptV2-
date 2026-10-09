# Lot 6 — Administration en Angular — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Méthode obligatoire de CHAQUE tâche :** le skill personnel `porting-react-to-angular`
> (`~/.claude/skills/porting-react-to-angular/SKILL.md` + `aida-remote-app.md` +
> `reference-angular-21.md`). Lire la source React EN ENTIER (page, composants, hooks, la route
> API appelée quand le format de sa réponse ou de son flux compte), inventorier les briques
> Angular existantes en LISANT leur fichier, ne jamais appeler une API non lue, recenser les
> défauts de React, prouver par captures et chiffres.

**Goal:** Porter en Angular les pages d'administration de MAGELIAN — `/admin/*` (Health check, Qualité des données, Users, Organisations et leur détail, Imports, Connexions API DV360 / TikTok / Meta / The Trade Desk / Logs, Import OOH, Import POI, Import Shapefile, Radio FM/DAB+, Sources) et `/dashboard/iris-crawler` — avec leurs imports à progression (NDJSON, SSE, multipart, lots côté client), rendus et chiffrés comme l'écran React, chaque import rejoué depuis Angular, sans retirer les pages React.

**Architecture:** Toutes les pages admin sont des enfants de `mg-coquille` (comme en React : `AppSidebar` + `MainPadding`), regroupés sous UNE route paresseuse `admin` (`loadChildren` → `features/admin/admin.routes.ts`). Sa route racine porte un cadre (`CadreAdminComponent`) qui résout le rôle UNE fois et n'ouvre son `<router-outlet>` qu'au super_admin — sinon un message, sans navigation (même comportement en autonome et dans un hôte) — ainsi que les services d'API de l'admin et les services d'écran communs (notifications). Chaque page est un composant autonome sous `features/admin/<écran>/`, ses services d'API sous `features/admin/<écran>/data/`. Les flux d'import passent par `HttpClient` (`lignesNdjson`, et un nouveau `lignesSse` pour les deux routes qui émettent `data: …`), donc par le limiteur et le jeton. Les modales deviennent des `<dialog>` natifs dans la racine d'ombre. La logique pure (rôles, version, types, lecteur de Shapefile) est RECOPIÉE (P6) et verrouillée par des tests de parité à la racine.

**Tech Stack:** Angular 21.2.4 (standalone, zoneless, signals, OnPush), Tailwind 4, RxJS 7.8, Vitest (Angular : `ng test` ; racine : `npm run test:unit`), Playwright MCP pour les captures et l'interception des routes destructrices. **Une dépendance d'exécution nouvelle, `proj4`** (arbitrage C10, T14 seulement).

**Spec:** ligne « 6 — Administration » de `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (verbatim : « Pages `/admin/*`, imports avec progression NDJSON » ; livrable : « Chaque import rejoué depuis Angular » ; dépend de : 0, 1 ; « Le lot 6 peut tourner en parallèle des lots 3 à 5 : il ne partage que le socle ») ; les sections « À savoir pour les lots suivants » de la même feuille de route (lots 0, 1, AIDA, 3 — CONTRAIGNANTES) ; `CLAUDE.md` § « Imports & batch DB — Progression OBLIGATOIRE » ; objectif du propriétaire, verbatim : « je veux la même chose que Next.js mais Angular en respectant la doc donnée ». Références de rendu et de comportement : `app/admin/**`, `app/dashboard/iris-crawler/page.tsx`, `components/ui/{confirm-modal,geo-toast,dialog}.tsx`, `ARCHITECTURE.md` (§ « Administration », § Application Angular), `DESIGN_SYSTEM.md`, la doc AIDA (privée, jamais stagée). Modèle de forme : `docs/superpowers/plans/2026-10-04-angular-lot4-carte-principale.md`.

---

## Préalable bloquant (à vérifier AVANT la tâche 1)

- [ ] Le socle (lots 0, 1, AIDA, Rendu) est en place sur la branche de départ : `HttpBaseService`, `lignesNdjson`, `telecharger.ts` (`ENREGISTRER_FICHIER`, `nomDeFichier`), `limiteurInterceptor`, `mg-coquille` et `layout/navigation.ts`, `ui/{entete-page,entete-section,tableau,champ,pastille,kpi,tuile-chiffre,icone,barre-progression}`, `core/format/nombre.ts`, `racine-ombre.ts`. Les LIRE avant d'écrire.
- [ ] **Gel P5 étendu à l'administration** : la feuille de route reçoit, dans le commit de la tâche 1, la mention « Gel de l'administration React (`app/admin/**`, `app/dashboard/iris-crawler/**`, `lib/admin-fetch.ts`) depuis le <date d'ouverture> (P5) ». Les modules purs recopiés qui servent AUSSI l'API (`lib/auth/roles.ts`, `lib/version.ts`, `lib/import/types.ts`, `lib/donnees/registre-fraicheur.ts`, `types/{admin,dsp,campaign}.ts`) ne sont PAS gelés — un correctif d'API doit rester possible — : ils sont tenus par le test de parité de T1, qui échoue et oblige à mettre la copie à jour. Tout correctif urgent côté React est reporté À LA MAIN dans la tâche Angular en cours et cité dans son rapport. `components/ui/{confirm-modal,geo-toast,dialog}.tsx` servent d'autres écrans React : non gelés, mais ce lot porte leur rendu de la date d'ouverture (capturé en T2).
- [ ] **Lot 4 en parallèle** : relire la section « Parallélisme avec le lot 4 » ci-dessous avant CHAQUE tâche qui modifie un fichier partagé.
- [ ] **Sauvegarde** : `scripts/local/10-sauvegarder.sh` est lancé avant la tâche 1 et avant chacune des tâches T11 à T20 (imports et suppressions). La base locale est le SEUL environnement (`CLAUDE.md`) et `emetteur_radio_stations` (569 698 liaisons) n'existe plus nulle part ailleurs.
- [ ] Dossier de chantier : `.superpowers/sdd/2026-10-06-angular-lot6-admin/` (registre `progress.md`, captures, fixtures de flux, rapports de tâche).
- [ ] Un compte `client` (non super_admin) est disponible pour éprouver le refus (C2) : la base locale en porte 2 (relevé du 2026-10-06). Identifiants : mémoire `reference_geomatik_credentials.md` (jamais recopiés) ; à défaut, en créer un jetable en T6.

---

## Parallélisme avec le lot 4 — fichiers partagés et règle de conflit

Le lot 4 (carte principale) avance en même temps sur la branche `feat/angular-lot0` ; ce lot se fait sur sa propre branche et sera rapproché par cherry-pick. Fichiers que LES DEUX lots touchent :

| Fichier | Ce que le lot 4 y fait | Ce que le lot 6 y fait | Règle |
|---|---|---|---|
| `angular/src/app/app.routes.ts` | route `carte` + ses enfants, `risques` → `carte/risques` (T13), services de la carte dans `FOURNISSEURS_DISTANTS` | **UNE ligne**, en T1 : `{ path: 'admin', loadChildren: … }` ajoutée en DERNIER enfant de la route de la coquille | Aucun service admin dans `FOURNISSEURS_DISTANTS` (C3) ; ne jamais réordonner ni reformater ce fichier |
| `angular/src/app/layout/navigation.ts` | « Explorer » → `cible: 'carte'` (fait) ; peut-être « Gestion campagnes » / « Zones custom » au lot 5 | `cible` des 12 entrées des sections « Administration » et « Systeme », une ou deux par tâche | Modifier SEULEMENT la valeur `cible` de la ligne de l'écran porté ; jamais déplacer une ligne |
| `angular/src/app/ui/icone/icones.ts` + `tests/unit/angular/icones-lucide.test.ts` (compte) | icônes du rail, des panneaux, des outils | `triangle-alerte`, `coche`, `loupe` (T2) — et seulement si une tâche en rencontre une autre | Entrées ajoutées EN FIN de table ; au rapprochement, le compte du test = somme des deux ajouts (conflit attendu, résolu à la main) |
| `angular/src/app/remote.spec.ts`, `app.config.spec.ts` | route `carte`, enfant `risques` | route `admin`, refus non super_admin, service admin sous jeton + limiteur | Nouveaux `it(…)` dans un `describe('administration (lot 6)')` À LA FIN du fichier |
| `ARCHITECTURE.md` (§ Application Angular) | une puce par tâche | une puce par tâche | **Une seule puce par tâche, ajoutée À LA FIN de la section « Application Angular »**, préfixée « **Administration (lot 6, T<n>, date)** » ; jamais de réécriture d'une puce existante, sauf la puce « Coquille » (entrées inertes → branchées) en T21 seulement |
| `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` | ligne du lot 4, « À savoir … lot 4 » | ligne du lot 6 (T1, T21), « À savoir … lot 6 » (T21) | Ne toucher QUE la ligne et la section du lot 6 |
| `angular/package.json` + `package-lock.json` | — (B8 : aucune dépendance) | `proj4` (T14, C10) | Le seul ajout de dépendance des deux lots ; au rapprochement, rejouer `npm ci` |
| `angular/src/app/features/catalogue/catalogue.page.{ts,html}` | — | planche des primitives admin (T2) | Section ajoutée en fin de page |

Tout le reste du lot 6 vit dans des fichiers NEUFS : `features/admin/**`, `ui/notifications/**`, `ui/confirmation/**`, `core/http/sse.ts`, `angular/public/logos/**`, `tests/unit/angular/admin-*.test.ts`. Le lot 6 ne modifie AUCUN fichier de `features/carte/**`, `features/risques/**`, `carte/**`, `layout/coquille*` ni `layout/racine-distante*`.

---

## Arbitrages proposés (chef de projet)

| # | Arbitrage | Coût si c'est faux |
|---|---|---|
| C1 | **Routes : `admin/*` enfants de la coquille**, regroupés sous `{ path: 'admin', loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ROUTES_ADMIN) }`. Segments RECOPIÉS de React pour la traçabilité : `admin/health`, `admin/qualite-donnees`, `admin/users`, `admin/organizations`, `admin/organizations/:id`, `admin/imports`, `admin/api` (enfants `dv360`, `meta`, `tiktok`, `ttd`, `logs`, `''` → `dv360` comme `app/admin/api/page.tsx`), `admin/ooh-import`, `admin/import`, `admin/carreaux-import`, `admin/radio`, `admin/sources`. **Exception : `/dashboard/iris-crawler` devient `admin/iris-crawler`** — la page n'appelle que des routes `requireAdmin`, elle doit passer sous le même garde (C2). `admin` seul → `health` (React n'a pas de `/admin`, il répond 404 : écart justifié, une page vide dans un hôte serait pire). | Faible : renommer un segment. |
| C2 | **Garde super_admin, que React n'a pas.** React ne contrôle RIEN côté client : un `client` ouvre `/admin/users`, la page s'affiche et chaque appel répond 401/403 (`requireAdmin` = super_admin strict, `lib/api/middleware.ts:19-23`). Angular : la route racine de `ROUTES_ADMIN` a `canActivate: [roleResoluGuard]` (attend `RoleAdminService.charger()`, RENVOIE TOUJOURS `true`) et `runGuardsAndResolvers: 'always'` ; `CadreAdminComponent` rend son `<router-outlet>` SEULEMENT si `estSuperAdmin()` — sinon « Accès réservé aux super-administrateurs. » (`role="status"`), et si le rôle n'a pu être lu, « Impossible de vérifier vos droits. » + bouton « Réessayer ». **Aucune navigation**, donc le même comportement dans un hôte (l'URL du shell ne bouge pas) et en autonome ; aucune page admin créée, donc aucun appel d'API. Le rôle est relu quand l'identifiant de session change (`AuthService.session()`), jamais à chaque page. Les entrées de la barre latérale restent visibles pour tous (parité : `navigation.ts` le documente, React ne filtre pas). | Faible : retirer le garde rend le comportement de React. |
| C3 | **Services d'API de l'admin fournis par la route `admin` (`FOURNISSEURS_ADMIN` dans `admin.routes.ts`)**, PAS par `FOURNISSEURS_DISTANTS`. L'injecteur de cette route est un enfant de celui de la racine distante : les services y reçoivent le `HttpClient` porteur de nos intercepteurs (prouvé par `remote.spec.ts`, T1). Gagne : zéro conflit avec le lot 4 sur `app.routes.ts`, services chargés avec le chunk admin seulement. Règles de `modele-aida.test.ts` inchangées (`@Injectable()` sans `providedIn`, héritent de `HttpBaseService`). | Faible : déplacer la liste dans `FOURNISSEURS_DISTANTS`. |
| C4 | **Flux par `HttpClient`, jamais `fetch`** : NDJSON (`import-ooh/arcgis`, `radio/import-anfr`, `radio/crawl-arcom`, `radio/import-arcom-ods`, `iris-crawler/manual-import`) par `lignesNdjson` ; **SSE sur POST** (`import-poi/execute`, `campaigns/import` — lignes `data: {…}` séparées par une ligne vide, `text/event-stream`, illisible par `EventSource` qui ne fait que GET) par un nouveau `lignesSse` (`core/http/sse.ts`), même mécanique que `lignesNdjson` (texte cumulé `partialText`, lignes complètes seulement, préfixe `data: ` retiré, toute autre ligne ignorée, ligne illisible ignorée). Corps d'erreur d'un flux refusé (HTTP ≠ 2xx) relu en TEXTE puis `JSON.parse` pour son `error` (patron du lot 3). Repli si une passerelle d'hôte bufferise : celui d'A9 (un `fetch` dans le service, Bearer posé à la main) — non activé tant que non mesuré. | Moyen : si un flux ne progresse pas dans l'hôte réel, activer le repli A9 dans les deux services concernés. |
| C5 | **Progression OBLIGATOIRE (`CLAUDE.md`) même là où React ne l'affiche pas** : React montre un pourcentage pour la radio (champ `percent`) et le Shapefile (lots), mais SEULEMENT un journal pour l'OOH, l'IRIS crawler, l'import DSP et l'import POI. Angular pose `mg-progression-import` (étape nommée, barre, lignes traitées / total, compteurs finaux) sur CHAQUE import, alimentée EXCLUSIVEMENT par des champs que le flux porte déjà (lus dans la route API) ; un flux qui ne porte pas de total donne une barre INDÉTERMINÉE avec le compteur des lignes reçues — jamais un pourcentage inventé (règle du lot 3). Défaut React corrigé, listé dans chaque rapport ; aucune route API modifiée (D4). | Faible : masquer la barre rend le rendu de React. |
| C6 | **Modales en `<dialog>` natif** (`showModal()`, couche supérieure, DANS la racine d'ombre) : `ConfirmModal` (`components/ui/confirm-modal.tsx`, `position: fixed` l.56) → `mg-confirmation` (`ui/confirmation/`) ; modales de `users/page.tsx:199`, `PoiPanel.tsx:261`, `ZoneAdminDeleteDialog.tsx:18`, `Dialog` Radix de `DspPanel.tsx:100` (portail vers `body`) → `<dialog>` propres à l'écran. **Les trois `window.confirm()`** (`import/page.tsx:334`, `organizations/[id]/page.tsx:301`, `:379`) deviennent `mg-confirmation` avec le MÊME texte — écart justifié : la boîte du navigateur bloque le fil du SHELL, ne suit ni le thème ni la langue de l'hôte et n'est pas testable. | Faible. |
| C7 | **Notifications** : `useToast` (`components/ui/geo-toast.tsx`, 4 variantes, titre + message, 4 s, 3 au plus, `position: fixed` en haut à droite l.191) → `NotificationsService` + `mg-notifications` (`ui/notifications/`, génériques), `@Injectable()` sans `providedIn`, **fournis par `CadreAdminComponent`** (détruits avec lui) ; rendus dans une rangée `sticky top-0` de hauteur nulle en tête du cadre, alignés à droite — patron de `mg-chrome-haut` (`ARCHITECTURE.md`, lot Rendu R3) : visibles au défilement, jamais `fixed`. Le service d'annonces du lot 4 (`features/carte/etat/annonce.service.ts`, info seule) n'est PAS touché ; un rapprochement éventuel est noté pour le lot 7. | Faible : le lot 7 fusionne les deux services. |
| C8 | **Téléchargements en blob par `HttpClient`** (patron A8) : l'export CSV d'une source (`sources/page.tsx:215`, `window.open('/api/admin/sources/<id>/export')`) part SANS jeton porteur alors que `requireAdmin` ne lit QUE l'en-tête `Authorization` (`lib/auth.ts:65-66`) → **401 en React** (défaut corrigé, à MESURER au navigateur en T18 et à citer). `window.open('/admin/import', '_self')` (`sources/page.tsx:886`, chemin absolu) → lien RELATIF `../import`. | Nul. |
| C9 | **Couleurs : jetons seulement.** L'admin React écrit environ 260 littéraux (hex et `rgba`) : `rgba(x,y,z,0.1)` des statuts → `color-mix(in srgb, var(--success|--danger|--warning) 10%, transparent)` ; hex qui EST la valeur d'un jeton → ce jeton (`#5b9bd5` = `--info`) ; les autres (palette de journal `#6b7280/#d1d5db/#f59e0b/#ef4444/#22c55e` de `radio/page.tsx`, `#06b6d4` et `#22c55e` des tuiles de `sources/page.tsx:421-422`, …) → le jeton sémantique le plus proche (`--text-tertiary`, `--text-secondary`, `--warning`, `--danger`, `--success`, `--info`), chaque substitution listée au rapport comme écart restant justifié. **Aucun jeton créé** (éviter `app/globals.css` et `jetons.css`, que la parité verrouille et que le lot 4 peut toucher). | Faible : un jeton dédié s'ajoute plus tard dans les deux fichiers. |
| C10 | **`proj4` devient une dépendance d'exécution** pour l'import Shapefile (`carreaux-import/_lib/shapefile.ts:10,186-197` : reprojection Lambert 93 / LAEA → WGS84 DANS le navigateur, avant tout envoi). Alternatives écartées : réécrire LCC/LAEA à la main (erreur de projection silencieuse sur 2,3 M de carreaux), ou reprojeter côté serveur (change l'API, D4). Version ÉPINGLÉE à celle que résout la racine (`package-lock.json`, `^2.11` déclaré), chargée en `import()` DYNAMIQUE depuis le seul écran Shapefile (hors paquet initial, mesuré au build). Règle de la feuille de route : **épreuve AIDA rejouée dans l'hôte PAR DÉFAUT** en T14 (dépendances transitives `wkt-parser`, `mgrs` invisibles à la garde des imports partagés). | Moyen : si l'épreuve échoue, le lecteur Shapefile reste en React jusqu'au lot 7. |
| C11 | **OAuth DV360 / TikTok** : « Connecter Google / TikTok » fait une navigation de PREMIER NIVEAU vers l'URL de consentement rendue par `oauth/start` (React : `window.location.href = json.url`, `dv360/page.tsx:139`) — inévitable pour un consentement tiers, y compris dans un hôte (le shell est quitté puis repris), faite par `DOCUMENT.defaultView.location.assign` derrière un jeton `NAVIGUER_HORS_APPLICATION` (couture de test). Le retour est décidé par l'API, inchangée (D4) : `oauth/callback` redirige vers `${NEXT_PUBLIC_APP_URL}/admin/api/<fournisseur>?oauth=…` (`app/api/admin/dsp/dv360/oauth/callback/route.ts:12-14`), c'est-à-dire la page REACT. Angular lit `oauth`/`reason` dans `ActivatedRoute` (jamais `window.location`) pour afficher la même notification quand il est atteint avec ces paramètres, puis les retire (`replaceUrl`, relatif). Re-cibler le retour vers Angular relève du lot 7 (noté en « À savoir »). DV360 est EN PAUSE (droits Google) : la preuve s'arrête à l'URL de consentement reçue. | Faible. |
| C12 | **Écrans qui écrivent ou effacent : trois régimes de preuve**, fixés écran par écran dans chaque tâche — (a) **écriture réelle sur jetable** `[ESSAI lot 6] …` (utilisateur, organisation, membre, catégorie POI, POI, source issue d'un import POI jetable, table de carreaux jetable, campagne DSP jetable, zone custom jetable), supprimée en fin de tâche et vérifiée par SQL ; (b) **pré-vol réel, geste final intercepté** : `DELETE /api/radio/data` avec `confirm: false` rend les comptes (sans risque) ; avec `confirm: true` la requête est INTERCEPTÉE (Playwright `page.route` → réponse factice), son corps vérifié ; (c) **entièrement intercepté** par une fixture rejouée aux DEUX écrans (React et Angular, même fixture, même rendu de progression) : imports radio ANFR (`archive_and_purge_radio`), crawl Arcom, ODS Arcom, `DELETE /api/admin/iris/delete` (TOUTES les données IRIS), `POST /api/admin/trigger-pmtiles` (workflow GitHub), `POST /api/iris-crawler/manual-import` (`update_iris_core_batch` réécrit `iris`), `POST /api/admin/import-ooh/arcgis` (sources réelles : appels ArcGIS + upsert de `panneaux_affichage`) et son `DELETE` d'historique. Les fixtures sont écrites d'après le code de la route (forme EXACTE des événements), rangées sous `tests/fixtures/admin/` et réutilisées par les specs. Comptes SQL relevés avant / après chaque tâche (bloc « Chiffres de référence ») : égaux, hors jetables. | Moyen : une fixture fausse prouverait un rendu sur un flux qui n'existe pas — d'où l'obligation de la dériver du code de la route et de la citer. |
| C13 | **Abonnement d'un import tenu jusqu'au bout** : se désabonner d'un `HttpClient` ANNULE la requête, et l'annulation d'un `ReadableStream` côté Next peut interrompre l'import au milieu — un import à moitié écrit. React ne coupe rien (le lecteur continue après démontage). Angular : un flux d'import n'est JAMAIS désabonné par `DestroyRef` ; la destruction pose seulement un drapeau qui fait ignorer la suite (même décision que la simulation du lot 3). Les LECTURES (listes, stats) restent annulées à la destruction (`versEtat` ou `DestroyRef.onDestroy`). | Faible. |
| C14 | **Journal d'import** (`ImportLogPanel.tsx`, journal radio `radio/page.tsx:459-518`, journaux OOH / IRIS crawler / Shapefile) → `mg-journal` (`features/admin/commun/`) : lignes horodatées, niveau, filtre par niveau et compteurs (radio), « Copier » (`navigator.clipboard`, autorisé : aucune écriture dans le DOM du shell), défilement automatique par **`conteneur.scrollTop = conteneur.scrollHeight`** — JAMAIS `scrollIntoView` (React l'emploie, `radio/page.tsx:338`, `import/page.tsx:249`) : dans un hôte, `scrollIntoView` fait défiler aussi la page du SHELL. Défaut objectif corrigé, listé. | Nul. |
| C15 | **Logos de fournisseurs** (`/logos/{dv360,meta,tiktok,ttd}.svg`, servis par Next depuis `public/`) copiés à l'octet dans `angular/public/logos/` et chargés par `urlRessourceDistante('logos/<p>.svg')` (contrat AIDA : aucune adresse relative au document). Le test de parité de T9 compare les octets des deux copies. | Nul. |
| C16 | **Pas de refactor de l'admin React en passant.** Chaque écran garde SA mise en page (les pages React ont chacune leur `C`, leurs cartes et leurs boutons, légèrement différents) : on porte le rendu MESURÉ, pas une harmonisation. Une primitive de `features/admin/commun/` n'existe que si deux écrans au moins l'utilisent au pixel près (vérifié par capture) ; sinon elle reste dans l'écran. Les textes sont recopiés tels quels, fautes et anglicismes compris (« Health check », « Users », « Qualite des donnees » dans la barre). Exception listée : les exemples de marque de `organizations/page.tsx:268` (« BMW France », « Mercedes ») sont gardés (parité) et signalés au propriétaire (règle mémoire « pas d'exemple de marque ») — à trancher, pas à corriger en silence. | Faible. |
| C17 | **Formats de nombre** : `toLocaleString('fr-FR')` et `formaterNombre` → `core/format/nombre.ts` (`formaterNombre`, même sortie, verrouillé par `format-paritaire.test.ts`) ; les constructions littérales (`(n / 1_000_000).toFixed(2) + 'M'`, `sources/page.tsx:420`) recopiées telles quelles ; `fmtBytes` / `fmtTime` (`carreaux-import/_components/shared.ts:45-58`) recopiés dans `features/admin/logique/formats.ts` avec test de parité. | Nul. |

---

## Global Constraints

Repris du lot 4 (`2026-10-04-angular-lot4-carte-principale.md` § Global Constraints) et des règles de chantier de la feuille de route — ils valent pour CHAQUE tâche :

- Angular **21.2.4** exact ; **une seule dépendance nouvelle**, `proj4`, en T14 (C10). Pas de `zod`, pas de `ngx-*`, pas du CDK Overlay, pas de bibliothèque de tableaux ni de formulaires réactifs hors `@angular/forms` (et `@angular/forms` reste interdit hors `features/connexion/` par `imports-partages.test.ts` : formulaires en signaux + `(input)`/`(change)`, comme le reste de l'application).
- À l'exécution, imports `@angular/*` limités à `core`, `common`, `common/http`, `router`, `platform-browser` (garde `imports-partages.test.ts`) — **jamais `@angular/core/rxjs-interop`**. Désabonnement explicite par `DestroyRef.onDestroy`, ou `versEtat` (hors contexte réactif) ; exception des flux d'import : C13.
- Services d'API : `*.api.ts`, `@Injectable()` **sans `providedIn`**, héritent de `HttpBaseService`, n'écrivent jamais `HttpClient` (garde `modele-aida.test.ts`), fournis par `FOURNISSEURS_ADMIN` (C3). Dossiers d'accès aux données sous `angular/src/**/data/`.
- Rien dans `angular/` n'importe hors d'`angular/` (garde `isolement.test.ts`).
- Racine d'ombre : interdits `position: fixed`, `document.body`, `querySelector('body')`, `appendTo: 'body'`, CDK Overlay, `::ng-deep`, `ViewEncapsulation.None` (garde `portails-hors-ombre.test.ts`) ; aucun `rem` dans un style de composant (`gardes-styles.test.ts`) ; `<html>` jamais écrit (`ECRIRE_HTML`) ; aucun écouteur sur `window`/`document` du shell ; jamais `scrollIntoView` (C14) ; jamais `window.confirm`/`alert`/`prompt` (C6). Modales : `<dialog>` (C6). Les `<style>` de React (`health/page.tsx:200`, animations `spin`/`pulse`) passent dans les `styles` du composant (confinés).
- Couleurs : jetons de `styles/jetons.css`, jamais un hexadécimal ni un `rgba` littéral (C9).
- Liens et navigations RELATIFS (`routerLink="../organizations"`, `router.navigate(['..', id], { relativeTo })`) ; ressources par `urlRessourceDistante` ; jamais `window.location` (sauf C11, derrière son jeton).
- Composants : préfixe `mg`, OnPush, `input()`/`output()`/`model()`, `@if`/`@for (… ; track id)`, `inject()`, `protected` pour le gabarit, `readonly` pour les entrées. Pas de méthode appelée dans le gabarit (→ `computed`). Un `input()` ne s'appelle jamais `style`, `class`, `id`, `title`, `hidden`, `role`. `button[mgPastille]` fixe `type="button"` : un vrai bouton de soumission dans un `<form>` ne l'emploie pas (réserve du lot 1).
- Bords 0,5 px, sentence case (sauf textes recopiés de React, C16), Inter + JetBrains Mono, flat total.
- **Règles d'I/O de `CLAUDE.md`, côté Angular** : au plus 3 appels `HttpClient` simultanés (`limiteurInterceptor`, ne PAS le contourner — un flux d'import occupe une place pendant toute sa durée : voulu, et le dire au rapport quand une page en lance un pendant que d'autres lectures attendent) ; chargement à la demande par onglet (`sources/page.tsx:170-174`, `radio/page.tsx:336-337` : un onglet non ouvert ne lit rien) ; **cache avant appel** (organisations, rôles, catégories POI, statistiques de sources : une fois par écran) ; jamais de « tout vérifier » sur Qualité des données (une vérification par clic, `qualite-donnees/page.tsx`, quota 2/min) ; lots d'envoi du Shapefile à 1 000 lignes comme React (la règle « 50 par lot » vaut pour les inserts SERVEUR, que `import-geo` applique déjà) ; aucune liste illimitée envoyée au serveur.
- **Écritures en base pendant les vérifications** : régimes de C12 uniquement. Les 5 profils, 4 organisations, 5 sources, 8 campagnes DSP, 7 zones custom, 9 catégories POI existants servent de référence en LECTURE seule. Sauvegarde avant T1 et T11-T20 (préalable).
- **Critère de sortie de toute tâche d'affichage** : captures React (`http://localhost:3000/admin/...`) et Angular (`http://localhost:4200/app/admin/...`) du même écran, 1440 × 900, même état, **deux thèmes**, rangées dans `.superpowers/sdd/2026-10-06-angular-lot6-admin/` sous `<tache>-<ecran>-<etat>-<theme>-{react,angular}.png`, plus survol / focus clavier / désactivé / chargement / erreur / vide quand la tâche les nomme, et pour un import : début, milieu (progression partielle) et fin ; **chiffres identiques** à React (formatage `fr-FR`) ; tableau « identifiant → corrigé / écart restant justifié » et liste des défauts React corrigés dans le rapport.
- Serveurs : racine `npm run dev` (:3000), Angular `cd angular && npm start` (:4200, routes sous `/app`). Arrêter l'arbre complet des serveurs en fin de tâche (zombies `next dev` sous Windows).
- Après chaque tâche : `cd angular && npx ng test --watch=false` et `npm run build` verts sans nouvel avertissement ; racine `npx tsc --noEmit` (code de retour lu DIRECTEMENT, jamais derrière un pipe) et `npm run test:unit` verts.
- `ARCHITECTURE.md` mis à jour dans le commit de chaque tâche (règle de la section « Parallélisme »). Commits atomiques `type: description`, terminés par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. **Ne jamais pousser** ; ne jamais stager la doc AIDA.

## Review Focus

- **Un non-super_admin n'atteint aucune page admin et ne déclenche aucun appel.** Compte `client`, autonome ET hôte : chaque entrée Administration / Systeme de la barre → message, URL inchangée côté hôte, onglet Réseau vide de `/api/admin`, `/api/radio`, `/api/iris-crawler`. Test : T1 (`cadre-admin.component.spec.ts`, `remote.spec.ts`).
- **Un import interrompu ne laisse pas un état faux.** Quitter la page pendant un flux : la requête N'EST PAS annulée (C13) ; revenir : la page repart vide comme React (pas de faux « terminé »). Un flux qui se termine sans événement final → « Le flux s'est interrompu avant la fin. » (règle du lot 3), jamais une barre à 100 %. Tests : T2 (`lignesSse`), chaque tâche d'import (spec « flux tronqué »).
- **La progression ne ment pas.** Une barre déterminée n'existe que si le flux porte un total ; sinon indéterminée + compteur (C5). Test : spec de `mg-progression-import` (T2) et de chaque import.
- **Rien d'irremplaçable n'est effacé.** Comptes SQL avant / après de `emetteur_radio_stations` (569 698), `iris` (49 448), `panneaux_affichage` actifs (1 434), `poi_france` (390 029), `data_sources` (5) à chaque tâche T11-T20. Test : C12 + bloc de commandes ci-dessous, relevé dans chaque rapport.
- **Téléchargement et OAuth** : export CSV d'une source téléchargé avec son nom de fichier (C8, 401 constaté côté React) ; OAuth qui part vers l'URL rendue et ne casse pas l'hôte (C11). Tests : T18, T9.

---

## Inventaire : React → Angular

Racine Angular : `angular/src/app/features/admin/` (abrégé `A/`). Lignes mesurées le 2026-10-06 (`wc -l`), 13 139 au total.

| Fichier React | Lignes | Routes API appelées (méthode) | Particularités | Cible Angular | Tâche |
|---|---|---|---|---|---|
| — (aucun équivalent React) | — | `profiles` via `AuthService.lireRole()` | garde absent en React (C2) | `A/admin.routes.ts`, `A/cadre-admin.component.ts`, `A/etat/role-admin.service.ts` | T1 |
| `lib/admin-fetch.ts` | 56 | — | Bearer + `Content-Type: application/json` sauf `FormData` | rien : `HttpBaseService` + `jetonInterceptor` | T1 |
| `components/ui/confirm-modal.tsx` | 173 | — | `position: fixed` (l.56), variante `danger`, « En cours... » | `ui/confirmation/confirmation.component.ts` (`<dialog>`) | T2 |
| `components/ui/geo-toast.tsx` | 202 | — | 4 variantes, 4 s, 3 au plus, `fixed` (l.191) | `ui/notifications/{notifications.service,notifications.component}.ts` | T2 |
| `app/admin/import/_components/ImportLogPanel.tsx` + journal de `radio/page.tsx:459-518` | 94 + 60 | — | `scrollIntoView` (C14) | `A/commun/journal.component.ts` | T2 |
| `app/admin/health/page.tsx` | 596 | `GET /api/admin/health` | onglets Système / Fraîcheur, `APP_VERSION`/`BUILD_DATE`, barre de taille de base, `<style>` d'animations | `A/health/health.page.{ts,html}`, `A/health/data/health.api.ts` | T3 |
| `app/admin/health/_components/FraicheurPanel.tsx` | 419 | `GET`, `POST /api/admin/fraicheur-donnees` (léger / lourd, quotas 6/min et 1/min) | coût annoncé AVANT le clic | `A/health/fraicheur.component.ts`, `A/health/data/fraicheur.api.ts` | T4 |
| `app/admin/qualite-donnees/page.tsx` | 444 | `GET`, `POST /api/admin/qualite-donnees` (quota 2/min) | une vérification à la fois, « jamais lancée » ≠ « rien à signaler » | `A/qualite-donnees/qualite-donnees.page.{ts,html}`, `data/qualite.api.ts` | T5 |
| `app/admin/users/page.tsx` | 301 | `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/[id]`, `GET /api/admin/organizations`, `GET /api/admin/roles` | modale `fixed` (l.199), lien d'initialisation copié (l.223) | `A/users/users.page.{ts,html}`, `data/users.api.ts` | T6 |
| `app/admin/organizations/page.tsx` | 292 | `GET/POST /api/admin/organizations` | `router.push` absolu (l.214) | `A/organizations/organizations.page.{ts,html}`, `data/organisations-admin.api.ts` | T7 |
| `app/admin/organizations/[id]/page.tsx` | 740 | `GET/PATCH /api/admin/organizations/[id]`, `POST/PATCH/DELETE …/members`, `POST …/members/reset-password`, `PATCH/DELETE …/sources`, `POST/DELETE …/sources/assign`, `GET /api/admin/sources-stats` | 2 `window.confirm` (C6), `ROLES` inversés (`lib/auth/roles.ts`) | `A/organizations/organisation.page.{ts,html}` | T8 |
| `app/admin/api/layout.tsx` + `page.tsx` + `_lib/constants.ts` + `_components/ProviderPlaceholder.tsx` + `meta/page.tsx` + `ttd/page.tsx` | 48+5+34+26+4+4 | — | onglets par `Link`, logos `/logos/*.svg` (C15) | `A/api/connexions-api.page.ts` (cadre + onglets), `A/api/fournisseur-a-venir.component.ts` | T9 |
| `app/admin/api/dv360/page.tsx` | 423 | `GET /api/admin/dsp/connections`, `GET …/dv360/config`, `POST/DELETE …/dv360/connect` (`?scope=full`), `POST …/dv360/oauth/config`, `POST …/dv360/oauth/start`, `POST …/dv360/test`, `GET /api/admin/dsp/logs?provider=dv360&limit=20` | `window.location` (C11), `ConfirmModal` | `A/api/dv360.page.{ts,html}`, `A/api/data/dsp.api.ts` | T9 |
| `app/admin/api/tiktok/page.tsx` | 322 | mêmes familles pour `tiktok` | idem | `A/api/tiktok.page.{ts,html}` | T10 |
| `app/admin/api/logs/page.tsx` | 77 | `GET /api/admin/dsp/logs` (`?errors_only`) | — | `A/api/journal-dsp.page.ts` | T10 |
| `app/admin/imports/page.tsx` | 192 | `GET /api/admin/imports` | filtres locaux | `A/imports/imports.page.{ts,html}`, `data/imports.api.ts` | T11 |
| `app/admin/ooh-import/page.tsx` | 325 | `GET`, `POST` (NDJSON), `DELETE /api/admin/import-ooh/arcgis` | `replace` (efface la source), source personnalisée | `A/ooh-import/ooh-import.page.{ts,html}`, `data/ooh-import.api.ts` | T11 |
| `app/admin/import/page.tsx` + `_components/{UploadStep,CategoryStep,MappingStep,ColumnSelectionStep,shared,styles}.tsx` | 586+188+119+181+209+60+134 | `GET /api/admin/organizations`, `GET/POST /api/admin/poi-categories`, `POST /api/admin/import-poi/parse` (multipart, plusieurs fichiers) | glisser-déposer, Shapefile en bundle | `A/import/import-poi.page.{ts,html}`, `A/import/etapes/{depot,categorie,correspondance,colonnes}.component.ts`, `data/import-poi.api.ts` | T12 |
| `app/admin/import/_components/{GeocodeStep,DryRunStep,ImportStep}.tsx` + reste de `page.tsx` | 379+118+194 | `POST /api/admin/geocode/batch`, `POST /api/admin/geocode/update`, `POST /api/admin/import-poi/dry-run`, `POST /api/admin/import-poi/execute` (**SSE**) | `window.confirm` (C6), journal (C14) | `A/import/etapes/{geocodage,essai,import}.component.ts` | T13 |
| `app/admin/carreaux-import/page.tsx` + `_components/{Stepper,FilesStep,MappingStep,ImportStep,shared}.tsx` + `_lib/shapefile.ts` | 502+77+267+382+306+62+216 | `POST /api/admin/import-geo` (lots de 1 000, demi-lot sur 413), `POST /api/admin/import-geo/register` | lecture `.shp/.dbf/.prj/.shx` dans le navigateur, `proj4` (C10), chronomètre `setInterval` | `A/carreaux-import/carreaux-import.page.{ts,html}`, `etapes/{fichiers,correspondance,envoi}.component.ts`, `A/logique/shapefile.ts`, `data/import-geo.api.ts` | T14 |
| `app/dashboard/iris-crawler/page.tsx` | 294 | `POST /api/iris-crawler/manual-upload` (multipart), `POST /api/iris-crawler/manual-import` (NDJSON) | réécrit `iris` (C12 c) | `A/iris-crawler/iris-crawler.page.{ts,html}`, `data/iris-crawler.api.ts` | T15 |
| `app/admin/radio/page.tsx` (onglet Import, danger zone, l.1-597 et 899-916) | ~640 | `GET /api/radio/stats`, `GET /api/radio/imports-history`, `GET /api/radio/import-logs/[logId]`, `POST /api/radio/import-anfr` (NDJSON), `POST /api/radio/crawl-arcom` (NDJSON), `POST /api/radio/import-arcom-ods` (multipart + NDJSON), `DELETE /api/radio/data` (`confirm` false puis true) | ⚠ `app/api/radio/data/route.ts` n'est PAS suivi par git (`.gitignore:45`) — il n'existe que sur le poste ; journal filtrable | `A/radio/radio.page.{ts,html}`, `A/radio/onglet-import.component.ts`, `data/radio-admin.api.ts` | T16 |
| `app/admin/radio/page.tsx` (onglets Radios et Stats, l.598-898) | ~300 | `GET /api/radio/stations?…` (recherche, non matchées, pagination), `GET /api/radio/audit` | chargé à l'ouverture de l'onglet | `A/radio/{onglet-radios,onglet-stats}.component.ts` | T17 |
| `app/admin/sources/page.tsx` (cadre, onglets, « Toutes », liste et détail, bloc radio) + `_lib/{theme,styles,types}.ts` + `_components/ui.tsx` | 928+40+105+73+56 | `GET /api/admin/sources`, `GET /api/admin/organizations`, `GET /api/admin/sources-stats`, `GET /api/radio/stats`, `GET /api/admin/transport-stats`, `POST …/sources/[id]/summary`, `PATCH/DELETE /api/admin/sources/[id]`, `GET …/[id]/meta-keys`, `GET …/[id]/export` (C8) | 9 onglets, chargement par onglet | `A/sources/sources.page.{ts,html}`, `A/sources/{liste-sources,detail-source}.component.ts`, `data/sources-admin.api.ts` | T18 |
| `app/admin/sources/_components/{OohPanel,CarreauxPanel,TransportPanel,IrisPanel,PoiPanel}.tsx` + `_hooks/{useIrisAdmin,usePoiAdmin}.ts` | 122+53+192+431+319+171+149 | `GET /api/admin/iris/{stats,metadata}`, `POST /api/admin/iris/metadata`, `POST /api/admin/sync-iris-system`, `POST /api/admin/trigger-pmtiles`, `DELETE /api/admin/iris/delete`, `GET /api/admin/poi-samples`, `POST/PUT/DELETE /api/admin/poi-manage` (`?id=`, `?cat=`) | modale POI `fixed` (C6) ; suppressions sans lecture de la réponse (`usePoiAdmin.ts:123,133`, défaut React) | `A/sources/panneaux/{ooh,carreaux,transport,iris,poi}.component.ts` | T19 |
| `app/admin/sources/_components/DspPanel.tsx` + `_hooks/useDspImport.ts` + `_components/CustomZonesTab/*` + `_hooks/useAdminCustomZones{,Stats}.ts` | 206+154+496+108 | `GET /api/admin/campaigns`, `POST /api/admin/campaigns/import` (multipart + **SSE**), `DELETE /api/admin/campaigns/[id]`, `GET /api/admin/custom-geo/{list,stats}`, `DELETE /api/admin/custom-geo/[id]` | `Dialog` Radix (portail), dialogue de suppression `fixed`, compteur `fixed` (`CustomZonesTab/index.tsx:134`) | `A/sources/panneaux/{dsp,zones-custom}.component.ts` | T20 |

Logique pure recopiée (P6) dans `A/logique/` — chaque fichier porte en tête « Copie de `<chemin React>` (gel P5 du <date>) ; parité : `<test>` » :

| Source React | Copie | Ce qui change | Tâche |
|---|---|---|---|
| `lib/auth/roles.ts` (`ROLE_LEVELS`, `ROLE_LABELS`, `ROLES`, `ROLES_MEMBRE`) | `A/logique/roles.ts` | sans `RoleSchema`/`RoleMembreSchema` (pas de Zod, A12) ; `UserRole` déclaré localement | T1 |
| `lib/version.ts` (`APP_VERSION`, `BUILD_DATE` seuls) | `A/logique/version.ts` | constantes seules — le test échoue à chaque incrément React, c'est voulu | T1 |
| `types/admin.ts`, `types/dsp.ts`, `types/campaign.ts` (ce que l'admin importe), `lib/import/types.ts`, `lib/donnees/registre-fraicheur.ts` (`NatureSource`, `EtatFraicheur` seuls) | `A/logique/types/{admin,dsp,campagne-import,import-poi,fraicheur}.ts` | types seuls ; parité par ASSIGNABILITÉ mutuelle vérifiée par `tsc` racine (bloc `type _Verif…` du test) | T1 |
| `app/admin/carreaux-import/_components/shared.ts` (`fmtBytes`, `fmtTime`) | `A/logique/formats.ts` | — | T1 |
| `app/admin/import/_components/shared.tsx` (`GEO_MODES`, `GENESIS_FIELDS_POI`), `styles.ts` (`statusColor`, `statusLabel` — logique seule) | `A/import/logique/constantes.ts` | couleurs → noms de jeton | T12 |
| `app/admin/api/_lib/constants.ts` (`PROVIDERS`) | `A/api/logique/fournisseurs.ts` | `logo` → `logos/<p>.svg` relatif (C15) | T9 |
| `app/admin/carreaux-import/_lib/shapefile.ts` | `A/logique/shapefile.ts` | import de `proj4` passé en paramètre (`reprojectCoords(ring, crs, proj4)`) pour permettre l'`import()` dynamique ; mêmes sorties | T14 |
| `app/admin/sources/_lib/theme.ts` (`SCHEMA_FILTER_COLS`) | `A/sources/logique/constantes.ts` | couleurs retirées (jetons) | T18 |

Routes API consommées (aucune n'est modifiée, D4) : celles de la colonne « Routes API » ci-dessus. Familles d'authentification : TOUTES lisent le Bearer (`requireAdmin` / `requireAuth`) ; `/api/admin`, `/api/iris-crawler`, `/api/radio` passent AUSSI le filtre cookie du middleware — le jeton ET le cookie voyagent déjà avec `HttpClient` (lot 0, tâche 3).

---

## Chiffres de référence (base locale, mesurés le 2026-10-06)

À REMESURER au début de chaque tâche qui les cite, et AVANT / APRÈS chaque tâche T11-T20 (C12) :

```bash
MSYS_NO_PATHCONV=1 docker exec supabase_db_genesis_app psql -U postgres -At -c "
select 'profiles', count(*) from profiles
union all select 'super_admin', count(*) from profiles where role='super_admin'
union all select 'client', count(*) from profiles where role='client'
union all select 'organizations', count(*) from organizations
union all select 'data_sources', count(*) from data_sources
union all select 'dsp_campaigns', count(*) from dsp_campaigns
union all select 'dsp_connections', count(*) from dsp_connections
union all select 'dsp_api_logs', count(*) from dsp_api_logs
union all select 'iris', count(*) from iris
union all select 'iris_import_history', count(*) from iris_import_history
union all select 'poi_france', count(*) from poi_france
union all select 'poi_categories', count(*) from poi_categories
union all select 'panneaux_actifs', count(*) from panneaux_affichage where actif
union all select 'import_runs_ooh', count(*) from import_runs_ooh
union all select 'emetteurs', count(*) from emetteurs_radio
union all select 'radios', count(*) from radios
union all select 'liaisons_radio', count(*) from emetteur_radio_stations
union all select 'radio_imports_log', count(*) from radio_imports_log
union all select 'custom_geo_zones', count(*) from custom_geo_zones
union all select 'qualite_releves', count(*) from qualite_releves;"
```

| Grandeur | Valeur | Où la relire côté écran |
|---|---|---|
| Profils / super_admin / client | **5 / 3 / 2** | Users (liste) ; C2 éprouvé avec un `client` |
| Organisations | **4** | Organisations ; sélecteurs d'organisation (Users, Import POI, Sources) |
| Sources de données | **5** (poi 3, carreaux 1, panneaux 1) | Sources › « Toutes », liste des sources |
| Campagnes DSP | **8** | Sources › DSP |
| Connexions DSP / journaux DSP | **1 / 24** | Connexions API › DV360, Logs |
| IRIS / historique d'imports IRIS | **49 448 / 8** | Sources › IRIS ; Sources › « Toutes » (tuile IRIS) |
| POI / catégories POI | **390 029 / 9** | Sources › POI ; Import POI › catégorie |
| Panneaux OOH actifs / runs d'import OOH | **1 434 / 1** | Sources › OOH ; Import OOH › historique |
| Émetteurs / radios / liaisons / journaux d'import radio | **12 704 / 1 175 / 569 698 / 26** | Radio › Import (stats), historique ; Sources › Radio |
| Zones custom | **7** | Sources › Zones custom |
| Relevés de qualité | **3** | Qualité des données (relevés persistés) |
| `APP_VERSION` / `BUILD_DATE` | **7.19.0 / 2026-04-28** (`lib/version.ts:11-12`) | Health check, en-tête |

Reproduire un état React : `http://localhost:3000/admin/<écran>` ; Angular : `http://localhost:4200/app/admin/<écran>` (IRIS crawler : React `/dashboard/iris-crawler`, Angular `/app/admin/iris-crawler`).

---

## Structure de fichiers Angular

```
angular/src/app/
├── core/http/sse.ts (+ spec)                 # lignesSse (C4)
├── ui/
│   ├── notifications/                        # NotificationsService + mg-notifications (C7)
│   └── confirmation/                         # mg-confirmation, <dialog> (C6)
└── features/admin/
    ├── admin.routes.ts                       # ROUTES_ADMIN, FOURNISSEURS_ADMIN (C1, C3)
    ├── cadre-admin.component.ts              # garde par rendu (C2), notifications
    ├── etat/role-admin.service.ts            # rôle lu une fois par session
    ├── commun/                               # journal (C14), progression-import (C5), depot-fichiers, onglets,
    │                                         # carte-admin, bouton-admin — seulement si ≥ 2 écrans (C16)
    ├── logique/                              # copies pures (P6) + types
    ├── health/          (page, fraicheur, data/)
    ├── qualite-donnees/ (page, data/)
    ├── users/           (page, data/)
    ├── organizations/   (liste, détail, data/)
    ├── imports/         (page, data/)
    ├── api/             (cadre + onglets, dv360, tiktok, journal-dsp, fournisseur-a-venir, logique/, data/)
    ├── ooh-import/      (page, data/)
    ├── import/          (page, etapes/, logique/, data/)
    ├── carreaux-import/ (page, etapes/, data/)
    ├── iris-crawler/    (page, data/)
    ├── radio/           (page, onglet-import, onglet-radios, onglet-stats, data/)
    └── sources/         (page, liste-sources, detail-source, panneaux/, logique/, data/)
angular/public/logos/{dv360,meta,tiktok,ttd}.svg   # C15
tests/unit/angular/admin-logique-paritaire.test.ts
tests/fixtures/admin/*.ndjson|*.sse               # flux rejoués (C12 c)
```

---

### Task 1: Socle admin I — route, garde super_admin, services de la route, copies pures, gel

**Files:**
- Create: `A/admin.routes.ts`, `A/cadre-admin.component.ts` (+ spec), `A/etat/role-admin.service.ts` (+ spec), `A/logique/{roles,version,formats}.ts`, `A/logique/types/{admin,dsp,campagne-import,import-poi,fraicheur}.ts`, `core/http/sse.ts` (+ spec), `tests/unit/angular/admin-logique-paritaire.test.ts`
- Modify: `angular/src/app/app.routes.ts` (UNE ligne, C1), `angular/src/app/remote.spec.ts`, `angular/src/app/app.config.spec.ts` (bloc `describe('administration (lot 6)')` en fin de fichier), `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (ligne lot 6 : gel P5), `ARCHITECTURE.md` (une puce en fin de section)

**Sources React :** `lib/admin-fetch.ts:1-56` (en-têtes posés), `lib/api/middleware.ts:19-23` (`requireAdmin` = super_admin strict), `lib/auth/roles.ts:1-36`, `lib/version.ts:11-12`, `types/{admin,dsp,campaign}.ts`, `lib/import/types.ts:1-264`, `lib/donnees/registre-fraicheur.ts:28,303`, `app/admin/carreaux-import/_components/shared.ts:45-58`, `app/api/admin/import-poi/execute/route.ts:35-37` et `app/api/admin/campaigns/import/route.ts:166,463` (forme SSE : `data: <json>\n\n`). Briques Angular à LIRE : `app.routes.ts`, `core/auth/{auth.service,auth.guard,strategie-sans-session}.ts`, `layout/racine-distante.component.ts` (patron du message « Session requise… »), `core/http/ndjson.ts` (+ spec), `core/etat/vers-etat.ts`.

**Interfaces — Produces :**

```ts
// core/http/sse.ts — même contrat que lignesNdjson (texte cumulé, lignes complètes, reste à la fin).
export function lignesSse<T>(evenements: Observable<HttpEvent<string>>): Observable<T>;
// Seules les lignes `data: …` sont lues (préfixe retiré, JSON.parse) ; lignes vides, `event:`,
// `id:`, commentaires `:` ignorés ; une ligne illisible est ignorée sans couper le flux.

@Injectable()
export class RoleAdminService {
  /** 'chargement' | 'super_admin' | 'refuse' | 'erreur' — relu quand l'identifiant de session change. */
  readonly etat: Signal<'chargement' | 'super_admin' | 'refuse' | 'erreur'>;
  /** Idempotent tant que la session ne change pas ; jamais plus d'une lecture de `profiles` en vol. */
  charger(): Promise<void>;
  reessayer(): Promise<void>;
}

export const roleResoluGuard: CanActivateFn; // attend charger(), rend TOUJOURS true (C2)
export const FOURNISSEURS_ADMIN: Provider[];  // RoleAdminService + services d'API ajoutés tâche par tâche
export const ROUTES_ADMIN: Routes;
```

`ROUTES_ADMIN` (enfants ajoutés tâche par tâche ; T1 ne pose que le cadre, `''` → `health` et une page provisoire `health` « Disponible prochainement » remplacée en T3) :

```ts
export const ROUTES_ADMIN: Routes = [
  {
    path: '',
    component: CadreAdminComponent,
    providers: FOURNISSEURS_ADMIN,
    canActivate: [roleResoluGuard],
    runGuardsAndResolvers: 'always',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'health' },
      // T3 … T20 : { path: 'health', loadComponent: … }, …
    ],
  },
];
```

Ligne de `app.routes.ts`, ajoutée en DERNIER enfant de la route de la coquille : `{ path: 'admin', loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ROUTES_ADMIN) },`.

`CadreAdminComponent` : `providers: [NotificationsService]` en T2 (pas encore en T1), gabarit : `@switch (role.etat())` — `chargement` → rien (le garde a attendu, état transitoire seulement à la relecture) ; `super_admin` → `<router-outlet />` ; `refuse` → « Accès réservé aux super-administrateurs. » ; `erreur` → « Impossible de vérifier vos droits. » + bouton « Réessayer » (`reessayer()`).

**Pièges :** `AuthService.lireRole()` rend `null` sur échec ET pour un profil sans rôle — distinguer (lire `lireProfil()` : `null` = lecture en échec → `erreur` ; profil présent, rôle ≠ `super_admin` → `refuse`) et le dire en commentaire ; le garde ne navigue JAMAIS (C2) ; la route `admin` est sous la coquille, donc sous `authGuard` : sans session, le comportement « Session requise… » / redirection vers `/connexion` reste celui du socle (ne rien refaire) ; `runGuardsAndResolvers: 'always'` pour qu'une connexion avec un autre compte relise le rôle ; `lignesSse` doit gérer `\r\n` (séparateur SSE autorisé par la norme) ; les types copiés ne doivent PAS importer `@/…`.

- [ ] **Step 1: Écrire le test de parité (échec : fichiers absents)**

```ts
// tests/unit/angular/admin-logique-paritaire.test.ts
/**
 * La logique de l'administration copiée dans angular/ (P6) rend la MÊME chose que sa source
 * React. Les modules copiés servent aussi l'API et ne sont pas gelés : ce test est ce qui
 * oblige la copie à suivre (feuille de route, lot 6).
 */
import { describe, expect, it } from 'vitest';
import * as Rr from '@/lib/auth/roles';
import * as Ar from '../../../angular/src/app/features/admin/logique/roles';
import * as Rv from '@/lib/version';
import * as Av from '../../../angular/src/app/features/admin/logique/version';
import * as Rf from '@/app/admin/carreaux-import/_components/shared';
import * as Af from '../../../angular/src/app/features/admin/logique/formats';
import type * as RtA from '@/types/admin';
import type * as AtA from '../../../angular/src/app/features/admin/logique/types/admin';
import type * as RtI from '@/lib/import/types';
import type * as AtI from '../../../angular/src/app/features/admin/logique/types/import-poi';

// Assignabilité mutuelle, vérifiée par `npx tsc --noEmit` à la racine (Vitest ne type-vérifie pas).
type Egal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _verif: [
  Egal<RtA.HealthResponse, AtA.HealthResponse>,
  Egal<RtA.Check, AtA.Check>,
  Egal<RtA.Organization, AtA.Organization>,
  Egal<RtI.ParseResult, AtI.ParseResult>,
  Egal<RtI.ImportProgress, AtI.ImportProgress>,
  Egal<RtI.ImportReport, AtI.ImportReport>,
  Egal<RtI.DryRunResult, AtI.DryRunResult>,
  Egal<RtI.GeocodeDetailedResult, AtI.GeocodeDetailedResult>,
] = [true, true, true, true, true, true, true, true];
void _verif;

describe("logique de l'administration : Angular = React", () => {
  it('rôles', () => {
    expect(Ar.ROLE_LEVELS).toEqual(Rr.ROLE_LEVELS);
    expect(Ar.ROLE_LABELS).toEqual(Rr.ROLE_LABELS);
    expect(Ar.ROLES).toEqual(Rr.ROLES);
    expect(Ar.ROLES_MEMBRE).toEqual(Rr.ROLES_MEMBRE);
  });
  it('version affichée par le Health check', () => {
    expect(Av.APP_VERSION).toBe(Rv.APP_VERSION);
    expect(Av.BUILD_DATE).toBe(Rv.BUILD_DATE);
  });
  it('formats de taille et de durée', () => {
    for (const b of [0, 1, 1023, 1024, 1_048_575, 1_048_576, 5_368_709_120]) expect(Af.fmtBytes(b)).toBe(Rf.fmtBytes(b));
    for (const s of [0, 59, 60, 61, 3599, 3600, 86_400]) expect(Af.fmtTime(s)).toBe(Rf.fmtTime(s));
  });
});
```

(Compléter `_verif` par chaque type que l'admin importe — liste obtenue par `grep -rhoE "from '@/(types|lib/import|lib/donnees)/[a-z-]+'" app/admin app/dashboard/iris-crawler` puis lecture des noms importés.)

`sse.spec.ts` (Angular) : deux morceaux qui coupent une ligne `data: {"type":"progress","processed":3}` au milieu → un seul objet, émis au second morceau ; `\r\n\r\n` accepté ; lignes `event: x`, `: commentaire`, `id: 1` ignorées ; ligne `data: {cassé` ignorée sans erreur ; dernière ligne sans saut de ligne lue à la `Response` finale ; erreur HTTP propagée. `role-admin.service.spec.ts` : `super_admin` → `super_admin` ; `client` → `refuse` ; lecture en échec → `erreur`, `reessayer()` relit ; deux `charger()` simultanés → une seule lecture ; changement d'identifiant de session → relecture. `cadre-admin.component.spec.ts` : `refuse` → message, AUCUN composant enfant instancié (route enfant factice qui compte ses constructions = 0) ; `super_admin` → enfant monté ; `erreur` → bouton « Réessayer ». `remote.spec.ts` (fin de fichier) : `admin` existe sous la coquille ; un service d'API factice fourni par `FOURNISSEURS_ADMIN` part avec `Authorization: Bearer` et passe par le limiteur (4 appels simultanés → 3 en vol) ; un `client` qui suit `admin/users` → message, URL inchangée, zéro requête. `app.config.spec.ts` : `/app/admin` → `/app/admin/health`.

- [ ] **Step 2: Lancer et constater l'échec** — `npx vitest run tests/unit/angular/admin-logique-paritaire.test.ts` : FAIL (« Failed to resolve import …/admin/logique/roles »).
- [ ] **Step 3: Implémenter** — copies (imports `@/…` → relatifs), `lignesSse`, `RoleAdminService`, garde, cadre, routes, la ligne de `app.routes.ts`.
- [ ] **Step 4: Lancer** — parité PASS ; `npx tsc --noEmit` racine (code de retour lu directement) ; `cd angular && npx ng test --watch=false` ; `npm run build` (le chunk `admin` apparaît, le paquet initial ne bouge pas : relever les deux tailles au rapport).
- [ ] **Step 5: Navigateur** — compte super_admin : `/app/admin` → `/app/admin/health` (page provisoire) ; compte `client` : message de refus, onglet Réseau sans `/api/admin` ; autonome, deux thèmes. Captures `T1-refus-{theme}-angular.png`, `T1-cadre-{theme}-angular.png` (React n'a pas d'équivalent : C2, le dire).
- [ ] **Step 6: Doc + commit** — feuille de route (gel P5) ; `ARCHITECTURE.md` : route `admin`, C1, C2, C3, `lignesSse`. Commit `feat(angular): administration — route, garde super_admin, services de la route et copies pures (lot 6, T1)`.

---

### Task 2: Socle admin II — notifications, confirmation, journal, progression, dépôt de fichiers, onglets

**Files:**
- Create: `ui/notifications/{notifications.service,notifications.component}.ts` (+ specs), `ui/confirmation/confirmation.component.ts` (+ spec), `A/commun/{journal,progression-import,depot-fichiers,onglets}.component.ts` (+ specs)
- Modify: `A/cadre-admin.component.ts` (`providers: [NotificationsService]`, rangée `sticky` des notifications), `ui/icone/icones.ts` (+ `triangle-alerte` AlertTriangle, `coche` Check, `loupe` Search — EN FIN de table), `tests/unit/angular/icones-lucide.test.ts` (compte), `features/catalogue/catalogue.page.{ts,html}` (planche « Administration », en fin de page)

**Sources React :** `components/ui/geo-toast.tsx:1-202` (durée, sortie animée `EXIT_MS`, 3 au plus, barre de temps, icônes), `components/ui/confirm-modal.tsx:1-173` (titre, message, `confirmLabel`, `variant`, `loading` → « En cours... », Échap / clic voile), `app/admin/import/_components/ImportLogPanel.tsx:1-94`, `app/admin/radio/page.tsx:224-247,459-518` (filtre par niveau, compteurs, copie, horodatage), `app/admin/import/_components/UploadStep.tsx:1-188` et `app/dashboard/iris-crawler/page.tsx:180-212` (zones de dépôt), `app/admin/health/page.tsx:216-240` et `app/admin/sources/page.tsx:370-412` (onglets — deux rendus DIFFÉRENTS : l'onglet générique prend la couleur et la graisse en entrées, C16), `app/admin/carreaux-import/_components/ImportStep.tsx:1-306` (barre de pourcentage React existante, modèle de rendu de `mg-progression-import`). Capturer `ConfirmModal` et un toast de chaque variante côté React (pages admin qui les déclenchent) AVANT d'écrire.

**Interfaces — Produces :**

```ts
@Injectable()
export class NotificationsService {
  readonly notifications: Signal<readonly Notification[]>;
  success(titre: string, message?: string): void;
  error(titre: string, message?: string): void;
  warning(titre: string, message?: string): void;
  info(titre: string, message?: string): void;
  retirer(id: number): void;
}
// mg-notifications : lit le service de l'injecteur, rend au plus 3 cartes, role="status" aria-live="polite".

// mg-confirmation : <dialog> natif, showModal() quand `ouvert` passe à true, close() sinon.
readonly ouvert = input.required<boolean>();
readonly titre = input.required<string>();
readonly message = input<string>();
readonly libelleConfirmer = input('Confirmer');
readonly variante = input<'danger' | 'defaut'>('defaut');
readonly enCours = input(false);
readonly confirmer = output<void>();
readonly annuler = output<void>();   // Échap (événement `cancel` du dialog, preventDefault puis émission), clic sur le fond, bouton

// mg-journal
export interface LigneJournal { message: string; niveau: 'debug' | 'info' | 'warn' | 'error' | 'success' | 'log'; phase?: string; horodatage?: number; }
readonly lignes = input.required<readonly LigneJournal[]>();
readonly filtrable = input(false);      // filtre par niveau + compteurs (radio)
readonly copiable = input(false);       // « Copier » → navigator.clipboard, notification « Logs copiés »
readonly hauteur = input(240);          // px

// mg-progression-import (C5)
readonly etape = input.required<string>();          // étape NOMMÉE : « Analyse », « Insertion », « Post-traitement »…
readonly traitees = input<number | null>(null);
readonly total = input<number | null>(null);        // null → barre indéterminée
readonly termine = input(false);
readonly echec = input<string | null>(null);

// mg-depot-fichiers : glisser-déposer + <input type="file">
readonly accepter = input<string>();                // attribut accept
readonly multiple = input(false);
readonly desactive = input(false);
readonly fichiers = output<File[]>();
```

**Pièges :** le `<dialog>` est dans la racine d'ombre : `showModal()` le place dans la couche supérieure SANS le sortir de l'arbre — vérifier au navigateur qu'il est stylé dans l'hôte ; l'événement `cancel` (Échap) ferme le dialogue nativement : `preventDefault()` puis émettre `annuler`, sinon l'état `ouvert` et le DOM divergent ; Échap dans le dialogue ne doit PAS remonter jusqu'à un écouteur de page (`stopPropagation` sur `keydown` Échap) ; les minuteries des notifications sont nettoyées par `DestroyRef` ; défilement du journal par `scrollTop` (C14) et seulement si l'utilisateur n'a pas remonté (`userScrolledRef`, `radio/page.tsx:233`) ; `mg-progression-import` n'invente aucun pourcentage (C5) ; « Copier » : `navigator.clipboard` peut lever (contexte non sécurisé, permission) → notification d'erreur, jamais une exception ; la zone de dépôt n'écoute `dragover`/`drop` que sur elle-même (jamais `document`).

- [ ] **Step 1: Specs (échec)** — notifications : 4 variantes, retrait après 4 s (`vi.useFakeTimers`), quatrième poussée → la plus ancienne disparaît, destruction → plus aucune minuterie ; confirmation : `ouvert` true → `showModal` appelé (jsdom : espionner `HTMLDialogElement.prototype.showModal`, absent de jsdom — le poser en doublure), Échap → `annuler` une fois et dialogue fermé, `enCours` → bouton désactivé « En cours... », `variante="danger"` → classe danger ; journal : 500 lignes → `scrollTop === scrollHeight` sans appel à `scrollIntoView` (espion), filtre niveau `error` seul → lignes filtrées et compteurs exacts, « Copier » → texte joint par `\n` ; progression : `total` null → `aria-busy` + rôle `progressbar` sans `aria-valuenow`, `traitees 250 / total 1000` → `aria-valuenow="25"` et « 250 / 1 000 » ; dépôt : `drop` de deux fichiers avec `multiple` false → seulement le premier.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; gardes `tests/unit/angular/` ; build.**
- [ ] **Step 5: Navigateur** — planche du catalogue (deux thèmes) : chaque variante de notification, confirmation ouverte (défaut et danger, focus clavier sur « Annuler »), journal filtrable, progression indéterminée / 25 % / terminée / échec, dépôt au survol de glisser. Comparer à `ConfirmModal` et aux toasts React capturés. Captures `T2-{notifications,confirmation,journal,progression,depot}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Doc + commit** — `ARCHITECTURE.md` : C6, C7, C14, C5 (composants). Commit `feat(angular): administration — notifications, confirmation en dialog, journal, progression et dépôt de fichiers (lot 6, T2)`.

---

### Task 3: Health check — onglet Système

**Files:**
- Create: `A/health/health.page.{ts,html}` (+ spec), `A/health/carte-verification.component.ts` (+ spec), `A/health/data/health.api.ts` (+ spec)
- Modify: `A/admin.routes.ts` (enfant `health`, `HealthApi` dans `FOURNISSEURS_ADMIN`), `layout/navigation.ts` (« Health check » → `cible: 'admin/health'`)

**Sources React :** `app/admin/health/page.tsx:1-596` (statuts OK/WARN/ERROR et leurs icônes l.37-68, couleurs l.70-81, `CheckCard` l.82-126, onglets l.128-133 et 216-240, filtres `donneesChecks`/`envChecks`/`connChecks`/`tableChecks` l.159-165, compteurs, « Database Overview » l.422-590 dont la barre de taille et son quota l.463-490, tableau des tables, `APP_VERSION`/`BUILD_DATE`), `types/admin.ts` (`Check`, `HealthResponse`), `app/api/admin/health/route.ts` (forme de la réponse).

**API :** `GET /api/admin/health`.

**Interfaces — Produces :** `HealthApi.lire(): Observable<HealthResponse>` ; `HealthPage.onglet: WritableSignal<'systeme' | 'fraicheur'>` (l'onglet Fraîcheur est rendu en T4 ; en T3, un texte provisoire « Disponible prochainement »).

**Pièges :** le statut global se lit `health?.status || 'ERROR'` — tant que rien n'est chargé, React n'affiche PAS la pastille (`!isLoading && health`) : garder ; les animations `spin`/`pulse` du `<style>` React passent dans les `styles` du composant ; « Rafraîchir » relance UNE lecture (bouton désactivé pendant) ; le quota de la barre de taille est une valeur React en dur (lire l.463-480 : Free 500 MB / Pro 8 GB) — recopier telle quelle et signaler qu'elle décrit le projet hébergé supprimé (défaut React, non corrigé : parité) ; `toLocaleString('fr-FR')` → `formaterNombre`.

- [ ] **Step 1: Specs (échec)** — réponse factice (2 OK, 1 WARN, 1 ERROR, 3 tables) → compteurs « 2 / 1 / 1 », sections dans l'ordre React, pastille globale ; pendant la lecture → aucune pastille ; erreur HTTP → message ; « Rafraîchir » → une seconde requête, aucune tant que la première est en vol.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — `/admin/health` contre `/app/admin/health`, mêmes compteurs et mêmes lignes de tables (nombres `fr-FR` identiques), version `7.19.0`. États : chargé, chargement (requête ralentie par `page.route` + délai), erreur (`page.route` → 500). Captures deux thèmes.
- [ ] **Step 6: Commit** — `feat(angular): Health check, onglet Système (lot 6, T3)`.

---

### Task 4: Health check — onglet Fraîcheur des données

**Files:**
- Create: `A/health/fraicheur.component.ts` (+ spec), `A/health/data/fraicheur.api.ts` (+ spec)
- Modify: `A/health/health.page.html`, `A/admin.routes.ts` (`FraicheurApi`)

**Sources React :** `app/admin/health/_components/FraicheurPanel.tsx:1-419` (lecture du relevé persisté l.145, mesure légère et lourde l.161, coût annoncé dans le `title` l.344, état par source, tableau), `lib/donnees/registre-fraicheur.ts` (`NatureSource`, `EtatFraicheur`), `app/api/admin/fraicheur-donnees/route.ts` (corps du POST, quotas `geo:rl:fraicheur` 6/min et `geo:rl:fraicheur-lourd` 1/min, réponse 429).

**API :** `GET /api/admin/fraicheur-donnees` (ne mesure rien), `POST /api/admin/fraicheur-donnees` (corps exact lu dans la route).

**Pièges :** la mesure LOURDE coûte 347 Mo lus (balayage de `comptages_routiers`) — un seul clic, bouton désactivé pendant, le coût affiché AVANT le clic comme React ; un 429 affiche le message du serveur, jamais une relance automatique ; le relevé est FUSIONNÉ côté serveur : ne rien recalculer côté client.

- [ ] **Step 1: Specs (échec)** — ouverture de l'onglet → un GET, aucun POST ; « Relancer la mesure » → POST au corps attendu ; mesure lourde → corps distinct, bouton désactivé pendant ; 429 → message du serveur ; passer d'un onglet à l'autre deux fois → toujours un seul GET (cache d'écran).
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — onglet Fraîcheur React / Angular, mêmes sources, mêmes âges ; une mesure légère réelle (écriture dans `qualite_releves` : relevé de mesure, pas une donnée métier — permis), PAS de mesure lourde (capturer l'état « prêt » et le `title` du coût). Captures deux thèmes.
- [ ] **Step 6: Commit** — `feat(angular): Health check, onglet Fraîcheur des données (lot 6, T4)`.

---

### Task 5: Qualité des données

**Files:**
- Create: `A/qualite-donnees/qualite-donnees.page.{ts,html}` (+ spec), `A/qualite-donnees/data/qualite.api.ts` (+ spec)
- Modify: `A/admin.routes.ts`, `layout/navigation.ts` (« Qualite des donnees » → `cible: 'admin/qualite-donnees'`)

**Sources React :** `app/admin/qualite-donnees/page.tsx:1-444` (en-tête de parti pris l.1-25, quatre familles indicateurs / fraîcheur / invariants / colonnes IRIS, « jamais lancée » ≠ « rien à signaler », coût annoncé avant le clic l.210, problèmes d'abord l.271, couverture de POPULATION l.285, contresens cron l.346, écart en unité métier l.387, « renseignée » vs « non nulle » l.429), `app/api/admin/qualite-donnees/route.ts` (corps du POST, quota 2/min).

**API :** `GET /api/admin/qualite-donnees` (relevés persistés), `POST /api/admin/qualite-donnees` (UNE vérification).

**Pièges :** un bouton par famille, jamais « tout vérifier » (CLAUDE.md, incident du 28/03) ; pendant une vérification, les autres boutons sont désactivés (une seule à la fois, quota serveur 2/min) ; le balayage d'`iris` coûte ~220 Mo : ne PAS le lancer pour la preuve si le relevé existe déjà (3 relevés persistés) — une vérification légère suffit ; `cache: 'no-store'` React → sans objet côté `HttpClient` (aucun cache HTTP navigateur sur ces GET authentifiés) : le dire en commentaire.

- [ ] **Step 1: Specs (échec)** — GET au montage, un seul ; famille jamais lancée → « jamais lancée » ; POST d'une famille → corps exact, autres boutons désactivés ; 429 → message ; tri « problèmes d'abord ».
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — mêmes quatre familles, mêmes nombres ; relancer UNE famille légère (indicateurs) ; captures deux thèmes, + état « vérification en cours ».
- [ ] **Step 6: Commit** — `feat(angular): Qualité des données (lot 6, T5)`.

---

### Task 6: Users — liste, invitation, édition, suppression

**REMPLACÉE** (2026-10-09) par la page Espaces de travail — `docs/superpowers/plans/2026-10-09-espaces-de-travail.md`. Ne pas exécuter.

**Files:**
- Create: `A/users/users.page.{ts,html}` (+ spec), `A/users/dialogue-utilisateur.component.ts` (+ spec), `A/users/data/users.api.ts` (+ spec), `A/commun/data/organisations-liste.api.ts` (lecture `GET /api/admin/organizations`, mise en cache par écran — reprise par T7, T12, T18)
- Modify: `A/admin.routes.ts`, `layout/navigation.ts` (« Users » → `cible: 'admin/users'`)

**Sources React :** `app/admin/users/page.tsx:1-301` (trois lectures au montage l.64-74 — `users`, `organizations` sous ses deux formes de réponse `{organizations}` ou tableau, `roles` —, création / édition l.80-110, lien d'initialisation et sa copie l.215-230, suppression l.112-120 + `ConfirmModal` l.289, modale `fixed` l.199), `app/api/admin/{users,users/[id],roles}/route.ts` (corps et réponses).

**API :** `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/[id]`, `GET /api/admin/organizations`, `GET /api/admin/roles`.

**Pièges :** trois lectures au montage = 3 places du limiteur : voulu ; la réponse d'`organizations` a deux formes (lire l.69-72) ; le lien d'initialisation est un SECRET d'usage unique : ne jamais le journaliser, ne pas le garder après fermeture du dialogue ; les rôles proposés viennent de `/api/admin/roles` (jamais réécrits à la main — règle `CLAUDE.md` § Rôles) ; modale = `<dialog>` (C6).

- [ ] **Step 1: Specs (échec)** — trois GET au montage, aucun de plus ; création → POST au corps exact, puis relecture de la liste ; édition → PATCH ; suppression → `mg-confirmation` puis DELETE puis relecture ; erreur serveur → notification d'erreur avec le message ; lien d'initialisation affiché puis copié (`navigator.clipboard` doublé).
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — liste (5 profils) identique ; régime C12 (a) : créer `[ESSAI lot 6] utilisateur` (email jetable), l'éditer, le supprimer ; SQL de contrôle (`profiles` revenu à 5, `auth.users` sans l'email jetable). Captures deux thèmes : liste, dialogue d'invitation (focus clavier dans le premier champ), lien affiché, confirmation de suppression.
- [ ] **Step 6: Commit** — `feat(angular): Users — liste, invitation, édition et suppression (lot 6, T6)`.

---

### Task 7: Organisations — liste et création

**REMPLACÉE** (2026-10-09) par la page Espaces de travail — `docs/superpowers/plans/2026-10-09-espaces-de-travail.md`. Ne pas exécuter.

**Files:**
- Create: `A/organizations/organizations.page.{ts,html}` (+ spec), `A/organizations/data/organisations-admin.api.ts` (+ spec)
- Modify: `A/admin.routes.ts` (enfants `organizations` et `organizations/:id` — ce dernier provisoire jusqu'à T8), `layout/navigation.ts` (« Organisations » → `cible: 'admin/organizations'`)

**Sources React :** `app/admin/organizations/page.tsx:1-292` (lecture l.50, création l.67-90, tableau l.193-249, ligne cliquable → détail l.214, encart explicatif l.260-275 avec les exemples de marque, C16), `app/api/admin/organizations/route.ts`.

**API :** `GET/POST /api/admin/organizations`.

**Pièges :** navigation vers le détail RELATIVE (`router.navigate([org.id], { relativeTo })`), la ligne est cliquable ET atteignable au clavier (`<a>` ou `tabindex` + Entrée — React n'offre que le clic : défaut d'accessibilité corrigé, listé) ; réutiliser le cache d'`organisations-liste.api.ts` de T6 pour la liste ? NON : cette page lit la forme COMPLÈTE (membres, sources) — vérifier la réponse et le dire.

- [ ] **Step 1: Specs (échec)** — liste rendue ; création → POST puis relecture ; clic et Entrée sur une ligne → navigation relative vers l'identifiant.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — 4 organisations ; régime (a) : créer `[ESSAI lot 6] organisation` (supprimée en T8 par `DELETE /api/admin/organizations/[id]` si l'écran le permet, sinon par SQL, et le dire). Captures deux thèmes.
- [ ] **Step 6: Commit** — `feat(angular): Organisations — liste et création (lot 6, T7)`.

---

### Task 8: Organisation — détail (configuration, membres, sources)

**REMPLACÉE** (2026-10-09) par la page Espaces de travail — `docs/superpowers/plans/2026-10-09-espaces-de-travail.md`. Ne pas exécuter.

**Files:**
- Create: `A/organizations/organisation.page.{ts,html}` (+ spec), `A/organizations/{membres,sources-organisation}.component.ts` (+ specs)
- Modify: `A/organizations/data/organisations-admin.api.ts`, `A/admin.routes.ts`

**Sources React :** `app/admin/organizations/[id]/page.tsx:1-740` (lecture l.168, stats système l.151, configuration et « Site Centric » l.432-470, enregistrement l.196-240, membres l.475-574 dont invitation l.266-282, changement de rôle l.284-296, retrait avec `window.confirm` l.299-310 (C6), réinitialisation de mot de passe l.244-262 ; sources propres l.575-678 (renommage l.321-333, suppression avec `window.confirm` l.377-392), sources disponibles et partage l.679-735 (`sources/assign` POST/DELETE l.341-372)), `lib/auth/roles.ts` (`ROLES` inversés l.46), routes `app/api/admin/organizations/[id]/**`.

**API :** `GET/PATCH /api/admin/organizations/[id]`, `POST/PATCH/DELETE …/members`, `POST …/members/reset-password`, `PATCH/DELETE …/sources`, `POST/DELETE …/sources/assign`, `GET /api/admin/sources-stats`.

**Pièges :** plusieurs `await adminFetch(...)` React n'ont AUCUNE lecture de leur réponse (l.286, 304, 323, 343, 362, 382) : une suppression en échec passe pour réussie (règle `CLAUDE.md` « jamais de delete sans lire son erreur », côté client) — Angular lit chaque réponse et notifie l'échec : défaut corrigé, listé ; l'identifiant vient de `ActivatedRoute` (`paramMap`) — un changement de paramètre sans recréation du composant doit relire (route réutilisée) ; « Retour » → lien RELATIF `..` ; `ROLES_MEMBRE` vs `ROLES` : lire ce que la page propose réellement.

- [ ] **Step 1: Specs (échec)** — lecture au montage (2 GET) ; changer de `:id` → relecture ; retirer un membre → `mg-confirmation` avec le texte « Retirer ce membre du workspace ? » puis DELETE ; DELETE en 500 → notification d'erreur et liste inchangée ; partager une source → POST `sources/assign` au corps exact ; réinitialiser un mot de passe → POST.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — détail d'une organisation existante (lecture seule) contre React ; régime (a) sur l'organisation jetable de T7 : config enregistrée, membre jetable invité puis retiré, partage d'une source puis retrait, puis suppression de l'organisation jetable ; SQL de contrôle (organisations = 4, membres et partages sans trace jetable). Captures deux thèmes.
- [ ] **Step 6: Commit** — `feat(angular): Organisation — configuration, membres et sources (lot 6, T8)`.

---

### Task 9: Connexions API — cadre, onglets, DV360, fournisseurs à venir

**Files:**
- Create: `A/api/connexions-api.page.ts` (+ spec), `A/api/dv360.page.{ts,html}` (+ spec), `A/api/fournisseur-a-venir.component.ts` (+ spec), `A/api/logique/fournisseurs.ts`, `A/api/data/dsp.api.ts` (+ spec), `angular/public/logos/{dv360,meta,tiktok,ttd}.svg`, `A/api/naviguer-hors-application.ts` (jeton `NAVIGUER_HORS_APPLICATION`, C11)
- Modify: `A/admin.routes.ts` (`api` + enfants `''`→`dv360`, `dv360`, `meta`, `ttd` ; `tiktok` et `logs` provisoires jusqu'à T10), `layout/navigation.ts` (« Connexions API » → `cible: 'admin/api'`), `tests/unit/angular/admin-logique-paritaire.test.ts` (+ `PROVIDERS` hors `logo`, octets des quatre SVG égaux à `public/logos/*`)

**Sources React :** `app/admin/api/layout.tsx:1-48` (titre, sous-titre, onglets actifs par chemin EXACT), `page.tsx:1-5`, `_lib/constants.ts:1-34`, `_components/ProviderPlaceholder.tsx:1-26`, `meta/page.tsx`, `ttd/page.tsx`, `dv360/page.tsx:1-423` (chargements l.40-60, lecture de `?oauth=` l.74-80, enregistrement l.84-96, test l.98-108, config OAuth l.110-125, démarrage OAuth l.127-141, déconnexion l.143-152, purge `?scope=full` l.154-171 + `ConfirmModal` l.327, diagnostic serveur l.198-240, méthode et Partner ID l.242-312, flux de logs l.344-420), routes `app/api/admin/dsp/**` (corps), `app/api/admin/dsp/dv360/oauth/callback/route.ts:12-14` (retour vers React, C11).

**API :** `GET /api/admin/dsp/connections`, `GET /api/admin/dsp/dv360/config`, `POST/DELETE /api/admin/dsp/dv360/connect` (`?scope=full`), `POST …/dv360/oauth/config`, `POST …/dv360/oauth/start`, `POST …/dv360/test`, `GET /api/admin/dsp/logs?provider=dv360&limit=20`.

**Interfaces — Produces :** `DspApi` (une méthode par route, `fournisseur: 'dv360' | 'tiktok'` en paramètre pour servir T10) ; `NAVIGUER_HORS_APPLICATION = new InjectionToken<(url: string) => void>(…, { factory: () => { const d = inject(DOCUMENT); return (url) => d.defaultView?.location.assign(url); } })`.

**Pièges :** onglets par `routerLink` RELATIF + `routerLinkActive` en correspondance exacte ; le secret OAuth saisi n'est jamais relu (champ mot de passe, effacé après envoi) ; les paramètres `oauth`/`reason` viennent de `ActivatedRoute`, puis sont retirés par `router.navigate([], { relativeTo, queryParams: { oauth: null, reason: null }, queryParamsHandling: 'merge', replaceUrl: true })` ; logos par `urlRessourceDistante` (C15), `alt` identique ; DV360 EN PAUSE : ne pas tenter un vrai consentement.

- [ ] **Step 1: Specs (échec)** — `/admin/api` → `dv360` ; onglet actif exact ; `meta` et `ttd` → texte de `ProviderPlaceholder` ; DV360 : trois GET au montage ; « Tester » → POST ; « Connecter Google » sans Partner ID → notification d'erreur (texte React), aucune requête ; avec Partner ID → POST `oauth/start` puis `NAVIGUER_HORS_APPLICATION` appelé avec l'URL rendue ; arrivée avec `?oauth=success` → notification « DV360 connecté via Google. » et paramètres retirés ; purge → `mg-confirmation` puis DELETE `?scope=full`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — DV360 React / Angular : diagnostic, état de la connexion (1 connexion), journal des 20 derniers appels identique ; « Tester la connexion » réel (lecture DV360 : échoue sur droits, même message des deux côtés) ; démarrage OAuth INTERCEPTÉ au niveau du jeton (spec) et, au navigateur, `page.route` sur l'URL de consentement Google → capture de la requête partante ; `?oauth=error&reason=x` rendu. Pas de purge réelle (connexion existante : capture du dialogue seul). Captures deux thèmes, onglets Meta / TTD compris.
- [ ] **Step 6: Commit** — `feat(angular): Connexions API — cadre, onglets, DV360 et fournisseurs à venir (lot 6, T9)`.

---

### Task 10: Connexions API — TikTok et journal des appels DSP

**Files:**
- Create: `A/api/tiktok.page.{ts,html}` (+ spec), `A/api/journal-dsp.page.ts` (+ spec)
- Modify: `A/admin.routes.ts` (`tiktok`, `logs`), `A/api/data/dsp.api.ts` (méthodes TikTok, journal filtré)

**Sources React :** `app/admin/api/tiktok/page.tsx:1-322` (même structure que DV360 : chargements, `?oauth=` l.72-76, App ID + secret l.80-92, OAuth l.94-103, test l.105-114, déconnexion, purge `ConfirmModal` l.235), `app/admin/api/logs/page.tsx:1-77` (`errorsOnly` → `?…` l.14-25, tableau l.48-73), routes `app/api/admin/dsp/tiktok/**`, `app/api/admin/dsp/logs/route.ts` (paramètres EXACTS).

**API :** `GET /api/admin/dsp/connections`, `GET …/tiktok/config`, `POST/DELETE …/tiktok/connect` (`?scope=full`), `POST …/tiktok/oauth/start`, `POST …/tiktok/test`, `GET /api/admin/dsp/logs?provider=tiktok&limit=20`, `GET /api/admin/dsp/logs` (`errors_only`).

**Pièges :** factoriser avec DV360 seulement ce qui est identique au pixel (C16) — les deux pages React diffèrent (OAuth client par organisation pour DV360, App ID pour TikTok) ; la case « Erreurs seulement » relance UNE lecture (le paramètre exact lu dans la route).

- [ ] **Step 1: Specs (échec)** — TikTok : chargements, enregistrement de l'app au corps exact, démarrage OAuth → jeton de navigation, `?oauth=success` → notification texte React ; journal : case cochée → requête avec le paramètre exact, décochée → sans.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — TikTok (aucune connexion : état « non connecté » identique), journal des 24 appels identique, filtre erreurs. Captures deux thèmes.
- [ ] **Step 6: Commit** — `feat(angular): Connexions API — TikTok et journal des appels DSP (lot 6, T10)`.

---

### Task 11: Import OOH (ArcGIS, NDJSON) et historique des imports

**Files:**
- Create: `A/ooh-import/ooh-import.page.{ts,html}` (+ spec), `A/ooh-import/data/ooh-import.api.ts` (+ spec), `A/imports/imports.page.{ts,html}` (+ spec), `A/imports/data/imports.api.ts` (+ spec), `tests/fixtures/admin/ooh-arcgis.ndjson`
- Modify: `A/admin.routes.ts`, `layout/navigation.ts` (« Import OOH » → `admin/ooh-import`, « Imports » → `admin/imports`)

**Sources React :** `app/admin/ooh-import/page.tsx:1-325` (sources proposées, URL personnalisée l.98-100, `replace` l.97, flux l.95-133 — types `status`/`progress`/`error`/`done` et leurs lignes de journal EXACTES l.117-124, relecture de l'historique après `done`, renommage du jeu `datasetName`/`nameSaved`, suppression d'un run), `app/api/admin/import-ooh/arcgis/route.ts` (événements émis : lire les `send(...)` pour savoir ce que `progress` porte — `page`, `fetched`, `inserted`, et s'il existe un total `nb_total` annoncé AVANT la fin ; corps validé l.145-160 ; `DELETE` l.492), `app/admin/imports/page.tsx:1-192` (stats l.107-120, filtres l.121-139, tableau l.140-187), `app/api/admin/imports/route.ts`.

**API :** `GET/POST/DELETE /api/admin/import-ooh/arcgis` (POST = NDJSON), `GET /api/admin/imports`.

**Progression (C5)** : étapes nommées depuis les événements `status` ; barre DÉTERMINÉE seulement si la route annonce un total avant la fin (sinon indéterminée + « N récupérés / N insérés ») ; compteurs finaux depuis `done`. Écart à React (journal seul) listé.

**Pièges :** `replace: true` EFFACE les panneaux de la source avant import — case recopiée, mais la preuve se fait par fixture (C12 c) ; un `DELETE` de run d'historique : intercepté ; C13 : l'abonnement au POST n'est pas coupé à la destruction ; le flux est lu même si le statut HTTP n'est pas 2xx tant qu'il y a un corps (React `if (!resp.body)`), sinon message.

- [ ] **Step 1: Fixture** — écrire `tests/fixtures/admin/ooh-arcgis.ndjson` d'après les `send(...)` de la route (au moins : 2 `status`, 3 `progress`, 1 `error` non bloquante, 1 `done`) et citer les numéros de ligne de la route en tête de fichier (commentaire dans un `.md` voisin, le NDJSON n'en admettant pas).
- [ ] **Step 2: Specs (échec)** — POST au corps exact (`source`, `replace`, `arcgisUrl` si personnalisée, `source: 'custom'`) ; la fixture découpée en trois morceaux → lignes de journal identiques au texte React, étape et compteurs de `mg-progression-import`, historique relu après `done` ; flux sans `done` → « Le flux s'est interrompu avant la fin. » ; destruction pendant le flux → requête NON annulée (`HttpTestingController` : `req.cancelled === false`) ; historique des imports : stats, filtres locaux sans requête.
- [ ] **Step 3: FAIL. Step 4: Implémenter. Step 5: PASS ; build.**
- [ ] **Step 6: Navigateur** — `page.route('**/api/admin/import-ooh/arcgis', …)` qui sert la fixture EN MORCEAUX espacés (même réponse aux deux écrans) : captures début / milieu / fin React et Angular ; historique (1 run) réel ; page « Imports » réelle contre React (mêmes stats, mêmes lignes). SQL avant / après : `panneaux_affichage` actifs = 1 434, `import_runs_ooh` = 1. Deux thèmes.
- [ ] **Step 7: Commit** — `feat(angular): Import OOH en flux avec progression et historique des imports (lot 6, T11)`.

---

### Task 12: Import POI I — dépôt, catégorie, correspondance, colonnes

**Files:**
- Create: `A/import/import-poi.page.{ts,html}` (+ spec), `A/import/etat/import-poi.service.ts` (+ spec — l'état du parcours, fourni par la page), `A/import/etapes/{depot,categorie,correspondance,colonnes}.component.ts` (+ specs), `A/import/logique/constantes.ts`, `A/import/data/import-poi.api.ts` (+ spec), `A/commun/data/categories-poi.api.ts`
- Modify: `A/admin.routes.ts`, `layout/navigation.ts` (« Import POI » → `admin/import`)

**Sources React :** `app/admin/import/page.tsx:1-330` (état complet l.35-94, chargements au montage organisations + catégories avec repli codé en dur l.97-130, `handleFileUpload` l.135-187 — `FormData` à PLUSIEURS fichiers pour un bundle Shapefile, réinitialisation des étapes suivantes —, glisser-déposer, `buildGeoConfig` l.206-220), `_components/{UploadStep,CategoryStep,MappingStep,ColumnSelectionStep,shared,styles}.tsx`, `lib/import/types.ts`, `app/api/admin/import-poi/parse/route.ts` (nom des champs multipart, réponse), `app/api/admin/poi-categories/route.ts` (création).

**API :** `GET /api/admin/organizations`, `GET/POST /api/admin/poi-categories`, `POST /api/admin/import-poi/parse` (multipart).

**Interfaces — Produces :** `ImportPoiService` (signaux : `fichiers`, `analyse: ParseResult | null`, `categorie`, `correspondance`, `modeGeo`, `correspondanceGeo`, `colonnesImportees`, `champsFiltres`, `nomSource`, `organisationId` ; `etapeAccessible(n)` en `computed`, mêmes conditions que React) — consommé par T13.

**Pièges :** multipart par `HttpClient` SANS `Content-Type` posé (le navigateur pose la frontière) — `adminFetch` faisait de même pour `FormData` ; le repli de catégories codées en dur (`page.tsx:120-127`) est recopié (parité) et signalé (règle « pas de valeurs en dur » : défaut React, non corrigé) ; l'organisation par défaut `00000000-…-0001` (l.90) recopiée ; une nouvelle analyse réinitialise TOUT l'aval (l.140-145) ; la création de catégorie ÉCRIT (régime a : `[ESSAI lot 6]`, supprimée par SQL en fin de tâche).

- [ ] **Step 1: Specs (échec)** — dépôt d'un CSV → `FormData` avec le champ attendu par la route, aucun `Content-Type` ; dépôt de 3 fichiers Shapefile → 3 entrées ; analyse rendue → colonnes, correspondance automatique ; changer de fichier → aval réinitialisé ; catégories : un GET au montage, repli sur erreur ; création → POST puis relecture ; étapes inaccessibles tant que la précédente n'est pas remplie (mêmes règles que React).
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — même fichier CSV jetable (10 lignes `[ESSAI lot 6]`, rangé sous `tests/fixtures/admin/poi-essai.csv`) déposé dans les deux écrans : même analyse, même correspondance proposée, mêmes colonnes ; catégorie jetable créée puis supprimée. Captures de chaque étape, deux thèmes, + survol de la zone de dépôt.
- [ ] **Step 6: Commit** — `feat(angular): Import POI — dépôt, catégorie, correspondance et colonnes (lot 6, T12)`.

---

### Task 13: Import POI II — géocodage, essai à blanc, import en flux SSE

**Files:**
- Create: `A/import/etapes/{geocodage,essai,import}.component.ts` (+ specs), `tests/fixtures/admin/import-poi.sse`
- Modify: `A/import/import-poi.page.html`, `A/import/etat/import-poi.service.ts`, `A/import/data/import-poi.api.ts`

**Sources React :** `app/admin/import/page.tsx:220-586` (`handleGeocodeBatch` l.221-258, `handleGeocodeUpdateRow` l.260-290 — trois actions `manual`/`reGeocode`/`ignore` —, validation du géocodage, `handleDryRun` l.292-330, `handleImport` l.332-425 avec `confirm()` (C6) et lecture SSE l.367-400 — `log` vers le journal, autres événements vers `importProgress`, `complete` → rapport —, gabarit des étapes 03c / 04 / 05 l.430-586), `_components/{GeocodeStep,DryRunStep,ImportStep}.tsx`, `ImportLogPanel.tsx`, `lib/import/types.ts` (`ImportProgress`, `ImportReport`, `GeocodeDetailedResult`), `app/api/admin/import-poi/execute/route.ts` (événements : `type`, champs de progression — ce qui sert de total), `app/api/admin/geocode/{batch,update}/route.ts`.

**API :** `POST /api/admin/geocode/batch`, `POST /api/admin/geocode/update`, `POST /api/admin/import-poi/dry-run`, `POST /api/admin/import-poi/execute` (SSE, C4).

**Progression (C5)** : `ImportProgress` porte des compteurs (lire le type et la route) → barre déterminée et étapes nommées (`parsing → insertion → post-traitement`, libellés EXACTS de la route) ; journal par `mg-journal` ; rapport final (insérées / ignorées / erreurs — `ignored` distingue « déjà présent », règle `CLAUDE.md` sur `ignoreDuplicates`).

**Pièges :** le confirm « Lancer l'import reel en base Supabase ? » devient `mg-confirmation` au MÊME texte (faute comprise, C16) ; le géocodage appelle la BAN (externe, lecture, mise en cache par session côté serveur) : permis sur le fichier jetable ; mode adresse : l'étape d'import reste bloquée tant que le géocodage n'est pas validé (l.286-290) ; C13 sur l'import ; l'import ÉCRIT : régime (a), POI de la catégorie jetable puis suppression (`DELETE /api/admin/poi-manage?cat=` depuis T19 n'existe pas encore → SQL, et la source créée par `DELETE /api/admin/sources/[id]` ou SQL) ; SQL de contrôle.

- [ ] **Step 1: Fixture** — `import-poi.sse` d'après les `send(...)` de la route (lignes `data: …` + ligne vide), au moins 3 `log`, 3 progressions, 1 `complete` avec rapport.
- [ ] **Step 2: Specs (échec)** — géocodage : corps exact, filtres vert/orange/rouge, édition d'une ligne → `update` avec chaque type d'action ; essai à blanc : corps exact, échantillon rendu ; import : `mg-confirmation` (annuler → aucune requête ; confirmer → POST), fixture en morceaux → journal, progression, rapport ; flux sans `complete` → message d'interruption ; requête non annulée à la destruction.
- [ ] **Step 3: FAIL. Step 4: Implémenter. Step 5: PASS ; build.**
- [ ] **Step 6: Navigateur** — parcours COMPLET réel sur le CSV jetable en mode GPS (essai puis import : 10 POI `[ESSAI lot 6]`) ET en mode adresse (géocodage BAN de 10 adresses publiques jetables, une ligne corrigée à la main), dans les deux écrans (chiffres du rapport identiques — le second import rapporte `ignored = 10` grâce à l'identité déterministe : le constater et le dire) ; nettoyage SQL ; `poi_france` revenu à 390 029. Captures début / milieu / fin de l'import, géocodage filtré, deux thèmes.
- [ ] **Step 7: Commit** — `feat(angular): Import POI — géocodage, essai à blanc et import en flux SSE (lot 6, T13)`.

---

### Task 14: Import Shapefile (carreaux) — lecture dans le navigateur, envoi par lots, enregistrement

**Files:**
- Create: `A/carreaux-import/carreaux-import.page.{ts,html}` (+ spec), `A/carreaux-import/etapes/{etapes,fichiers,correspondance,envoi}.component.ts` (+ specs), `A/logique/shapefile.ts`, `A/carreaux-import/data/import-geo.api.ts` (+ spec)
- Modify: `angular/package.json` + `package-lock.json` (`proj4` épinglé, C10), `A/admin.routes.ts`, `layout/navigation.ts` (« Import Shapefile » → `admin/carreaux-import`), `tests/unit/angular/admin-logique-paritaire.test.ts` (+ shapefile)

**Sources React :** `app/admin/carreaux-import/page.tsx:1-502` (étapes 1-3, chronomètre `setInterval` l.63-75, lecture des fichiers par extension l.96-206 avec cessions au fil `setTimeout(…, 0)`, envoi `BATCH_SIZE = 1000` l.246-350 dont la reprise par DEMI-LOT sur 413 l.314-340, `register` l.360-395, réinitialisation l.396), `_components/{Stepper,FilesStep,MappingStep,ImportStep,shared}.tsx`, `_lib/shapefile.ts:1-216` (`parseSHP`, `parseDBF`, `detectCRS`, `reprojectCoords`, `polygonToEWKT`, `detectIdColumn`, définitions `EPSG:3035`/`EPSG:2154`), `app/api/admin/import-geo/{route,register/route}.ts` (corps, réponse, 413).

**API :** `POST /api/admin/import-geo` (lots), `POST /api/admin/import-geo/register`.

**Progression (C5)** : React a déjà une barre (lots envoyés / total) : parité, plus étape nommée « Lecture des fichiers » (déterminée : enregistrements lus / total du `.dbf`) puis « Envoi » puis « Enregistrement ».

**Pièges :** **un seul lot en vol à la fois** (React les enchaîne) : ne pas paralléliser, le limiteur ne suffirait pas à protéger l'I/O ; la lecture d'un gros `.shp` bloque le fil : garder les cessions (`await` d'une micro-pause entre paquets) ; `proj4` chargé par `import('proj4')` au premier fichier lu, jamais au chargement de la page (relever au build que le chunk initial n'a pas grossi) ; le parseur copié reste PUR (proj4 en paramètre) ; le chronomètre se nettoie à la destruction ; l'import CRÉE une table dynamique et une `data_sources` : régime (a) avec un Shapefile jetable de 50 carreaux (fabriqué par le helper du test, écrit sous `tests/fixtures/admin/carreaux-essai.{shp,shx,dbf,prj}`), supprimé ensuite par `DELETE /api/admin/sources/[id]` (qui appelle `drop_carreaux_table`) via l'écran React, ou SQL ; SQL de contrôle (`data_sources` = 5, aucune table `carreaux_*` jetable restante).

- [ ] **Step 1: Test de parité (échec)** — helper `fabriquerShapefile(polygones, attributs)` qui écrit les octets `.shp`/`.dbf` (en-têtes de 100 et 32 octets, enregistrements Polygon type 5) ; `parseSHP`, `parseDBF`, `detectCRS` (prj Lambert 93, LAEA, absent + coordonnées), `reprojectCoords` (même `proj4` des deux côtés), `polygonToEWKT`, `detectIdColumn` : sorties `toEqual` React.
- [ ] **Step 2: Specs Angular (échec)** — lecture du bundle factice → champs, enregistrements, CRS détecté ; envoi de 2 500 entités → 3 POST séquentiels (le second ne part qu'après la réponse du premier) au corps exact ; 413 sur un lot → deux demi-lots ; `register` au corps exact ; destruction pendant l'envoi → plus aucun lot nouveau (l'envoi est un enchaînement client, C13 ne s'applique pas : on s'arrête proprement, le DIRE au rapport) ; chronomètre nettoyé.
- [ ] **Step 3: FAIL. Step 4: Implémenter (+ `npm install proj4@<version exacte de la racine> --save-exact` dans `angular/`). Step 5: PASS ; build (tailles relevées).**
- [ ] **Step 6: Navigateur** — même bundle jetable dans les deux écrans : même CRS détecté, même correspondance, même rapport ; captures des trois étapes et de l'envoi (début / milieu / fin), deux thèmes ; nettoyage.
- [ ] **Step 7: Épreuve AIDA (C10)** — hôte jetable PAR DÉFAUT (`ignoreUnusedDeps: true`), remote en `ng serve` PUIS en build de production : `/outils/magelian/admin/carreaux-import`, lecture du bundle jetable (proj4 chargé depuis :4201, aucune erreur console, aucun `NG0203`), puis annulation avant envoi. Procédure : `ARCHITECTURE.md` § « Épreuve dans un shell hôte jetable ».
- [ ] **Step 8: Commit** — `feat(angular): Import Shapefile — lecture dans le navigateur, envoi par lots et enregistrement (lot 6, T14)`.

---

### Task 15: IRIS crawler — dépôt manuel, correspondance, import NDJSON

**Files:**
- Create: `A/iris-crawler/iris-crawler.page.{ts,html}` (+ spec), `A/iris-crawler/data/iris-crawler.api.ts` (+ spec), `tests/fixtures/admin/iris-manual-import.ndjson`
- Modify: `A/admin.routes.ts` (`iris-crawler`, C1), `layout/navigation.ts` (« IRIS Crawler » → `admin/iris-crawler`)

**Sources React :** `app/dashboard/iris-crawler/page.tsx:1-294` (dépôt l.92-118 — `file`, `encoding: 'utf-8'`, `separator: 'auto'` —, résultat et correspondance des colonnes cœur l.214-252, colonne clé IRIS, import l.120-170 — événements `log`/`status`/`progress`/`error`/`done` (`totalInserted`) —, journal l.281-292), `app/api/iris-crawler/{manual-upload,manual-import}/route.ts` (champs, session de dépôt, événements et ce que `progress` porte).

**API :** `POST /api/iris-crawler/manual-upload` (multipart), `POST /api/iris-crawler/manual-import` (NDJSON).

**Progression (C5)** : React = journal seul ; Angular ajoute `mg-progression-import` d'après les champs de `progress` (déterminée si la route les porte, lire `manual-import/route.ts`).

**Pièges :** l'import RÉÉCRIT des colonnes d'`iris` (`update_iris_core_batch`) : régime (c), fixture ; le DÉPÔT seul (`manual-upload`) n'écrit qu'une session temporaire côté serveur : réel, avec un petit CSV jetable de 5 IRIS (`tests/fixtures/admin/iris-essai.csv`) ; `toLocaleString('fr-FR')` → `formaterNombre` ; C13.

- [ ] **Step 1: Fixture** d'après la route. **Step 2: Specs (échec)** — dépôt : `FormData` aux trois champs ; correspondance modifiable ; import : corps `{ sessionId, irisKeyCol, mapping }`, fixture en morceaux → journal au texte React (« ✓ Import terminé — N lignes traitées »), progression ; erreur HTTP → `! <error>` ; requête non annulée à la destruction.
- [ ] **Step 3: FAIL. Step 4: Implémenter. Step 5: PASS ; build.**
- [ ] **Step 6: Navigateur** — dépôt réel du CSV jetable dans les deux écrans (même résultat : lignes, colonnes mappées) ; import INTERCEPTÉ (fixture, deux écrans). SQL : `iris` = 49 448, `iris_import_history` = 8. Captures deux thèmes.
- [ ] **Step 7: Commit** — `feat(angular): IRIS crawler — dépôt manuel et import en flux avec progression (lot 6, T15)`.

---

### Task 16: Radio I — onglet Import, journal filtrable, historique, zone dangereuse

**Files:**
- Create: `A/radio/radio.page.{ts,html}` (+ spec, cadre et onglets), `A/radio/onglet-import.component.ts` (+ spec), `A/radio/data/radio-admin.api.ts` (+ spec), `tests/fixtures/admin/radio-{anfr,arcom,ods}.ndjson`
- Modify: `A/admin.routes.ts`, `layout/navigation.ts` (« Radio FM/DAB+ » → `admin/radio`)

**Sources React :** `app/admin/radio/page.tsx:1-597,899-916` (stats l.100-115, historique l.128-140, ODS multipart l.162-210, journal structuré l.212-247, relecture d'un journal passé l.239-252, `launchImport` l.254-297 — `percent`, `level`, `phase`, `done`, `error` —, dry-run puis suppression l.300-332, cartes d'action l.371-458, journal terminal l.459-518, historique l.520-580, zone dangereuse l.581-597, `ConfirmModal` l.900-916), `app/api/radio/{import-anfr,crawl-arcom,import-arcom-ods,stats,imports-history,import-logs/[logId]}/route.ts`, **`app/api/radio/data/route.ts` du poste** (non suivi par git — le lire dans le dépôt principal `C:\GENESIS\genesis_app\app\api\radio\data\route.ts`).

**API :** `GET /api/radio/stats`, `GET /api/radio/imports-history`, `GET /api/radio/import-logs/[logId]`, `POST /api/radio/import-anfr` (NDJSON), `POST /api/radio/crawl-arcom` (NDJSON), `POST /api/radio/import-arcom-ods` (multipart + NDJSON), `DELETE /api/radio/data` (corps `{ target, confirm }`).

**Progression (C5)** : React affiche `percent` quand il arrive : parité, plus étape = `phase` courante ; ODS : même règle.

**Pièges :** **l'import ANFR PURGE et ARCHIVE les données radio** (`archive_and_purge_radio`) et les 569 698 liaisons n'existent plus ailleurs : régime (c) pour les TROIS imports ; `DELETE /api/radio/data` : `confirm: false` RÉEL (rend les comptes, n'efface rien — vérifié dans la route l.27-40), `confirm: true` INTERCEPTÉ (C12 b) — et le DIRE dans le rapport avec le corps relevé ; `HttpClient.delete(url, { body })` porte bien un corps ; journal : défilement `scrollTop` (C14), filtre et compteurs, copie ; relire un journal passé remplace le journal courant (parité) ; le fichier ODS est remis à vide après envoi ; C13.

- [ ] **Step 1: Fixtures** d'après les trois routes (niveaux `info`/`warn`/`error`/`success`, phases, `percent`). **Step 2: Specs (échec)** — trois GET au montage de l'onglet Import (stats, historique — et rien des autres onglets) ; ANFR : POST sans corps, fixture → journal, `percent` → barre, `done` → notification « Import terminé » et relecture stats + historique ; ODS : `FormData` champ `file` ; « Supprimer les émetteurs » → DELETE `{target:'emetteurs',confirm:false}` → comptes dans `mg-confirmation` → confirmer → DELETE `{…,confirm:true}` → notification ; annuler → aucun second DELETE ; relecture d'un journal passé → lignes horodatées au format React (`[HH:MM:SS] [LEVEL  ] [PHASE       ] message`).
- [ ] **Step 3: FAIL. Step 4: Implémenter. Step 5: PASS ; build.**
- [ ] **Step 6: Navigateur** — stats et historique (26 journaux) identiques ; un journal passé relu dans les deux écrans ; les trois imports par fixture (deux écrans, début / milieu / fin) ; dry-run réel « Supprimer les émetteurs » puis confirmation INTERCEPTÉE (`page.route` sur `DELETE **/api/radio/data` qui ne laisse passer QUE `confirm:false` et répond lui-même `{success:true}` à `confirm:true` — vérifier le corps). SQL avant / après : émetteurs 12 704, radios 1 175, liaisons 569 698. Captures deux thèmes.
- [ ] **Step 7: Commit** — `feat(angular): Radio — imports en flux, journal filtrable, historique et zone dangereuse (lot 6, T16)`.

---

### Task 17: Radio II — onglets Radios et Stats (audit du matching)

**Files:**
- Create: `A/radio/{onglet-radios,onglet-stats}.component.ts` (+ specs)
- Modify: `A/radio/radio.page.html`, `A/radio/data/radio-admin.api.ts`

**Sources React :** `app/admin/radio/page.tsx:141-160` (`fetchRadios`, paramètres EXACTS), `:336-337` (chargement à l'ouverture de l'onglet), `:598-718` (recherche, filtre « non matchées », tableau, pagination), `:719-898` (audit : KPI, barre, par catégorie, radios non matchées avec diagnostic et filtres, sources, historique des enrichissements), `app/api/radio/{stations,audit}/route.ts`.

**API :** `GET /api/radio/stations?…`, `GET /api/radio/audit`.

**Pièges :** l'onglet ne lit qu'à son ouverture et ne relit pas à chaque retour si React ne relit pas (lire l.336-337 : il RELIT à chaque passage — parité, le dire) ; recherche : lire si React attend une validation ou une frappe (pas d'anti-rebond inventé) ; pagination par paramètres exacts.

- [ ] **Step 1: Specs (échec)** — ouverture de Radios → un GET aux paramètres exacts ; recherche / filtre / page suivante → paramètres ; ouverture de Stats → un GET `audit` ; sections de l'audit rendues dans l'ordre React.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — 1 175 radios, mêmes pages, même recherche ; audit identique (KPI, catégories, non matchées). Captures deux thèmes.
- [ ] **Step 6: Commit** — `feat(angular): Radio — onglets Radios et audit du matching (lot 6, T17)`.

---

### Task 18: Sources I — cadre, onglets, vue « Toutes », liste et détail d'une source

Le partage d'une source n'est PAS porté : lien « Gérer les droits → Espaces de travail » à la place (spec espaces § 6).

**Files:**
- Create: `A/sources/sources.page.{ts,html}` (+ spec), `A/sources/{liste-sources,detail-source,tuiles-sources}.component.ts` (+ specs), `A/sources/logique/constantes.ts`, `A/sources/data/sources-admin.api.ts` (+ spec)
- Modify: `A/admin.routes.ts`, `layout/navigation.ts` (« Sources » → `admin/sources`)

**Sources React :** `app/admin/sources/page.tsx:1-928` hors panneaux (état l.51-100, lectures l.86-170 dont le chargement PAR ONGLET l.168-175, résumé IA l.180-195, suppression l.196-212 + `ConfirmModal` l.916, export `window.open` l.214-216 (C8), édition nom / organisation l.218-260, partage, filtres de la source l.262-300 avec `meta-keys`, onglets l.370-412, tuiles « Toutes » l.414-438 dont `CustomZonesStatsCard`, liste des sources l.466-880, bloc radio l.528-548, bouton vers l'import l.886 (C8)), `_lib/{theme,styles,types}.ts`, `_components/ui.tsx`, `_components/CustomZonesTab/CustomZonesStatsCard.tsx` + `_hooks/useAdminCustomZonesStats.ts`, routes `app/api/admin/{sources,sources/[id],sources/[id]/summary,sources/[id]/meta-keys,sources/[id]/export,sources-stats,transport-stats,custom-geo/stats}/route.ts`, `app/api/radio/stats/route.ts`.

**API :** `GET /api/admin/sources`, `GET /api/admin/organizations`, `GET /api/admin/sources-stats`, `GET /api/radio/stats`, `GET /api/admin/custom-geo/stats`, `POST /api/admin/sources/[id]/summary`, `PATCH/DELETE /api/admin/sources/[id]`, `GET /api/admin/sources/[id]/meta-keys`, `GET /api/admin/sources/[id]/export` (blob, C8).

**Interfaces — Produces :** `SourcesPage.onglet: WritableSignal<'all' | 'poi' | 'panneaux' | 'carreaux' | 'iris' | 'transport' | 'radio' | 'dsp' | 'custom_zones'>` (contenu des panneaux en T19-T20, provisoire d'ici là) ; `SourcesAdminApi.exporter(id): Observable<HttpResponse<Blob>>` (+ `ENREGISTRER_FICHIER`).

**Pièges :** le chargement au montage lance JUSQU'À cinq lectures (sources, organisations, stats, radio, zones) : le limiteur en laisse passer 3, voulu ; changer d'onglet vide la sélection (l.391) ; les couleurs des onglets et tuiles (`#06b6d4`, `#22c55e`…) → jetons (C9, écarts listés) ; l'export : constater d'abord le 401 côté React (onglet Réseau) puis le téléchargement Angular avec le nom de `Content-Disposition` ; « Importer » → lien relatif `../import` ; le résumé IA appelle Gemini (`GOOGLE_GENERATIVE_AI_API_KEY`) : réel sur une source existante (il ÉCRIT le résumé dans la source : permis ? — c'est une donnée dérivée régénérable : oui, mais le noter) ; suppression d'une source : régime (a) sur la source jetable laissée par T12-T13 si conservée, sinon une source jetable créée par import POI de 3 lignes.

- [ ] **Step 1: Specs (échec)** — montage : lectures attendues, aucune de `transport-stats` avant l'onglet Transport ; onglet → sélection vidée ; détail d'une source : édition PATCH au corps exact, filtres via `meta-keys` puis PATCH ; export → blob + `ENREGISTRER_FICHIER` appelé avec le nom de l'en-tête ; suppression → `mg-confirmation` puis DELETE ; tuile cliquée → onglet correspondant.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — « Toutes » : tuiles identiques (OOH 1 434, POI, carreaux en millions à deux décimales, IRIS 49 448, transport, radio 12 704, zones 7), liste des 5 sources ; détail d'une source (lecture) ; export : 401 React constaté, fichier Angular téléchargé (nom, nombre de lignes égal à la source) ; source jetable éditée puis supprimée ; SQL `data_sources` = 5. Captures deux thèmes.
- [ ] **Step 6: Commit** — `feat(angular): Sources — onglets, vue d'ensemble, liste et détail d'une source (lot 6, T18)`.

---

### Task 19: Sources II — panneaux OOH, Carreaux, Transport, IRIS et POI

**Files:**
- Create: `A/sources/panneaux/{ooh,carreaux,transport,iris,poi}.component.ts` (+ specs), `A/sources/panneaux/dialogue-poi.component.ts` (+ spec), `tests/fixtures/admin/iris-delete.json`
- Modify: `A/sources/sources.page.html`, `A/sources/data/sources-admin.api.ts`

**Sources React :** `_components/OohPanel.tsx:1-122`, `CarreauxPanel.tsx:1-53`, `TransportPanel.tsx:1-192` (tableau repliable, relecture), `IrisPanel.tsx:1-431` + `_hooks/useIrisAdmin.ts:1-171` (stats + métadonnées en parallèle l.83-84, synchronisation l.100-112, année du millésime l.113-118 SANS lecture de la réponse, PMTiles l.120-135, suppression l.140-155), `PoiPanel.tsx:1-319` + `_hooks/usePoiAdmin.ts:1-149` (échantillons paginés par 50 l.85, modale création / édition `fixed` l.261, suppression unitaire l.121-125 et par catégorie l.131-137 SANS lecture de la réponse), routes `app/api/admin/{iris/stats,iris/metadata,iris/delete,sync-iris-system,trigger-pmtiles,poi-samples,poi-manage}/route.ts`.

**API :** `GET /api/admin/iris/stats`, `GET/POST /api/admin/iris/metadata`, `POST /api/admin/sync-iris-system`, `POST /api/admin/trigger-pmtiles`, `DELETE /api/admin/iris/delete`, `GET /api/admin/poi-samples?cat=&limit=50&offset=`, `POST/PUT/DELETE /api/admin/poi-manage` (`?id=`, `?cat=`).

**Pièges :** suppressions et mises à jour React sans lecture de la réponse (`useIrisAdmin.ts:115`, `usePoiAdmin.ts:123,133`) → Angular lit et notifie l'échec (défaut corrigé, listé) ; **`DELETE /api/admin/iris/delete` efface TOUTES les données IRIS** : régime (c), intercepté ; `trigger-pmtiles` déclenche un workflow GitHub (jeton absent en local) : intercepté ; `sync-iris-system` ne fait que comparer (route l.1-30) : réel ; métadonnées (année) : écriture d'un réglage — réel puis remis à la valeur initiale, relevée avant ; POI : régime (a) — création d'un POI `[ESSAI lot 6]` dans la catégorie jetable (recréée si T12 l'a supprimée), édition, suppression unitaire, puis suppression par catégorie de la catégorie JETABLE seulement ; modale POI = `<dialog>`.

- [ ] **Step 1: Specs (échec)** — onglet IRIS : deux GET au plus ensemble ; synchronisation → rapport rendu ; année → POST puis relecture, échec notifié ; PMTiles et suppression IRIS → `mg-confirmation` puis requête ; POI : page 2 → `offset=50` ; création → POST au corps exact ; édition → PUT ; suppression → DELETE `?id=`, réponse 500 → notification et ligne gardée ; suppression par catégorie → `?cat=` ; Transport : repli sans requête, « Rafraîchir » → une requête.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — chaque panneau contre React (chiffres identiques) ; synchronisation IRIS réelle ; PMTiles et suppression IRIS interceptées (corps et méthode relevés) ; POI jetable créé / édité / supprimé ; SQL : `iris` 49 448, `poi_france` 390 029, catégories 9. Captures deux thèmes, dont la modale POI (focus dans le premier champ).
- [ ] **Step 6: Commit** — `feat(angular): Sources — panneaux OOH, Carreaux, Transport, IRIS et POI (lot 6, T19)`.

---

### Task 20: Sources III — campagnes DSP (import SSE) et zones custom

**Files:**
- Create: `A/sources/panneaux/{dsp,zones-custom}.component.ts` (+ specs), `A/sources/panneaux/dialogue-import-dsp.component.ts` (+ spec), `A/sources/panneaux/dialogue-suppression-zone.component.ts` (+ spec), `tests/fixtures/admin/campagne-essai.csv`
- Modify: `A/sources/sources.page.html`, `A/sources/data/sources-admin.api.ts`

**Sources React :** `_components/DspPanel.tsx:1-206` (liste, `Dialog` Radix l.100-190 — fermeture interdite pendant l'import —, `ConfirmModal` l.194), `_hooks/useDspImport.ts:1-154` (liste avec `?_t=` anti-cache l.60-75 — sans objet côté `HttpClient`, le dire —, import multipart `file`/`dsp_source`/`campaign_name` l.80-115 en SSE, suppression l.117-136, réinitialisation), `_components/CustomZonesTab/*` (filtres organisation et type de source, tableau, compteur `fixed` l.134, dialogue de suppression `fixed`), `_hooks/useAdminCustomZones{,Stats}.ts`, routes `app/api/admin/{campaigns,campaigns/import,campaigns/[id],custom-geo/list,custom-geo/[id]}/route.ts` (événements SSE de l'import : `type`, compteurs, `complete.report`).

**API :** `GET /api/admin/campaigns`, `POST /api/admin/campaigns/import` (multipart + SSE, C4), `DELETE /api/admin/campaigns/[id]`, `GET /api/admin/custom-geo/list?…`, `DELETE /api/admin/custom-geo/[id]`.

**Progression (C5)** : React = liste d'événements ; Angular ajoute la barre d'après les compteurs que portent les événements de la route (lire `campaigns/import/route.ts:160-460`), étapes nommées depuis leurs `type`.

**Pièges :** le dialogue d'import ne se ferme pas pendant l'import (`cancel` du `<dialog>` empêché tant que `importEnCours`) ; C13 ; l'import ÉCRIT dans `dsp_campaigns`, `dsp_campaign_data`, rollups : régime (a) avec `campagne-essai.csv` (20 lignes, 3 codes postaux, nom `[ESSAI lot 6] campagne`), supprimée ensuite par l'écran (DELETE) — vérifier par SQL que `dsp_campaign_data` et les rollups de cette campagne ont disparu (cascade) ; zones custom : régime (a), zone jetable créée par `POST /api/custom-geo/source/rayon` + `/save` (`curl` avec un jeton de super_admin, documenté au rapport) puis supprimée par l'écran ; le compteur `fixed` de React devient un élément `sticky`/`absolute` dans la page (C6 étendu, le décrire).

- [ ] **Step 1: Specs (échec)** — import DSP : `FormData` aux trois champs, fixture SSE (dérivée de la route) → événements et barre, `complete` → rapport, notification « Import terminé — N lignes », relecture de la liste ; dialogue non fermable pendant l'import ; suppression → `mg-confirmation` puis DELETE ; zones : filtres → paramètres exacts, suppression → dialogue puis DELETE puis relecture.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — 8 campagnes et 7 zones identiques ; import réel de la campagne jetable dans les deux écrans (même rapport), puis suppression ; zone jetable supprimée ; SQL : `dsp_campaigns` 8, `custom_geo_zones` 7, aucune ligne orpheline. Captures deux thèmes (dialogue d'import début / milieu / fin).
- [ ] **Step 6: Commit** — `feat(angular): Sources — import de campagnes DSP en flux et zones custom (lot 6, T20)`.

---

### Task 21: Parcours complet de l'administration, parité finale, épreuve AIDA, documentation

**Files:**
- Modify: `ARCHITECTURE.md` (§ Application Angular : puce de synthèse « Administration (lot 6) » en fin de section, et la puce « Coquille » : entrées Administration / Systeme désormais branchées), `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (ligne lot 6 ✅ + section « À savoir pour les lots suivants (revue finale du lot 6) »)

- [ ] **Step 1: Parcours complet, React et Angular côte à côte**, 1440 × 900, deux thèmes, compte super_admin : chacune des 12 entrées Administration / Systeme de la barre dans l'ordre, chaque onglet de chaque page (Health ×2, Connexions API ×5, Radio ×3, Sources ×9), et **chaque import rejoué depuis Angular** (livrable de la feuille de route) : OOH (fixture), POI GPS et adresse (réels, jetables), Shapefile (réel, jetable), IRIS crawler (dépôt réel, import fixture), radio ANFR / Arcom / ODS (fixtures), DSP (réel, jetable). Tableau final « écran → chiffre React → chiffre Angular » (tous égaux) ; liste des défauts React corrigés (C2, C5 ×4, C6, C8, C14, réponses non lues ×9, accessibilité de la ligne d'organisation) ; écarts restants justifiés (C1 iris-crawler et `admin` → `health`, C9 substitutions de couleurs, C11 retour OAuth vers React, C16 textes et exemples de marque) ; 375 × 812 sur Users et Sources (constat de parité).
- [ ] **Step 2: Compte `client`** — les 12 entrées → message de refus, zéro requête admin, autonome et hôte.
- [ ] **Step 3: Mesures d'I/O** — onglet Réseau sur le parcours : au plus 3 requêtes `/api` simultanées à tout instant (un flux d'import compte pour une pendant sa durée) ; aucune lecture d'un onglet non ouvert ; organisations, rôles, catégories : une fois par écran ; aucune vérification de qualité ni mesure lourde de fraîcheur lancée sans clic.
- [ ] **Step 4: Comptes SQL finaux** égaux au bloc « Chiffres de référence » (aucun jetable restant : `select … where name like '[ESSAI lot 6]%'` sur chaque table touchée = 0).
- [ ] **Step 5: Épreuve AIDA** (hôte jetable PAR DÉFAUT, `ignoreUnusedDeps: true`, remote en `ng serve` PUIS en build de production) : `/outils/magelian/admin/health` stylé ; Users avec `<dialog>` d'invitation et `mg-confirmation` DANS la racine d'ombre (stylés, Échap) ; notifications visibles en haut à droite au défilement ; un import en flux (fixture servie par `page.route`) qui PROGRESSE avant sa fin (C4) ; un dépôt multipart ; un téléchargement d'export ; journal qui défile SANS faire défiler la page de l'hôte (C14 : `scrollY` de l'hôte inchangé) ; compte `client` → message, URL de l'hôte inchangée ; thème piloté par l'hôte ; tableau de fuite = 0 différence ; 0 propriété sur `<html>` ; aucune erreur console ; limiteur.
- [ ] **Step 6: Gardes** — `npm run test:unit` (dont `portails-hors-ombre`, `gardes-styles`, `imports-partages`, `modele-aida`, `isolement`, `admin-logique-paritaire`, `icones-lucide`) ; `cd angular && npx ng test --watch=false` ; `npm run build` ; `npx tsc --noEmit` à la racine.
- [ ] **Step 7: Documentation** — `ARCHITECTURE.md` : route `admin` et ses enfants, garde par rendu (C2), services de la route (C3), flux SSE/NDJSON (C4), progression (C5), dialogues (C6), notifications (C7), régimes de preuve (C12) ; feuille de route : ligne « 6 — Administration » ✅ avec la date, écarts restants, et « À savoir pour les lots suivants (revue finale du lot 6) » — au minimum : le lot 4 peut brancher Réglages › Back office sur `../admin/…` (liens relatifs depuis la carte) ; le lot 7 re-cible les `oauth/callback` vers l'interface Angular (C11), retire `/dashboard/iris-crawler` et `/admin/*` côté Next, et rapproche `AnnonceService` (lot 4) de `NotificationsService` (C7) ; `app/api/radio/data/route.ts` reste hors git (ARCHITECTURE § RLS) : la question de son suivi reste ouverte.
- [ ] **Step 8: Commit** — `feat(angular): parcours complet de l'administration, parité finale et épreuve AIDA (lot 6, T21)`.

---

## Auto-relecture (faite)

- **Couverture de la spec** : les 12 pages `/admin/*` et leurs sous-pages (T3-T20), `/dashboard/iris-crawler` (T15), « imports avec progression NDJSON » — NDJSON (T11, T15, T16), SSE (T13, T20), lots client (T14), multipart (T12, T15, T16, T20) — et le livrable « chaque import rejoué depuis Angular » (T21, step 1, avec le régime de preuve de chacun).
- **Contraintes du propriétaire** : gel P5 nommé (préalable, T1) ; contrat AIDA (Global Constraints, C3, C4, C6, C7, C8, C11, C14, C15, épreuves T14 et T21) ; parité deux thèmes par tâche ; barre latérale branchée au fil des tâches (`navigation.ts` dans les tâches T3, T5-T7, T9, T11, T12, T14-T16, T18) ; garde super_admin et comportement dans l'hôte (C2, T1, T21) ; fichiers partagés et règle de conflit (section dédiée) ; écrans destructeurs testés sans perte (C12, sauvegarde, comptes SQL).
- **Placeholders** : aucune tâche ne renvoie à « similaire à » ; les fixtures sont dérivées du code de la route, nommées et rangées ; les valeurs qui ne se lisent qu'à l'écran React sont marquées « contre React » avec l'état à reproduire.
- **Types** : `lignesSse` (T1) est celui de T13 et T20 ; `NotificationsService`, `mg-confirmation`, `mg-journal`, `mg-progression-import`, `mg-depot-fichiers` (T2) sont ceux de T3-T20 ; `OrganisationsListeApi` (T6) est réutilisé par T12 et T18 ; `ImportPoiService` (T12) est consommé par T13 ; `DspApi` (T9) sert T10 ; `NAVIGUER_HORS_APPLICATION` (T9) sert T10.
- **Review Focus** : chaque ligne a son test dans la tâche qui possède le code (T1 ; T2 + imports ; T2 ; C12 dans T11-T20 ; T18, T9).

## Questions au propriétaire

1. **Garde super_admin (C2)** — React n'en a pas ; Angular affiche un refus au lieu de pages qui échouent en 403. Garder (défaut) ou parité stricte ?
2. **`proj4` (C10)** — accepter cette dépendance d'exécution pour l'import Shapefile (défaut), ou laisser cet écran en React jusqu'au lot 7 ?
3. **Exemples de marque** d'`organizations/page.tsx:268` (« BMW France », « Mercedes ») — les garder (parité, défaut) ou les remplacer par des exemples génériques des deux côtés ?
