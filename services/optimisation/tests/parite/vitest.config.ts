/**
 * Configuration du SEUL générateur de fixtures de parité (T2). Hors des projets `unit` et `integration` de
 * `vitest.workspace.ts` à dessein : il lit la base locale et ÉCRIT des fichiers, il ne doit pas tourner à chaque
 * `npm test`. Lancement, depuis la racine du dépôt :
 *
 *   npx vitest run --config services/optimisation/tests/parite/vitest.config.ts
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

const racine = path.resolve(__dirname, '../../../..');

export default defineConfig({
  root: racine,
  resolve: { alias: { '@': racine } },
  test: {
    name: 'parite-fixtures',
    environment: 'node',
    include: ['services/optimisation/tests/parite/generer-fixtures.ts'],
    // Une lecture à la fois sur la base partagée (CLAUDE.md : jamais plus de 3 appels simultanés).
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
