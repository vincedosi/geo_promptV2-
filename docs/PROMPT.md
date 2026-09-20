\# MISSION : écran unifié "Population à risque industriel" (MAGELIAN)



\## Constat sur l'existant

Les trois onglets actuels (Rayons, Territoires, Zones) partagent un en-tête mais pas leur état :

\- l'en-tête annonce "Seveso seuil haut 5 km / seuil bas 5 km" pendant que Territoires garde sa propre réglette à 0,5 km, marquée "Propre à Territoires". Résultat : 217 946 habitants sur un écran, 24 406 618 sur l'autre, pour le même profil affiché. Indéfendable.

\- la courbe du bas répond à une autre question que le tableau (672 323 contre 24 406 618) et le dit en note de bas de page. Il faut supprimer cette dualité, pas la documenter.

\- la carte n'apparaît que dans Zones, alors que c'est l'objet du module.



\## Cap

Un seul écran, un seul état, une seule réglette en haut, une carte toujours visible, et quatre étapes en fil d'Ariane qui ne changent que le panneau de gauche.

Le parcours métier : je choisis mes sites, je règle le rayon, je vérifie la couverture par territoire, j'enregistre un jeu de zones. Le jeu de zones est l'objet final, réutilisable comme plan géographique. Aucune diffusion, aucun DSP, aucune campagne dans ce module.



\## Phase 0 : audit, puis STOP

Écris docs/ecran-risque-unifie.md :

1\. Où vit l'état de chaque onglet aujourd'hui, et pourquoi Territoires a une réglette locale. Ce qui est partagé, ce qui est dupliqué.

2\. D'où viennent les chiffres de la courbe (précalcul, distance par site, par nature) et si on peut en tirer une courbe PAR NIVEAU réglementaire, en affectation exclusive, sans recalcul lourd.

3\. État du code des jeux de zones déjà construit (tables, RPC, tuiles) et ce qui est réutilisable.

4\. Comment les tuiles MVT des zones et la couche des sites sont branchées.

5\. Plan de fichiers, migrations, code à supprimer.

Arrête-toi et attends mon "go".



\## Phase 1 : état unique

Un seul store pour tout l'écran, sérialisé dans l'URL :

{ cible, territoire, natureZone, niveaux: ('haut'|'bas'|'ied'|'autorisation'|'enregistrement'|'autres')\[], rayons: { haut: number, bas: number, autres: number }, lie: boolean, inclurePPRT: boolean, etape: 1|2|3|4, maille: 'region'|'departement'|'cp'|'commune' }

Zod partagé client / serveur, rayons en mètres (100 à 10 000).

\- Supprime la réglette locale de Territoires et le libellé "Propre à Territoires". Toute réglette locale est un bug.

\- Un anneau par niveau pour cette version (plus la classe PPRT à part). Le modèle reste un tableau de rayons par niveau en base, pour ouvrir les anneaux multiples plus tard sans migration.

