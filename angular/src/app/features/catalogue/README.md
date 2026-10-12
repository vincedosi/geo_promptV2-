# catalogue — guide vivant des composants

**Rôle** : chaque brique de `ui/` (et `mg-carte`, `mg-courbe`) dans son état réel, avec des données
d'exemple GÉNÉRIQUES. Sert à la relecture visuelle dans les deux thèmes et de mode d'emploi : avant d'écrire
un bouton, un champ ou un KPI, regarder ici ce qui existe déjà.

**Route** : `catalogue` sous la coquille (`/app/catalogue`), atteinte par le lien de développement du pied de
la barre latérale (hors production seulement).

**Fichiers** : `catalogue.page.ts` (+ `.html`, `.spec.ts`). Aucun appel d'API, aucun service d'état.

**Ajouter une brique** : la créer dans `ui/<nom>/`, puis la montrer ici dans ses états utiles (défaut,
survol, désactivé, chargement, erreur). Pas de nom de marque dans les exemples.
