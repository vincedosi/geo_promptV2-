import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as R from '@/lib/zones/recette';
import * as A from '../../../angular/src/app/features/carte/logique/zones/recette';

describe('recette de zone : Angular = serveur', () => {
  it('mêmes constantes', () => {
    for (const k of ['VERSION_RECETTE', 'TYPES_RECETTE', 'TYPES_RECALCULABLES', 'TYPES_BORNES_PAR_PERIMETRE', 'TYPES_PERIMETRE',
      'RAYON_POI_MIN_M', 'RAYON_POI_MAX_M', 'RAYON_POINT_MAX_M', 'SEUIL_CARREAUX_MAX', 'SEUIL_TERRITOIRE_MAX_ABS','CAPACITE_SYNCHRONE_POI_RAYON', 'CODES_FRANCE', 'CODES_PAYS', 'MAX_CARREAUX_SEUIL', 'MIN_MENAGES_CARREAUX_DEFAUT', 'MIN_MENAGES_CARREAUX_MAX', 'MAX_INDICATEURS_SCORE', 'MAX_TERRITOIRES_SEUIL', 'MAX_SOMMETS_FORME',
      'MAX_CODES_POSTAUX', 'SURFACE_MAX_PERIMETRE_KM2', 'SURFACE_MAX_PERIMETRE_CARREAUX_KM2', 'PERIMETRES_ADMIS',
      'INDICATEURS_SEUIL_CARREAUX', 'MESSAGES_REFUS', 'UNITE_COMMUNE_ENTIERE', 'MAX_ZONES_COMBINAISON'] as const) {
      expect((A as unknown as Record<string, unknown>)[k], k).toEqual((R as unknown as Record<string, unknown>)[k]);
    }
  });
  it('mêmes réponses', () => {
    const cas: R.Recette[] = [
      { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 20_000 },
      { v: 1, type: 'rayon_poi', categorie: 'cirfa', rayon_m: 10_000, perimetre: { type: 'france', code: 'FR' } },
      { v: 1, type: 'seuil_carreaux', indicateur: 'densite_ind', operateur: '>=', seuil: 2.5, perimetre: { type: 'region', code: '84' }, min_menages: 11 },
      { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '<=', seuil: 10, perimetre: null },
      { v: 1, type: 'codes_postaux', codes: ['13001', '13002'] },
      { v: 1, type: 'dessin' },
      { v: 1, type: 'import', format: 'kml', fichier: 'zones.kml' },
      { v: 1, type: 'isochrone', parametres: { mode: 'voiture', minutes: 15 } },
      { v: 1, type: 'combinaison', operation: 'union', zones: ['a', 'b'] },
      { v: 1, type: 'capture', source_type: 'isochrone_battle' },
      { v: 1, type: 'capture', source_type: 'score', parametres: { indicateurs: [{ code: 'taux_pauvrete', poids: 1, sens: 'croissant' }], maille: 'cp', seuil_score: 70 } },
      { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '33' }, min_menages: 11 },
      { v: 1, type: 'pays', code: 'METRO' },
      { v: 1, type: 'pays', code: 'FR' },
      // Décision du 02/11 : rayons sous le minimum d'activation (estimatifs, jamais activés).
      { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 100, perimetre: { type: 'departement', code: '13' } },
      { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 200 },
    ];
    // Tour 3 (N-2) : une combinaison dont une zone source est trop fine, sources connues par une liste.
    const sources = new Map([['a', { name: 'Fin', recette: cas[cas.length - 2] }], ['b', { name: 'Dessin', recette: cas[5] }]]);
    const combi: R.Recette = { v: 1, type: 'combinaison', operation: 'difference', zones: ['b', 'a'] };
    expect(A.refusActivation(combi, sources)).toBe(R.refusActivation(combi, sources));
    expect(A.mentionEstimatif(combi, sources)).toBe(R.mentionEstimatif(combi, sources));
    expect(R.refusActivation(combi, sources)).not.toBeNull();
    // La liste d'un écran en zones connues : même forme des deux côtés (le serveur lit, lui, les sources en base).
    const liste = [{ id: 'a', name: 'Fin', recette: cas[cas.length - 2] }, { id: 'b', name: 'Sans recette' }];
    expect(A.zonesParId(liste)).toEqual(R.zonesParId(liste));
    expect(R.refusActivation(combi, R.zonesParId(liste))).toBe(R.refusActivation(combi, sources));
    for (const r of cas) {
      expect(A.refusActivation(r)).toBe(R.refusActivation(r));
      expect(A.mentionEstimatif(r)).toBe(R.mentionEstimatif(r));
      expect(A.estRecalculable(r)).toBe(R.estRecalculable(r));
      expect(A.exigePerimetre(r)).toBe(R.exigePerimetre(r));
      expect(A.refusPerimetreLocal(r)).toBe(R.refusPerimetreLocal(r));
      expect(A.libelleRecette(r)).toBe(R.libelleRecette(r));
    }
  });
  it('les deux fichiers sont identiques hors de leur en-tête', () => {
    // Seuls l'en-tête et le chemin d'import de `formaterNombre` diffèrent (`@/lib/format/nombre` contre
    // `core/format/nombre`, copie elle-même verrouillée par format-paritaire.test.ts).
    const corps = (chemin: string) => readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n')
      .replace(/^\/\*\*[\s\S]*?\*\/\n/, '')
      .replace(/^import \{ formaterNombre \} from '[^']+';\n/, '');
    expect(corps('angular/src/app/features/carte/logique/zones/recette.ts')).toBe(corps('lib/zones/recette.ts'));
  });
});
