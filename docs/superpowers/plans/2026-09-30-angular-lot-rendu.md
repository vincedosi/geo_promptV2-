# Lot Rendu — parité visuelle Angular ↔ React — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire que l'application Angular soit visuellement IDENTIQUE à l'application Next.js/React sur tout ce qui existe déjà côté Angular — base globale, icônes, marque, coquille, connexion, en-têtes, accueil, bandeau KPI, mobilier de carte, courbe, écran d'essai — avant que le lot 3 ne porte le moindre écran métier.

**Architecture:** On ne redessine rien : on PORTE le rendu React, mesuré à l'écran. Chaque écart porte l'identifiant de l'inventaire (`docs/superpowers/plans/2026-09-30-inventaire-rendu-react-angular.md`, sections § 1.1 à § 1.10 : L1…, S1…, K1…, H1…, D1…, P1…, C1…, E1…, G1…). Contraintes nées du lot AIDA : l'interface vit dans une racine d'ombre (`position: fixed`, `document.body`, `::ng-deep`, `ViewEncapsulation.None` interdits — garde `tests/unit/angular/portails-hors-ombre.test.ts`) ; les sélecteurs globaux vivent dans `angular/src/styles.css` (adoptée par la racine) ; les couleurs MapLibre/ECharts passent par `CouleursService`.

**Tech Stack:** Angular 21.2.4 (zoneless, signals), Tailwind 4, MapLibre 5.18.0, ECharts 6.1.0, Vitest, Playwright (MCP) pour les captures.

**Spec:** objectif fixé par le propriétaire le 2026-09-30, verbatim : « je veux la même chose que Next.js mais Angular en respectant la doc donnée ». Références : `DESIGN_SYSTEM.md` (source de vérité du frontend), le code React (`app/login/page.tsx`, `components/AppSidebar.tsx`, `components/layout/TopRightChrome.tsx`, `app/dashboard/page.tsx`, `components/risques/*`, `app/globals.css`), l'inventaire ci-dessus, la doc AIDA (privée, jamais stagée).

## Arbitrages du chef de projet (questions § 5 de l'inventaire)

1. **Coquille** : `AppSidebar.tsx` (+ `TopRightChrome.tsx`) est la référence pour les pages ; les routes carte et risque sont SANS coquille, comme `/map` en React. Même rendu en autonome et dans le shell AIDA (le contrat AIDA fait de la racine de `remoteRoutes` le shell propre de la remote) ; à revoir seulement si le siège demande de masquer notre navigation.
2. **Icônes** : composant maison `mg-icone`, SVG en ligne recopiant les tracés lucide (licence ISC, mention dans le fichier), zéro dépendance. Remplaçable par `mecha-lib-ui` le jour venu.
3. **Parité stricte**, sauf défaut objectif de React, qu'on corrige et qu'on documente : la popup garde sa marge intérieure Angular (le texte React touche le bord). La réglette native reste comme React (V10 : écart au DESIGN_SYSTEM hérité de React, signalé, pas corrigé ici).
4. **Logo** : `viewBox` inchangé (parité) ; ce sont l'hexagone et la signature, absents aujourd'hui, qui le rendent lisible comme en React.
5. **Connexion** : portée ENTIÈRE, lien d'inscription et vitrine compris. Les chiffres de la vitrine sont repris tels que React les affiche, regroupés dans une constante nommée et commentée comme texte de vitrine statique (dette signalée : React les écrit en dur).
6. **Bouton « MAGELIAN » de la barre** : porté à l'identique, inerte (désactivé, infobulle « Disponible prochainement ») jusqu'à l'overlay campagne du lot 5.
7. **Lissage des polices** : `antialiased`, posé en R0.
8. **Pied « Online »** : même règle que React, affiché seulement hors production.

## Global Constraints

