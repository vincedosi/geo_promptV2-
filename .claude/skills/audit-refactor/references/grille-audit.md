# Grille d'audit

## Sommaire
1. Seuils par défaut
2. Échelle de gravité
3. Architecture bancale
4. Logique dupliquée
5. Goulots d'étranglement
6. Casse à l'échelle
7. Impossible à maintenir
8. Sécurité

---

## 1. Seuils par défaut

Remplacés par ceux de `CLAUDE.md` s'ils existent.

| Mesure | Seuil |
|---|---|
| Lignes par fichier | 300 |
| Lignes par fonction | 50 |
| Profondeur d'imbrication | 3 |
| Paramètres par fonction | 4 |
| Bloc dupliqué | 10 lignes similaires, ou même règle métier implémentée 2 fois |

Un dépassement de seuil est un signal, pas un constat automatique. Un fichier de 400 lignes de constantes cohérentes n'est pas un problème.

## 2. Échelle de gravité

- **Critique** : faille de sécurité, perte ou corruption de données possible, casse certaine au volume visé.
- **Haute** : bloque l'évolution du code ou dégrade fortement les performances.
- **Moyenne** : ralentit la maintenance, augmente le risque de régression.
- **Basse** : amélioration utile sans urgence.

---

## 3. Architecture bancale

Signaux :
- Logique métier dans les composants UI, pages, routes ou controllers
- Accès base de données directs depuis la couche présentation
- Module de bas niveau qui importe une couche supérieure
- Dépendances circulaires
- Fichier ou objet "fourre-tout" qui fait tout
- Configuration, URLs, identifiants ou seuils métier en dur
- État global mutable partagé
- Calcul pur mélangé aux I/O, ce qui le rend intestable

Correction type : extraire la logique pure dans un module dédié et testable, isoler les I/O aux bords, injecter la configuration.

## 4. Logique dupliquée

Signaux :
- Même calcul, formatage ou validation à plusieurs endroits
- Copier-coller avec petites variantes
- Constantes ou enums redéfinis
- Mappings de données répétés
- Schémas de validation divergents entre front et back pour la même donnée

Piège : deux blocs qui se ressemblent mais évoluent pour des raisons métier différentes ne sont pas une duplication. Ne factorise que si c'est la même règle métier. Une factorisation forcée crée un couplage pire que la duplication.

Quand les variantes divergent déjà (bug corrigé d'un côté seulement), c'est un constat de gravité haute, et le choix de la version de référence est un changement de comportement : hors périmètre.

## 5. Goulots d'étranglement

Signaux :
- Requêtes N+1 (requête dans une boucle)
- `await` séquentiels dans une boucle alors que les appels sont indépendants
- Chargement complet d'une table ou d'un fichier en mémoire
- Absence de pagination sur des listes non bornées
- Colonnes filtrées ou jointes sans index
- Calcul lourd sur le thread principal ou l'event loop
- Même calcul coûteux répété sans cache
- Payloads surdimensionnés (champs inutiles, `SELECT *`)
- Re-renders ou recalculs inutiles côté front

Méthode : quantifie quand c'est possible (nombre de requêtes par action utilisateur, complexité algorithmique, taille des données en jeu).

## 6. Casse à l'échelle

Signaux :
- État en mémoire du process (sessions, caches, files) incompatible avec plusieurs instances ou le serverless
- Absence d'idempotence sur webhooks, retries, imports
- Race conditions : lecture puis écriture sans transaction ni verrou
- Appels externes sans timeout, retry ni backoff
- Rate limits des API tierces ignorés
- Stockage sur disque local
- Jobs longs non reprenables après interruption
- Croissance non bornée : logs, tables, listes en mémoire, fichiers temporaires
- Limites de plateforme ignorées : timeouts serverless, taille des payloads, connexions BDD

Pour chaque constat, précise à partir de quel ordre de grandeur ça casse si tu peux l'estimer depuis le code.

## 7. Impossible à maintenir

Signaux :
- Dépassements des seuils de la section 1
- Typage faible : `any`, casts forcés, `@ts-ignore`, `# type: ignore`
- Erreurs avalées : catch vide, catch non typé, erreur loggée puis ignorée
- Magic numbers et magic strings
- Code mort : exports jamais importés, branches inatteignables, feature flags figés
- Nommage trompeur (le nom dit autre chose que ce que fait le code)
- Commentaires obsolètes qui contredisent le code
- Aucun test sur la logique critique
- Couplage temporel : ordre d'appel implicite non documenté
- Effets de bord cachés dans des fonctions qui semblent pures

## 8. Sécurité

Signaux :
- Secrets en dur ou commités dans l'historique
- Injections SQL, commande, template
- Entrées utilisateur non validées côté serveur
- Contrôles d'accès absents côté serveur ou base (confiance dans le front)
- Données sensibles dans les logs
- CORS permissif
- Dépendances avec vulnérabilités connues

Attention : corriger un contrôle d'accès bloque souvent un accès aujourd'hui possible, donc change le comportement. Classe ces constats en critique et place leur correction en hors périmètre, à arbitrer en priorité. Seules les corrections sans effet fonctionnel (retirer un secret du code vers une variable d'environnement, masquer une donnée dans un log) entrent dans les lots.
