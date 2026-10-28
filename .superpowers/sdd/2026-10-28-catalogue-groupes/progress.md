# SDD ledger — plan: docs/superpowers/plans/2026-10-28-carte-en-parcours-catalogue-groupes.md
Worktree .claude/worktrees/carte-finitions, branche feat/carte-finitions (HEAD au plan : 20fbee8b). Mode accéléré, agents opus, 2 groupes + T6.
Spec : 2026-10-13-carte-en-parcours-design.md § 7.1, § 7.3, V6-V9 (lot 8 = lot 11 « inchangé » du § 16.5). § 7.2 déjà livré (lot 2, sql/251).

## Pré-vol (28/10, architecte)
- Mesures locales : data_sources 7 lignes (1 buffer) ; cible_indicator_registry 19 (1 buffer) ; abstention 6 186 CP ; 5 espaces ; sql 288-289 libres (à revérifier).
- Écarts à la spec tranchés (Q-1, Q-4, Q-5) : pas de table catalogue_jeux (indicateur privable = ligne data_sources type 'indicateur') ; pas de table groupes_espaces (colonne organizations.groupe_espace) ; fiche dépliée dans ②, pas d'outil « Fiche ».
- Questions à Vincent Q-1..Q-5 (plan) : le plan applique les recommandations en attendant.

## Statut des tâches
- [ ] T1 l'indicateur devient un jeu (sql/288) — Groupe A
- [ ] T2 une seule règle pour tout indicateur servi — Groupe A
- [ ] T3 fiche d'un jeu + groupes côté serveur (sql/289) — Groupe A
- [ ] Relecture 1 (groupe A)
- [ ] T4 Accès : dossiers de groupes, champ Groupe, libellé Indicateur — Groupe B
- [ ] T5 ② rangé par les droits, fiche d'un jeu — Groupe B
- [ ] Relecture 2 (groupe B)
- [ ] T6 revue finale, preuve navigateur deux thèmes (:3002/:4202), doc

== RESUME HERE ==
1. Lire les réponses de Vincent à Q-1..Q-5 (si une diffère de la reco, amender l'arbitrage cité avant de dispatcher).
2. Revérifier les numéros SQL libres (`ls sql .claude/worktrees/*/sql | grep -E '^2(8[8-9]|9[0-9])_'`).
3. Dispatcher le Groupe A (T1+T2+T3) à UN implémenteur, BASE = HEAD courant ; puis relecture 1.
