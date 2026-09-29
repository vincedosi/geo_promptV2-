import { assurerFeuilleMaplibre } from './feuille-maplibre';

describe('assurerFeuilleMaplibre', () => {
  it('ajoute la feuille de style une seule fois', () => {
    const doc = document.implementation.createHTMLDocument('test');

    assurerFeuilleMaplibre(doc);
    const liens = doc.head.querySelectorAll('link[data-mg-maplibre]');
    expect(liens.length).toBe(1);
    expect(liens[0].getAttribute('href')).toBe('maplibre.css');
    expect(liens[0].getAttribute('rel')).toBe('stylesheet');

    assurerFeuilleMaplibre(doc);
    expect(doc.head.querySelectorAll('link[data-mg-maplibre]').length).toBe(1);
  });
});
