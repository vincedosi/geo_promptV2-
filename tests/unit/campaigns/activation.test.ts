/**
 * La logique pure du pré-vol de ⑦ Activation (lot 7, T1) : source des CP poussés, mode de la poussée, motifs.
 */
import { describe, expect, it } from 'vitest';
import { modePoussee, motifsPrevol, sourceDuPlan, type EntreeMotifs } from '@/lib/campaigns/activation';

const EXTRACTION = '2fc8fd52-cacf-44c4-9071-fae8c782f09e';
const ZONE = '11111111-2222-4333-8444-555555555555';

describe('sourceDuPlan', () => {
  it('une stratégie à zone : la zone (chemin d’avant le lot 7), même si une extraction est nommée', () => {
    expect(sourceDuPlan({ zone_id: ZONE, in_zone_weights: { extraction_id: EXTRACTION } }))
      .toEqual({ type: 'zone', zoneId: ZONE });
  });
  it('sans zone, l’extraction de `in_zone_weights.extraction_id` (écrite par rattacher en ⑥)', () => {
    expect(sourceDuPlan({ zone_id: null, in_zone_weights: { mode: 'zone_set', extraction_id: EXTRACTION } }))
      .toEqual({ type: 'extraction', extractionId: EXTRACTION });
  });
  it('ni zone ni extraction : null', () => {
    expect(sourceDuPlan({ zone_id: null, in_zone_weights: { mode: 'zone_set', zone_set_id: ZONE } })).toBeNull();
    expect(sourceDuPlan({ zone_id: null, in_zone_weights: {} })).toBeNull();
  });
  it('`in_zone_weights` illisible : null, jamais d’exception', () => {
    for (const w of [null, undefined, 'texte', 42, [EXTRACTION], { extraction_id: 12 }, { extraction_id: 'pas-un-uuid' }]) {
      expect(sourceDuPlan({ zone_id: null, in_zone_weights: w })).toBeNull();
    }
  });
});

describe('modePoussee', () => {
  it('une connexion DV360 `connected` : réel, même sur une campagne de démo', () => {
    expect(modePoussee([{ provider: 'dv360', status: 'connected' }], true)).toBe('reel');
    expect(modePoussee([{ provider: 'dv360', status: 'connected' }], false)).toBe('reel');
  });
  it('connexion en erreur, révoquée ou absente + démo : simulé', () => {
    expect(modePoussee([{ provider: 'dv360', status: 'error' }], true)).toBe('simule');
    expect(modePoussee([{ provider: 'dv360', status: 'revoked' }], true)).toBe('simule');
    expect(modePoussee([], true)).toBe('simule');
  });
  it('les mêmes sans démo : indisponible', () => {
    expect(modePoussee([{ provider: 'dv360', status: 'error' }], false)).toBe('indisponible');
    expect(modePoussee([{ provider: 'dv360', status: 'revoked' }], false)).toBe('indisponible');
    expect(modePoussee([], false)).toBe('indisponible');
  });
  it('une connexion active d’une AUTRE plateforme ne rend pas DV360 disponible', () => {
    expect(modePoussee([{ provider: 'tiktok', status: 'connected' }], false)).toBe('indisponible');
  });
});

describe('motifsPrevol', () => {
  const pret: EntreeMotifs = {
    aStrategie: true, superAdmin: true, versionPubliee: 1, nZonesModifiees: 0, mode: 'simule',
    connexionDv360: false, source: { type: 'extraction', extractionId: EXTRACTION }, nCpDv360: 79,
  };
  const codes = (e: Partial<EntreeMotifs>) => motifsPrevol({ ...pret, ...e }).map((m) => m.code);

  it('démo sans connexion : aucun motif de connexion, activable (liste vide)', () => {
    expect(motifsPrevol(pret)).toEqual([]);
  });
  it('jamais publiée, puis dérive (avec sa version)', () => {
    expect(codes({ versionPubliee: null })).toEqual(['jamais_publiee']);
    const [derive] = motifsPrevol({ ...pret, versionPubliee: 2, nZonesModifiees: 1 });
    expect(derive).toEqual({
      code: 'derive', version: 2,
      message: '1 zone a changé depuis la publication de la v2 — republiez avant d’activer.',
    });
  });
  it('indisponible : aucune connexion, ou connexion en erreur', () => {
    expect(codes({ mode: 'indisponible' })).toEqual(['aucune_connexion']);
    expect(codes({ mode: 'indisponible', connexionDv360: true })).toEqual(['connexion_en_erreur']);
  });
  it('0 CP DV360 : `aucun_cp_dv360`, message d’extraction ou de plan', () => {
    const [m] = motifsPrevol({ ...pret, nCpDv360: 0 });
    expect(m).toEqual({ code: 'aucun_cp_dv360', message: 'Cette extraction n’achète pas DV360 au code postal : rien à pousser.' });
    expect(motifsPrevol({ ...pret, nCpDv360: 0, source: null })[0].message)
      .toBe('Ce plan ne porte aucun code postal à pousser chez DV360.');
  });
  it('sans stratégie et sans droit : les deux premiers blocages d’avant le lot 7, dans l’ordre', () => {
    expect(motifsPrevol({ ...pret, aStrategie: false, superAdmin: false, versionPubliee: null, nCpDv360: 0 }))
      .toEqual([
        { code: 'aucune_strategie', message: 'Aucune stratégie n’est définie pour cette campagne.' },
        { code: 'droit', message: 'La poussée de ciblage vers un DSP est réservée aux super-administrateurs.' },
      ]);
  });
});
