1. Correction du périmètre des analyses (Isochrones)

Il y a un bug de filtrage lors du lancement des analyses. Actuellement, quand on applique un filtre par territoire, région ou département, les POI sont bien filtrés visuellement sur la carte. En revanche, dès que l'on lance une analyse (isochrone par exemple), le calcul prend en compte la totalité des POI du territoire national au lieu de se limiter uniquement à la sélection filtrée.

Attendu : L'analyse doit impérativement respecter les filtres actifs et ne traiter que les données affichées à l'écran.



2. Suppression de l'overlay d'accueil sur /map

Il faut supprimer l'écran de bienvenue qui s'affiche lors de l'arrivée sur http://localhost:3000/map.



Retirer le fond noir (overlay).

Supprimer la bannière "Que voulez-vous analyser ?".

Objectif : L'utilisateur doit arriver directement sur la carte avec le bandeau latéral visible, sans étape intermédiaire.

3. Nettoyage du bandeau latéral (Sidebar)

Dans le menu latéral, merci de supprimer définitivement le bouton "Home". Nous n'en avons plus besoin pour la navigation.

Merci de me confirmer quand ces modifications seront en ligne.