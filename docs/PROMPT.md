# MISSION : refonte du module "Population à risque industriel"

## Contexte
Module existant dans MAGELIAN (overlay plein écran depuis /map, contexte campagne via ?campagne=...&maille=cp).
1 259 sites classés (Géorisques ICPE + 664 périmètres PPRT IGN). Deux onglets aujourd'hui :
- "Population exposée" : tableau par région / département / CP / commune + choroplèthe, rayon 500 m à 5 km, périmètre PPRT réel si dispo sinon rayon choisi.
- "Rayon d'influence" : courbe cumulée 0 à 10 km par nature de risque, slider "lecture immédiate, sans recalcul", distance mesurée au site, jamais au PPRT.
Finalité métier : custom bidding différencié Seveso haut / Seveso bas. Le produit sert à éviter de sur-presser ou sous-presser des zones par rapport au plan.

Stack : Next.js 15.5 App Router, React 19, TS strict (imports @/), Supabase + PostGIS 3.3, MapLibre 5.18, tuiles MVT via ST_AsMVT sur /api/tiles/..., shadcn/ui (Radix tabs, dialog), Recharts 3.8, Zod, Vitest (unit puis integration), design system MAGELIAN (Inter + JetBrains Mono).

## Phase 0 : audit, puis STOP
Avant tout code, lis le module existant et écris docs/risque-refonte-plan.md avec :
1. Fichiers, routes API, RPC et tables du module (sites, PPRT, précalculs de distance carreau vers site, cache "résultat mémorisé").
2. Comment la courbe obtient sa lecture immédiate (quelle table de précalcul, distance par site, par nature, par niveau ?). Peut-on en tirer la distance au site le plus proche PAR NIVEAU réglementaire sans recalcul lourd ?
3. Schéma réel des tables de campagne (dsp_campaigns, dsp_campaign_data ou équivalent actuel), maille disponible (CP), colonnes impressions / coût.
4. Comment la couche des points de sites est branchée sur la carte aujourd'hui.
5. Plan de fichiers à créer / modifier / supprimer.
Arrête-toi et attends mon "go".

## Phase 1 : un seul écran, un seul état
Fusionne les deux menus. Un état partagé unique (cible, territoire, nature de zone, niveaux réglementaires, profil de rayons), sérialisé dans l'URL.
Structure :
- En-tête : titre, territoire, Export Excel, fermer.
- Barre de filtres unique : Cible, Territoire, Nature de la zone, Niveau réglementaire. Résumé du profil en chips cliquables ("Haut : 1 · 2 · 5 km", "Bas : 0,5 · 1 km").
- Bandeau KPI commun : population exposée totale, part de la population, sites concernés, puis ventilation Haut / Bas. Une ligne sous les KPI rappelle la règle de calcul en clair.
- Onglets (shadcn Tabs) dans l'ordre du travail : 1. Rayons  2. Territoires  3. Diffusion. Bouton persistant "Voir sur la carte".
Supprime les doublons de code entre les deux anciens onglets.

## Phase 2 : atelier "Rayons"
Modèle : ProfilRayons = { haut: number[], bas: number[], autres: number[], lie: boolean, inclurePPRT: boolean }. Rayons en mètres, 100 à 10 000, 4 anneaux max par niveau, triés, schéma Zod partagé client / serveur.
- lie = true : mêmes anneaux pour tous les niveaux (mode comparaison). lie = false : anneaux propres à chaque niveau.
- La courbe existante (Recharts) devient le sélecteur : une courbe par niveau actif, marqueurs verticaux déplaçables par anneau, clic sur la courbe pour ajouter un anneau, lecture immédiate de la population et du "palier suivant". Les courbes par nature de risque restent disponibles en bascule.
- Panneau latéral : une ligne par niveau avec ses anneaux en chips éditables, presets (500 m, 1, 2, 5 km), cadenas "lier les niveaux", bascule "inclure les périmètres PPRT".
- Tableau des bandes : par niveau et par bande, population dans la bande et cumulée.

Règle d'affectation unique (fonction pure, testée en Vitest) : chaque carreau INSEE 200 m reçoit UNE seule classe.
1. Niveau : Seveso haut prime sur Seveso bas, qui prime sur les autres.
2. Dans le niveau : classe "PPRT" si le carreau est dans un périmètre PPRT et inclurePPRT actif, sinon la plus petite bande dont le rayon couvre la distance au site le plus proche de ce niveau.
3. Bandes exclusives (0 à r1, r1 à r2, ...). Le cumul se déduit par somme.
Conséquence : toutes les sommes sont additives (niveaux, bandes, territoires) et les deux anciens chiffres contradictoires disparaissent. Si un total change par rapport à l'existant, explique l'écart dans le plan.

