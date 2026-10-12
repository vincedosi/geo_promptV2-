# connexion — page de connexion (lancement autonome seulement)

**Rôle** : se connecter quand l'application tourne SEULE. Dans le shell AIDA, c'est le shell qui authentifie :
cette route n'existe pas dans `remoteRoutes`, seulement dans `appRoutes`.

**Route** : `/connexion`, gardée par `demarrageGuard` et `sansSessionGuard` (une session ouverte renvoie vers
`/app`). La page porte sa propre racine d'ombre.

**Fichiers** : `connexion.page.ts` (+ `.html`, `.spec.ts`) ; `vitrine.ts`, la grille décorative de la moitié
droite (fonction pure).

**Particularité** : seul dossier autorisé à importer `@angular/forms` (`tests/unit/angular/imports-partages.test.ts`) —
un hôte par défaut ne le partage pas, et cette page n'y est jamais chargée.
