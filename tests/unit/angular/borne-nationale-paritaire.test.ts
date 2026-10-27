import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as S from '@/lib/isochrones/borne-nationale';
import * as A from '../../../angular/src/app/features/carte/logique/bataille/borne-nationale';

/**
 * @file tests/unit/angular/borne-nationale-paritaire.test.ts — la capacité synchrone d'une bataille : Angular = serveur
 * (retours du 26/10, T4). L'écran refuse avant l'appel ce que la route V2 refuserait après lecture : même constantes,
 * même texte.
 */
describe('borne nationale de la bataille : Angular = serveur', () => {
  it('mêmes constantes', () => {
    expect(A.CAPACITE_SYNCHRONE_ANNEAUX).toBe(S.CAPACITE_SYNCHRONE_ANNEAUX);
    expect(A.PLAFOND_LECTURE_POI).toBe(S.PLAFOND_LECTURE_POI);
  });

  it('mêmes réponses', () => {
    const cas: [number, number, number?][] = [
      [95, 7], [100, 7], [101, 7], [175, 4], [176, 4], [499, 1], [500, 1], [500, 7], [150, 7], [120, 6], [95, 8, 285], [0, 0],
    ];
    for (const [p, n, a] of cas) {
      expect(A.refusBorneNationale(p, n, a), `${p}×${n}`).toBe(S.refusBorneNationale(p, n, a));
      expect(A.refusCapaciteAnneaux(p, n, a), `${p}×${n}`).toBe(S.refusCapaciteAnneaux(p, n, a));
    }
    for (const t of [{}, { filtre_ville: 'Brest' }, { filtre_regions: ['53'] }, { filtre_depts: ['29'] }, { filtre_ville: '  ' }]) {
      expect(A.sansTerritoire(t)).toBe(S.sansTerritoire(t));
    }
  });

  it('les deux fichiers sont identiques hors de leur en-tête et du chemin de formaterNombre', () => {
    const corps = (chemin: string) => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
      .replace(/^\/\*\*[\s\S]*?\*\/\n/, '')
      .replace(/^import \{ formaterNombre \} from '[^']+';\n/m, '');
    expect(corps('angular/src/app/features/carte/logique/bataille/borne-nationale.ts')).toBe(corps('lib/isochrones/borne-nationale.ts'));
  });
});
