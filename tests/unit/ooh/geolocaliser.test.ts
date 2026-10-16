import { describe, expect, it, vi } from 'vitest';
import type { GeocodeDetailedResult } from '@/lib/import/types';
import { geolocaliser, villeCorrespond, type LigneAdresse } from '@/lib/ooh/plan/geolocaliser';
import type { GareSncf } from '@/lib/ooh/plan/gares-sncf';
import type { EmplacementBrut } from '@/types/campagnes-media';

const GARES: GareSncf[] = [
  { nom: 'Villetest', code_insee: '92001', uic: '87000001', lat: 48.8, lng: 2.3 },
];

function emplacement(partiel: Partial<EmplacementBrut> & Pick<EmplacementBrut, 'cle' | 'recherche' | 'adaptateur'>): EmplacementBrut {
  return {
    nom_lieu: partiel.cle, type_lieu: 'lieu', reseau: 'DOOH essai', numerique: true, nb_ecrans: 1, formats: [],
    adresse: null, code_postal: null, ville: null, reference_panneau: null, contacts_semaine: null, contacts_18_25_semaine: null,
    metadata: { onglet: 'ESSAI', lignes: [{ numero: 1, cellules: {} }] },
    ...partiel,
  };
}

function ban(partiel: Partial<GeocodeDetailedResult>): GeocodeDetailedResult {
  return {
    rowIndex: 0, inputAddress: '', lat: 43.3, lng: 5.4, score: 0.9, resultLabel: '1 Rue Essai 13008 Villetest',
    resultType: 'housenumber', resultCity: 'Villetest', resultPostcode: '13008', resultCitycode: '13208', status: 'green', manualOverride: false,
    ...partiel,
  };
}

const campus = (cle: string, cp = '13008', ville = 'Villetest') => emplacement({
  adaptateur: 'stride-campus', cle, adresse: '1 Rue Essai', code_postal: cp, ville,
  recherche: { type: 'adresse', adresse: '1 Rue Essai', code_postal: cp, ville, commune_seule: false },
});

describe('villeCorrespond', () => {
  it('égalité normalisée, ou l une prolonge l autre d un mot', () => {
    expect(villeCorrespond('Besancon', 'Besançon')).toBe(true);
    expect(villeCorrespond('Aix en Provence La Pioline', 'Aix-en-Provence')).toBe(true);
    expect(villeCorrespond('St Essai', 'Saint-Essai')).toBe(true);
    expect(villeCorrespond('Villetest', 'Autreville')).toBe(false);
  });
});

