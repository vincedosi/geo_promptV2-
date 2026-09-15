import { describe, it, expect } from 'vitest';
import {
  poserFiltre, retirerFiltre, bboxDuFiltre, BBOX_METRO, type FiltreActif,
} from '@/lib/carte/filtre';

const region: FiltreActif = { type: 'region', code: '93', label: 'Provence-Alpes-Côte d’Azur' };
const dept: FiltreActif  = { type: 'departement', code: '13', label: 'Bouches-du-Rhône' };

describe('filtre unique', () => {
  it('remplace toujours : un seul filtre actif a la fois', () => {
    expect(poserFiltre(region, dept)).toEqual(dept);
  });

  it('re-poser le meme filtre le retire (bascule)', () => {
    expect(poserFiltre(region, region)).toBeNull();
  });

  it('retirer rend null', () => {
    expect(retirerFiltre()).toBeNull();
  });

  it('sans filtre, la bbox est la metropole et jamais le monde', () => {
    expect(bboxDuFiltre(null)).toEqual(BBOX_METRO);
    expect(BBOX_METRO).toEqual([-5.5, 41.2, 9.8, 51.2]);
  });

  it('rend la bbox portee par le filtre quand elle existe', () => {
    const avecBbox: FiltreActif = { ...dept, bbox: [4.2, 43.1, 5.8, 43.9] };
    expect(bboxDuFiltre(avecBbox)).toEqual([4.2, 43.1, 5.8, 43.9]);
  });

  it('retombe sur la metropole si le filtre n a pas encore sa bbox', () => {
    expect(bboxDuFiltre(dept)).toEqual(BBOX_METRO);
  });

  it('ne bascule pas sur un meme code porte par un type different', () => {
    const zone: FiltreActif = { type: 'zone', code: '13', label: 'Zone 13' };
    expect(poserFiltre(dept, zone)).toEqual(zone);
  });

  // Filtre 'france' (spec-filtre-france.md, 2026-09-15) — touche minimale au
  // fichier protege : un membre d'union de plus, poserFiltre/retirerFiltre et
  // le repli de bboxDuFiltre restent INCHANGES (verifie ici).
  it('le filtre france se pose et se bascule comme n importe quel autre', () => {
    const france: FiltreActif = { type: 'france', code: 'france', label: 'France entière' };
    expect(poserFiltre(null, france)).toEqual(france);
    expect(poserFiltre(france, france)).toBeNull();
    expect(poserFiltre(dept, france)).toEqual(france);
  });

  it('bboxDuFiltre replie sur BBOX_METRO pour le filtre france aussi (repli inchange, non contourne) — c est bboxPourRequete qui porte la vraie correction, voir bbox-requete.test', () => {
    const france: FiltreActif = { type: 'france', code: 'france', label: 'France entière' };
    expect(bboxDuFiltre(france)).toEqual(BBOX_METRO);
  });
});
