\# MISSION : conversion zones vers codes postaux + onglet ⑤ Campagne (simulation)



\## Contexte

Le module "Population à risque industriel" est terminé sur 4 étapes : ① Sites › ② Rayon › ③ Couverture › ④ Zones. Barre permanente (filtres, réglette unique, KPI) et carte permanente en place. Le jeu de zones s'enregistre.

Problème métier : on définit des zones en rayons autour des sites, mais on diffuse sur des codes postaux. Il faut rendre visible la conversion rayon vers CP, puis simuler une campagne qui diffuse au CP et mesurer son alignement zone par zone.

Principe d'alignement : le plan de chaque zone est sa part de POPULATION EXPOSÉE (carreaux INSEE 200 m dans le rayon), jamais la population totale des CP.



\## Phase 0 : audit, puis STOP

Écris docs/zones-cp-campagne.md :

1\. Géométries CP disponibles : table de polygones dédiée, ou union de communes via postal\_code\_commune ? Source, millésime, couverture outre-mer, index GIST, colonne 3857 précalculée. Gestion des communes à plusieurs CP (Paris, Lyon, Marseille par arrondissement, autres) et des CP à plusieurs communes. Si aucune géométrie CP propre n'existe, propose la méthode (union des communes, et pour les communes multi-CP : répartition des carreaux par plus proche centroïde ou autre) et chiffre l'erreur.

2\. Rattachement carreau 200 m vers CP : existe-t-il déjà ? Sinon coût de calcul (jamais de scan complet de carreaux\_filosofi).

3\. Tables du jeu de zones actuelles (zone\_sets et tables filles) et ce qu'elles stockent déjà côté CP.

