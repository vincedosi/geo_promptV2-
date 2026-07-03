# BLOC STANDARD — À inclure en tête de chaque sprint MAGELIAN

## SKILLS OBLIGATOIRES
@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## LECTURE PRÉALABLE — OBLIGATOIRE AVANT TOUTE LIGNE DE CODE
Lis ces fichiers dans l'ordre :
1. DESIGN_SYSTEM.md — tokens visuels, composants, règles d'or
2. .claude/skills/magelian-product-vision/SKILL.md — architecture UX cible
3. .claude/skills/magelian-ux/SKILL.md — règles UX (états, contraste, feedback)
4. .claude/skills/frontend-design/SKILL.md — design visuel et esthétique
5. .claude/skills/magelian-metier/SKILL.md — vocabulaire métier OOH/IRIS
6. .claude/skills/cleanup-magelian/SKILL.md — règles de cleanup post-dev

## STRATÉGIE D'EXÉCUTION — AGENTS

### Phase planification
- Utilise `make-plan` pour créer le plan complet AVANT d'écrire du code
- Utilise `smart-explore` pour cartographier les fichiers impactés
- Utilise `brainstorming` si un choix d'architecture n'est pas évident
- Utilise `mem-search` pour vérifier le contexte des décisions passées
- Soumets le plan pour VALIDATION avant d'exécuter

### Phase exécution
- Utilise `executing-plans` pour dérouler le plan phase par phase
- Utilise `dispatching-parallel-agents` si des tâches sont indépendantes
  (ex: migrer 3 composants qui ne partagent pas de state)
- Utilise `subagent-driven-development` pour les sous-tâches complexes
- Utilise `systematic-debugging` si un bug apparaît pendant le dev
- Utilise `frontend-design` pour CHAQUE composant UI créé ou modifié
  → Pas de composant "moche par défaut" — le design est obligatoire

### Phase vérification
- Utilise `verification-before-completion` AVANT de considérer terminé
- Utilise `requesting-code-review` pour un résumé des changements
- Utilise `receiving-code-review` si des problèmes sont détectés
- Utilise `finishing-a-development-branch` pour le merge propre
- Utilise `timeline-report` pour le rapport final

### Phase cleanup — OBLIGATOIRE
Après le dernier commit de code fonctionnel :
1. Lance `@cleanup-magelian` Partie 2 + Partie 3 sur les fichiers modifiés
2. Rapport rapide : failles sécu + `any` introduits + catch non typés
3. Corrige TOUT avant de considérer la tâche terminée
4. Commit cleanup : `chore(cleanup): lint + types + sécurité post-sprint-X`

## INTERDIT — TOUJOURS
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*
- Ne PAS hardcoder des valeurs qui viennent de la data (RIEN en dur)
- Ne PAS utiliser de couleur orange ou violet
- Ne PAS utiliser de font autre que Inter et JetBrains Mono
- Ne PAS utiliser getUser() sur les API routes (utiliser getSession())
- Ne PAS faire de Promise.all() avec plus de 3 appels Supabase concurrents
- Ne PAS utiliser fetch() sur les routes admin (utiliser adminFetch())
