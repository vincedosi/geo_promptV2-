import { chargerFeuilleMaplibre } from './feuille-maplibre';

const BASE = 'https://distante.exemple/remotes/magelian/chunk-ABC.js';

describe('chargerFeuilleMaplibre', () => {
  it('pose la feuille une seule fois, résolue contre l\'application distante', () => {
    const doc = document.implementation.createHTMLDocument('test');

    void chargerFeuilleMaplibre(doc, BASE);
    const liens = doc.head.querySelectorAll('link[data-mg-maplibre]');
    expect(liens.length).toBe(1);
    expect(liens[0].getAttribute('href')).toBe('https://distante.exemple/remotes/magelian/maplibre.css');
    expect(liens[0].getAttribute('rel')).toBe('stylesheet');

    void chargerFeuilleMaplibre(doc, BASE);
    expect(doc.head.querySelectorAll('link[data-mg-maplibre]').length).toBe(1);
  });

  it('rejette en nommant la feuille si elle ne charge pas', async () => {
    const doc = document.implementation.createHTMLDocument('test');
    const p = chargerFeuilleMaplibre(doc, BASE);
    doc.head.querySelector('link[data-mg-maplibre]')!.dispatchEvent(new Event('error'));
    await expect(p).rejects.toThrow(/maplibre\.css/);
  });
});