4\. Composants du Suivi de campagne réutilisables (score d'alignement, cartes Impressions / Plan / Alignement, "Ce qu'il faut corriger", "Qui a diffusé") et ce qui y est codé en dur.

5\. Tables de campagne (dsp\_campaigns, dsp\_campaign\_data, plan) et contraintes d'unicité.

6\. Plan de fichiers et de migrations.

Arrête-toi et attends mon "go".



\## Phase 1 : notion de zone (grappe)

Les buffers qui se touchent forment une zone : vallée de la chimie = une zone, pas 40 sites.

\- Regroupement automatique des buffers qui s'intersectent, par niveau et tous niveaux confondus (ST\_ClusterIntersecting ou équivalent), une fois par profil\_hash.

\- Table zone\_set\_clusters : id, zone\_set\_id, nom (auto : commune du site le plus peuplé ou nom de raccourci connu, éditable), niveau dominant, nombre de sites, population exposée, geom + geom\_3857 (GIST).

\- Chaque carreau exposé porte son cluster, en plus de sa classe (règle d'affectation exclusive inchangée).



\## Phase 2 : conversion rayon vers CP

Table zone\_set\_cp (compléter si elle existe) : code\_postal, cluster\_id, classe dominante, population\_exposee, population\_totale\_cp, taux\_exposition (exposée / totale), retenu (bool), poids.

\- Un CP à cheval sur plusieurs zones a une ligne par zone, au prorata de sa population exposée dans chacune.

\- Seuil de rétention CP existant conservé (défaut 20 %).

\- Dilution : un CP retenu diffuse sur toute sa population alors que seule une partie est exposée. Poids plan par défaut = population exposée x multiplicateur de classe, JAMAIS la population totale du CP.

\- KPI à exposer : taux d'utile (population exposée des CP retenus / population totale des CP retenus), population exposée perdue par les CP écartés.



\## Phase 3 : étape ④ Zones, deux cartes synchronisées

Dans l'étape ④, la carte permanente passe en vue double, côte à côte, caméras synchronisées (pan et zoom liés, une seule logique de sélection) :

\- Gauche "Zones en rayon" : bandes fusionnées par niveau (style existant), contours des clusters, étiquettes de clusters.

\- Droite "Zones en codes postaux" : choroplèthe des CP retenus colorée par part du plan, CP écartés en gris hachuré, contour des rayons en surimpression fine. Bascule de coloration : part du plan / taux d'exposition du CP / population exposée.

\- Survol d'un CP : population totale, exposée, taux d'exposition, zone(s), poids. Survol d'un cluster : surbrillance de ses CP sur l'autre carte.

\- Bandeau sous les cartes : population exposée en rayon, population des CP retenus, taux d'utile, nombre de CP, population exposée perdue. Le curseur de seuil CP les fait bouger en direct.

\- Tableau des zones sous les cartes : zone, sites, niveau, population exposée, CP retenus, taux d'utile de la zone, part du plan. Clic : fitBounds sur les deux cartes.

Hors étape ④, la carte permanente redevient simple, avec un interrupteur "Rayons / Codes postaux".

Raccourcis Vallée de la chimie, Estuaire de la Seine, Étang de Berre conservés.



\## Phase 4 : extraction

Bouton "Extraire pour le custom bidding" sur un jeu de zones enregistré :

\- Table zone\_set\_extractions : id, zone\_set\_id, version (v1, v2, ...), created\_at, seuil CP, poids par CP, origine ('initiale' | 'recalage'), commentaire.

\- Fichier Excel : CP, zone, classe, population exposée, taux d'exposition, poids. Variante points + rayons pour le ciblage par proximité.

\- Une extraction est immuable. Un recalage crée une nouvelle version.



\## Phase 5 : étape ⑤ Campagne (simulation)

Ajoute l'étape ⑤ au fil d'Ariane : ① Sites › ② Rayon › ③ Couverture › ④ Zones › ⑤ Campagne. Barre permanente conservée (KPI en mode campagne : impressions, part en zone, alignement, taux d'utile réel).

Sélecteur d'extraction + bouton "Simuler une campagne". Badge "Simulation" permanent, rien ne se mélange avec les vraies campagnes (flag en base).



Générateur (lib/simulation/, fonctions pures testées, graine fixe, reproductible) :

\- Paramètres éditables : durée (défaut 28 jours), budget (défaut 250 000 €), partenaires (défaut 3 à CPM distincts entre 4 et 11 €), intensité de l'effet inventaire (défaut 1,3), fuite hors zone (défaut 4 %), bruit.

\- Diffusion par CP = plan x (densité du CP)^intensité, renormalisée au volume, plus bruit, plus fuite vers les CP limitrophes non retenus.

\- Chaque impression se diffuse sur la population TOTALE du CP : l'impression "utile" est la part touchant la population exposée (taux d'exposition du CP).

\- CPM légèrement plus élevé sur les CP peu denses et fortement pondérés.

\- Scénario : semaines 1 et 2 sur l'extraction v1 (effet inventaire plein, zones denses comme la vallée de la chimie et l'estuaire de la Seine en sur-pression, grappes rurales en sous-pression). Bouton "Recaler" : calcule l'extraction v2 (poids corrigés par zone et baisse des CP très dilués), semaines 3 et 4 sur v2. Alignement attendu autour de 60 en semaine 1, autour de 85 en semaine 4, sans valeur forcée : ce sont les calculs qui doivent y mener.

\- Écrit dans les tables de campagne existantes en respectant leurs contraintes (pré-agrégation, lots de 50). Purge en un clic.



Visualisation de l'étape ⑤ :

\- Score d'alignement par zone (0 à 100) et global, calculé sur la population EXPOSÉE. Réutilise la mécanique du Suivi existant, en corrigeant ce qui y est codé en dur (libellés "taux d'abstention" interdits ici). Aucun score parfait si l'écart n'est pas calculable : afficher "non calculable" avec la raison.

\- Carte : bascule Rayons / CP. Côté zones, clusters colorés par indice de pression (part diffusée / part du plan x 100, divergente sous / sur, repère à 100). Côté CP, même indice.

\- Tableau des zones trié par écart : zone, population exposée, part du plan, part diffusée, indice, impressions utiles, taux d'utile réel, coût par habitant exposé touché.

\- Sites : carte des sites vert / orange / rouge selon la pression reçue dans leur rayon, liste des sites sous-servis.

\- Courbe d'alignement jour par jour avec l'événement "Recalage v2" annoté, et bilan avant / après (alignement, part en zone, taux d'utile, coût par exposé).

\- "Ce qu'il faut corriger" : zones en sur-pression et en sous-pression, volume et euros déplaçables, CP les plus dilués.

\- Répartition par partenaire : volume, CPM, part en zone.

\- Export Excel : Extraction, Diffusion par CP, Alignement par zone, Journalier.



\## Phase 6 : finitions

États vides (pas de jeu enregistré, pas d'extraction, pas de simulation), chargement, erreur. Nombres au format français, JetBrains Mono. Tests Vitest : clustering, prorata CP multi-zones, taux d'utile, poids plan, générateur (reproductibilité à graine égale, somme des impressions = volume), recalage (v2 réduit l'écart), score non calculable. Lint, typecheck, npm run catalogue propres.



\## Contraintes

\- Ne touche JAMAIS à /api/isochrone-battle/route.ts ni aux fonctions PostGIS battle.

\- Aucune nouvelle dépendance npm (Next 15.5, React 19, MapLibre 5.18, shadcn/Radix, Recharts 3.8, exceljs, Zod).

\- Routes API : Zod en entrée, getSession côté API, jamais getUser.

\- Migrations via le MCP Supabase, index GIST sur toute géométrie, EXPLAIN ANALYZE avant application, jamais de scan complet de carreaux\_filosofi, lots de 50, max 3 requêtes parallèles (compute Nano).

\- Tuiles : /api/tiles/..., ST\_AsMVT, gzip, simplification par zoom.

\- Interface en français, pas de tiret cadratin.

\- Un commit par phase avec un court récapitulatif.

