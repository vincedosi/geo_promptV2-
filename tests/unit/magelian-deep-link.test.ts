import { describe, it, expect } from 'vitest';
import { parseMagelianParams } from '@/components/magelian/deep-link';

describe('parseMagelianParams', () => {
  it('retourne null sans param pertinent', () => {
    expect(parseMagelianParams(new URLSearchParams(''))).toBeNull();
    expect(parseMagelianParams(new URLSearchParams('foo=bar'))).toBeNull();
  });

  it('parse campaign seul', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=abc-123')))
      .toEqual({ campaignId: 'abc-123', tab: undefined });
  });

  it('parse tab valide', () => {
    expect(parseMagelianParams(new URLSearchParams('tab=apercu')))
      .toEqual({ campaignId: undefined, tab: 'apercu' });
  });

  it('ignore un tab invalide (mais garde campaign)', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=x&tab=zzz')))
      .toEqual({ campaignId: 'x', tab: undefined });
    expect(parseMagelianParams(new URLSearchParams('tab=zzz'))).toBeNull();
  });

  it('parse les deux', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=x&tab=suivi')))
      .toEqual({ campaignId: 'x', tab: 'suivi' });
  });

  it('parse le nouvel onglet strategie (ex-creation, Tâche 9)', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=x&tab=strategie')))
      .toEqual({ campaignId: 'x', tab: 'strategie' });
  });

  it('ancien lien tab=creation (alias hérité, round de correction 1) : ouvre toujours Stratégie', () => {
    // L'onglet "creation" a été renommé "strategie" (Tâche 9). Le traiter
    // comme une simple valeur invalide (repli sur undefined -> Suivi) perd
    // SILENCIEUSEMENT une campagne coquille/brouillon derrière un ancien
    // lien : n'étant pas consultable sur l'onglet Suivi, MagelianOverlay ne
    // l'assigne ni à `selectedId` ni à `creationCampaignId`. `creation` doit
    // donc résoudre EXACTEMENT comme `strategie`, jamais comme un tab inconnu.
    expect(parseMagelianParams(new URLSearchParams('campaign=x&tab=creation')))
      .toEqual({ campaignId: 'x', tab: 'strategie' });
  });

  it("n'intercepte pas les URLs adressées à un autre overlay", () => {
    expect(parseMagelianParams(new URLSearchParams('overlay=pilotage&action=new&campaign=x'))).toBeNull();
    expect(parseMagelianParams(new URLSearchParams('overlay=pilotage&campaign=x&tab=suivi'))).toBeNull();
  });
});

/**
 * Tâche 20 (2026-09-13) — l'onglet Activation s'intercale entre Stratégie et
 * Suivi. Le plan exigeait que `MagelianTab` et ce test soient mis à jour DANS
 * LE MÊME COMMIT que l'onglet : un deep-link `tab=activation` qui retombe
 * silencieusement sur Suivi est exactement le défaut que le round de
 * correction de la Tâche 9 avait dû réparer pour `tab=creation`.
 */
describe('onglet activation (Tâche 20)', () => {
  it('parse tab=activation', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=x&tab=activation')))
      .toEqual({ campaignId: 'x', tab: 'activation' });
  });

  it('parse tab=activation sans campagne', () => {
    expect(parseMagelianParams(new URLSearchParams('tab=activation')))
      .toEqual({ campaignId: undefined, tab: 'activation' });
  });

  it('n a pas casse les trois onglets preexistants', () => {
    for (const onglet of ['strategie', 'suivi', 'apercu'] as const) {
      expect(parseMagelianParams(new URLSearchParams(`tab=${onglet}`)))
        .toEqual({ campaignId: undefined, tab: onglet });
    }
  });

  it('rejette toujours un onglet inconnu', () => {
    // Sans campagne NI onglet valide, le parseur rend `null` — il n'y a rien
    // a ouvrir. Avec une campagne, l'onglet inconnu retombe sur `undefined`
    // (l'overlay ouvre alors Suivi) mais la campagne, elle, est preservee.
    expect(parseMagelianParams(new URLSearchParams('tab=activations'))).toBeNull();
    expect(parseMagelianParams(new URLSearchParams('campaign=x&tab=activations')))
      .toEqual({ campaignId: 'x', tab: undefined });
  });
});
