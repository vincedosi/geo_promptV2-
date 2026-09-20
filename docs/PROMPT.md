\# MISSION : jeu de zones de risque + branchement campagne (MAGELIAN)



\## Constat

Le module "Population à risque industriel" calcule bien l'exposition, mais son onglet Diffusion double le Suivi de campagne existant et ne marche pas :

\- le seed a créé des impressions sans plan ("2 000 codes postaux sans plan défini"), donc le Suivi retombe sur sa variable par défaut (taux d'abstention) et n'a rien à comparer ;

\- l'alignement affiche 100/100 avec 0 CP conforme, 0 sous-pression et 0 sur-pression : faux positif ;

\- volumes du seed irréalistes (1,2 Md d'impressions en 30 jours, 3 partenaires au même CPM de 7,06 €) ;

\- bandeau "La dernière actualisation a échoué".

Le maillon manquant : il n'existe pas d'objet "zone" enregistrable, donc rien à donner comme plan à une campagne.



\## Cap

Le module risque devient un atelier qui produit un JEU DE ZONES réutilisable. Le suivi de diffusion reste dans Campagne > Suivi, rendu générique et alimenté par ce jeu de zones.



\## Phase 0 : audit, puis STOP

Écris docs/zones-risque-plan.md :

1\. Comment un plan de campagne est défini aujourd'hui : table(s), métadonnées, d'où vient "taux d'abstention (prés. 2022)", comment le Suivi choisit ses libellés, sa carte du milieu et ses légendes. Qu'est-ce qui est en dur ?

2\. Pourquoi l'alignement vaut 100/100 alors que rien n'est calculable, et pourquoi l'actualisation échoue.

3\. Ce que fait l'entrée "Zones" de la barre latérale : objet existant à réutiliser, ou à créer ?

4\. Schéma réel des tables de campagne et de plan, maille d'achat (CP).

5\. Comment la couche des sites et les tuiles MVT sont branchées sur la carte.

6\. Plan de fichiers et de migrations.

Arrête-toi et attends mon "go".



\## Phase 1 : correctifs de vérité

\- Alignement non calculable = "non calculable" (et non 100/100), avec la raison affichée ("aucun plan défini sur cette campagne"). Idem pour les 3 cartes Zones conformes / Sous-pression / Sur-pression : état vide explicite, pas des 0 %.

\- Corrige l'échec d'actualisation, ou expose l'erreur réelle si elle est externe.

\- Test Vitest : couverture de plan nulle ou partielle ne produit jamais un score parfait.



\## Phase 2 : l'objet "jeu de zones"

Nouvelle table zone\_sets (+ migration MCP Supabase) :

\- id, nom, description, created\_by, created\_at, version

\- profil de rayons : { haut: number\[], bas: number\[], autres: number\[], lie: boolean, inclurePPRT: boolean } (mètres, 100 à 10 000, 4 anneaux max par niveau, trié), schéma Zod partagé client / serveur

\- filtres figés : cible, territoire, nature de zone, niveaux réglementaires

\- mode\_plan : 'exclusif' (hors zone = 0 impression) ou 'pondere' (France entière, poids relevé sur les classes), défaut 'pondere'

\- seuil\_couverture\_cp : part minimale de la population d'un CP en zone pour que le CP soit retenu (défaut 20 %)

\- poids par classe (multiplicateur d'enchère, 0 à 5, défaut 1)

\- profil\_hash (déterministe, sur profil + filtres) pour le cache

Tables filles : zone\_set\_geoms (classe, niveau, bande, geom 4326, geom\_3857, index GIST) et zone\_set\_cp (code\_postal, classe dominante, population en zone, part de la population du CP, retenu bool).



Règle d'affectation unique (fonction pure, testée) : chaque carreau INSEE 200 m reçoit UNE seule classe.

1\. Niveau : Seveso haut prime sur bas, qui prime sur les autres.

2\. Dans le niveau : classe "PPRT" si le carreau est dans un périmètre PPRT et inclurePPRT actif, sinon la plus petite bande couvrant la distance au site le plus proche de ce niveau.

3\. Bandes exclusives (0 à r1, r1 à r2, ...), cumul par somme.

Géométries : ST\_Buffer en géographie, ST\_Union par niveau et par bande, ST\_Difference pour l'exclusivité et la primauté du Haut. Calcul une fois par profil\_hash.



\## Phase 3 : onglet "Zones" (remplace Diffusion)

Supprime l'onglet Diffusion du module risque et tout son code mort (vérifie avec npm run catalogue). Onglets : 1. Rayons  2. Territoires  3. Zones.

L'onglet Zones est piloté par la carte :

\- Comparateur : petites cartes côte à côte, une par rayon candidat (500 m, 1, 2, 5 km), chacune avec population exposée, sites concernés, CP retenus. Clic = adopter ce rayon dans le profil.

\- Grande carte du profil retenu : bandes fusionnées, teintes Seveso haut chaud (rouge corail) / bas ambre / autres gris bleuté (tokens du design system, clair et dark), opacité dégressive du cœur vers l'extérieur (ordre de grandeur 0,45 / 0,28 / 0,16 / 0,08), contour fin par bande, halo (line-blur) sur le contour extérieur, dernier anneau en pointillés, PPRT en hachures + trait plein, étiquette du rayon le long du contour à partir de z11. Par zoom : z<7 points proportionnels à la population, z7 à 10 zones fusionnées, z>10 détail + étiquettes. Survol d'un site : ses cercles propres en trait fin (polygone 64 segments côté client, aucune nouvelle dépendance) + infobulle population par bande.

\- 2 ou 3 zooms de référence sur grappes denses (vallée de la chimie, Le Havre, Fos) pour montrer les superpositions.

\- Panneau latéral : liste des classes (Haut PPRT, Haut bande 1..n, Bas..., hors zone) avec population, CP retenus, multiplicateur d'enchère éditable.

\- Bloc "Dilution CP" : curseur seuil\_couverture\_cp, et en clair population exposée vs population des CP retenus, soit un taux d'utile. C'est le point dur : le DSP achète au CP, un cercle de 1 km est bien plus petit qu'un CP.

\- Actions : Enregistrer le jeu de zones (nom + description), Dupliquer, Exporter (Excel : classes, CP retenus, poids ; plus un export points + rayons pour les DSP à ciblage par proximité).

\- Les jeux enregistrés apparaissent dans l'entrée "Zones" de la barre latérale : liste, ouverture, suppression.

Tuiles : sert les géométries du jeu via le pattern MVT existant (/api/tiles/..., ST\_AsMVT, gzip, simplification par zoom, même auth). Filtre Seveso haut / bas dans la légende de la couche, synchronisé avec le module. Clic tableau vers carte (fitBounds + surbrillance) et carte vers module.



\## Phase 4 : le jeu de zones comme plan de campagne

Dans Campagne > Stratégie : une campagne tire son plan soit d'une variable (abstention, etc.), soit d'un jeu de zones. Sélecteur, avec la version du jeu figée au moment du rattachement.

Génération du plan à la maille CP depuis zone\_set\_cp :

\- mode 'exclusif' : part de plan nulle hors zone, répartition entre CP retenus au prorata de (population en zone x poids de la classe) ;

\- mode 'pondere' : tous les CP, au prorata de (population x poids de la classe du CP, 1 hors zone).

Affiche la part de plan concentrée en zone et le taux d'utile au moment du rattachement.



\## Phase 5 : Suivi générique

Libellés, carte du milieu, légendes et textes d'aide viennent des métadonnées du plan, rien en dur ("taux d'abstention" ne doit plus apparaître pour un plan zones).

Quand le plan est un jeu de zones, ajoute un bloc "Pression par classe" : part des impressions vs part du plan, indice (part impressions / part plan x 100, repère à 100), part diffusée hors zone, évolution quotidienne en zone vs hors zone. Barres par classe + tableau par territoire à la maille choisie.



\## Phase 6 : refaire le seed

scripts/seed-demo-campagne-risque.ts, graine fixe, reproductible, purge incluse :

\- crée d'abord un jeu de zones de démo, puis la campagne "\[DEMO] Risque industriel" rattachée à ce jeu ;

\- 30 jours, maille CP, 20 à 40 M d'impressions au total, CPM distincts par partenaire (fourchette réaliste 3 à 12 €) ;

\- scénario volontaire : sous-pression sur Seveso haut, sur-pression sur 2 ou 3 régions, pour que le Suivi montre des écarts ;

\- respecte les contraintes d'unicité des tables (pré-agréger avant insert, lots de 50) ;

\- badge "Données de démonstration" visible.



\## Phase 7 : finitions

États vides, chargement, erreur. Navigation clavier sur chips, marqueurs et curseurs. Nombres au format français, en JetBrains Mono. Tests Vitest : règle d'affectation, Zod du profil, profil\_hash, prorata CP, génération de plan dans les deux modes, score non calculable. Lint, typecheck et npm run catalogue propres.



\## Contraintes

\- Ne touche JAMAIS à /api/isochrone-battle/route.ts ni aux fonctions PostGIS battle.

\- Aucune nouvelle dépendance npm (Next 15.5, React 19, MapLibre 5.18, shadcn/Radix, Recharts 3.8, exceljs, Zod).

\- Routes API : Zod en entrée, getSession côté API (jamais getUser).

\- Migrations via le MCP Supabase, index GIST sur toute géométrie, EXPLAIN ANALYZE avant application, jamais de scan complet de carreaux\_filosofi, lots de 50, max 3 requêtes parallèles (compute Nano).

\- Conserve le cache de résultats et la mention "résultat mémorisé".

\- Interface en français, pas de tiret cadratin.

\- Un commit par phase avec un court récapitulatif.

