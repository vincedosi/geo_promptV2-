---
name: geomatik-ux
description: >
  Règles UX pour GEOMATIK : accessibilité, contraste, hiérarchie d'information,
  feedback utilisateur, loading states, composants interactifs, navigation.
  Utilise cette skill pour TOUT travail touchant à l'interface, aux composants React,
  aux pages, aux panels, aux tables, aux charts, aux formulaires, ou quand le prompt
  mentionne UX, accessibilité, contraste, loading, skeleton, feedback, navigation,
  responsive, empty state, error state, tooltip, ou amélioration d'interface.
---

# UX GEOMATIK — Règles obligatoires

> Ce fichier complète DESIGN_SYSTEM.md (qui couvre le design visuel).
> Ici on traite l'expérience utilisateur : lisibilité, feedback, hiérarchie, interactions.
> Claude Code DOIT lire et appliquer ces règles avant toute modification de composant UI.

---

## 1. Accessibilité et contraste

### Ratios WCAG AA minimum (fond #050505)
| Token | Ancien | Corrigé | Ratio | Usage |
|-------|--------|---------|-------|-------|
| --text-primary | #f0f0f0 | #f0f0f0 | 18.5:1 | OK ne pas toucher |
| --text-secondary | #a0a0a0 | #b0b0b0 | 9.7:1 | Corps de texte, labels inactifs |
| --text-tertiary | #666666 | #8a8a8a | 4.6:1 | Hints, placeholders, métadonnées |

### Règles
- Tout texte lisible doit avoir un ratio >= 4.5:1 sur son fond
- Texte dans cellules colorées (heatmap, badges) : couleur la plus sombre du même ramp, jamais blanc pur
- Labels de champ : minimum --text-secondary, JAMAIS --text-tertiary seul
- Placeholder input : --text-tertiary OK (non critique)

---

## 2. Hiérarchie d'information

### KPI cards (bandeau haut de page)
- Maximum 4 KPI visibles sans scroll horizontal
- KPI principal visuellement dominant : taille 24px, les secondaires en 16px
- Chaque KPI = valeur + label + contexte (variation, période, ou benchmark)
- Pas de KPI orphelin sans label explicite
- Ordre : le plus important à gauche, le moins à droite

### Sections de contenu
- Une page = une question principale
- Chaque section = une sous-question
- Ordre de lecture : résumé actionnable puis détail puis export
- Titre de section = la question, pas le type de chart

---

## 3. États des composants — OBLIGATOIRE

Chaque composant interactif DOIT gérer ces 4 états :

### Loading
- Skeleton animé (pulse) reproduisant la forme du contenu final
- Operations > 2s : barre de progression ou message de statut
- Tableaux : skeleton = 5 lignes grisées avec colonnes alignées
- Charts : skeleton = forme du chart en gris avec pulse
- JAMAIS un spinner seul sans contexte

