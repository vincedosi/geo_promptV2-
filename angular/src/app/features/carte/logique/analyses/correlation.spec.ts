import { type ResultatCorrelation, ligneCouverture, lireCoefficient, nomCampagne, urlCorrelation } from './correlation';

describe('logique/analyses/correlation (CorrelationTool.tsx)', () => {
  it('lecture du coefficient : rien sous 30 points, puis les seuils 0,1 / 0,3 / 0,5 / 0,7', () => {
    expect(lireCoefficient(0.92, 5)).toBe('trop peu de points pour interpréter (n = 5)');
    expect(lireCoefficient(0.05, 100)).toBe('aucune relation linéaire');
    expect(lireCoefficient(-0.2, 100)).toBe('relation négative très faible');
    expect(lireCoefficient(0.4, 100)).toBe('relation positive faible');
    expect(lireCoefficient(0.6, 100)).toBe('relation positive modérée');
    expect(lireCoefficient(-0.8, 100)).toBe('relation négative forte');
  });

  it('nom de la campagne : `name`, puis `nom`, sinon « — »', () => {
    const c = [{ id: 'a', name: 'Élections' }, { id: 'b', name: null, nom: 'Rentrée' }];
    expect([nomCampagne(c, 'a'), nomCampagne(c, 'b'), nomCampagne(c, 'z')]).toEqual(['Élections', 'Rentrée', '—']);
  });

  it('couverture : « n = N codes postaux sur M touchés par la campagne », sans M quand la route ne l’a pas', () => {
    const r = (cp: number | null): ResultatCorrelation => ({
      r: 0.31, n: 1234, points: [],
      indicateur: { code: 'rev_median', label: 'Revenu médian', unit: '€', calcule_le: null },
      couverture: { cp_apparies: 1234, cp_campagne: cp },
    });
    expect(ligneCouverture(r(2041))).toBe('n = 1 234 codes postaux sur 2 041 touchés par la campagne');
    expect(ligneCouverture(r(null))).toBe('n = 1 234 codes postaux');
  });

  it('adresse de la route, paramètres encodés', () => {
    expect(urlCorrelation('c/1', 'a&b')).toBe('analyses/correlation?campaignId=c%2F1&variable=a%26b');
  });
});
