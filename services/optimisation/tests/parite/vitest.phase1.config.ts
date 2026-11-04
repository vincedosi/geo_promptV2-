/**
 * Configuration du générateur de fixtures TS de la phase 1, lot 1 (`generer-fixtures-phase1.ts`). Hors des projets
 * `unit` et `integration` de `vitest.workspace.ts` : il ÉCRIT des fichiers, il ne doit pas tourner à chaque `npm test`.
 * Aucune lecture de base. Lancement, depuis la racine du dépôt :
 *
 *   npx vitest run --config services/optimisation/tests/parite/vitest.phase1.config.ts
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

const racine = path.resolve(__dirname, '../../../..');

export default defineConfig({
  root: racine,
  resolve: { alias: { '@': racine } },
  test: {
    name: 'parite-fixtures-phase1',
    environment: 'node',
    include: ['services/optimisation/tests/parite/generer-fixtures-phase1.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
  },
});
