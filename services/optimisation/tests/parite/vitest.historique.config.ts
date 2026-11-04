/**
 * Configuration du générateur des fixtures HISTORIQUES (phase 1.4-1.5 : rebid, recalage, simulateur). Hors des projets `unit` et `integration` de
 * `vitest.workspace.ts` à dessein : il ÉCRIT des fichiers (sans lire la base), il ne doit pas tourner à chaque
 * `npm test`. Lancement, depuis la racine du dépôt :
 *
 *   npx vitest run --config services/optimisation/tests/parite/vitest.historique.config.ts
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

const racine = path.resolve(__dirname, '../../../..');

export default defineConfig({
  root: racine,
  resolve: { alias: { '@': racine } },
  test: {
    name: 'parite-fixtures-historique',
    environment: 'node',
    include: ['services/optimisation/tests/parite/generer-fixtures-historique.ts'],
    // Séquentiel : l'ordre des appels enregistrés fait partie de la fixture.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
