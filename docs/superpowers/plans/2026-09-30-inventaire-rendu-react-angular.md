# Inventaire de rendu React ↔ Angular — préparation du lot « Rendu »

> Analyse en LECTURE seule, 2026-09-30. Aucun navigateur, aucun serveur, aucune
> modification. Chaque affirmation cite `fichier:ligne`. Le code Angular lu est
> la copie de travail (branche `feat/angular-lot0`, y compris les modifications
> non commitées de la reprise de la tâche 8 : `styles.css`, `feuilles.ts`,
> `carte.component.ts`, `racine-ombre.ts`).
>
> Chemins abrégés : `ng/` = `angular/src/app/`, `R/` = racine du dépôt.

---

## 0. Réponses courtes

| Question | Réponse |
|---|---|
| La barre vide avec un « x » au-dessus de la carte | **Artefact de mesure, pas l'application.** `task-8-report.md:239` : « The popup probe `#t8-popup` (a synthetic `.maplibregl-popup-content` injected by the measurement script) shows as an empty bar with an « x » on some screenshots ». Cohérent avec le code : une popup n'existe qu'au clic sur un site (`ng/features/essai-carte/essai-carte.page.ts:369`) et est bornée à `maxWidth: '260px'` (`:394`), donc ne peut pas faire toute la largeur. Absente de `task-4-sombre.png` (avant la tâche 8) et de `task-8-fix1-prod-hote-hostile-sombre.png` (après). La barre est un `div` synthétique hors du flux MapLibre, stylé par NOTRE surcharge `.maplibregl-popup-content` (`ng/../styles.css:144-149` : fond surface, bord 0,5 px, rayon 6 px). `maplibre.css` est bien appliquée dans la racine : l'attribution est positionnée en bas à droite sur la même capture. **À confirmer une fois au navigateur (tâche R0), pas à corriger.** |
| Le logo « minuscule » | Fidèle à React dans la barre latérale, et c'est le fichier source qui le rend petit : le `viewBox` fait 1600 × 360 (`ng/ui/logo/logo.component.ts:28`) mais les lettres n'occupent que y = 141 → 220, soit 79/360 de la hauteur. À 18 px (`ng/layout/coquille.component.html:4` comme `R/components/AppSidebar.tsx:195`), les lettres font **≈ 4 px**. React compense par un hexagone de 28 px (`AppSidebar.tsx:170-190`) et une signature « Geospatial intelligence » (`:198-203`) — absents côté Angular. À la connexion, l'écart est réel : React 240 px de LARGE (`R/app/login/page.tsx:102`, ≈ 54 px de haut, lettres ≈ 12 px) contre `h-5` = 20 px de haut (`ng/features/connexion/connexion.page.html:11`, lettres ≈ 4,4 px). |
| Coquille de référence | **`AppSidebar.tsx` pour les pages hors carte, AUCUNE coquille pour la carte et le module risque.** Voir § 1.2. |
| Dépendance d'icônes | `angular/package.json` n'a aucune bibliothèque d'icônes. Recommandation : un composant `mg-icone` en SVG en ligne recopiant les tracés lucide (licence ISC), **zéro dépendance**. `lucide-angular` exigerait un arbitrage (contrainte AIDA : seules native-federation et mecha-lib-ui). Voir § 5. |
| Régressions dues à l'isolation | **Aucune confirmée.** Tous les écarts visibles sont des portages jamais faits (§ 3). Une contrainte NOUVELLE pèse en revanche sur le portage : `position: fixed` est interdit (`R/tests/unit/angular/portails-hors-ombre.test.ts:24-28, 59-60`), or React l'utilise pour la barre latérale, le chrome haut-droite et l'overlay risque. |

---

## 1. Écarts par paire d'écrans

Légende colonnes : **Dim.** = dimension (Lay. mise en page · Typo · Coul. · Esp. espacement · Bord. · Icô. · État · Resp.).

### 1.1 Connexion — `R/app/login/page.tsx` ↔ `ng/features/connexion/connexion.page.html`