describe('geolocaliser', () => {
  describe('règle outre-mer (décision du 16/10)', () => {
    const club = () => campus('OM|1');
    const raison = 'résultat BAN hors du territoire de la ligne (outre-mer)';

    it('ligne métropolitaine, résultat BAN en 97 : non placé avec sa raison', async () => {
      const { places, non_places } = await geolocaliser([club()], { gares: [], geocoder: async () => [ban({ resultCitycode: '97411' })] });
      expect(places).toEqual([]);
      expect(non_places.map((n) => [n.cle, n.raison])).toEqual([['OM|1', raison]]);
    });

    it('ligne métropolitaine, résultat BAN en 98 : non placé', async () => {
      const { non_places } = await geolocaliser([club()], { gares: [], geocoder: async () => [ban({ resultCitycode: '98800' })] });
      expect(non_places.map((n) => n.raison)).toEqual([raison]);
    });

    it('ligne métropolitaine, résultat BAN en 75056 : inchangé', async () => {
      const { places, non_places } = await geolocaliser([club()], { gares: [], geocoder: async () => [ban({ resultCitycode: '75056' })] });
      expect(non_places).toEqual([]);
      expect(places[0].code_insee).toBe('75056');
    });

    it('ligne d outre-mer, résultat BAN en 97411 : inchangé', async () => {
      const { places, non_places } = await geolocaliser([club()], {
        gares: [], geocoder: async () => [ban({ resultCitycode: '97411' })], adaptateursOutreMer: new Set(['stride-campus']),
      });
      expect(non_places).toEqual([]);
      expect(places[0].code_insee).toBe('97411');
    });
  });

  it('adresse : un seul lot pour la BAN, score ≥ 0,6 sûr, code INSEE et département repris', async () => {
    const geocoder = vi.fn(async (rows: LigneAdresse[]) => rows.map(() => ban({})));
    const { places, non_places } = await geolocaliser([campus('A|13008')], { gares: [], geocoder });
    expect(geocoder).toHaveBeenCalledTimes(1);
    expect(geocoder.mock.calls[0][0]).toEqual([{ adresse: '1 Rue Essai', code_postal: '13008', ville: 'Villetest' }]);
    expect(non_places).toEqual([]);
    expect(places[0]).toMatchObject({
      source_ref: 'A|13008', lat: 43.3, lng: 5.4, code_insee: '13208', code_departement: '13',
      geoloc_methode: 'adresse_ban', geoloc_qualite: 'sure', geoloc_score: 0.9, geoloc_libelle: '1 Rue Essai 13008 Villetest',
    });
  });

  it('score entre 0,3 et 0,6 : à vérifier ; sous 0,3 ou introuvable : non placé, raison dite', async () => {
    const reponses = [ban({ score: 0.45 }), ban({ score: 0.2 }), ban({ lat: null, lng: null, score: 0 })];
    const { places, non_places } = await geolocaliser([campus('A|1'), campus('B|1'), campus('C|1')], {
      gares: [], geocoder: async () => reponses,
    });
    expect(places.map((p) => [p.cle, p.geoloc_qualite])).toEqual([['A|1', 'a_verifier']]);
    expect(non_places.map((n) => [n.cle, n.raison])).toEqual([
      ['B|1', 'score BAN 0,20 sous 0,30'],
      ['C|1', 'adresse introuvable (BAN)'],
    ]);
  });

  it('ville ou CP différents de ceux de la régie : jamais sûr, même avec un bon score', async () => {
    const { places } = await geolocaliser([campus('VILLE|1'), campus('CP|1')], {
      gares: [], geocoder: async () => [ban({ resultCity: 'Autreville' }), ban({ resultPostcode: '13009' })],
    });
    expect(places.map((p) => p.geoloc_qualite)).toEqual(['a_verifier', 'a_verifier']);
    expect(places.map((p) => p.geoloc_raison)).toEqual([
      'ville rendue « Autreville » au lieu de « Villetest »',
      'code postal rendu 13009 au lieu de 13008',
    ]);
  });

  it('même ville : le nom rendu par la BAN est gardé (accents, ville de régie qui déborde sur le nom du club)', async () => {
    const { places } = await geolocaliser([campus('A|1', '13008', 'Ales'), campus('B|1', '13008', 'Villetest Doyen Essai')], {
      gares: [], geocoder: async () => [ban({ resultCity: 'Alès' }), ban({ resultCity: 'Villetest' })],
    });
    expect(places.map((p) => [p.ville, p.geoloc_qualite, p.geoloc_raison])).toEqual([
      ['Alès', 'sure', undefined],
      ['Villetest', 'sure', undefined],
    ]);
  });

  it('la raison d un point à vérifier réunit tous ses motifs', async () => {
    const club = emplacement({
      adaptateur: 'basic-fit', cle: '2346', ville: 'Bourg-Essai',
      recherche: { type: 'adresse', adresse: '', code_postal: null, ville: 'Bourg-Essai', commune_seule: true },
    });
    const { places } = await geolocaliser([club], { gares: [], geocoder: async () => [ban({ score: 0.45, resultCity: 'Autreville' })] });
    expect(places[0].geoloc_raison).toBe('score BAN 0,45 sous 0,60 ; commune seule (pas de rue dans la liste) ; ville rendue « Autreville » au lieu de « Bourg-Essai »');
  });

  it('Basic-Fit sans rue : la commune seule est cherchée, le point est à vérifier', async () => {
    const club = emplacement({
      adaptateur: 'basic-fit', cle: '2345', ville: 'Bourg-Essai',
      recherche: { type: 'adresse', adresse: '', code_postal: null, ville: 'Bourg-Essai', commune_seule: true },
    });
    const geocoder = vi.fn(async (_rows: LigneAdresse[]) => [ban({ resultCity: 'Bourg-Essai', resultType: 'municipality', resultLabel: 'Bourg-Essai' })]);
    const { places } = await geolocaliser([club], { gares: [], geocoder });
    expect(geocoder.mock.calls[0][0]).toEqual([{ adresse: '', code_postal: '', ville: 'Bourg-Essai' }]);
    expect(places[0]).toMatchObject({ geoloc_qualite: 'a_verifier', adresse: null, ville: 'Bourg-Essai' });
  });

  it('gares : référentiel, UIC pour identité, et deux noms de la liste sur la même gare réunis', async () => {
    const geocoder = vi.fn(async () => []);
    const gare = (nom: string, nb: number) => emplacement({ adaptateur: 'mediatransports-gares', cle: nom, nb_ecrans: nb, recherche: { type: 'gare', nom, bloc: 'idf' } });
    const { places, non_places } = await geolocaliser([gare('VILLETEST', 2), gare('VILLETEST - GARE DE VILLETEST', 3), gare('NULLE PART', 1)], { gares: GARES, geocoder });
    expect(geocoder).not.toHaveBeenCalled();
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      source_ref: '87000001', nom_lieu: 'Villetest', nb_ecrans: 5, code_insee: '92001', code_departement: '92',
      geoloc_methode: 'referentiel_gares', geoloc_qualite: 'sure', geoloc_score: 1, geoloc_libelle: 'Villetest (UIC 87000001, INSEE 92001)',
    });
    expect(non_places).toEqual([expect.objectContaining({ cle: 'NULLE PART', raison: 'gare introuvable dans le référentiel SNCF' })]);
  });

  it('une gare à vérifier (première partie seule) porte le score 0,5, pas 1', async () => {
    const nom = 'VILLETEST - QUARTIER INCONNU';
    const gare = emplacement({ adaptateur: 'mediatransports-gares', cle: nom, recherche: { type: 'gare', nom, bloc: 'idf' } });
    const { places } = await geolocaliser([gare], { gares: GARES, geocoder: async () => [] });
    expect(places[0]).toMatchObject({ geoloc_qualite: 'a_verifier', geoloc_score: 0.5, geoloc_raison: 'première partie du nom seule' });
  });

  it('panne de la BAN (« Erreur API BAN ») : on lève, rien n\'est rendu comme introuvable', async () => {
    const panne = ban({ lat: null, lng: null, score: 0, resultLabel: 'Erreur API BAN', resultCity: '', resultPostcode: '', status: 'red' });
    await expect(geolocaliser([campus('A|1')], { gares: [], geocoder: async () => [panne] })).rejects.toThrow("BAN indisponible : rien n'est écrit");
  });

  it('la progression finit à total / total', async () => {
    const progression = vi.fn();
    await geolocaliser([campus('A|1')], { gares: [], geocoder: async () => [ban({})], progression });
    expect(progression).toHaveBeenLastCalledWith(1, 1);
  });
});
