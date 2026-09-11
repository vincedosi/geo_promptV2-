---
name: audit-refactor
description: Audit complet et refactor à comportement constant d'une codebase inconnue, héritée ou jamais documentée. Reconstitue l'architecture depuis le code, suit le trajet des données de bout en bout, détecte les choix d'architecture bancals, la logique dupliquée, les goulots d'étranglement, ce qui cassera à l'échelle et ce qui sera impossible à maintenir, puis produit un plan de refactor priorisé et l'exécute sous filet de tests de caractérisation. Utilise cette skill dès que le prompt mentionne audit, refactor, dette technique, reprise de projet, code legacy, architecture à reconstituer, duplication, performance, scalabilité, maintenabilité, mise en prod ou amélioration de la qualité sans changement fonctionnel, même si le mot audit n'apparaît pas.
---

# Audit et refactor à comportement constant

Tu reprends une codebase que personne ne t'a expliquée. L'objectif est de faire monter la qualité interne sans que le comportement observable ne bouge. Toute la méthode sert cet invariant : on ne refactore que ce qu'on sait vérifier.

## Avant de commencer

1. Lis `CLAUDE.md`, `ARCHITECTURE.md`, `README.md` et toute doc projet existante. Leurs règles (seuils de taille, conventions, langue, style de commit) priment sur les valeurs par défaut de cette skill.
2. Détermine le mode à partir du prompt :
   - **Mode validé (défaut)** : tu t'arrêtes après la phase 3 et tu attends la validation du plan.
   - **Mode one-shot** : uniquement si le prompt le demande explicitement (one-shot, autonome, sans validation). La phase 4 reste obligatoire.
   - **Mode audit seul** : si le prompt ne demande que l'analyse, tu t'arrêtes après la phase 3 sans toucher au code.
3. Crée `docs/` si absent. Tous les livrables y vont.

## Règle absolue : comportement constant

Comportement observable = mêmes entrées, mêmes sorties, mêmes routes, mêmes signatures exportées, même schéma de données, mêmes variables d'environnement, même UI, mêmes effets de bord (écritures, emails, appels externes).

En cas de doute, ne modifie pas : consigne le point dans la section "Hors périmètre" du plan. Un refactor qui change le comportement, même pour le mieux, détruit la confiance dans tout le reste du travail.

### Interdits, et pourquoi

- **Modifier un contrat public** : des consommateurs invisibles depuis le repo peuvent en dépendre.
- **Ajouter ou upgrader une dépendance sans justification dans le plan** : chaque dépendance est une nouvelle surface de dette.
- **Créer des abstractions "pour plus tard"** : la sur-ingénierie est de la dette déguisée en qualité.
- **Renommer ou reformater sans gain réel** : ça noie les vrais changements dans le diff.
- **Supprimer du code sans preuve qu'il est mort** : aucune référence, aucun import dynamique, aucun appel par chaîne, aucun point d'entrée externe (cron, webhook, CLI).
- **Corriger un bug métier** : c'est un changement de comportement. Documente-le dans le rapport.
- **Modifier un test de caractérisation pour le faire passer** : c'est la seule preuve que l'invariant tient.

## Principe de preuve

Chaque constat est cité en `fichier:ligne`. Ce que tu n'as pas vérifié dans le code, tu ne l'écris pas. Un audit avec des suppositions pousse à refactorer des problèmes qui n'existent pas.

---

## Phase 1 : cartographie (lecture seule)

1. **Inventaire** : stack, versions, gestionnaire de paquets, points d'entrée (app, API, workers, crons, scripts), configuration, variables d'environnement, dépendances.
2. **Graphe des modules** : qui importe quoi, couches réelles (pas celles supposées par les noms de dossiers), dépendances circulaires.
3. **Trajet des données de bout en bout**, pour chaque flux principal :
   entrée (UI, API, cron, webhook, import) → validation → transformation → logique métier → persistance → sortie (réponse, UI, export, appel externe).
4. **Sur un gros repo** : découpe la cartographie par module et utilise des sous-agents en parallèle si disponibles, puis consolide.

Livrable : `docs/ARCHITECTURE.md`, structure dans `references/templates-livrables.md`.

## Phase 2 : audit

Lis `references/grille-audit.md` et applique chaque catégorie :
architecture bancale, logique dupliquée, goulots d'étranglement, casse à l'échelle, impossible à maintenir, sécurité.

Format de chaque constat : identifiant, `fichier:ligne`, description factuelle, impact concret, gravité, effort (S, M, L).

Livrable : `docs/AUDIT.md`, trié par gravité.

## Phase 3 : stratégie de refactor

1. Priorise par impact, risque et effort.
2. Découpe en **lots indépendants et réversibles**. Un lot doit pouvoir être reverté seul.
3. Ordre d'exécution :
   filet de sécurité → quick wins sans risque → dédoublonnage → découplage → performance.
   Ce qui est sûr et simple passe en premier pour sécuriser le terrain avant les changements structurels.
4. Pour chaque lot : objectif, constats traités, fichiers touchés, risque, méthode de vérification du comportement identique.
5. Section **Hors périmètre** : tout ce qui exigerait un changement de comportement (bugs métier, failles dont la correction bloque un accès aujourd'hui autorisé, changements de contrat). À arbitrer par un humain.

Livrable : `docs/REFACTOR_PLAN.md`

## STOP (mode validé et mode audit seul)

Présente un résumé court : top 5 des zones critiques, nombre de lots, risques principaux, points hors périmètre à arbitrer. Attends la validation avant la phase 4.

---

## Phase 4 : filet de sécurité

Aucune modification du code de prod tant que cette phase n'est pas verte.

1. Lance les tests existants et note l'état initial (ce qui passe, ce qui échoue déjà).
2. Écris des **tests de caractérisation** sur chaque flux critique de la phase 1. Ils figent le comportement actuel, bizarreries comprises : si le code renvoie une valeur étrange, le test attend cette valeur étrange.
3. Capture une baseline : build, lint, typecheck, nombre de warnings, et temps de réponse des flux critiques si mesurable.

Commit dédié : `test: tests de caractérisation avant refactor`.

## Phase 5 : exécution

- Un lot = un ou plusieurs commits atomiques, conventional commits (`refactor:`, `perf:`, `chore:`, `test:`), sauf convention contraire du projet.
- Après chaque lot : build + lint + typecheck + tests.
- Si rouge : corrige dans le périmètre du lot ou reverte le lot. N'avance jamais sur un état rouge, les erreurs se cumulent et deviennent impossibles à isoler.
- Si un lot révèle un problème non prévu au plan : note-le, ne l'élargis pas en cours de route.

## Definition of done "prêt pour la prod"

- Build, lint, typecheck et tests verts
- Tests de caractérisation identiques avant et après
- Aucun secret en dur, aucun catch vide ou non typé, aucun `any` introduit
- Gestion d'erreur explicite et logs exploitables sur les flux critiques
- `docs/ARCHITECTURE.md` mis à jour avec l'état final

## Rapport final

Livrable : `docs/REFACTOR_REPORT.md`, structure dans `references/templates-livrables.md`. Il doit permettre à quelqu'un qui n'a pas suivi le travail de comprendre ce qui a changé, ce qui reste et pourquoi.
