# REFONTE NAVIGATION : 5 thèmes, Campagne au cœur

Lis `CLAUDE.md`, `ARCHITECTURE.md` et `DESIGN_SYSTEM.md` avant toute chose.

## SKILLS OBLIGATOIRES
@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## CONTEXTE

La navigation actuelle (rail gauche : geo.prompt, Périmètre, Terrain, Audience, Analyses, Campagne, Zones) mélange trois logiques différentes et les features sont mal rangées. On repart sur 5 entrées, adossées à la question que se pose l'utilisateur à ce moment-là.

Chaîne mentale : **Filtre → Calques → Analyse → Zones → Campagne**

1. **Filtre** : où je regarde. Restreint l'affichage de la carte et allège les requêtes. Ne crée rien.
2. **Calques** : ce que je vois. Affiche des données. Ne fabrique rien.
3. **Analyse** : ce que je calcule. Produit un calque de résultat, une zone candidate ou un rapport.
4. **Zones** : ce que je fabrique. Seul endroit qui crée de la géométrie et une liste de CP.
5. **Campagne** : ce que j'active. Cœur du produit, overlay plein écran à 3 onglets.

## TÂCHE

Refondre le rail de navigation et le routage des panneaux, puis déplacer chaque feature existante dans sa nouvelle catégorie. **Aucune feature ne doit être supprimée ni réécrite fonctionnellement** : c'est un déplacement et un regroupement, pas une réécriture métier.

### 1. Rail de navigation

Ordre de haut en bas :

- **Assistant** (ex geo.prompt), icône `Sparkles`, ouvre un tiroir à DROITE de la carte, pas un panneau gauche. Raccourci `Ctrl+K`. Renommer l'entrée en « Assistant » dans l'UI, garder `geo.prompt` comme nom interne si des refs existent.
- séparateur
- **CAMPAGNE**, icône `Megaphone`. Traitement visuel distinct : bouton pleine largeur en fond primaire teal, libellé toujours visible, ombre légère, plus haut que les autres. Porte le badge du nombre d'alertes. Ouvre un overlay plein écran, pas un panneau latéral.
- séparateur
- **Filtre** `Funnel`, **Calques** `Layers`, **Analyse** `FlaskConical`, **Zones** `Shapes` : icônes fines, même taille, libellé sous l'icône.
- en bas : **Réglages** `Settings`, **Aide** `CircleHelp`.

