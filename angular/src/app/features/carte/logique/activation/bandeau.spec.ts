import type { LotActivation } from '../../data/activation.api';
import { bandeauActivation, dateLot, estPrete, lotAbouti } from './bandeau';
import type { CarteActivation } from './cartes';

const carte = (canal: string, motifs: string[] = []): CarteActivation => ({
  canal, plateforme: null, libelle: canal, maille: 'cp', nature: '', mode: 'fichier', unites: 1, formats: ['cp'], motifs, avertissements: [],
  aVerifier: false,
});
const lot = (canal: string, statut: string, lance_le: string): LotActivation => ({
  id: `${canal}-${lance_le}`, canal, version_strategie: 1, statut, mode: 'reel', lance_le, termine_le: null, lance_par: null, cibles: {}, n_cibles: 1,
});

describe('bandeauActivation (A-12)', () => {
  it('sans lot : plateformes et prêtes seulement, dernière poussée absente', () => {
    expect(bandeauActivation([carte('dv360'), carte('meta', ['x'])], [])).toEqual({
      plateformes: 2, pretes: 1, poussees: 0, enErreur: 0, derniere: null,
    });
  });

  it('M-1 : une carte muette (lecture en cours : ni maille ni motif) n’est pas prête', () => {
    const muette = { ...carte('ttd'), maille: null, formats: [] };
    expect(estPrete(muette)).toBe(false);
    expect(bandeauActivation([carte('dv360'), muette], [])).toMatchObject({ plateformes: 2, pretes: 1 });
  });

  it('poussées : canaux avec un lot terminé ou partiel ; en erreur : canaux dont le DERNIER lot est échec ou partiel', () => {
    const lots = [
      lot('dv360', 'echec', '2026-10-26T09:00:00Z'),
      lot('dv360', 'termine', '2026-10-25T09:00:00Z'),
      lot('ttd', 'annule', '2026-10-24T09:00:00Z'),
      lot('meta', 'partiel', '2026-10-23T09:00:00Z'),
    ];
    const b = bandeauActivation([carte('dv360'), carte('ttd'), carte('meta')], lots);
    expect(b).toMatchObject({ poussees: 2, enErreur: 2 });
    expect(b.derniere).toBe(dateLot('2026-10-26T09:00:00Z'));
  });

  it('l’ordre servi n’importe pas : le plus récent est retrouvé', () => {
    const b = bandeauActivation([], [lot('dv360', 'termine', '2026-10-01T09:00:00Z'), lot('dv360', 'echec', '2026-10-02T09:00:00Z')]);
    expect(b).toMatchObject({ enErreur: 1, derniere: dateLot('2026-10-02T09:00:00Z') });
  });

  it('lotAbouti : terminé et partiel ; jamais annulé, échec ou en cours (A-11)', () => {
    expect(['termine', 'partiel', 'annule', 'echec', 'en_cours'].map((statut) => lotAbouti({ statut }))).toEqual([true, true, false, false, false]);
  });

  it('dateLot : la forme courte fr-FR de React', () => {
    expect(dateLot('2026-10-26T09:00:00Z')).toBe(new Date('2026-10-26T09:00:00Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }));
  });
});
