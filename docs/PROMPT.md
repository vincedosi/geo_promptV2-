\# Contexte

Module "Population à risque industriel" de Magelian (Next.js 15 App Router, React 19, TypeScript strict, MapLibre GL JS, Supabase PostGIS, Tailwind + shadcn/ui, Recharts).

Onglets concernés : Sites, Rayon, Couverture, Zones. Un menu unifié porte les filtres globaux (dont "Territoire" et la réglette de rayon).



\# Méthode

1\. Commence par explorer le code du module : composants des 4 onglets, menu unifié, store/état des filtres, hooks de chargement de données, composants carte.

2\. Propose-moi un plan court (fichiers touchés, approche par lot) AVANT de coder. Attends ma validation.

3\. Implémente lot par lot, un commit par lot.

4\. À la fin de chaque lot : `npm run lint`, typecheck, tests Vitest. Rien de cassé.



\# Contraintes

\- Ne jamais modifier `/api/isochrone-battle/route.ts` ni les fonctions PostGIS battle existantes.

\- Réutiliser le design system MAGELIAN et les composants shadcn existants, pas de nouvelle dépendance sans me demander.

\- Pas de refactor hors périmètre.



\# Lot 1 : Indicateur de chargement global (tous les onglets)

Objectif : l'utilisateur doit savoir à tout moment si les chiffres affichés sont à jour ou encore en calcul.

\- Ajouter une barre de progression visible dans chaque onglet dès qu'une requête ou un calcul est en cours (fetch, RPC PostGIS, chargement de tuiles si pertinent).

\- Si la progression réelle est mesurable (streaming, étapes), afficher un pourcentage. Sinon, barre indéterminée.

\- Tant que le chargement n'est pas terminé, les chiffres précédents doivent être visuellement marqués comme obsolètes (opacité réduite ou skeleton), jamais affichés comme valides.

\- Mutualiser : un seul hook/composant partagé, pas une implémentation par onglet.

Critère d'acceptation : en changeant un filtre, la barre apparaît immédiatement, les KPI sont grisés, puis tout revient à l'état normal une fois les données reçues.



\# Lot 2 : Onglet Sites

\- Transformer la barre horizontale de volume en barre empilée, segmentée par niveau réglementaire (utiliser les niveaux présents en base, ex : Seveso seuil haut, Seveso seuil bas, autres).

\- Une couleur par niveau, cohérente avec celles de la carte, légende + tooltip avec le volume par niveau.

Critère : la somme des segments = le volume total affiché auparavant.



\# Lot 3 : Onglet Rayon

\- La réglette de rayon audessus du graphique doit aussi piloter le rayon des zones à risque dessinées sur la carte de droite, en temps réel.

\- Debounce sur les recalculs coûteux (population), mais mise à jour visuelle immédiate des cercles.

Critère : déplacer la réglette redimensionne les zones sur la carte sans rechargement de page.



\# Lot 4 : Onglet Couverture

\## 4a. Clic sur une région

\- Le clic met à jour la carte du dessous, centrée et cadrée sur l'entité sélectionnée.

\- Le clic NE DOIT PAS modifier le filtre global "Territoire" du menu unifié. La sélection reste un état local à l'onglet Couverture.



\## 4b. Carte du dessous

\- Toujours entièrement visible sans scroll : hauteur adaptée au viewport.

\- À chaque sélection, recadrage automatique (`fitBounds` avec padding) sur l'emprise de l'entité.

\- Le zoom interactif n'est pas nécessaire : il peut être désactivé (scrollZoom, boutons).



\## 4c. Navigation hiérarchique dans le tableau

\- Sur chaque ligne du tableau, ajouter deux petites flèches : une avant le libellé pour remonter d'un niveau, une après pour descendre d'un niveau.

\- Hiérarchie : région > département > commune / code postal (respecter l'ordre déjà utilisé dans le code).

\- Flèche désactivée aux extrémités (pas de remontée depuis région, pas de descente depuis le dernier niveau).

\- La navigation par flèche met à jour tableau ET carte (même recadrage qu'en 4b), toujours sans toucher au filtre "Territoire".

Critère : je peux aller de Région à Commune puis revenir uniquement avec les flèches, la carte suit à chaque étape.



\# Lot 5 : Onglet Zones

\- Le rayon utilisé pour déterminer les zones vient exclusivement de la réglette du menu unifié. Supprimer tout réglage de rayon local ou en doublon dans cet onglet.

Critère : changer la réglette du menu unifié recalcule les zones de l'onglet.



\# Livrable final

Résumé des fichiers modifiés par lot + points d'attention ou dette identifiée.