Contraintes :
- largeur du rail suffisante pour que « Campagne » et « Réglages » ne soient pas tronqués (l'actuel tronque « Périmètr »)
- état actif : fond plein et icône contrastée, plus `aria-pressed`
- tooltip au survol avec la phrase de la catégorie (« Où je regarde », « Ce que je vois », « Ce que je calcule », « Ce que je fabrique »)
- déplacer le badge de dev Next.js qui masque le bas du rail : dans `next.config`, `devIndicators: { position: "bottom-right" }`

### 2. Reclassement des features

| Feature actuelle | Nouvelle place |
|---|---|
| geo.prompt (chat, choix du modèle, statut de clé) | Assistant (tiroir droite) ; le choix du modèle et l'état de la clé partent dans Réglages |
| Périmètre global (France Metro / France + DROM) | Filtre |
| Régions, Départements | Filtre |
| Recherche locale | Filtre |
| Zones (bookmark, zones enregistrées) | Zones, section « Mes zones » |
| Dessin libre, isochrone, rayon, import de CP | Zones, section « Créer une zone » |
| Audience > Carreaux, IRIS (maillage, indicateur, palette, opacité, légende) | Calques, groupe « Socio-démographie » |
| Audience > Indicateurs civiques | Calques, groupe « Environnement » |
| Audience > Santé environnementale | Calques, groupe « Environnement » |
| Audience > Météo | Calques, groupe « Environnement » |
| Terrain > Points d'intérêt (POI) | Calques, groupe « POI et mobilité » |
| Terrain > Arrêts de transport en commun | Calques, groupe « POI et mobilité » |
| Terrain > Flux routier (TMJA) | Calques, groupe « POI et mobilité » |
| Terrain > Panneaux OOH et DOOH | Calques, groupe « Médias offline » |
| Terrain > Radio FM/DAB+ | Calques, groupe « Médias offline » |
| Analyses > Battle isochrone | Analyse |
| Analyses > ELM | Analyse |
| Analyses > scoring, alignement géo | Analyse (le scoring de performance d'une campagne va dans Campagne > Suivi) |
| Clustering K-Means, segments | Analyse |
| Campagne > import CSV/XLSX, tables `dsp_campaigns` | Campagne > liste des campagnes |
| Campagne > multiplicateurs, zones cibles, bornes | Campagne > onglet Stratégie |
| Campagne > push DSP, connecteurs | Campagne > onglet Activation ; la config OAuth des connecteurs va dans Réglages |
| Campagne > résultats, fidélité géo | Campagne > onglet Suivi |

### 3. Panneau Filtre

- Recherche locale (adresse, commune, CP)
- Découpage administratif : périmètre global, région, département
- Filtrer sur une zone enregistrée
- **Un seul filtre actif à la fois**, matérialisé par un chip persistant en haut à gauche de la carte, avec une croix pour le retirer, plus une pastille sur l'icône Filtre du rail
- Le filtre s'applique à la carte, aux calques et aux requêtes. **Il ne s'applique jamais au périmètre d'une stratégie de campagne** : une stratégie couvre toute la campagne. Afficher une note explicite dans l'onglet Stratégie quand un filtre est actif.
- Côté requêtes, le filtre doit réellement borner les appels Supabase (bbox ou liste d'IRIS/CP), pas seulement masquer côté client : c'est le garde-fou contre les scans France entière.

### 4. Panneau Calques

- Section « Actifs (n) » en tête, listant les calques affichés avec une croix pour les retirer
- Groupes repliables ensuite : Socio-démographie, Campagne active, POI et mobilité, Médias offline, Environnement, Mes analyses
- Les réglages d'un calque (maillage, indicateur, palette, opacité) apparaissent sous ce calque, seulement quand il est actif
- **Un seul dégradé de couleur à la fois** : activer les impressions de campagne masque automatiquement les données INSEE, et l'inverse, avec un toast qui l'explique
- Légende unique en bas à gauche, repliable, alimentée par les calques actifs
- Chevrons cohérents partout : droite fermé, bas ouvert (l'UI actuelle en mélange quatre)
- Supprimer les puces décoratives devant les titres de section

### 5. Panneau Analyse

Une analyse produit un résultat, jamais de la géométrie nouvelle.

- **Clusters (K-Means)** : choix des variables, du maillage et du nombre de classes ; sortie = calque de classes plus un bouton « Créer une zone » par cluster, qui ouvre Zones
- **Score composite** : plusieurs indicateurs pondérés, sortie = calque de score 0 à 100, plus « Créer une zone au-dessus d'un seuil »
- **Battle isochrone** : deux zones en entrée, tableau comparatif en sortie
- **ELM** : une zone plus une activité, rapport PDF en sortie
- **Corrélation** : impressions de la campagne active contre un indicateur, nuage de points en sortie
- Chaque analyse lancée est un objet enregistré (nom, paramètres, maillage, date), rejouable, et son résultat apparaît dans Calques > Mes analyses
- **Périmètre obligatoire avant calcul** : filtre actif ou zone. Bloquer le lancement avec un message clair plutôt que de lancer un calcul France entière.
- Respecter les limites Supabase du projet : pas de scan bbox France, batchs bornés, maximum 3 appels parallèles

### 6. Panneau Zones

- Section « Créer une zone » : sélection IRIS, sélection carreaux, isochrone, rayon, dessin libre, import de CP, capture d'un calque actif
- Section « Mes zones » : une carte par zone avec son nom, sa composition en clair (« 992 IRIS sélectionnés », « 3 départements moins Paris », « 412 IRIS et isochrone 15 min »), son nombre de CP et sa population
- Sélection multiple par cases à cocher, puis opérations **Fusionner**, **Intersection**, **Soustraire**
- Menu par zone : Filtrer sur cette zone, Ajouter à une stratégie, Modifier la composition, Lancer une battle, Préparer un ELM
- Toute zone stocke sa géométrie **et** sa liste de CP résolue, de façon déterministe, avec le seuil de couverture population appliqué. C'est cette liste que consomme le DSP.
- Chaque module carte contribue au système de capture via `useCustomGeoLayer` : ne casser aucun appel existant, et brancher les nouveaux modules de la même façon

### 7. Overlay Campagne

Plein écran par-dessus la carte, pas un panneau latéral.

- Colonne gauche : liste des campagnes, recherche, import
- En-tête : nom, annonceur, DSP, dates, statut, bouton « Voir sur la carte »
- 3 onglets : **Stratégie**, **Activation**, **Suivi**
- Onglet Stratégie : tableau des zones cibles ordonné par priorité (glisser-déposer), colonnes zone et composition, CP, population, objectif en %, poids ou « auto » en mode Piloté, ligne « Hors zones », barre de total à 100 %, avertissements de chevauchement, encart version avec « Vérifier et publier », encart mode et bornes CPM
- Stratégie ne fabrique pas de géométrie : « Modifier la composition » renvoie vers Zones
- Si une zone de la stratégie est modifiée après publication, afficher un bandeau « a changé depuis la publication de la vN, republier » et un tag sur la ligne concernée
- Onglet Activation : pré-vol en lecture seule, push par lots, statut par line item, historique, rollback
- Onglet Suivi : KPI, réel contre cible par zone, carte des impressions en carreaux, alertes GeoAgent en lecture seule
- La campagne sélectionnée reste active quand on revient à la carte

### 8. Bascule et état global

- Bouton de bascule **Campagne / Carte** au centre de l'en-tête, raccourci `Alt+C`
- La campagne active est un contexte global, affiché dans l'en-tête et dans une carte flottante en haut à gauche de la carte, avec un bouton « Ouvrir »
- Raccourcis : `Ctrl+K` assistant, `Alt+1` à `Alt+4` pour Filtre, Calques, Analyse, Zones, `Échap` ferme
- Sans campagne active, Campagne affiche un état vide « Choisir une campagne ». Les 4 outils restent pleinement utilisables.

## CONTRAINTES TECHNIQUES

- Règle absolue du projet : **rien en dur**. La liste des indicateurs, des maillages, des campagnes et des catégories vient toujours de la base ou d'`information_schema`, jamais d'un enum figé dans le code de navigation.
- La config de navigation vit dans **un seul fichier** (par exemple `lib/navigation/config.ts`) : id, label, icône, tooltip, type de panneau. Les composants la consomment, ils ne la redéclarent pas.
- MapLibre n'accepte pas les variables CSS dans les `paint` : valeurs hexadécimales littérales.
- Pas de régression sur les modules carte existants, en particulier `/api/isochrone-battle/route.ts` et les fonctions PostGIS `battle_*`, qui sont des fichiers protégés : ne pas les modifier.
- Icônes Lucide, taille et `strokeWidth` homogènes sur tout le rail.

## MÉTHODE

1. `@smart-explore` pour cartographier les composants de navigation et de panneaux existants, et lister chaque feature à déplacer avec son fichier.
2. `@make-plan` : plan de migration écrit, feature par feature, avec l'ancien et le nouvel emplacement. **Me montrer ce plan avant de coder.**
3. Migration par lots avec commits atomiques, un lot par catégorie : rail, Filtre, Calques, Analyse, Zones, Campagne.
4. `@test-driven-development` sur la config de navigation et sur la logique d'exclusivité des calques et du filtre.
5. Build vert, aucun `any` introduit, aucun `catch` non typé.
6. Rapport final : tableau de ce qui a bougé, ce qui a été laissé en place, et les points restés ouverts.

## POST-LIVRAISON

Après le dernier commit, lance @cleanup-geomatik Partie 2 + Partie 3 sur les fichiers modifiés uniquement. Rapport rapide : failles sécu + any introduits + catch non typés. Corrige avant de considérer la tâche terminée.
