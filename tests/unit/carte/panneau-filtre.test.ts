import { describe, it, expect } from 'vitest';
import {
  seedDepuisFiltre, composerFiltreVille, composerFiltreCodePostal, filtreApresChangementScope,
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

  it('un filtre france ne remplit aucun champ du widget administratif non plus', () => {
    const france: FiltreActif = { type: 'france', code: 'france', label: 'France entière' };
    expect(seedDepuisFiltre(france)).toEqual({ ville: '', codePostal: '', selectedRegions: [], selectedDepts: [] });
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

describe('panneau-filtre-logique — filtreApresChangementScope (round 2)', () => {
  it('un filtre departement actif est retire par un changement de perimetre global', () => {
    // Le panneau videait deja ses selecteurs (use-territory-selection.ts) sans
    // le dire au FiltreActif : le chip continuait de borner requetes ET
    // bataille isochrone sur un territoire que le panneau affichait vide.
    expect(filtreApresChangementScope(departement)).toBeNull();
  });

  it('un filtre region/commune/cp actif est retire de meme', () => {
    expect(filtreApresChangementScope(region)).toBeNull();
    expect(filtreApresChangementScope(commune)).toBeNull();
    expect(filtreApresChangementScope(cp)).toBeNull();
  });

  it('un filtre zone (zone enregistree) survit au changement de perimetre — pas administratif', () => {
    expect(filtreApresChangementScope(zone)).toBe(zone);
  });

  it('un filtre france survit de meme — pas administratif, independant du pill Metro/+DROM', () => {
    const france: FiltreActif = { type: 'france', code: 'france', label: 'France entière' };
    expect(filtreApresChangementScope(france)).toBe(france);
  });

  it('sans filtre actif, rend null sans effet', () => {
    expect(filtreApresChangementScope(null)).toBeNull();
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

  // Verification #1 de la spec (spec-filtre-france.md, LE PIEGE) : un filtre
  // 'france' est un filtre ACTIF (filtre !== null) mais doit rendre undefined,
  // exactement comme l'absence de filtre — jamais BBOX_METRO. bboxDuFiltre
  // (fichier protege, inchange) REPLIE pourtant sur BBOX_METRO pour ce type
  // (voir tests/unit/carte/filtre.test.ts) : c'est bboxPourRequete qui doit
  // l'intercepter AVANT d'appeler bboxDuFiltre, pas l'inverse.
  it("rend undefined pour le filtre 'france' — jamais BBOX_METRO (339 POI d'outre-mer sinon)", () => {
    const france: FiltreActif = { type: 'france', code: 'france', label: 'France entière' };
    expect(bboxPourRequete(france)).toBeUndefined();
  });
});
