import { describe, expect, it } from 'vitest';
import { ALIAS_GARES, indexerGares, lireReferentielGares, normaliserNomGare, trouverGare } from '@/lib/ooh/plan/gares-sncf';
import { normaliser } from '@/lib/ooh/plan/texte';

/** Un extrait SYNTHÉTIQUE du CSV « gares-de-voyageurs » (même en-tête, BOM compris), plus une vraie gare publique pour l'alias. */
const CSV = [
  '\uFEFFnom;libellecourt;segment_drg;position_geographique;codeinsee;codes_uic;id',
  'Villetest;VTT;C;48.80, 2.30;92001;87000001;a',
  'Ville Essai Centre;VEC;C;45.10, 5.20;38001;87000002;b',
  'Les Essais;LES;C;48.90, 2.25;92002;87000003;c',
  'Bourg Essai;BES;C;48.95, 2.20;92003;87000004;d',
  'Aix-les-Bains le Revard;ALB;B;45.688161, 5.909371;73008;87741132;e',
  'Sans position;SPS;C;;92004;87000005;f',
].join('\n');

describe('référentiel des gares SNCF', () => {
  it('lit le CSV (BOM, « lat, lon », premier code UIC) et écarte une gare sans position', () => {
    const gares = lireReferentielGares(CSV);
    expect(gares).toHaveLength(5);
    expect(gares[0]).toEqual({ nom: 'Villetest', code_insee: '92001', uic: '87000001', lat: 48.8, lng: 2.3 });
  });

  it('normaliserNomGare retire les mots vides', () => {
    expect(normaliserNomGare("Gare d'Évry - Les Essais")).toBe('EVRY ESSAIS');
  });

  const index = indexerGares(lireReferentielGares(CSV));

  it('nom plein exact : sûr si la gare est dans le bloc (IDF)', () => {
    expect(trouverGare('VILLETEST', 'idf', index)).toMatchObject({ trouvee: true, methode: 'referentiel_gares', qualite: 'sure', gare: { uic: '87000001' } });
  });

  it('une gare hors du bloc annoncé (Isère dans la liste IDF) est à vérifier', () => {
    expect(trouverGare('VILLE ESSAI CENTRE', 'idf', index)).toMatchObject({ trouvee: true, qualite: 'a_verifier' });
  });

  it('la dernière partie passe avant la première (« BOURG ESSAI - LES ESSAIS » est « Les Essais »)', () => {
    expect(trouverGare('BOURG ESSAI - LES ESSAIS', 'idf', index)).toMatchObject({ trouvee: true, qualite: 'sure', gare: { nom: 'Les Essais' } });
  });

  it('« VILLETEST - GARE DE VILLETEST » : la dernière partie, sans mots vides, est la gare', () => {
    expect(trouverGare('VILLETEST - GARE DE VILLETEST', 'idf', index)).toMatchObject({ trouvee: true, qualite: 'sure', gare: { uic: '87000001' } });
  });

  it('trouvée par la SEULE première partie : à vérifier', () => {
    expect(trouverGare('BOURG ESSAI - QUARTIER INCONNU', 'idf', index)).toMatchObject({ trouvee: true, qualite: 'a_verifier', gare: { nom: 'Bourg Essai' } });
  });

  it('alias : la gare nommée, vérifiée par son code INSEE', () => {
    expect(trouverGare('AIX LES BAINS', 'province', index)).toMatchObject({ trouvee: true, methode: 'alias_manuel', qualite: 'sure', gare: { uic: '87741132' } });
  });

  it('alias périmé (la gare a changé de commune) : non placé, et la raison le dit', () => {
    const perime = indexerGares(lireReferentielGares(CSV.replace(';73008;', ';73999;')));
    const r = trouverGare('AIX LES BAINS', 'province', perime);
    expect(r.trouvee).toBe(false);
    if (!r.trouvee) expect(r.raison).toContain('alias périmé');
  });

  it('introuvable : non placé, jamais approché', () => {
    expect(trouverGare('GARE INCONNUE', 'province', index)).toEqual({ trouvee: false, raison: 'gare introuvable dans le référentiel SNCF' });
  });

  it('la table d alias : 32 entrées, clés normalisées, chacune avec un code INSEE à cinq caractères', () => {
    const cles = Object.keys(ALIAS_GARES);
    expect(cles).toHaveLength(32);
    for (const cle of cles) {
      expect(normaliser(cle), cle).toBe(cle);
      expect(ALIAS_GARES[cle].insee, cle).toMatch(/^[0-9][0-9AB][0-9]{3}$/);
    }
  });
});