| # | Dim. | React | Angular |
|---|---|---|---|
| L1 | Lay. | Écran partagé 50/50, formulaire à gauche, vitrine à droite (`page.tsx:77-92`, `:318-329`) — c'est ce que prescrit `DESIGN_SYSTEM.md` § 6 « Page login » | Carte de 320 px centrée sur le fond (`connexion.page.html:1`, `:9`) |
| L2 | Lay. | Pas de carte : colonne `maxWidth: 340` posée sur `--bg-primary` (`:94`) | `bg-surface border border-subtle rounded-lg p-6` (`:9`) — la « boîte grise » |
| L3 | Lay. | Logo `width={240}` (`:99-104`) | `mg-logo class="h-5"` (`:11`) — ~4,5× plus petit |
| L4 | Typo | Titre 15 px / 500 (`:109`) + sous-titre 13 px tertiaire « Accédez à votre espace de travail » (`:112-116`) | `text-lg` = 18 px (`:12`), pas de sous-titre |
| L5 | Typo | Libellé « Email », 12 px tertiaire, `marginBottom: 6` (`:124-127`) | « Adresse e-mail », `text-xs` tertiaire, `gap-1` = 4 px (`:14-15`) |
| L6 | Bord./Esp. | Champ : `--bg-level-2`, bord **0,5 px** subtle, rayon 6, `9px 12px`, 13 px (`:136-142`) | `bg-elevated` ✓, `border` = **1 px** (`:17`, `:24`), `px-3 py-2` = 8 px vertical |
| L7 | Typo | Placeholders « nom@entreprise.com », « •••••••• » (`:133`, `:185`) | Aucun |
| L8 | État | Focus : la BORDURE passe à `rgba(78,205,196,0.5)` (`:143`, `:195`) | Contour global 1 px teal-50 décalé de 1 px (`ng/../styles.css:131-134`) — couleur juste, forme différente |
| L9 | Lay. | « Mot de passe oublié ? » 11 px + encart d'aide (`:150-179`) | Absent |
| L10 | Icô. | Œil / œil barré lucide 16 px dans le champ (`:198-214`) | Absent |
| L11 | Coul./Icô. | Erreur : encart `rgba(255,87,87,.10)`, bord 0,5 `rgba(255,87,87,.2)`, rayon 6, icône `AlertCircle` 14 px (`:219-236`) | Texte nu `text-xs text-danger` (`:29`) |
| L12 | État | Bouton pleine largeur, `10px 0`, survol `#d4d4d4` (`:253`), attente : fond `--border-default`, texte tertiaire, spinner SVG (`:245-262`) | `bg-primary text-page py-2.5`, `disabled:opacity-50`, **aucun survol**, pas de spinner (`:33-36`) |
| L13 | Lay. | Bascule « Pas de compte ? Inscription » (`:269-303`) | Absente (question § 5 : volontaire ?) |
| L14 | Lay. | Pied : trait 0,5 px, point `--success` 6 px + « Tous les systèmes opérationnels » mono 11 px (`:306-313`) | Absent |
| L15 | Lay. | Vitrine : `--bg-surface`, bord gauche 0,5 px, grille d'hexagones SVG 260 px, accroche 15/13 px, rangée de 4 chiffres mono 18 px (`:318-407`) | Absente |
| L16 | Resp. | Vitrine masquée sous `md`, formulaire pleine largeur (`:92`, `:319`) | Aucune règle |
| L17 | État | Apparitions échelonnées `fadeIn` (`:347`, `:393`) | Aucune |

**17 écarts.** Le chemin d'erreur de démarrage (`connexion.page.html:2-7`) n'a pas d'équivalent React : à garder, mais habillé comme L11.

### 1.2 Coquille — `R/components/AppSidebar.tsx` (+ `R/components/layout/TopRightChrome.tsx`, `MainPadding.tsx`) ↔ `ng/layout/coquille.component.html`

**Quelle référence ?** Trois sources concordent :
- La feuille de route place « coquille (barre latérale, routes) » au lot 0 et le rail de `/map` au lot 4 (`R/docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md:65`, `:72`) : ce sont deux objets distincts.
- React masque `AppSidebar` sur `/map` (`AppSidebar.tsx:348`) et retire le padding de page (`R/components/layout/MainPadding.tsx`), et l'overlay risque est plein écran (`R/components/risques/AnalysePopulationOverlay.tsx:901`, `position: fixed, inset: 0`).
- `DESIGN_SYSTEM.md` § 6 : « Sidebar » pour les pages, « Page copilote/map — Pas de sidebar (plein écran) ».

⇒ **La coquille Angular = `AppSidebar`** (240 px, marque, sections, icônes, pied « Online ») pour accueil, catalogue et plus tard l'administration ; **les routes carte et risque (dont `essai-carte`) se rendent SANS coquille**, en pleine hauteur, et leur navigation sera le rail du lot 4 (`R/components/map/RailNavigation.tsx`, 76 px, `R/lib/navigation/config.ts:60`). Aujourd'hui `essai-carte` est enfant de la coquille — c'est l'écart de composition n° 1 de l'écran (§ 1.6).