- Angular 21.2.4 exact ; **aucune nouvelle dépendance** (AIDA : seules native-federation et mecha-lib-ui).
- Aucune couleur en dur : jetons de `styles/jetons.css` via classes Tailwind / `var()` dans le DOM ; `CouleursService` pour MapLibre et ECharts.
- Bords 0,5 px (DESIGN_SYSTEM § 7.8) sauf séparateurs de section ; sentence case ; Inter + JetBrains Mono ; flat total (pas d'ombre, de dégradé, de flou) ; pas de violet.
- Interdits de l'isolation : `position: fixed`, `document.body`, `appendTo(Body)`, CDK Overlay, `::ng-deep`, `ViewEncapsulation.None` dans `angular/src/app`. Sélecteurs globaux uniquement dans `angular/src/styles.css`.
- Rien dans `angular/` n'importe hors d'`angular/`. OnPush, `input()`/`output()`, préfixe `mg`.
- **Critère de sortie de TOUTE tâche d'affichage** : captures Angular et React du même écran, même taille de fenêtre (1440 × 900, plus 375 × 812 quand la tâche le dit), même état, DEUX thèmes, rangées côte à côte dans le dossier du chantier sous le nom `<tache>-<ecran>-<theme>-{react,angular}.png`, et un tableau « identifiant d'écart → corrigé / écart restant justifié » dans le rapport. Le chef de projet regarde les paires avant validation.
- Serveurs : React et API `npm run dev` à la racine (:3000) ; Angular `npm start` dans `angular/` (:4200, routes sous `/app`). Identifiants : fichier mémoire `reference_geomatik_credentials.md` (jamais recopiés). Arrêter les serveurs en fin de tâche (arbre complet).
- Après chaque tâche : `cd angular && npx ng test --watch=false && npm run build` verts sans nouvel avertissement ; racine `npx tsc --noEmit` (code de retour lu directement) et `npm run test:unit` verts. Ne jamais pousser ; ne jamais stager la doc AIDA.
- `ARCHITECTURE.md` (§ Application Angular) mis à jour dans le commit de chaque tâche qui ajoute un composant partagé.

## Review Focus

- **Les deux thèmes** : un écart invisible en sombre saute aux yeux en clair (bords, fonds de survol). Chaque paire de captures existe dans les deux thèmes.
- **Petite largeur** (375 px) : coquille en tiroir, connexion empilée — sans `position: fixed`.
- **États** : survol, actif, focus clavier, désactivé, erreur, chargement — comparés, pas seulement l'état de repos.
- **Dans le shell AIDA** : un composant porté ne doit pas réintroduire de fuite (garde des portails, table de fuite de la tâche 8 du lot AIDA rejouée en R11).
- **Texte** : mêmes libellés, même casse, mêmes nombres formatés (`fr-FR`), mêmes tailles et graisses.

---

### Task R0: Base globale et vérification de la barre « x »

**Files:** Modify `angular/src/styles.css` (+ spec structurelle si pertinente).

- [ ] Confirmer au navigateur, en autonome ET dans l'hôte jetable du lot AIDA (voir `task-7-report.md`/`task-8-report.md` pour le lancer), qu'aucune barre vide avec « x » n'apparaît au-dessus de la carte de `/app/essai-carte` sans la sonde `#t8-popup` du script de mesure. Si elle apparaît, c'est un défaut : le diagnostiquer et le corriger dans cette tâche.
- [ ] Porter G1 (`antialiased`), G2 (barres de défilement 6 px, couleurs de `globals.css`), G3 (`::selection` teal), G5 (inventaire § 1.10) ; ajouter un utilitaire Tailwind 4 de bord 0,5 px (`@utility border-fin { border-width: 0.5px; }` et variantes de côté utilisées par la suite) et l'employer là où l'inventaire relève V1.
- [ ] Captures : `/app/catalogue` défilé vs `localhost:3000/dashboard` défilé, deux thèmes.
- [ ] Commit `feat(angular): base globale alignée sur React (lissage, défilement, sélection, bords 0,5 px)`.

### Task R1: Icônes `mg-icone` sans dépendance

**Files:** Create `angular/src/app/ui/icone/icone.component.ts` + `icones.ts` (tracés) + spec ; Modify catalogue.

**Interfaces:** `mg-icone` : `nom` (union littérale des icônes portées), `taille` (px, défaut 16), `trait` (défaut 1.5, comme React `strokeWidth`), `aria-hidden` par défaut, `libelle` optionnel → `role="img"` + `aria-label`.

- [ ] Recenser les icônes lucide utilisées par `AppSidebar.tsx`, `TopRightChrome.tsx`, `app/login/page.tsx`, `app/dashboard/page.tsx`, la légende et les contrôles de `CarteRisque.tsx`, `BandeauKpi.tsx`/`Kpi.tsx`, l'en-tête de l'écran risque (inventaire § 1.1, 1.2, 1.5, 1.6, 1.8). Recopier les tracés depuis `node_modules/lucide-react` de la RACINE (lecture seule, aucune importation), avec la mention ISC.
- [ ] Tests : chaque nom rend un `<svg>` 24 × 24 `viewBox`, `stroke="currentColor"`, taille et trait appliqués ; un nom inconnu ne compile pas (type).
- [ ] Planche dans `/app/catalogue` ; capture à 14/16/20 px comparée aux mêmes icônes rendues par React (`/dashboard`).
- [ ] Commit `feat(angular): icônes mg-icone, tracés lucide sans dépendance`.

### Task R2: Marque — hexagone, signature, tailles de logo

**Files:** Modify `angular/src/app/ui/logo/*` ; Create `angular/src/app/ui/hexagone/*`.

- [ ] Porter l'hexagone (28 px barre, 15 px ailleurs selon React) et la signature « Geospatial intelligence » (`AppSidebar.tsx:170-203`), tailles de logo (18 px de haut dans la barre, 240 px de LARGE à la connexion — `app/login/page.tsx:102`).
- [ ] Captures : en-tête de barre latérale vs `/dashboard`, deux thèmes.
- [ ] Commit.

### Task R3: Coquille = `AppSidebar` + chrome haut-droite

**Files:** Modify `angular/src/app/layout/coquille.component.*` ; Create `angular/src/app/layout/chrome-haut.component.ts` (+ specs).

- [ ] Porter S1… de l'inventaire § 1.2 : sections et libellés, liens arrondis avec icônes, survol/actif, séparateurs 0,5 px, pied « Online » hors production, bouton « MAGELIAN » inerte (arbitrage 6), thème et session dans un chrome haut-droite (`absolute` dans `main`, jamais `fixed`), contenu `p-8` comme `MainPadding.tsx`.
- [ ] Petite largeur (< 768 px) : tiroir comme React (`Sheet`), en `absolute` dans la racine, fermeture par Échap et clic extérieur, focus rendu au déclencheur ; tests.
- [ ] Les liens restent RELATIFS (contrat AIDA) ; `remote.spec.ts` reste vert.
- [ ] Captures `/app/` vs `/dashboard` à 1440 et 375 px, deux thèmes, états survol/actif.
- [ ] Commit.

### Task R4: Routes plein écran pour carte et risque

**Files:** Modify `angular/src/app/app.routes.ts` (+ `remote.spec.ts`, `app.config.spec.ts`).

- [ ] `essai-carte` (et, pour la suite, les routes carte/risque) monte HORS de `mg-coquille`, toujours sous `RacineDistanteComponent` et ses fournisseurs, avec `authGuard`. Liens relatifs conservés ; le lien « Essai carte » de la coquille y mène toujours.
- [ ] Tests de routage (autonome et hôte simulé) ; capture pleine hauteur sans barre latérale vs l'écran risque React ouvert depuis `/map`.
- [ ] Commit.

### Task R5: Connexion en écran partagé

**Files:** Modify `angular/src/app/features/connexion/*` (+ spec).

- [ ] Porter L1-L17 (inventaire § 1.1) : écran partagé 50/50, formulaire (logo 240 px de large, titres, champs conformes DESIGN_SYSTEM § 5 « Inputs » : `8px 12px`, bord 0,5, focus en BORDURE teal 50 %), CTA blanc (survol `#d4d4d4` via jeton), lien d'inscription (arbitrage 5), vitrine avec ses chiffres dans une constante nommée (arbitrage 5), empilement < 768 px, message d'erreur de démarrage et d'identifiants habillés comme React.
- [ ] Tests : états repos / erreur / envoi.
- [ ] Captures `/connexion` vs `localhost:3000/login` à 1440 et 375 px, deux thèmes, trois états.
- [ ] Commit.

### Task R6: En-têtes — section, page, écran

**Files:** Create `angular/src/app/ui/entete-section/*`, `angular/src/app/ui/entete-page/*` ; Modify catalogue, accueil ; `angular/src/app/ui/pastille/pastille.component.ts` (R12 : transition `var(--ease-out)`).

- [ ] `mg-entete-section` = `.geo-section-header` (`globals.css:527-550`, DESIGN_SYSTEM § 5) : bandeau `--bg-level-2`, trait haut, point teal 6 px, libellé Inter 500 12 px, chevron optionnel pour les sections repliables ; `mg-entete-page` : titre 18 px −0,02em + sous-titre. Corriger V2 et V9.
- [ ] Captures : bandeau « Navigation rapide » et titre « Dashboard » vs `/dashboard`.
- [ ] Commit.

### Task R7: Accueil = tableau de bord

**Files:** Modify `angular/src/app/features/accueil/*` ; Create `angular/src/app/ui/tuile-chiffre/*` (nom ≠ `mg-carte`).

- [ ] Porter D1-D4 (inventaire § 1.5) : cartes de chiffre (icône teal 20 px, valeur mono 15/500, libellé 12 tertiaire, `16px 18px`, bord 0,5, rayon 6, survol), disposition de `app/dashboard/page.tsx` pour ce que l'accueil Angular affiche aujourd'hui (le compte des sites à risque). Ce qui, dans le tableau de bord React, dépend d'écrans pas encore portés est listé dans le rapport, pas inventé.
- [ ] Captures vs `/dashboard` (rangée de cartes, survol), deux thèmes.
- [ ] Commit.

### Task R8: Bandeau KPI

**Files:** Create `angular/src/app/ui/bandeau-kpi/*` ; Modify `angular/src/app/ui/kpi/*`, `essai-carte`.

- [ ] Porter K1-K5 (inventaire § 1.3) : conteneur `--bg-level-2`, traits 0,5 haut et bas, `10px 20px`, `gap 26`, retour à la ligne ; tuile KPI conforme ; valeurs périmées (`mgPerime`) posées.
- [ ] Captures vs le bandeau de l'écran risque, étape ② Rayon.
- [ ] Commit.

### Task R9: Mobilier de carte — contrôles, légende, popup

**Files:** Modify `angular/src/app/carte/*`, `angular/src/app/carte/contenu-popup.ts`, `styles.css`, `essai-carte` ; Create `angular/src/app/carte/legende/*`.

- [ ] Porter P1-P9 (inventaire § 1.6) : `NavigationControl` et raccourcis de zone comme React, légende (conteneur générique + contenu niveaux/anneaux, jetons CSS dans le DOM), avertissement de zoom, popup (typographie : mono seulement pour les nombres — V8 ; marge intérieure gardée — arbitrage 3).
- [ ] Captures : coin bas-gauche et popup d'un site de Berre-l'Étang, même cadrage, vs l'écran risque React étape ② Rayon, deux thèmes.
- [ ] Commit.

### Task R10: Courbe identique à Recharts

**Files:** Modify `angular/src/app/graphiques/option-courbe.ts`, `courbe.component.ts` (+ specs).

- [ ] Porter C1-C13 (inventaire § 1.7) : courbes lissées (`monotone` → `smooth` équivalent), grille pointillée et teinte, polices des axes, légende, infobulle SANS ombre (V7) et au rendu de React, repère « Rayon 5 km ». Couleurs toujours par jetons.
- [ ] Tests d'option (lissage, grille, infobulle sans ombre).
- [ ] Captures : courbe + légende + infobulle au survol du point 5 km vs l'écran risque étape ②, deux thèmes.
- [ ] Commit.

### Task R11: Composition de l'écran d'essai sur le squelette risque

**Files:** Modify `angular/src/app/features/essai-carte/*`.

- [ ] Porter E1-E6 (inventaire § 1.8) : écran plein, en-tête d'écran avec fil d'étapes, barre commune, barre de progression à sa place, bandeau KPI, panneau gauche (courbe + réglette) / carte droite, proportions identiques à 1440 px.
- [ ] Captures d'ensemble vs l'écran risque React étape ② Rayon, deux thèmes ; KPI 13 841 288 inchangé.
- [ ] Rejouer dans l'hôte AIDA par défaut la table de fuite du lot AIDA (tâche 8) : zéro différence, aucune fuite inverse — le lot Rendu ne doit pas avoir rouvert l'isolation.
- [ ] Documentation : `ARCHITECTURE.md` (composants partagés ajoutés), feuille de route (ligne « Rendu » ✅ avec la date, et les écarts restants justifiés).
- [ ] Commit.
