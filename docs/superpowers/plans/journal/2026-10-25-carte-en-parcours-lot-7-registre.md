# SDD ledger — plan: docs/superpowers/plans/2026-10-25-carte-en-parcours-lot-7-activation.md
Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md (§ 19 fait foi). Worktree .claude/worktrees/carte-activation, branche feat/carte-activation depuis c8bcb325 ; plan commité 7d50b6ca. Mode accéléré, agents opus.
- Vincent (25/10) : Q-1 simulation DV360 pour les démos seulement (sinon fichier SDF) ; Q-2 avertissement écrit (pas de case bloquante) ; Q-3 line items DV360 saisis à la main, annonceur prérempli ; Q-4 fichiers téléchargeables aussi depuis ⑤ sans campagne. Toutes = recommandations du plan.
- RESUME HERE (26/10) : pré-vol du plan (table de conflits) PAS encore fait ; puis dispatcher groupe A (T1+T2).

## Pré-vol (26/10)
| Paire / tâche | Produit → consommé | Constat |
|---|---|---|
| T1↔T2 | `lireCpPlateforme` (T1) → route fichier (T2) | cohérent |
| T1↔T3 | prevol `mode_dv360`, `n_cp_dv360`, `extraction`, `motifs[code]` → `cartesActivation`, `texteMotif` | cohérent ; `publier(strategie)` : l'id vient du champ `strategie` déjà rendu par prevol (route l. 164) |
| T1↔T3 | historique `mode` → bandeau/historique | cohérent |
| T2↔T3/T5 | `formatsDe` dupliqué Angular, verrou de parité | plan-mandated (duplication) — Ruling ci-dessous |
| T3↔T4 | `ActivationCampagneService` → panneau | cohérent |
| T4↔T5 | `mg-carte-plateforme` (T4, contenu projeté) ← fichiers (T5) ; tous deux dans `panneaux/activation/` | séquentiel, cohérent |
| T5↔⑤ | `mg-fichiers-extraction` remplace le texte d'`extractions-jeu` | cohérent |
| T1 interne | A-2 « mêmes contrôles en simulé » vs route actuelle 404 sans connexion | conflit — Ruling 1 |
| T1 interne | test 2 001 geo IDs « Utiliser l'export fichier » = texte réel de la route l. 83 | cohérent ; `mapPostalCodesToGeoIds` est local (pas de Google) → simulé calcule les vrais comptes |
| T2 interne | tests ↔ formats A-6 | cohérent |
| T3/T4/T5 internes | specs ↔ composants | cohérent ; `carte.page.ts` 378/400 + une ligne |
- Ruling 1 : en `simule`, `pousserCiblageDv360` ne lit PAS `dsp_connections` ni de jeton (contrôles = CP vides, 0 mappé, > 2 000) ; en `reel`, 404 « Aucune connexion DV360 enregistrée. » inchangé — sinon le simulé serait inatteignable sans connexion, ce qui est son seul cas d'usage (E3) — coût si faux : une condition.
- Ruling 2 : duplication `formatsDe` / parsing line items React↔Angular acceptée, verrouillée par tests de parité — mandatée par le plan, retirée à la bascule React — coût : rien tant que la parité est testée.
- Groupe A (T1+T2) dispatché 26/10, BASE 7d50b6ca, implémenteur opus.
- Groupe A livré DONE_WITH_CONCERNS : T1 3dfb311c, T2 cac654dc (suites complètes non relancées par l'implémenteur — relancées par le contrôleur ; échec connu jeux-de-zone-schema = données de preuve lot 6 dans la base partagée). Relecture 1 dispatchée (opus) → review-groupe-a.md.
- Relecture 1 : spec ✅ T1/T2 ; Not approved : I-1 contrôle d'espace perdu dans pousser, I-2 jeton Google sans délai (lot en_cours possible) ; 12 mineurs dans review-groupe-a.md (deferred → T6).
- Ruling 3 : le renommage `sourceDuPlan` (mineur) est joint au fix round 1 — l'homonymie compilerait en silence en T3 — coût : un renommage.
- Groupe A : fix round 1/5 dispatché (FIX_BASE cac654dc).
- Suite complète contrôleur sur cac654dc : unit 274 fichiers/2 904 verts ; intégration 547/548 (seul échec jeux-de-zone-schema, données de preuve lot 6 — hors code). tsc : 5 erreurs dans pousser-ciblage.test.ts pendant le fix round 1 (à revérifier après).
- Groupe A fix round 1 : 27dd2a5e (I-1 espace 404 prevol+pousser, I-2 jeton borné 30 s, renommage sourceDePoussee). tsc racine : 0 erreur hors angular/ ; 10 erreurs dans angular/ (résolution des modules depuis la racine dans le worktree) — à vérifier par `ng test`/`ng build` en T3. Re-review scoped dispatchée.
- Groupe A : fix round 1/5 (3 addressed, 0 open ; commits cac654dc..27dd2a5e).
- Task 1: complete (commits 7d50b6ca..27dd2a5e, review clean après fix round 1)
- Task 2: complete (commits 3dfb311c..cac654dc, review clean)
- Groupe B (T3+T4) dispatché, BASE 27dd2a5e.
- Groupe B livré DONE_WITH_CONCERNS : T3 4436f7b7, T4 d454f8a7 ; ng test 409 fichiers/3 327 verts, ng build OK, tsc racine 0 erreur (jonction angular/node_modules réparée par le contrôleur le 26/10 : elle pointait vers C:\GENESIS\angular\node_modules).
- Ruling 4 : Meta sur un jeu RISQUE = aucun fichier, motif affiché (le serveur T2 n'accepte que dv360/ttd en cp/sdf pour un jeu risque ; A-4 « CP à vérifier » pour Meta contredisait T2) — le plan se contredisait, le serveur relu fait foi — coût si faux : un format côté route + une règle de carte.
- Relecture 2 (T3+T4) dispatchée, opus.
- Relecture 2 : spec ✅ T3/T4 ; Not approved : I-1 cache des extractions par jeu (pas par version) → RF4 cassé après relance ; I-2 canaux non relus après relance ; 10 mineurs dans review-groupe-b.md (deferred → T6, dont « carte en lecture comptée prête » → T5).
- Groupe B : fix round 1/5 dispatché (FIX_BASE d454f8a7).
- Groupe B fix round 1 : e199524c (I-1 extractions relues si version absente, I-2 canaux repris après lancement) ; specs ciblées 67/67, tsc 0 ; ng test complet rc=1 sur un délai de remote.spec (26/26 seul). plan-campagne.service.ts 391/400. Re-review dispatchée.
- Groupe B : fix round 1/5 (2 addressed, 0 open ; commits d454f8a7..e199524c).
- Task 3: complete (commits 27dd2a5e..4436f7b7, review clean après fix round 1 du groupe)
- Task 4: complete (commits 4436f7b7..e199524c, review clean après fix round 1)
- T5 dispatché, BASE e199524c.
- T5 livré DONE_WITH_CONCERNS : 3694e99a (M-1 corrigé ; ng test 410/3 345 verts hors délai remote.spec ; écarts : flèche ↓ retirée, fichiers sous chaque version en ⑤). Relecture 3 dispatchée.
- Relecture 3 (T5) : Approved, 0 C/I, 5 mineurs dans review-t5.md (dont m-1 ⑤ : boutons liés au jeu quitté pendant un chargement — comportement).
- Task 5: complete (commits e199524c..3694e99a, review clean)
- Mineurs différés à trier en T6 : review-groupe-a.md (12), review-groupe-b.md (M-2..M-9), review-t5.md (m-1..m-5).
- T6 : revue finale dispatchée (opus), package c8bcb325..3694e99a.
- Revue finale : 0 C, 2 I (I-1 disconnected compté actif → démo en réel ; I-2 pré-vol affiche n_codes_postaux), 27 mineurs triés (11 à corriger), 6 factorisations ; final-review.md. Vague de correctifs unique dispatchée, FIX_BASE 3694e99a.
- Vague finale : 8336f9bf (fix), b47976b5 (docs), 0073782d ; tsc 0, unit 2 911 verts, intégration seul échec connu, ng test 2 délais admin/radio (verts seuls), ng build OK. I-1 touche React aussi (disconnected ≠ actif). Re-review dispatchée.
- Re-review vague finale : tout ADDRESSED, 0 casse nouvelle ; prêt pour la preuve. Preuve navigateur T6 dispatchée (:3002/:4202 de la session).
- Preuve T6 : PASSE deux thèmes, 24 captures L7-T6-*, fichiers = base octet pour octet, aucun prevol hors espace ; nettoyage fait. Constats : statuts bruts affichés (pousse/en_cours/annule), message d'annulation persistant, annonceur DV360 non prérempli (A-8), texte d'annulation serveur technique, teal texte clair 1,77:1 (54 occurrences carte, hors lot → décision design).
- Ruling 5 : les 4 premiers constats sont corrigés dans une passe courte avant clôture (écran du lot, visibles par Vincent) ; le contraste teal clair est global → porté à l'Excel, pas corrigé ici — coût si faux : une passe de plus.
- Correctifs preuve : 86639ac9 (statuts.ts table unique, message effacé, texte d'annulation Angular ; annonceur : donnée absente en base, code correct). ng test 412/3 356, tsc 0. Re-review dispatchée.
- Correctifs preuve : re-review APPROUVÉE (4/4 addressed).
- Task 6: complete (commits 3694e99a..86639ac9, revue finale + vague unique + preuve deux thèmes + correctifs de preuve, review clean)
- LOT 7 (⑦ Activation) CLOS le 26/10. Non fait : `npm run build` (le dev server :3002 du worktree occupe .next) — à lancer avant toute fusion dans main. Ouverts hors lot : contraste teal texte clair (Excel 45), annonceur absent des campagnes sans liaison ⑥.
