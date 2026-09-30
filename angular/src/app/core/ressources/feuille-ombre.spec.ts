import { TestBed } from '@angular/core/testing';
import { ADOPTER_FEUILLE, CONSTRUIRE_FEUILLE, LIRE_FEUILLE } from './feuille-ombre';

/** Les coutures de PRODUCTION (celles que les specs remplacent partout ailleurs). */
describe('feuille-ombre — coutures de production', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ADOPTER_FEUILLE ajoute la feuille UNE fois, sans retirer celles déjà adoptées', () => {
    const adopter = TestBed.inject(ADOPTER_FEUILLE);
    const deja = { deja: true } as unknown as CSSStyleSheet;
    const feuille = { magelian: true } as unknown as CSSStyleSheet;
    const racine = { adoptedStyleSheets: [deja] } as unknown as ShadowRoot;
    adopter(racine, feuille);
    adopter(racine, feuille);
    expect(racine.adoptedStyleSheets).toEqual([deja, feuille]);
  });

  it("CONSTRUIRE_FEUILLE construit une CSSStyleSheet résolue contre l'adresse de la feuille (baseURL), pas contre la page du shell", async () => {
    const construites: { init: unknown; texte?: string }[] = [];
    class FeuilleFactice {
      constructor(readonly init: unknown) { construites.push({ init }); }
      replace(texte: string) { construites.at(-1)!.texte = texte; return Promise.resolve(this); }
    }
    vi.stubGlobal('CSSStyleSheet', FeuilleFactice);
    const construire = TestBed.inject(CONSTRUIRE_FEUILLE);
    const f = await construire('.a{color:red}', 'https://distante.exemple/remotes/magelian/magelian.css');
    expect(f).toBeInstanceOf(FeuilleFactice);
    expect(construites).toEqual([{ init: { baseURL: 'https://distante.exemple/remotes/magelian/magelian.css' }, texte: '.a{color:red}' }]);
  });

  it("LIRE_FEUILLE lit par le fetch du document, à l'adresse donnée", async () => {
    const reponse = { ok: true, text: async () => '' };
    const fetchFactice = vi.fn(async () => reponse);
    vi.stubGlobal('fetch', fetchFactice);
    await expect(TestBed.inject(LIRE_FEUILLE)('https://distante.exemple/magelian.css')).resolves.toBe(reponse);
    expect(fetchFactice).toHaveBeenCalledWith('https://distante.exemple/magelian.css');
  });
});
