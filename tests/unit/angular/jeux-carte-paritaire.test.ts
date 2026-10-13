import { describe, it, expect } from 'vitest';
import * as R from '@/lib/carte/jeux-carte';
import * as A from '../../../angular/src/app/features/carte/logique/jeux-carte';

describe('registre des jeux de la carte : Angular = serveur', () => {
  it('mêmes référentiels, natures, catégories hors POI, borne et expression', () => {
    expect(A.JEUX_REFERENTIELS).toEqual(R.JEUX_REFERENTIELS);
    expect(A.LIBELLE_NATURE).toEqual(R.LIBELLE_NATURE);
    expect(A.CATEGORIES_HORS_POI).toEqual(R.CATEGORIES_HORS_POI);
    expect(A.MAX_JEUX_RECOMMANDES).toBe(R.MAX_JEUX_RECOMMANDES);
    expect(A.RE_CLE_JEU.source).toBe(R.RE_CLE_JEU.source);
    expect(A.PREFIXE_POI).toBe(R.PREFIXE_POI);
  });
  it('mêmes réponses des fonctions', () => {
    for (const c of ['lycee', 'Lycée', '', 'risque_industriel', 'bmw']) expect(A.cleJeuPoi(c)).toBe(R.cleJeuPoi(c));
    for (const k of ['iris:socio-demo', 'poi:bmw', 'poi:risque_industriel', 'x', 'meteo:zones']) expect(A.estCleJeuConnue(k)).toBe(R.estCleJeuConnue(k));
  });
});
