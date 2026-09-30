import { chargerFeuille } from './feuilles';

function nouveauDocument(): Document {
  return document.implementation.createHTMLDocument('test');
}

describe('chargerFeuille', () => {
  it('pose le lien une seule fois et résout au chargement', async () => {
    const doc = nouveauDocument();
    let resolue = false;
    const a = chargerFeuille(doc, 'data-mg-essai', 'https://distante.exemple/magelian.css');
    const b = chargerFeuille(doc, 'data-mg-essai', 'https://distante.exemple/magelian.css');
    void a.then(() => (resolue = true));

    const liens = doc.head.querySelectorAll('link[data-mg-essai]');
    expect(liens.length).toBe(1);
    expect(liens[0].getAttribute('rel')).toBe('stylesheet');
    expect(liens[0].getAttribute('href')).toBe('https://distante.exemple/magelian.css');

    await Promise.resolve();
    expect(resolue).toBe(false);
    liens[0].dispatchEvent(new Event('load'));
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBeUndefined();
  });

  it('un appel APRÈS le chargement résout aussitôt, sans second lien', async () => {
    const doc = nouveauDocument();
    const a = chargerFeuille(doc, 'data-mg-essai', 'x.css');
    doc.head.querySelector('link[data-mg-essai]')!.dispatchEvent(new Event('load'));
    await a;
    await expect(chargerFeuille(doc, 'data-mg-essai', 'x.css')).resolves.toBeUndefined();
    expect(doc.head.querySelectorAll('link[data-mg-essai]').length).toBe(1);
  });

  it('rejette avec le nom du fichier si la feuille ne charge pas', async () => {
    const doc = nouveauDocument();
    const p = chargerFeuille(doc, 'data-mg-essai', 'https://distante.exemple/magelian.css?v=1');
    doc.head.querySelector('link[data-mg-essai]')!.dispatchEvent(new Event('error'));
    await expect(p).rejects.toThrow(/magelian\.css/);
  });

  it('après un échec, le lien est retiré : un nouvel appel retente', async () => {
    const doc = nouveauDocument();
    const p = chargerFeuille(doc, 'data-mg-essai', 'x.css');
    doc.head.querySelector('link[data-mg-essai]')!.dispatchEvent(new Event('error'));
    await expect(p).rejects.toThrow();
    expect(doc.head.querySelector('link[data-mg-essai]')).toBeNull();

    const q = chargerFeuille(doc, 'data-mg-essai', 'x.css');
    expect(doc.head.querySelectorAll('link[data-mg-essai]').length).toBe(1);
    doc.head.querySelector('link[data-mg-essai]')!.dispatchEvent(new Event('load'));
    await expect(q).resolves.toBeUndefined();
  });
});
