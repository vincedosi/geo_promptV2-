---
name: geomatik-product-vision
description: >
  Vision produit et architecture UX cible de GEOMATIK. Source de vérité pour toute
  décision structurelle : layout, navigation, layer manager, intégration Digital,
  thème light/dark. Utilise cette skill quand le prompt touche à la
  navigation, au layout global, aux tabs, au panel Expert, à l'intégration de pages,
  au thème, ou à toute réorganisation de l'interface.
---

# GEOMATIK — Vision Produit UX

> Ce fichier est la source de vérité pour l'architecture UX cible.
> Il complète DESIGN_SYSTEM.md (tokens visuels) et geomatik-ux (règles composants).
> Claude Code DOIT lire ce fichier avant toute modification structurelle de l'app.

---

## 1. Principe fondamental

GEOMATIK est un outil cartographique. TOUT vit autour de la carte.
Aucune fonctionnalité ne justifie de quitter la carte pour aller sur une page séparée.
Si un module affiche des données géographiques, il s'intègre comme un layer sur la carte.

---

## 2. Layout global cible

```
┌──────────────────────────────────────────────────────────────┐
│ Header : Home | GEOMATIK | Carte | Étude | Org ▾ | 🌙 | @  │
├────────┬─────────────────────────────────────────────────────┤
│        │                                                     │
│ Panel  │              CARTE MAPLIBRE                         │
│ Expert │     (ou split 3 cartes si Digital ON)               │
│        │                                                     │
│ 260px  │              flex: 1                                │
│ scroll │                                                     │
│        │                                                     │
│        │                                                     │
│        │                                                     │
├────────┴─────────────────────────────────────────────────────┤
│ (optionnel) Drawer bas : analyse détaillée (heatmap, tables) │
└──────────────────────────────────────────────────────────────┘
```

- Panel Expert : côté gauche, 260px, scrollable
- Carte : centre, flex 1, plein écran
- Drawer bas (optionnel) : pour les analyses détaillées (heatmap, tables bidding)

---

## 3. Panel Expert — Layer Manager à 2 niveaux

### Architecture : Catégories → Layers

Le panel Expert n'a AUCUN sous-tab (plus de Territoire/POI/Analyse).
C'est un panel unique scrollable organisé en catégories collapsibles.

```
🔍 Rechercher un filtre...        ← Fixe en haut, filtre tout

▾ CONTEXTE                         ← Catégorie (toujours ouverte)
  Périmètre : France Métro ▾
  Ville/CP : [________]

▾ DONNÉES TERRAIN                  ← Catégorie collapsible
  ● Panneaux OOH             [○]   ← Layer = switch + accordéon
  ● Points d'intérêt          [○]
  ● Arrêts de transport       [○]
  ● Flux routier TMJA         [○]
  ● Radio FM/DAB+             [○]

▾ DONNÉES SOCIO-DÉMO              ← Catégorie collapsible
  ● IRIS                      [○]
  ● Carreaux Filosofi         [○]

▾ CAMPAGNES MÉDIA                 ← Catégorie collapsible
  ● Campagne digitale         [○]   (railroad stepper dedans)

▾ ANALYSES                        ← Catégorie collapsible
  ● Scoring OOH               [○]
  ● Corrélation IRIS × POI    [○]
  ● Clustering                [○]
  ● Couverture                [○]
  ● Isochrone battle           [○]
```

### Niveau 1 : Catégorie
- Header bandeau : background #111, border-top 1px #1a1a1a
- Dot teal 6px + label Inter 500 12px #f0f0f0 uppercase
- Chevron collapse/expand, 14px #666, ml-auto
- Pas de switch — une catégorie ne s'active pas, c'est un tiroir
- Peut être collapsée pour masquer les layers non utilisés

### Niveau 2 : Layer
- Ligne compacte : dot couleur + nom Inter 400 13px + switch on/off à droite
- Clic sur le nom = ouvre l'accordéon des réglages (filtres, options)
- Le switch peut s'activer SANS ouvrir l'accordéon (action rapide)
- Layer inactif = 40px de hauteur, très compact
- Layer actif + accordéon ouvert = hauteur variable selon le contenu

### Comportement
- La barre de recherche filtre layers ET catégories en temps réel
- L'utilisateur peut collapse une catégorie entière qu'il n'utilise pas
- L'état d'ouverture des catégories persiste en localStorage
- Les switches activent/désactivent les layers sur la carte immédiatement

