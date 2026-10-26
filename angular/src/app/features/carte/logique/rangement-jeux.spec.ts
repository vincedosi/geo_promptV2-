import { JEUX_REFERENTIELS } from './jeux-carte';
import { decouperCommuns, filtrerJeux, jeuxDeLaCarte, rangerJeux } from './rangement-jeux';

const types = [
  { id: 'bmw', label: 'Concessions BMW', origine: 'espace' as const },
  { id: 'lycee', label: 'Lycées', origine: 'commune' as const },
  { id: 'risque_industriel', label: 'Risque', origine: 'commune' as const },
];

describe('rangement des jeux de ②', () => {
  it('jeuxDeLaCarte : POI de l’espace, puis les 8 référentiels, puis POI communs ; risque_industriel rangé ailleurs ; ni OOH ni radio', () => {
    const j = jeuxDeLaCarte(types);
    expect(j[0]).toMatchObject({ cle: 'poi:bmw', origine: 'espace', nature: 'poi', maille: 'point' });
    expect(j[1].cle).toBe('iris:socio-demo');
    expect(j.at(-1)).toMatchObject({ cle: 'poi:lycee', origine: 'commune' });
    expect(j.some((x) => x.cle === 'poi:risque_industriel')).toBe(false);
    expect(j.some((x) => x.cle === 'ooh:panneaux' || x.cle === 'radio:emetteurs')).toBe(false);
    expect(j).toHaveLength(10);
  });
  it('jeuxDeLaCarte passe par cleJeuPoi : une catégorie à clé non conforme n’est pas un jeu (AT-10)', () => {
    const j = jeuxDeLaCarte([...types, { id: 'Nom Libre', label: 'Nom libre', origine: 'commune' as const }]);
    expect(j.some((x) => x.nom === 'Nom libre')).toBe(false);
    expect(j).toHaveLength(10);
  });
  it('une sélection range : recommandés dans l’ordre des jeux, le reste dans « Plus de données communes »', () => {
    const r = rangerJeux(jeuxDeLaCarte(types), ['poi:lycee', 'carreaux:filosofi']);
    expect(r.espace.map((x) => x.cle)).toEqual(['poi:bmw']);
    expect(r.recommandes.map((x) => x.cle)).toEqual(['carreaux:filosofi', 'poi:lycee']);
    expect(r.autres).toHaveLength(7);
    expect(r.sansSelection).toBe(false);
  });
  it('aucune sélection : tout déplié', () => {
    const r = rangerJeux(jeuxDeLaCarte(types), []);
    expect(r.recommandes).toHaveLength(9);
    expect(r.autres).toEqual([]);
    expect(r.sansSelection).toBe(true);
  });
  it('sélection périmée (aucune clé ne désigne un jeu commun présent) : tout déplié, jamais un bloc vide (Review Focus 5)', () => {
    const r = rangerJeux(jeuxDeLaCarte(types), ['poi:disparue', 'poi:bmw', 'ooh:panneaux']);
    expect(r.recommandes).toHaveLength(9);
    expect(r.sansSelection).toBe(true);
  });
  it('un jeu de l’espace recommandé reste dans le bloc de l’espace', () => {
    const r = rangerJeux(jeuxDeLaCarte(types), ['poi:bmw', 'meteo:zones']);
    expect(r.espace.map((x) => x.cle)).toEqual(['poi:bmw']);
    expect(r.recommandes.map((x) => x.cle)).toEqual(['meteo:zones']);
  });
  it('decouperCommuns : référentiels d’un côté (arrêts et ICPE compris, bien que de nature « poi »), types de POI de l’autre, ordre conservé ; sans POI, liste vide', () => {
    const communs = rangerJeux(jeuxDeLaCarte([...types, { id: 'cirfa', label: 'CIRFA', origine: 'commune' as const }]), []).recommandes;
    const d = decouperCommuns(communs);
    expect(d.referentiels.map((x) => x.cle)).toEqual(JEUX_REFERENTIELS.map((j) => j.cle));
    expect(d.pois.map((x) => x.cle)).toEqual(['poi:lycee', 'poi:cirfa']);
    expect(decouperCommuns(d.referentiels).pois).toEqual([]);
    expect(decouperCommuns([])).toEqual({ referentiels: [], pois: [] });
  });
  it('filtrerJeux : sans casse ni accents, vide = tout', () => {
    const j = jeuxDeLaCarte(types);
    expect(filtrerJeux(j, 'METEO').map((x) => x.cle)).toEqual(['meteo:zones']);
    expect(filtrerJeux(j, 'lycées').map((x) => x.cle)).toEqual(['poi:lycee']);
    expect(filtrerJeux(j, '  ')).toHaveLength(10);
  });
});