### Empty
- Message explicatif : pourquoi c'est vide + quoi faire
- Icône contextuelle (pas un emoji)
- CTA si applicable (Importer des données, Lancer l'analyse)
- JAMAIS un tableau vide sans explication

### Error
- Message lisible par un humain (pas de stack trace)
- Bouton Réessayer quand l'action est retentable
- Conserver le dernier état valide quand possible (stale-while-revalidate)
- Couleur --danger pour le message, pas pour tout le composant

### Success / Feedback
- Toast notification pour les actions utilisateur (2-4s, auto-dismiss)
- Transition de l'élément modifié (highlight 300ms puis fade)
- Confirmation explicite pour les actions destructives (modal)

---

## 4. Tables de données

### Règles générales
- Header sticky en scroll vertical
- Colonnes numériques alignées à droite, texte à gauche
- Hover row : background #111111 (--elevated)
- Pas d'alternance de fond (trop de bruit sur dark theme) — hover + borders subtiles
- Maximum 6-7 colonnes visibles sans scroll horizontal
- Si > 7 colonnes : scroll horizontal avec colonne fixe à gauche

### Heatmap
- Cellule hover : border teal + tooltip avec valeur exacte + contexte
- Texte dans cellule : couleur adaptée au fond (sombre sur clair, clair sur sombre)
- Palette divergente : bleu (sous-servi) → gris (neutre) → rouge (sur-servi)
- Pas de blanc pur (#fff) sur cellules colorées
- Taille minimum de cellule : 40px x 32px
- Si > 10 colonnes : scroll horizontal OU grouper/filtrer

### Tri et filtres
- Indicateur de tri visible (chevron) sur la colonne active
- Filtre inline pour les tables > 10 lignes
- Nombre de résultats affiché

---

## 5. Navigation et sidebar

### Structure
- Séparer clairement : Pages métier vs Admin vs Système
- Labels de section : Analyse / Administration / Système
- Maximum 6 items par section
- Icônes cohérentes : même famille, même taille (18px)
- Badge de notification si action requise

### Contexte
- L'utilisateur doit toujours savoir où il est
- Page active = highlight sidebar + titre de page visible
- Sous-navigation (tabs) : tab actif visuellement clair

---

## 6. Filtres et contrôles

### Railroad Stepper Pipeline (page Digital)

La barre de filtres n'est PAS un ensemble de filtres indépendants.
C'est un RAILROAD STEPPER : 5 noeuds circulaires connectés par des tracks teal.
L'utilisateur progresse de gauche à droite. Chaque choix conditionne le suivant.

```
  (o)———————(o)———————(o)———————(o)———————(●)
 Camp.     Cible     Vue geo   Régies    Focus
Q1-86M    15-29     Regions   Toutes     Ratio
```

Composants du railroad :
- Noeud : cercle 40px, icône SVG 18px, 3 états (done/active/future)
- Track : ligne 2px entre noeuds, remplissage teal animé (transition 0.4s)
- Label : 10px uppercase sous le noeud
- Valeur : 12px bold sous le label, cliquable pour ouvrir le popover
- Popover : bulle avec flèche, fond #0a0a0a, border #262626, radius 10px
- Pulse ring animé sur le noeud actif (keyframes scale 1→1.3, opacity 0.4→0)

Les 5 noeuds :
1. Campagne : radio select + sparklines SVG, source DISTINCT dsp_campaigns
2. Cible : radio select, source DISTINCT tranches d'âge de la campagne
3. Vue géo : toggle group inline (Regions/Dept/CP), options fixes
4. Régies : checkbox multi-select, source DISTINCT régies de la campagne
5. Focus : radio select avec descriptions (Imp/Pop/Ratio/1-3), options fixes

Règles :
- Changer l'étape N reset les étapes N+1 à leur défaut
- Les tracks passent de "done" à "future" sur les étapes reset
- Options TOUJOURS dynamiques (DISTINCT sur données filtrées), jamais hardcodées
- Sélection radio = ferme le popover immédiatement
- Sélection checkbox (régies) = reste ouvert pour multi-select
- Compteur de résultats + bouton Réinitialiser sous le railroad
- Responsive < 768px : railroad vertical (noeuds empilés)

### Barre de filtres générale (autres pages)
- Chaque filtre a un label visible (pas juste la valeur)
- Grouper les filtres liés
- Nombre de résultats filtrés en temps réel
- Bouton Réinitialiser si au moins un filtre actif
- Ordre : du plus large au plus fin

### Sliders
- Label + valeur actuelle + unité toujours visibles
- Feedback immédiat sur le contenu lié
- Tooltip ou description courte de l'effet

---

## 7. Composants cartographiques (MapLibre)

- Curseur pointer sur les éléments cliquables
- Tooltip au hover avec info essentielle (3 lignes max)
- Panel de détail au clic (pas de popup native MapLibre)
- Indicateur de chargement sur la carte pendant les requêtes PostGIS
- Légende toujours visible, jamais cachée dans un menu
- Légende position bas-gauche ou bas-droite, semi-transparente
- Palette lisible en cas de daltonisme (pas rouge/vert seuls)

---

## 8. Responsive et densité

### Breakpoints
- < 768px : sidebar en drawer, layout single-column, tabs scrollables
- 768-1280px : sidebar collapsed (icônes), layout 2 colonnes max
- > 1280px : sidebar full, layout selon la page

### Densité
- Un écran = une action principale
- Ne pas tout montrer en même temps — collapse les sections secondaires
- Gap minimum entre les blocs : 12px
- Padding intérieur des cards : 16px minimum

---

## 9. Patterns anti-UX à ne JAMAIS reproduire

1. Deux boutons avec la même action et des styles différents
2. Logo dupliqué (sidebar + header)
3. Footer debug visible en production
4. Tableau vide sans message
5. Slider sans label ni feedback
6. Tabs avec styles incohérents sur la même page
7. KPI sans label ni unité ni contexte
8. Texte #666 sur fond #050505
9. Heatmap avec texte blanc sur cellules colorées
10. Spinner sans message de contexte

---

## 10. Checklist UX avant commit

- [ ] Tous les textes passent le ratio WCAG 4.5:1
- [ ] Chaque composant gère loading / empty / error / success
- [ ] Les tables ont header sticky et hover row
- [ ] Les filtres ont des labels visibles
- [ ] Les sliders affichent valeur + unité + feedback
- [ ] La sidebar sépare pages métier et admin
- [ ] Pas de doublon de bouton ou de logo
- [ ] Le layout a des gaps >= 12px entre les blocs
- [ ] Les KPI ont label + valeur + contexte
- [ ] Info debug masquée en production