## Phase 3 : les zones sur la carte
Nouvelle couche MVT "zones de risque", pilotée par le profil courant.
Serveur : table de cache (profil_hash, niveau, bande, geom 4326, geom_3857, index GIST). Pour un profil : ST_Buffer en géographie, ST_Union par niveau et par bande, ST_Difference pour rendre les bandes exclusives et faire primer Haut sur Bas. Calcul une fois par profil_hash, puis tuiles depuis le cache (simplification par zoom, gzip comme les autres routes de tuiles, même pattern d'auth). PPRT servis comme classe à part.
Style MapLibre (clair et dark MAGELIAN) :
- Deux teintes : Seveso haut chaud (rouge corail), Seveso bas ambre, autres gris bleuté. Tokens du design system.
- Opacité dégressive du cœur vers l'extérieur (ordre de grandeur 0.45 / 0.28 / 0.16 / 0.08). Aucun empilement d'opacité grâce à l'union.
- Contour fin sur la limite de chaque bande, contour extérieur avec halo (line-blur), dernier anneau en pointillés.
- PPRT : hachures (fill-pattern) + trait plein, pour distinguer le réglementaire du calculé.
- Étiquette du rayon le long du contour (symbol-placement line) à partir de z11.
- Par zoom : z < 7 points proportionnels à la population exposée, z 7 à 10 zones fusionnées, z > 10 détail + étiquettes.
- Survol d'un site : ses cercles propres en trait fin (polygone 64 segments calculé côté client, sans nouvelle dépendance), infobulle population par bande. Clic : fiche site.
- Filtre Seveso haut / bas directement dans la légende de la couche, synchronisé avec le module.
- Tableau vers carte : clic sur un territoire ou un site, fitBounds et surbrillance. Carte vers module : clic sur une zone, ouverture du module filtré.
Bonus seulement si simple : marquer les zones couvertes par 2 sites ou plus (cumul de risques).

## Phase 4 : onglet "Diffusion" + campagne de démo
Aucune campagne réelle en base. Crée scripts/seed-demo-campagne-risque.ts :
- 1 campagne "[DEMO] Risque industriel", identifiable (flag ou préfixe), 30 jours, maille code postal, dans les tables de campagne existantes, en respectant leurs contraintes d'unicité (pré-agréger, insert par lots).
- Générateur à graine fixe (reproductible) : impressions proportionnelles à la population avec bruit, plus un scénario volontaire (sur-pression dans 2 ou 3 régions, sous-pression sur les zones Seveso haut) pour que l'écran raconte quelque chose. Coût / CPM si les colonnes existent.
- Commande de purge. Badge "Données de démonstration" visible dans l'onglet.
Contenu de l'onglet (campagne de l'URL, sinon sélecteur) :
- KPI : impressions en zone vs hors zone, part des impressions vs part de la population, indice de pression (part impressions / part population x 100) par classe.
- Barres par classe (Haut PPRT, Haut bande 1..n, Bas ..., hors zone) avec l'indice 100 en repère.
- Tableau par territoire (même "Lister par" que Territoires) : population exposée, impressions, indice, écart au plan.
- Évolution quotidienne en zone vs hors zone.
- Emplacement réservé "Custom bidding" : un multiplicateur par classe, en lecture seule pour l'instant. Pas de logique d'enchère dans cette mission.
Ventilation CP vers classes : au prorata de la population des carreaux du CP dans chaque classe, précalculée et mise en cache par profil_hash.

## Phase 5 : finitions
- Export Excel (exceljs) : feuilles Profil, Bandes, Territoires, Diffusion.
- États vides, chargement, erreur. Navigation clavier sur chips et marqueurs. Nombres au format français, en JetBrains Mono.
- Tests Vitest : règle d'affectation, schéma Zod du profil, hash du profil, prorata CP.
- npm run catalogue (knip) propre, lint et typecheck OK.

## Contraintes
- Ne touche JAMAIS à /api/isochrone-battle/route.ts ni aux fonctions PostGIS battle.
- Aucune nouvelle dépendance npm.
- Routes API : Zod en entrée, même pattern d'auth que les routes existantes (getSession côté API).
- Migrations via le MCP Supabase, index GIST sur toute géométrie, EXPLAIN ANALYZE sur les requêtes lourdes, jamais de scan complet de carreaux_filosofi.
- Conserve le cache de résultats existant et la mention "résultat mémorisé".
- Interface en français, pas de tiret cadratin dans les textes.
- Un commit par phase, avec un court récapitulatif de ce qui a changé.