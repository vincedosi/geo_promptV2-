import { describe, it, expect } from 'vitest';
import {
  seedDepuisFiltre, composerFiltreVille, composerFiltreCodePostal,
} from '@/app/map/_components/panneaux/panneau-filtre-logique';
import { bboxPourRequete } from '@/lib/carte/bbox-requete';
import { BBOX_METRO, type FiltreActif } from '@/lib/carte/filtre';

const commune: FiltreActif     = { type: 'commune', code: 'brest', label: 'Brest' };
const cp: FiltreActif          = { type: 'cp', code: '29200', label: 'CP 29200' };
const region: FiltreActif      = { type: 'region', code: '53', label: 'Bretagne' };
const departement: FiltreActif = { type: 'departement', code: '29', label: '29 — Finistère' };
const zone: FiltreActif        = { type: 'zone', code: 'zone-1', label: 'Zone CIRFA' };

describe('panneau-filtre-logique — seedDepuisFiltre', () => {
  it('un filtre commune actif survit a une remontee du panneau', () => {
    // Round 1 : rouvrir le panneau (remontage React) appelait le meme
    // composeur que la frappe utilisateur avec un etat local vide, ce qui
    // retirait le filtre commune/CP aussitot. seedDepuisFiltre est un simple
    // AFFICHAGE : il ne doit jamais produire un signal de retrait.
    const seed = seedDepuisFiltre(commune);
    expect(seed.ville).toBe('Brest');
    expect(seed.codePostal).toBe('');
    expect(seed.selectedRegions).toEqual([]);
    expect(seed.selectedDepts).toEqual([]);
  });

  it('un filtre cp actif se reaffiche dans le champ code postal', () => {
    const seed = seedDepuisFiltre(cp);
    expect(seed.codePostal).toBe('29200');
    expect(seed.ville).toBe('');
  });

  it('un filtre region actif se reaffiche dans les regions selectionnees', () => {
    const seed = seedDepuisFiltre(region);
    expect(seed.selectedRegions).toEqual(['53']);
  });

  it('un filtre departement actif se reaffiche dans les departements selectionnes', () => {
    const seed = seedDepuisFiltre(departement);
    expect(seed.selectedDepts).toEqual(['29']);
  });

  it('un filtre zone ou aucun filtre ne remplit aucun champ du widget', () => {
    expect(seedDepuisFiltre(zone)).toEqual({ ville: '', codePostal: '', selectedRegions: [], selectedDepts: [] });
    expect(seedDepuisFiltre(null)).toEqual({ ville: '', codePostal: '', selectedRegions: [], selectedDepts: [] });
  });
});

describe('panneau-filtre-logique — composerFiltreVille / composerFiltreCodePostal', () => {
  it('une frappe reelle compose un nouveau filtre commune', () => {
    expect(composerFiltreVille(null, 'Rennes')).toEqual({ type: 'commune', code: 'rennes', label: 'Rennes' });
  });

  it('vider le champ ville retire le filtre s il portait sur une commune', () => {
    expect(composerFiltreVille(commune, '')).toBeNull();
  });

  it('vider le champ ville ne touche pas un filtre d un autre type', () => {
    expect(composerFiltreVille(region, '')).toBe(region);
  });

  it('un code postal invalide ne compose rien et ne retire pas un autre filtre', () => {
    expect(composerFiltreCodePostal(region, '123')).toBe(region);
  });

  it('un code postal complet (5 chiffres) compose un filtre cp', () => {
    expect(composerFiltreCodePostal(null, '29200')).toEqual({ type: 'cp', code: '29200', label: 'CP 29200' });
  });

  it('vider le champ code postal retire le filtre s il portait sur un cp', () => {
    expect(composerFiltreCodePostal(cp, '')).toBeNull();
  });
});

describe('bboxPourRequete — la bbox ne part que si un filtre est actif', () => {
  it('rend undefined sans filtre — jamais un repli implicite sur BBOX_METRO', () => {
    expect(bboxPourRequete(null)).toBeUndefined();
  });

  it('rend la bbox du filtre (ou son repli BBOX_METRO) quand un filtre est actif', () => {
    expect(bboxPourRequete(departement)).toEqual(BBOX_METRO);
    const avecBbox: FiltreActif = { ...zone, bbox: [4.2, 43.1, 5.8, 43.9] };
    expect(bboxPourRequete(avecBbox)).toEqual([4.2, 43.1, 5.8, 43.9]);
  });
});