\- Cadenas "lier les niveaux" : lie = true applique le même rayon à tous, lie = false donne un rayon par niveau (c'est ce qui permettra le bidding différencié).



Règle d'affectation exclusive (fonction pure, testée en Vitest), à conserver telle qu'elle est déjà écrite dans l'interface :

1\. Seveso seuil haut prime sur seuil bas, qui prime sur les autres.

2\. Dans le niveau : classe "Périmètre PPRT" si le carreau est dans une servitude publiée et inclurePPRT actif, sinon "Bande calculée".

3\. Un carreau INSEE 200 m = une seule classe, donc toutes les sommes sont additives (par niveau, par bande, par territoire).

Garde les textes d'explication existants, ils sont bons, et garde la phrase sur les habitants à moins de 10 km non retenus par les anneaux, qui empêche de lire le total comme "la population non exposée de France".



\## Phase 2 : la barre permanente

Toujours visible, quelle que soit l'étape, dans cet ordre :

1\. Filtres : Cible, Territoire, Nature de la zone, Niveau réglementaire (chips actuels conservés).

2\. Réglette unique : une réglette par niveau actif quand lie = false, une seule quand lie = true. Lecture immédiate, sans recalcul, comme aujourd'hui. Chips de rappel ("Haut 2 km", "Bas 1 km") cliquables pour éditer.

3\. Bandeau KPI, 6 chiffres, format français, JetBrains Mono :

&#x20;  - population couverte (somme exclusive)

&#x20;  - part de la population France

&#x20;  - sites retenus sur total (ex. 421 / 676)

&#x20;  - codes postaux retenus

&#x20;  - taux d'utile : population couverte / population des CP retenus. Indicateur clé, à styliser comme tel : il chute fortement aux petits rayons et doit être vu avant l'achat, pas après.

&#x20;  - gain marginal : habitants gagnés par 100 m de plus, au rayon courant (déjà calculé pour la courbe).

Chaque KPI a une infobulle avec sa définition en une phrase.



\## Phase 3 : fil d'Ariane et carte permanente

Fil d'Ariane "① Sites › ② Rayon › ③ Couverture › ④ Zones", chaque étape cliquable dans les deux sens, jamais un tunnel : on revient sans arrêt du 3 au 2. Étape courante soulignée, étapes déjà renseignées marquées. Navigation clavier.

Mise en page : panneau de l'étape à gauche, carte à droite, toujours montée (une seule instance MapLibre, jamais démontée entre les étapes, seules les couches et la caméra changent). Poignée de redimensionnement, et bouton plein écran carte.

Couches et zoom :

\- z < 7 : points proportionnels à la population couverte par site, les zones ne sont pas lisibles à cette échelle et ne sont pas rendues.

\- z 7 à 10 : zones fusionnées par niveau.

\- z > 10 : détail, contours par classe, étiquette du rayon le long du contour.

Style (tokens du design system, clair et dark) : Seveso haut rouge corail, bas ambre, autres gris bleuté. Trait plein pour les périmètres PPRT publiés, tireté pour les rayons calculés, comme le dit déjà la légende actuelle. Opacité modérée, aucune superposition d'opacité grâce à l'union des géométries.

Survol d'un site : ses cercles en trait fin (polygone 64 segments côté client, aucune nouvelle dépendance) et infobulle population par classe.

Conserve les raccourcis Vallée de la chimie, Estuaire de la Seine, Étang de Berre.



\## Phase 4 : les quatre panneaux

① Sites : sélection des niveaux, décompte par niveau et par nature de risque, part des sites couverts par un périmètre PPRT publié. Carte : points seuls.

② Rayon : la courbe devient le sélecteur. Redessine-la PAR NIVEAU (seuil haut, seuil bas, cumul exclusif), en affectation exclusive, cohérente avec le tableau, pour supprimer la contradiction actuelle. Les natures de risque restent accessibles en bascule secondaire, avec leur note expliquant qu'elles ne s'additionnent pas. Marqueurs déplaçables sur la courbe, clic pour poser le rayon, tableau des classes (Périmètre PPRT, Bande calculée) par niveau avec population et cumul. Carte : anneaux qui se dilatent en direct pendant le glissement.

③ Couverture : tableau à la maille choisie (Région, Département, Code postal, Commune) + choroplèthe latérale (Part %, Densité, Effectif) déjà en place. Survol de ligne : surbrillance sur la grande carte. Clic : fitBounds. Garde les notes existantes sur l'outre-mer et sur la colonne "sites" qui ne s'additionne pas.

④ Zones : liste des classes (Haut PPRT, Haut bande, Bas PPRT, Bas bande, autres) avec population, CP retenus et multiplicateur d'enchère éditable (0 à 5, défaut 1). Curseur "CP retenu si au moins X % de sa population est en zone" (défaut 20 %), avec l'effet sur le taux d'utile affiché en direct. Enregistrement du jeu de zones (nom, description), duplication, liste des jeux enregistrés, suppression. Exports : Excel (classes, CP retenus, poids) et fichier points + rayons pour les outils à ciblage par proximité.



\## Phase 5 : finitions

États vides, chargement, erreur sur chaque panneau. Conserve le cache et la mention "résultat mémorisé · date · durée de calcul". Nombres au format français. Tests Vitest : règle d'affectation, Zod de l'état, hash de profil, cohérence courbe / tableau (même rayon, même total), taux d'utile, seuil de rétention CP. Lint, typecheck et npm run catalogue propres, code mort des anciens onglets supprimé.



\## Contraintes

\- Ne touche JAMAIS à /api/isochrone-battle/route.ts ni aux fonctions PostGIS battle.

\- Aucune nouvelle dépendance npm (Next 15.5, React 19, MapLibre 5.18, shadcn/Radix, Recharts 3.8, exceljs, Zod).

\- Routes API : Zod en entrée, getSession côté API, jamais getUser.

\- Migrations via le MCP Supabase, index GIST sur toute géométrie, EXPLAIN ANALYZE avant application, jamais de scan complet de carreaux\_filosofi, lots de 50, max 3 requêtes parallèles (compute Nano).

\- Tuiles : /api/tiles/..., ST\_AsMVT, gzip obligatoire, simplification par zoom.

\- Interface en français, pas de tiret cadratin.

\- Un commit par phase avec un court récapitulatif.

