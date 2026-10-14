import { clesAffichees, type EtatAffichage } from './donnees-affichees.service';

const ETEINT: EtatAffichage = {
  carreaux: false, iris: false, civique: false, transport: false, tmja: false, risques: false, sante: false, meteo: false, pois: [],
};

describe('clesAffichees — l’unique source de « affiché » de ② (pastilles des lignes ET de l’étape, AT-4)', () => {
  it('tout éteint : aucune clé', () => {
    expect([...clesAffichees(ETEINT)]).toEqual([]);
  });

  it('chaque couche allumée donne la clé de SON jeu, dans l’ordre du registre ; les POI choisis donnent poi:<id>', () => {
    const tout: EtatAffichage = {
      carreaux: true, iris: true, civique: true, transport: true, tmja: true, risques: true, sante: true, meteo: true, pois: ['bmw', 'lycee'],
    };
    expect([...clesAffichees(tout)]).toEqual([
      'iris:socio-demo', 'carreaux:filosofi', 'civique:indicateurs-cp', 'transport:arrets', 'tmja:comptages', 'risques:icpe-pprt',
      'sante:air-pollen', 'meteo:zones', 'poi:bmw', 'poi:lycee',
    ]);
  });

  it('ni OOH ni radio : ils ne sont pas dans ② (T11b)', () => {
    const cles = clesAffichees({ ...ETEINT, tmja: true });
    expect(cles.has('ooh:panneaux')).toBe(false);
    expect(cles.has('radio:emetteurs')).toBe(false);
    expect([...cles]).toEqual(['tmja:comptages']);
  });
});