---

## 4. Intégration Digital (Campagnes Média)

### Le layer "Campagne digitale"
La page /digital n'existe plus comme page séparée.
Elle devient un layer dans la catégorie "Campagnes Média".

Quand l'utilisateur active le switch "Campagne digitale" :
1. L'accordéon s'ouvre avec le railroad stepper
2. Si aucune campagne sélectionnée : afficher la liste des campagnes (cards)
3. Si campagne sélectionnée : la carte split en 3 (vue comparée)

### Toggle Vue comparée / Vue fusionnée
- Vue comparée (3 cartes) : activée par défaut, effet wow en démo
- Vue fusionnée (1 carte) : choroplèthe sur la carte principale, superposable
- Toggle visible au-dessus des cartes quand le layer Digital est actif

### Railroad Stepper
Le railroad stepper vit DANS l'accordéon du layer Campagne digitale.
5 noeuds : Campagne → Cible → Vue géo → Régies → Focus
Valeurs par défaut : Vue géo = Régions, Focus = Ratio.
Voir geomatik-ux/SKILL.md pour les specs détaillées du railroad.

### Analyse détaillée
Le bouton "Ouvrir analyse →" ouvre un drawer bas avec :
- Heatmap régies × géographie
- Tables sur-servis / sous-servis
- Recommandation bidding
Le drawer est dismissable, ne remplace pas la carte.

---

## 5. Geo.prompt — SUPPRIMÉ

Le copilote IA (geo.prompt, chat, Smart Bar, agents) a été retiré du produit le
2026-10-12 : il n'y a plus d'IA dans le code. Ne pas prévoir de tab, de FAB ni
de barre de chat dans une réorganisation de l'interface.

---

## 6. Thème Light / Dark

### Principe
Toutes les couleurs passent par des CSS variables.
Un attribut data-theme="dark|light" sur <html> contrôle tout.
La préférence est sauvegardée en localStorage et respecte prefers-color-scheme.

### Tokens light (à créer)
| Token | Dark | Light |
|-------|------|-------|
| --background | #050505 | #ffffff |
| --card | #0a0a0a | #f8f8f8 |
| --elevated | #111111 | #f0f0f0 |
| --overlay | #181818 | #e8e8e8 |
| --border-subtle | #1a1a1a | #e5e5e5 |
| --border-default | #262626 | #d4d4d4 |
| --border-hover | #333333 | #a3a3a3 |
| --text-primary | #f0f0f0 | #0a0a0a |
| --text-secondary | #b0b0b0 | #525252 |
| --text-tertiary | #8a8a8a | #737373 |
| --brand-teal | #4ecdc4 | #0d9488 |

### Carte MapLibre
- Dark : style CartoDB Dark Matter ou Positron Dark
- Light : style Positron ou OpenStreetMap
- Le style change quand le thème toggle

### Toggle
- Position : header, à côté du sélecteur d'organisation
- Icône : soleil/lune (lucide Sun/Moon)
- Transition : 200ms sur background-color et color

---

## 7. Ce qui disparaît

- Les sous-tabs Territoire / POI / Analyse dans Expert
- La page /digital comme page séparée (devient un layer)
- Les boutons orange (remplacés par teal)
- Le footer debug "Online 18:06:49" en production
- Le logo dupliqué dans le header top-right
- L'indicateur de zoom "z5 —" (remplacé par badge discret)
- Les labels cryptiques de fond de carte ("Lib", "Bn")

---

## 8. Ce qui reste

- Le tab Carte / Étude dans le header
- La sidebar avec sections Analyse / Administration / Système
- Les 3 cartes côte à côte quand Digital est actif (toggle on par défaut)
- Le railroad stepper (dans l'accordéon du layer Digital)
- Le bouton "Sauvegarder" (renommé clairement)
- Le système d'organisations multi-tenant

---

## 9. Roadmap des sprints

Sprint 0 : Fondations (composants, thème, contraste)
Sprint 1 : Layer Manager (fusion tabs → panel unique catégories)
Sprint 2 : Digital intégré (page → layer carte, toggle 3 cartes)
Sprint 3 : Accordéons POI (refonte sections, suppression orange)
Sprint 4 : Thème light/dark complet
Sprint 5 : Polish (loading states, transitions, légendes carte)

Chaque sprint = 1 branche git, 1 checkpoint, 1 merge indépendant.
