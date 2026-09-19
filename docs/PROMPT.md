# Tâche : nouvel onglet "Rayon d'influence" dans l'overlay Zones à risque

## Contexte

L'overlay "Zones à risque" existe déjà et calcule la couverture.
AVANT DE CODER :
1. Localise le composant de l'overlay, ses onglets, ses filtres et le(s) RPC qu'il appelle.
2. Identifie la table des zones à risque (<<TABLE_ZONES_RISQUE>>), sa colonne géométrique et son SRID.
3. Identifie la source de population utilisée (carreaux Filosofi ou IRIS) et les colonnes de population disponibles.
4. Résume-moi en 5 lignes ce que tu as trouvé et les hypothèses que tu prends, puis code.

## Objectif
Ajouter un onglet supplémentaire dans l'overlay, à côté de l'onglet de couverture existant,
qui permet de choisir le rayon pertinent autour des zones à risque.

## Spécification fonctionnelle
- Graphique (même librairie de charts que le reste de l'app) :
  - axe X : rayon en mètres, paliers de 100 m, de 0 à 10 000 m
  - axe Y : population à risque couverte, en CUMULÉ (population située à moins de X m d'au moins une zone à risque)
  - courbe + tooltip au survol : rayon, population couverte, part en % de la population totale des zones filtrées
- Curseur (slider) sur l'axe X pour sélectionner un rayon :
  - affichage d'un bloc de KPI : rayon retenu, population couverte, % du total, nombre de zones concernées
  - le déplacement du curseur ne déclenche AUCUN appel réseau (série complète déjà en mémoire)
- Filtres identiques à ceux du premier onglet : région, département, type de population.
  Réutilise les mêmes composants et le même state, ne les redéveloppe pas.
  Changement de filtre = un seul appel RPC, avec debounce et cache par combinaison de filtres.
- États gérés : chargement (skeleton), vide (aucune zone après filtrage), erreur.

## Implémentation données
Créer une fonction Postgres `get_couverture_par_rayon(p_region text, p_departement text, p_type_pop text)` :
1. Sélectionner les zones à risque filtrées.
2. Pré-filtrer les unités de population avec `ST_DWithin(..., 10000)` pour ne garder que ce qui est à moins de 10 km.
3. Pour chaque unité de population, calculer la distance à la zone à risque LA PLUS PROCHE
   (opérateur `<->` + `LATERAL ... ORDER BY ... LIMIT 1`), afin d'éviter tout double comptage entre zones.
4. Bucketiser : `ceil(distance / 100) * 100` (bucket 0 pour les unités à l'intérieur d'une zone).
5. `GROUP BY bucket, SUM(population)` puis cumul en SQL avec `SUM(...) OVER (ORDER BY bucket)`.
6. Renvoyer une série complète de 0 à 10 000 par pas de 100 (paliers sans données remplis par report du cumul précédent),
   colonnes : `rayon_m`, `pop_increment`, `pop_cumulee`.

Contraintes techniques :
- Distances en mètres via une projection métrique (Lambert 93, EPSG:2154) ou `geography`, jamais en 4326 brut.
- Vérifier/créer les index GIST nécessaires sur les géométries concernées.
- Migration SQL versionnée dans `supabase/migrations`.
- Fonction en `SECURITY INVOKER` si les RLS le permettent ; sinon documenter le choix et poser une policy explicite.
- Objectif de perf : réponse sous 2 s sur un périmètre France entière ; si le volume l'impose, agréger en amont
  (table ou vue matérialisée de distances précalculées) plutôt que de dégrader l'UX.

## Interdits
- Ne jamais modifier `/api/isochrone-battle/route.ts` ni les fonctions PostGIS de battle existantes.
- Ne pas toucher au calcul de couverture de l'onglet existant.
- Pas de nouvelle dépendance de charting.

## Critères d'acceptation
- Le nouvel onglet s'affiche sans régression sur l'onglet existant.
- Les filtres pilotent bien la courbe, et un filtre vide donne un état vide propre.
- Le curseur met à jour les KPI instantanément, sans appel réseau.
- La somme des `pop_increment` sur toute la série égale la `pop_cumulee` à 10 000 m.
- `npm run build` et le lint passent.