| # | Dim. | React | Angular |
|---|---|---|---|
| S1 | Lay./Bord. | `aside` 240 px, bord droit **0,5 px** (`:355-360`) ; `fixed` | `w-60` ✓, `border-r` = **1 px** (`coquille.component.html:2`). `fixed` interdit côté Angular (garde des portails) : garder le flex |
| S2 | Lay. | Hexagone SVG 28 px (trait teal 1 et 0,5, point 2 px) + logotype 18 px, `gap-2`, `px-4 pt-5 pb-4` (`:167-197`) | Logotype seul, `px-4 py-4` (`:3-5`) |
| S3 | Typo | « Geospatial intelligence » 11 px tertiaire, retrait 36 px (`:198-203`) | Absent |
| S4 | Bord. | Séparateur 0,5 px sous la marque (`:206`) | Absent |
| S5 | Lay. | Bouton blanc « MAGELIAN » (hexagone 15 px + `ArrowUpRight`), 12,5 px / 500, `letter-spacing .03em` (`:209-234`) — ouvre l'overlay campagne | Absent (rien à ouvrir avant le lot 5 — question § 5) |
| S6 | Esp. | `nav` `px-3 py-3`, sections espacées de `mt-5` (`:237-239`) | Liens posés bord à bord, sans conteneur (`:6-18`) |
| S7 | Typo | Titres de section 11 px tertiaires, `mb-2 px-3` (`:240-245`) | Aucun |
| S8 | Lay./Esp. | Lien : `rounded-md`, `gap-2.5`, `px-3 py-[9px] pl-[10px]`, 13 px, `leading-none` (`:103-104`, `:122`) — pastille arrondie à l'intérieur de la colonne | `px-4 py-2 text-[13px]`, carré, pleine largeur (`:8`) |
| S9 | Icô. | Icône lucide 16 px, trait 1,5 ; tertiaire → secondaire au survol, primaire actif (`:114-121`) | Aucune |
| S10 | État | Survol : `bg-level-2`, texte primaire, `translate-x-[2px]`, 150 ms (`:105`, `:108`) | Aucun |
| S11 | État | Actif : `bg-level-3`, texte primaire, bord gauche 2 px primaire (`:107`) | `bg-overlay` (= level-3) + `border-l-2 border-primary` (`:6`) — **identique** ✓ |
| S12 | Lay. | Badges « Admin » / « Sys » 10 px, `bg-level-3`, bord `--border-default` (`:123-132`) | Absent (pas encore d'entrées admin) |
| S13 | État | Apparition échelonnée 40 ms/entrée (`:250-257`) | Absente |
| S14 | Lay. | Pied (dev) : point `--success` pulsant + « Online » mono 11 + horloge mono 10 (`:268-306`). Thème et session vivent AILLEURS : chrome haut-droite `ThemeToggle` (Sun/Moon 15 px) + `SessionBadge` (`TopRightChrome.tsx:15-24`) | Pied : email mono, « Thème clair », « Se déconnecter » en texte nu (`:19-29`) |
| S15 | Bord. | Séparateur du pied 0,5 px (`:270`) | `border-t` 1 px (`:19`) |
| S16 | Esp. | Contenu : `md:pl-[240px]` + `p-8` (32 px) (`MainPadding.tsx`) | `main` sans marge ; chaque page pose `p-6` (24 px) |
| S17 | Resp. | Sous `md` : barre masquée, bouton `Menu` 16 px en haut à gauche ouvrant un tiroir (`:313-340`, `:356`) | Toujours affichée |

**17 écarts (dont S11 conforme, 16 à traiter).** ⚠ Défaut React à NE PAS porter : le rail écrit `color: 'var(--background)'` (`R/components/map/RailNavigation.tsx:120`, `:137`), un triplet HSL shadcn — le piège décrit par `DESIGN_SYSTEM.md` § 3 « Deux familles de jetons ».

### 1.3 Tuile KPI et bandeau — `R/components/risques/Kpi.tsx` + `BandeauKpi.tsx` ↔ `ng/ui/kpi/kpi.component.ts` + `essai-carte.page.html`

La tuile elle-même est un portage FIDÈLE : valeur mono 24/22 px `leading-[1.1]`, libellé 12/11 px secondaire, note 10 px tertiaire, `gap-px` (`kpi.component.ts:12-18` ↔ `Kpi.tsx:46-62`). Les écarts sont dans l'assemblage :

| # | Dim. | React | Angular |
|---|---|---|---|
| K1 | Lay./Coul./Bord. | Bandeau : `--bg-level-2`, traits 0,5 px haut ET bas, `padding: 10px 20px`, `gap: 26`, `flexWrap` (`BandeauKpi.tsx:168-175`) | `div class="flex gap-8"` nu (32 px), sans fond ni trait (`essai-carte.page.html:24`) |
| K2 | Coul. | Accent teal sur le total et le taux d'utile (`:181`, `:214`) | Aucun accent |
| K3 | Typo | Consigne finale 10 px tertiaire, `maxWidth 260`, infobulle de définition (`:227-241`) | Absente |
| K4 | Lay. | Bandeau pleine largeur SOUS la barre de progression, au-dessus du corps (`AnalysePopulationOverlay.tsx:1240-1259`) | Deux tuiles sous la carte, dans le flux de la page |
| K5 | Lay. | Six tuiles, enveloppées dans `Perime` (`:1250-1259`) | Deux ; `mgPerime` existe (`ng/ui/perime/perime.directive.ts`) mais n'est pas posé |

**5 écarts.** Le contenu des six chiffres relève du lot 3 ; le CONTENEUR (K1, K3) est un composant réutilisable à porter maintenant.

### 1.4 En-tête de section — `DESIGN_SYSTEM.md` § 5 + `R/app/globals.css:527-550` ↔ rien

| # | Dim. | React | Angular |
|---|---|---|---|
| H1 | Lay. | Classe `.geo-section-header` : `--bg-level-2`, trait haut 1 px, `10px 14px`, point teal 6 px en `::before`, libellé Inter 500 12 px primaire (`globals.css:527-550`), utilisée par le tableau de bord (`R/app/dashboard/page.tsx:166`) | Aucun composant, aucune classe |
| H2 | Lay. | En-tête d'écran risque : `--bg-surface`, trait bas 0,5, `14px 20px`, point teal 7 px + titre 15 px / 500 (`AnalysePopulationOverlay.tsx:908-918`) | `essai-carte` : `h1 text-lg` + paragraphe (`essai-carte.page.html:3-6`) |
| H3 | Typo | Titre de page 18 px / 500, `letter-spacing: -0.02em`, sous-titre 13 px tertiaire, `marginBottom: 32` (`dashboard/page.tsx:104-114`) | `text-lg tracking-tight` = −0,025em, pas de sous-titre (`ng/features/accueil/accueil.page.html:2`, `ng/features/catalogue/catalogue.page.html:3`) ; `essai-carte` sans `tracking` (`:4`) |
| H4 | Lay. | — | Sous-titres du catalogue en `h2 text-xs font-medium` sans bandeau ni point (`catalogue.page.html:5`, `:17`, `:25`, …) |

**4 écarts.**

### 1.5 Accueil — `R/app/dashboard/page.tsx` ↔ `ng/features/accueil/accueil.page.html`

| # | Dim. | React | Angular |
|---|---|---|---|
| D1 | Lay./Icô. | Carte de chiffre : icône teal 20 px, puis valeur mono 15 / 500, puis libellé 12 tertiaire ; `16px 18px`, bord 0,5 subtle, rayon 6 (`:117-152`) | Libellé AVANT la valeur, valeur `text-base` (16 px), pas d'icône ; `border` 1 px, `rounded-lg` (8 px), `p-4` (`accueil.page.html:4-17`) |
| D2 | État | Survol : bord `--border-default` + `translateY(-1px)` (`:129-136`) | Aucun |
| D3 | Esp. | Conteneur `maxWidth: 960` centré (`:101`) + `p-8` de `MainPadding` | `p-6`, aligné à gauche (`:1`) |
| D4 | Lay. | Rangée de 4 cartes en grille, section « Navigation rapide » + grille 3 colonnes (`:117`, `:166-205`) | Une carte |

**4 écarts.**

### 1.6 Carte, légende et popup — `R/components/risques/CarteRisque.tsx` ↔ `ng/carte/carte.component.ts` + `ng/carte/contenu-popup.ts` + `essai-carte.page.*`

| # | Dim. | React | Angular |
|---|---|---|---|
| M1 | Lay. | La carte remplit son volet (`position: relative, 100 % × 100 %`, `CarteRisque.tsx:968`), sans cadre, à droite du panneau d'étape (`AnalysePopulationOverlay.tsx:1302-1320`) | Boîte de 520 px de haut, `border` 1 px, dans une page à `p-6` (`essai-carte.page.html:12-13`) |
| M2 | Icô. | Zoom +/− (`NavigationControl`, sans boussole) en haut à droite (`:327`) | Aucun contrôle (`carte.component.ts:115-121`) |
| M3 | Lay. | Attribution compacte ajoutée en bas à droite (`:325`, `:328`) | `attributionControl: { compact: true }` (`:120`) — même résultat ✓ |
| M4 | Lay./Coul. | **Légende** en bas à gauche : `--card-overlay`, bord 0,5 subtle, rayon 8, `9px 11px`, `maxWidth 260` ; par niveau un libellé 10,5 px secondaire et des carrés 13 px rayon 3 à l'opacité de la bande, rayons en mono 9,5 ; note 9,5 px tertiaire (`:1003-1047`) | **Absente** |
| M5 | Lay. | Boutons « aller à une grappe » en haut à gauche, 11 px, `--card-overlay`, bord 0,5 `--border-default`, rayon 6 (`:972-997`) | Absents |
| M6 | Coul. | Avertissement sous z7 : fond `rgba(247,183,49,.12)`, bord 0,5, texte `--warning` 11 px (`:1052-1065`) | Absent |
| M7 | État | Pastille « Découpage des zones… » 10,5 px en haut à droite (`:1067-1079`) | Remplacée par la barre de progression globale — acceptable, à arbitrer |
| P1 | Esp. | Contenu de popup `padding: 0 !important` (`R/app/globals.css:1053`) | `padding: 8px 10px !important` (`ng/../styles.css:147`) — écart volontaire ? le texte React touche le bord (question § 5) |
| P2 | État | Entrée `popup-in` 180 ms, `scale(.96)` (`globals.css:1045-1056`) | Aucune |
| P3 | Typo | Bloc Inter 11,5 px, interligne 1,55 ; titre 500, `marginBottom 2` ; UNE ligne tertiaire « statut · ville · nature » (`CarteRisque.tsx:655-669`) | `text-xs` (12 px) ; titre `font-medium` ; une ligne par champ « Libellé : » tertiaire + valeur en **JetBrains Mono** (`contenu-popup.ts:9-24`) |
| P4 | État | Bouton de fermeture : défaut MapLibre, hérite de la couleur du texte | Idem ✓ |

**11 écarts (M3, P4 conformes ; 9 à traiter).** Les couches elles-mêmes (anneaux tiretés, survol, PPRT, étiquettes de rayon) relèvent du lot 3.

### 1.7 Courbe — `R/components/risques/OngletRayonInfluence.tsx` (Recharts) ↔ `ng/graphiques/option-courbe.ts` + `courbe.component.ts` (ECharts)

| # | Dim. | React | Angular |
|---|---|---|---|
| C1 | Lay. | `type="monotone"` (`:340-341`) | Segments droits (`smooth` absent, `option-courbe.ts:63-69`) |
| C2 | Lay. | Épaisseur totale 2,2, natures 1,3 (`:344`) | 2 (`essai-carte.page.ts:255`) et 1,5 par défaut (`option-courbe.ts:68`) |
| C3 | Bord. | Grille horizontale seule, `strokeDasharray="2 4"`, `--border-subtle` (`:304`) | `splitLine` pleine (`option-courbe.ts:54`) |
| C4 | Typo | Graduations JetBrains Mono 10 px tertiaire (`:311`, `:316`) | **Inter** 10 px (`option-courbe.ts:39`) |
| C5 | Bord. | Deux axes tracés en `--border-default` (`:312`, `:317`) | Axe X en `--border-subtle` (`:48`), axe Y non tracé (défaut ECharts d'un axe de valeurs) |
| C6 | Lay. | Graduations X fixes 1 à 10 km (`:309`) | Intervalle automatique |
| C7 | Coul. | Repère : trait **teal** tireté 3 3, 1 px, SANS libellé (`:337`) | Trait `--text-secondary` tireté, libellé vertical « Rayon 5 km » (`option-courbe.ts:72-78`, `courbe.component.ts:152-155`) |
| C8 | Bord./Coul. | Infobulle : `--card-overlay`, bord **0,5**, rayon 6, Inter 11, titre « à moins de X km » (`:320-330`) — plate | ECharts : fond `--bg-level-1`, bord **1 px** et rayon 4 par défaut, et **ombre `shadowBlur: 10`** par défaut (`angular/node_modules/echarts/lib/component/tooltip/TooltipModel.js:81-88`) — non surchargés (`option-courbe.ts:56-62`) |
| C9 | Esp. | Marges `top 4/20, right 20, bottom 24, left 8`, axe Y 54 px (`:303`, `:318`) | `grid: { left: 56, right: 16, top: 16, bottom: 28 }` (`option-courbe.ts:42`) |
| C10 | Lay./Bord. | Légende sous un trait 0,5 px, `10px 20px 6px`, `gap 6px 14px`, trait de couleur 14 × 2,5 rayon 2, **valeur au rayon** en mono 10, masquée = opacité 0,5 (`:361-397`) | `mt-2 gap-x-3 gap-y-1`, trait 12 × 2, barré si masquée, pas de valeur (`courbe.component.ts:106-116`) |
| C11 | Lay. | Étiquettes au kilomètre sur la courbe totale, halo `--bg-level-1` (`:347-350`, `:426-446`) | Absentes |
| C12 | Lay. | Rangée au-dessus : réglette `accentColor` teal, lecture mono 12, « lecture immédiate », case « Afficher les étiquettes », export (`:248-280`) | Absente (la réglette existe : `ng/ui/reglette/reglette.component.ts`) |
| C13 | Typo | Note de lecture 10 px tertiaire sous la légende (`:399-414`) | Absente |

**13 écarts.** Rien ici n'exige une dépendance : tout se règle dans l'option ECharts (`smooth`, `splitLine.lineStyle.type: [2,4]`, `axisLine`, `interval`, `tooltip.shadowBlur: 0`, `borderWidth: 0.5`, `borderRadius: 6`, `extraCssText`) et dans le gabarit de la légende.

### 1.8 Composition de `essai-carte` ↔ l'écran risque React, étape ② Rayon

Référence : `R/components/risques/AnalysePopulationOverlay.tsx:896-1320` (ouvert depuis `/map`, `R/app/map/page.tsx:1200-1205`).

| # | Dim. | React | Angular |
|---|---|---|---|
| E1 | Lay. | Plein écran, fond `--bg-primary`, colonne (`:899-904`) | Page enfant de la coquille (`ng/app.routes.ts:52-56`) |
| E2 | Lay. | Barre d'en-tête (H2) portant fil d'Ariane, **fil d'étapes**, cible mono 11, résumé du profil, exports, fermer `X` 18 px (`:908-970`) | `h1` + sous-titre (`essai-carte.page.html:3-6`) ; `mg-fil-etapes`/`mg-fil-ariane` existent mais ne sont pas posés |
| E3 | Lay. | Barre commune : `Champ` + `select` (`--bg-level-2`, 0,5, rayon 6, `6px 10px`, 12 px — `:1690-1698`), pastilles, réglette ; `padding 12px 20px`, `gap 18`, puis rangée des filtres sous un trait 0,5 (`:980-1110`) | Absente |
| E4 | Lay. | Barre de progression ENTRE la barre commune et les chiffres (`:1240`) | En tête de page (`essai-carte.page.html:2`) |
| E5 | Lay. | Bandeau KPI (§ 1.3) | Deux tuiles sous la carte |
| E6 | Lay. | Corps : panneau d'étape à gauche (largeur réglable, `padding 16px 20px`) + carte à droite (`:1302-1320`) ; la courbe vit DANS le panneau ② | Carte, tuiles et courbe empilées verticalement |

**6 écarts.** `essai-carte` est une page de preuve ; la recomposer sur ce squelette sert d'épreuve visuelle aux briques avant le lot 3.

### 1.9 Briques du lot 1 (contrôle)

`fil-etapes`, `fil-ariane`, `champ`, `pastille`, `th/td`, `reglette` sont des portages fidèles de `R/components/risques/FilArianeEtapes.tsx:62-124`, `elements.tsx:31-156` et `RegletteRayons.tsx:163-192` (tailles, couleurs, soulignement teal 2 px, `accentColor`). Un seul écart : la transition de `mgPastille` utilise la courbe par défaut de Tailwind (`ng/ui/pastille/pastille.component.ts:11`) au lieu de `var(--ease-out)` (`elements.tsx:55`). **1 écart.**

### 1.10 Base globale — `R/app/globals.css:394-431` ↔ `ng/../styles.css:67-134`

| # | React | Angular |
|---|---|---|
| G1 | `-webkit-font-smoothing: antialiased` (`globals.css:406`) | `auto !important` (`styles.css:124`, ajouté par la reprise de la tâche 8, non commitée) — visible sur macOS seulement |
| G2 | Barres de défilement 6 px, pouce `--border-default`, survol `--border-hover` (`:417-431`) | Barres natives (visibles sur toutes les captures) |
| G3 | `::selection` teal 20 % (`:410-413`) | Défaut du navigateur |
| G4 | Interligne 1,5 (préflight Tailwind 3, rien dans `globals.css`) ; taille par défaut 16 px | `line-height: 1.6`, `font-size: 13px` sur `:host` (`styles.css:77`, `:88`) — plus proche du DESIGN_SYSTEM, mais tout texte sans `leading` explicite est 7 % plus aéré qu'en React |
| G5 | Transition de fond/texte 200 ms au changement de thème (`:407`) | Aucune |

**5 écarts.**

### Total

| Écran | Écarts |
|---|---|
| Connexion | 17 |
| Coquille | 16 (+1 conforme) |
| Tuile/bandeau KPI | 5 |
| En-tête de section | 4 |
| Accueil | 4 |
| Carte, légende, popup | 9 (+2 conformes) |
| Courbe | 13 |
| Composition essai-carte | 6 |
| Briques lot 1 | 1 |
| Base globale | 5 |
| **Total** | **80** |

---

## 2. Violations de `DESIGN_SYSTEM.md` dans le code Angular actuel

| # | Règle | Où |
|---|---|---|
| V1 | « Borders = 0.5px — jamais 1px sauf les séparateurs de section » (§ 7.8) : `border` Tailwind = 1 px | `ng/layout/coquille.component.html:2`, `:19` ; `ng/features/connexion/connexion.page.html:3`, `:8`, `:17`, `:24` ; `ng/features/accueil/accueil.page.html:4` ; `ng/features/catalogue/catalogue.page.html:32` ; `ng/features/essai-carte/essai-carte.page.html:13`. (La pastille, elle, écrit `border-[0.5px]` : `ng/ui/pastille/pastille.component.ts:11`) |
| V2 | « Section headers avec bandeau #111111 + dot teal + border-top » (§ 5, § 7.4, checklist § 8) | Aucun en-tête conforme : `catalogue.page.html:5, 17, 25, 38, 44, 55`, `essai-carte.page.html:3-6`, `accueil.page.html:2` |
| V3 | Login : « Split screen : formulaire à gauche, vitrine à droite ; logo MAGELIAN complet » (§ 6) | `connexion.page.html:1-36` |
| V4 | Sidebar : sections en 11 px tertiaire, pied « point vert + Online » (§ 6) | `coquille.component.html:6-29` |
| V5 | CTA principal : survol `#d4d4d4` (§ 5 « Bouton CTA principal ») | `connexion.page.html:33` |
| V6 | Inputs : `padding: 8px 12px`, bord 0,5, focus = BORDURE teal 50 % (§ 5 « Inputs ») | bord 1 px `connexion.page.html:17, 24`, `catalogue.page.html:32` ; focus en `outline` (`styles.css:131-134`) |
| V7 | Flat total : « pas de shadow » (§ 2, § 7.10) | Infobulle ECharts ombrée par défaut, non neutralisée (`ng/graphiques/option-courbe.ts:56-62`) |
| V8 | Mono réservé aux « données numériques / statut / code » (§ 4) | Valeurs textuelles des popups (commune, statut, nature) en mono (`ng/carte/contenu-popup.ts:21`) |
| V9 | Titres 18 px+ : `letter-spacing: -0.02em` (§ 4) | `tracking-tight` = −0,025em (`accueil.page.html:2`, `catalogue.page.html:3`) ; aucun (`essai-carte.page.html:4`) |
| V10 | Sliders : piste 4 px `#1a1a1a`, remplie `#f0f0f0`, pouce 14 px (§ 5) | `accent-[var(--brand-teal)]` natif (`ng/ui/reglette/reglette.component.ts:28`). ⚠ **Hérité de React** (`RegletteRayons.tsx:192`, `OngletRayonInfluence.tsx:257`) : la parité impose de garder le rendu React — à signaler, pas à corriger dans ce lot |

---

## 3. Causes

**Portages jamais faits (la totalité des écarts visibles).**
- Lot 0 a posé une coquille et une connexion minimales (`coquille.component.html`, `connexion.page.html`) sans relire `AppSidebar.tsx` ni `app/login/page.tsx` : aucune icône, aucune section, pas d'écran partagé.
- Lot 1 a porté les primitives du module risque, pas ses ASSEMBLAGES : `BandeauKpi` (conteneur), l'en-tête d'écran, `.geo-section-header`, la légende de carte n'ont pas d'équivalent.
- Lot 2 a porté la mécanique de `mg-carte` et `mg-courbe` (cycle de vie, couleurs par jetons) mais pas l'habillage Recharts (§ 1.7) ni le mobilier de carte (§ 1.6).
- La base globale (G2, G3, G5) n'a jamais été portée : elle manquait déjà avant la tâche 8 (`git show efa70d30:angular/src/styles.css:38-54` ne porte ni barres de défilement, ni sélection, ni lissage).
- Aucun système d'icônes n'existe côté Angular (`angular/package.json`).

**Régressions dues à l'isolation : aucune confirmée.**
- La barre « x » est un artefact de mesure (§ 0).
- G1 (`-webkit-font-smoothing: auto !important`, `styles.css:124`) vient de la reprise de la tâche 8 en cours, mais la valeur était déjà `auto` avant (non déclarée) : ce n'est pas une régression, c'est l'écart G1 désormais écrit en dur. **À signaler au contrôleur : la reprise en cours peut poser `antialiased` directement.**

**Contraintes nouvelles que l'isolation impose au portage (à écrire dans les tâches) :**
- `position: fixed` interdit (`R/tests/unit/angular/portails-hors-ombre.test.ts:24-28`) : `AppSidebar` (`fixed inset-y-0`, `:356`), `TopRightChrome` (`fixed top-0 right-0`, `TopRightChrome.tsx:18`), l'overlay risque (`fixed inset-0`, `AnalysePopulationOverlay.tsx:901`) et le tiroir mobile se portent en flex / `absolute` dans la racine.
- Tout sélecteur global (barres de défilement, `::selection`, animations `@keyframes`) doit vivre dans `styles.css`, adoptée par la racine — jamais dans le document.
- Les couleurs ECharts et MapLibre passent par `CouleursService` (pas de `var()` dans une option ECharts ni dans un `paint` MapLibre) ; le DOM de la légende, lui, garde les jetons CSS (même règle que `CarteRisque.tsx:604-608`).

---

## 4. Découpage proposé du lot « Rendu »

Critère de sortie commun (décision du contrôleur, `progress.md:101`) : **capture Angular identique à la capture React de référence, dans les deux thèmes, revue côte à côte.** Serveurs : React `localhost:3000`, Angular autonome `localhost:4200/app/…` (ou `:4201` en prod). Chaque tâche cite l'écran React à capturer.

| # | Tâche | Fichiers | Critère d'acceptation | Référence React |
|---|---|---|---|---|
| R0 | **Base globale + vérification de la barre « x ».** Confirmer au navigateur, autonome et hôte, qu'aucune barre n'apparaît sans la sonde `#t8-popup`. Porter G1-G3, G5 ; ajouter un utilitaire de bord 0,5 px (`@utility` Tailwind 4, ex. `border-fin`) | `angular/src/styles.css` | Capture de `/app/catalogue` défilée : barre de défilement 6 px, sélection teal, identiques à React dans les deux thèmes ; aucune barre « x » sur `/app/essai-carte` | `localhost:3000/dashboard` défilé |
| R1 | **Icônes sans dépendance** : `mg-icone` (SVG en ligne, tracés lucide recopiés avec la mention ISC), taille et trait en entrée ; ~25 icônes (§ 1.2, 1.1, 1.6) | `ng/ui/icone/*` (nouveau), catalogue | Planche du catalogue identique pixel à pixel à `lucide-react` à 14/16/20 px, trait 1,5 | Icônes de `AppSidebar` sur `/dashboard` |
| R2 | **Marque** : hexagone (28 px, 15 px), signature « Geospatial intelligence », tailles de logo (18 px barre, 240 px de large connexion) | `ng/ui/logo/*`, `ng/ui/hexagone/*` (nouveau) | En-tête de la barre latérale identique | En-tête de `AppSidebar`, `/dashboard` |
| R3 | **Coquille = AppSidebar** : sections, liens arrondis avec icônes, survol/actif, séparateurs 0,5, pied « Online », tiroir < 768 px sans `fixed` ; thème + session déplacés dans un chrome haut-droite (`absolute` dans `main`), contenu `p-8` | `ng/layout/coquille.component.*`, nouveau `ng/layout/chrome-haut.component.ts` | `/app/` identique à `/dashboard` (barre + chrome), à 1440 px et 375 px, deux thèmes | `localhost:3000/dashboard` |
| R4 | **Routes plein écran** : `essai-carte` (et les futures routes carte/risque) hors de `mg-coquille` | `ng/app.routes.ts`, `ng/layout/racine-distante.component.ts` | `/app/essai-carte` sans barre latérale, pleine hauteur | `/map` → écran risque |
| R5 | **Connexion en écran partagé** : formulaire (L3-L14), vitrine (L15), responsive (L16), erreur de démarrage habillée comme L11 | `ng/features/connexion/*` | `/connexion` identique à `/login` à 1440 et 375 px, deux thèmes, états repos / erreur / envoi | `localhost:3000/login` |
| R6 | **En-têtes** : `mg-entete-section` (bandeau + point, `globals.css:527-550`), en-tête de page (titre 18 px −0,02em + sous-titre), en-tête d'écran (H2) | `ng/ui/entete-*/*` (nouveaux), catalogue, accueil | Bandeau « Navigation rapide » et titre « Dashboard » identiques | `/dashboard` |
| R7 | **Accueil = tableau de bord** : carte de chiffre (D1-D3). ⚠ Nom à choisir ≠ `mg-carte` (déjà la carte MapLibre) | `ng/features/accueil/*`, `ng/ui/tuile-chiffre/*` | Une carte de chiffre identique à celles de `/dashboard` (survol compris) | `/dashboard`, rangée de cartes |
| R8 | **Bandeau KPI** : conteneur K1/K3, `mgPerime` posé | `ng/ui/bandeau-kpi/*` (nouveau), `essai-carte` | Bandeau identique | Écran risque, étape ② Rayon (bandeau sous la barre commune) |
| R9 | **Mobilier de carte** : `NavigationControl`, légende (conteneur générique + contenu niveaux/anneaux), avertissement de zoom, popup (P1-P3 selon arbitrage) | `ng/carte/*`, `styles.css`, `essai-carte` | Coin bas-gauche et popup d'un site identiques, même cadrage (Étang de Berre), deux thèmes | Écran risque, étape ② Rayon, clic sur un site de Berre-l'Étang |
| R10 | **Courbe** : C1-C11, C13 dans l'option ECharts et la légende | `ng/graphiques/option-courbe.ts`, `courbe.component.ts` | Courbe + légende identiques (même rayon 5 km), infobulle au survol identique, deux thèmes | Écran risque, étape ② Rayon, panneau de gauche |
| R11 | **Composition `essai-carte`** sur le squelette risque : en-tête H2 avec fil d'étapes, barre commune (quelques `mg-champ`/pastilles/réglette inertes ou branchées), barre de progression à sa place, bandeau, panneau gauche (courbe + réglette C12) / carte droite | `ng/features/essai-carte/*` | Capture d'ensemble superposable à l'étape ② React (mêmes proportions à 1440 px), deux thèmes | Écran risque, étape ② Rayon |
| R12 | **Pastille** : transition `var(--ease-out)` (1.9) | `ng/ui/pastille/pastille.component.ts` | Contrôle de code (pas de capture) | — |

**13 tâches.** Ordre : R0 → R1 → R2 → R3 → R4 débloquent tout ; R5-R7 sont indépendantes ; R8-R10 avant R11. R12 peut se glisser dans R6.

Chemin de capture React pour l'écran risque : `localhost:3000/map` → panneau Calques → risque industriel → « Analyser la population » (`R/app/map/page.tsx:1200-1205`), puis étape ② via le fil d'étapes.

---

## 5. Questions pour le chef de projet

1. **Coquille** : confirmer `AppSidebar` pour les pages et « pas de coquille » pour carte/risque (§ 1.2). Et DANS le shell AIDA, qui a sa propre navigation : faut-il seulement afficher la coquille MAGELIAN, ou la réserver au lancement autonome ?
2. **Icônes** : `mg-icone` maison (tracés lucide recopiés, ISC, zéro dépendance) ou `lucide-angular` (nouvelle dépendance, hors de la liste AIDA native-federation + mecha-lib-ui) ? Recommandation : maison, remplaçable par mecha-lib-ui le jour venu (D6).
3. **Parité stricte ou correction** là où React est défectueux : popup sans marge intérieure (`globals.css:1053`), réglette native contraire au DESIGN_SYSTEM (V10), `var(--background)` dans le rail. Recommandation : parité sauf défaut objectif (popup : garder la marge Angular).
4. **Logo** : garder le `viewBox` 1600 × 360 (parité, lettres de 4 px à 18 px) ou le recadrer sur les glyphes (lisible, mais s'écarte de React et du `public/magelian-icon.svg`) ?
5. **Connexion** : l'inscription (« Pas de compte ? », `page.tsx:269-303`) et la vitrine chiffrée (49K, 2.3M… en dur, `:387-392`) sont-elles à porter ? Les chiffres en dur contredisent la règle « jamais de valeur en dur ».
6. **Bouton blanc « MAGELIAN »** de la barre (S5) : le porter maintenant, inerte ou masqué, jusqu'à l'overlay campagne du lot 5 ?
7. **Lissage des polices** (G1) : la reprise de la tâche 8 en cours écrit `auto !important` ; la faire passer à `antialiased` dans cette reprise plutôt qu'au lot Rendu ?
8. **Pied « Online »** : React ne l'affiche qu'en développement (`AppSidebar.tsx:268`) — même règle côté Angular ?
