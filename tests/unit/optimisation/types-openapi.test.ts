/**
 * Les types TS du service (`lib/optimisation/types-openapi.ts`) sont GÉNÉRÉS depuis `services/optimisation/openapi.json`,
 * lui-même exporté par pytest (`tests/api/test_openapi.py`, qui échoue si le fichier ne décrit plus les routes). Ce
 * test ferme la chaîne : l'empreinte écrite en tête des types est celle du schéma. Un schéma changé sans régénération
 * (`node scripts/optimisation/generer-types.mjs`) échoue ici.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = process.cwd();

describe('types générés depuis l’OpenAPI du service d’optimisation', () => {
  it('l’empreinte des types est celle de services/optimisation/openapi.json', () => {
    const schema = readFileSync(join(RACINE, 'services', 'optimisation', 'openapi.json'));
    const types = readFileSync(join(RACINE, 'lib', 'optimisation', 'types-openapi.ts'), 'utf-8');
    const ecrite = /openapi-sha256: ([0-9a-f]{64})/.exec(types)?.[1];
    expect(ecrite, 'types-openapi.ts sans empreinte : régénérer').toBeDefined();
    expect(ecrite, 'openapi.json a changé : node scripts/optimisation/generer-types.mjs')
      .toBe(createHash('sha256').update(schema).digest('hex'));
  });

  it('les trois routes de calcul sont décrites', () => {
    const schema = JSON.parse(readFileSync(join(RACINE, 'services', 'optimisation', 'openapi.json'), 'utf-8'));
    expect(Object.keys(schema.paths)).toEqual(
      expect.arrayContaining(['/v1/plans/zone', '/v1/plans/risque', '/v1/historique/recaler']));
  });
});
