import { defineWorkspace } from 'vitest/config';
import path from 'path';

/**
 * Deux familles de tests, deux régimes d'exécution.
 *
 * ── POURQUOI CE FICHIER EXISTE ─────────────────────────────────────────────
 *
 * Les tests unitaires ne touchent aucune ressource partagée : ils lisent des
 * fichiers et appellent des fonctions pures. Les faire tourner en parallèle est
 * gratuit, et c'est ce qui garde `npm test` sous la minute et demie.
 *
 * Les tests d'INTÉGRATION, eux, tapent tous la MÊME base locale, et plusieurs
 * d'entre eux déclenchent des calculs lourds — `population_exposee_agregee`
 * prend 4,5 s au premier appel, `lire_couverture_rayon` lit 115 962 lignes.
 * Vitest exécutant les FICHIERS en parallèle, quatre fichiers lançaient
 * simultanément autant de requêtes coûteuses sur un seul PostgREST.
 *
 * Le symptôme, observé le 2026-09-19, était trompeur : un test DIFFÉRENT
 * échouait à chaque exécution, tantôt sur « Test timed out in 5000ms », tantôt
 * sur « An invalid response was received from the upstream server » — ce
 * dernier venant de Kong, pas de Postgres. Rien dans le message ne désignait la
 * concurrence, et chaque échec ressemblait à une régression du test concerné.
 *
 * LE correctif : `npm test` lance les deux projets en DEUX PASSES
 * SUCCESSIVES (`package.json`), et non en parallèle. Sérialiser les seuls
 * fichiers d'intégration ne servait à rien tant que 150 fichiers unitaires
 * tournaient en même temps sur les 4 vCPU de la VM : PostgREST, privé de CPU,
 * ne répondait plus et Kong rendait « An invalid response was received from
 * the upstream server ». Mesuré : le fichier d'invariants passe 3/3 lancé
 * seul, et échouait 2 fois sur 3 dans la suite complète.
 *
 * Le coût est nul — l'intégration prend 10 s — et le gain est une suite qui dit
 * la vérité.
 *
 * ⚠ Ce n'est PAS un contournement de lenteur. Un test d'intégration qui échoue
 * parce qu'un autre test tourne en même temps ne teste plus rien : il rapporte
 * l'état de la machine, pas celui du code.
 */
const alias = { '@': path.resolve(__dirname, '.') };

export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: 'unit',
      environment: 'node',
      globals: true,
      include: ['tests/unit/**/*.test.ts'],
    },
  },
  {
    resolve: { alias },
    test: {
      name: 'integration',
      environment: 'node',
      globals: true,
      include: ['tests/integration/**/*.test.ts'],
      // Un seul test à la fois dans un fichier : ils partagent la base.
      //
      // ⚠ `fileParallelism: false` a été essayé ici et RETIRÉ : l'option
      // n'existe pas dans une configuration de PROJET, seulement à la racine.
      // Elle était donc silencieusement ignorée — `tsc` l'a signalée, pas
      // Vitest. Un réglage qui ne s'applique pas est pire que son absence : il
      // fait croire à une protection. La sérialisation réelle vient des deux
      // passes de `npm test`.
      sequence: { concurrent: false },
      // Les calculs d'exposition dépassent le défaut de 5 s par construction :
      // prouver qu'une colonne est vide sur 2,3 M lignes demande de les lire
      // toutes, et aucun index ne peut raccourcir cette preuve.
      testTimeout: 60_000,
    },
  },
]);
