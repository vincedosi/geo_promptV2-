import { chargerFeuille, chargerFeuilleConstruite, preparerFeuilleOmbre, proprietesEnVariables, remEnPx } from './feuilles';

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

describe('chargerFeuille — dans une racine d\'ombre', () => {
  it('pose le lien DANS la racine, jamais dans le <head> du document', async () => {
    const hote = document.createElement('div');
    document.body.appendChild(hote);
    const ombre = hote.attachShadow({ mode: 'open' });
    try {
      const p = chargerFeuille(ombre, 'data-mg-essai-ombre', 'https://distante.exemple/maplibre.css');
      expect(ombre.querySelectorAll('link[data-mg-essai-ombre]').length).toBe(1);
      expect(document.head.querySelector('link[data-mg-essai-ombre]')).toBeNull();
      // Un second appel pour la même racine ne double pas le lien.
      void chargerFeuille(ombre, 'data-mg-essai-ombre', 'https://distante.exemple/maplibre.css');
      expect(ombre.querySelectorAll('link[data-mg-essai-ombre]').length).toBe(1);
      ombre.querySelector('link')!.dispatchEvent(new Event('load'));
      await expect(p).resolves.toBeUndefined();
    } finally {
      hote.remove();
    }
  });
});

/** Extrait RÉEL du magelian.css de production (tâche 8) : une bordure, une transformation, un filtre. */
const EXTRAIT_TAILWIND = [
  '@layer utilities{.border-r{border-right-style:var(--tw-border-style);border-right-width:1px}',
  '.blur{--tw-blur: blur(8px);filter:var(--tw-blur,) var(--tw-brightness,)}}',
  '@property --tw-rotate-x{syntax: "*"; inherits: false;}',
  '@property --tw-border-style{syntax: "*"; inherits: false; initial-value: solid;}',
  '@property --tw-blur{syntax: "*"; inherits: false;}',
  '@property --tw-drop-shadow-alpha{syntax: "<percentage>"; inherits: false; initial-value: 100%;}',
].join('');

describe('proprietesEnVariables', () => {
  it('réécrit chaque @property en déclaration posée sur CHAQUE élément, valeur initiale comprise', () => {
    const sortie = proprietesEnVariables(EXTRAIT_TAILWIND);
    const bloc = /@layer properties\{\*,:before,:after,::backdrop\{([^}]*)\}\}\s*$/.exec(sortie);
    expect(bloc, 'bloc de repli absent ou mal placé').not.toBeNull();
    const decl = Object.fromEntries(bloc![1].split(';').map((d) => d.split(':').map((s) => s.trim())));
    expect(decl).toEqual({
      '--tw-rotate-x': 'initial',        // transformation, sans valeur initiale
      '--tw-border-style': 'solid',      // bordure : sans elle, `border-r` n'a pas de style
      '--tw-blur': 'initial',            // filtre
      '--tw-drop-shadow-alpha': '100%',
    });
    // Le reste de la feuille est intact.
    expect(sortie).toContain('.border-r{border-right-style:var(--tw-border-style);border-right-width:1px}');
    expect(sortie).toContain('.blur{--tw-blur: blur(8px);filter:var(--tw-blur,) var(--tw-brightness,)}');
  });

  it("RETIRE les @property réécrites : un navigateur qui les honorerait dans l'ombre les enregistrerait pour tout le document", () => {
    expect(proprietesEnVariables(EXTRAIT_TAILWIND)).not.toMatch(/@property/);
  });

  it("une @property qui S'HÉRITE (`inherits: true`) est posée sur :host seul, d'où elle descend — jamais sur chaque élément", () => {
    const sortie = proprietesEnVariables(
      '.a{color:red}@property --x-herite{syntax:"*";inherits:true;initial-value:4px;}@property --x-local{syntax:"*";inherits:false;initial-value:1px;}',
    );
    expect(sortie).toContain('@layer properties{:host{--x-herite:4px}*,:before,:after,::backdrop{--x-local:1px}}');
    expect(sortie).not.toMatch(/@property/);
  });

  it('ne touche pas une feuille sans @property', () => {
    expect(proprietesEnVariables('.a{color:red}')).toBe('.a{color:red}');
  });

  it('non-héritage : le repli vise CHAQUE élément (`*` et pseudo-éléments), donc un enfant ne reçoit jamais la valeur de son parent', () => {
    // jsdom ne calcule pas les propriétés personnalisées d'une feuille (mesuré : '' même sur l'élément
    // qui la porte) : la preuve de rendu est faite au navigateur (rapport de la tâche 8) ; ici, la forme.
    // Une déclaration posée par `*` sur l'enfant lui-même l'emporte sur l'héritage du parent : c'est ce
    // qui remplace `inherits: false`, que `@property` ne peut plus garantir dans une racine d'ombre.
    const sortie = proprietesEnVariables(EXTRAIT_TAILWIND);
    const bloc = sortie.slice(sortie.indexOf('@layer properties'));
    const selecteur = /@layer properties\{([^{]*)\{/.exec(bloc)![1];
    expect(selecteur.split(',').map((x) => x.trim())).toEqual(['*', ':before', ':after', '::backdrop']);
    for (const nom of ['--tw-rotate-x', '--tw-border-style', '--tw-blur', '--tw-drop-shadow-alpha']) {
      expect(bloc).toContain(`${nom}:`);
    }
  });
});

describe('preparerFeuilleOmbre', () => {
  it('retire les @import (interdits par CSSStyleSheet.replace) et réécrit les @property', () => {
    const sortie = preparerFeuilleOmbre("@import url('https://fonts.exemple/x.css');\n.a{color:red}@property --tw-x{syntax:\"*\";inherits:false;initial-value:1px;}");
    expect(sortie).not.toMatch(/@import/);
    expect(sortie).toMatch(/\.a\{color:red\}/);
    expect(sortie).toMatch(/--tw-x:1px/);
  });

  it('convertit les rem en px (voir remEnPx)', () => {
    expect(preparerFeuilleOmbre('.a{padding:1rem}')).toBe('.a{padding:16px}');
  });
});

describe('remEnPx', () => {
  it("ne touche pas un rem collé à un nom (propriété personnalisée, classe) : seulement une VALEUR isolée", () => {
    expect(remEnPx('.a{gap:var(--gap-2rem)}')).toBe('.a{gap:var(--gap-2rem)}');
    expect(remEnPx('.x-1rem {color:red}')).toBe('.x-1rem {color:red}');
    expect(remEnPx('.b{--taille_3rem: 1}')).toBe('.b{--taille_3rem: 1}');
    // Toujours converti : un signe moins de VALEUR, précédé d'un séparateur.
    expect(remEnPx('.m{margin:-0.5rem 12rem}')).toBe('.m{margin:-8px 192px}');
  });

  it("convertit les rem des VALEURS en px (base 16) : la taille de police de <html> appartient au shell, pas à MAGELIAN", () => {
    expect(remEnPx(':host{--spacing: .25rem;--text-lg: 1.125rem}.m{margin:-0.5rem 2rem;width:calc(100% - 1rem)}.i{top:0rem!important}'))
      .toBe(':host{--spacing: 4px;--text-lg: 18px}.m{margin:-8px 32px;width:calc(100% - 16px)}.i{top:0px!important}');
  });

  it('ne touche ni un sélecteur échappé (`.p-\[1rem\]`), ni un rapport sans unité, ni un nom qui contient « rem »', () => {
    const css = '.p-\[1rem\]{padding:1rem}.l{line-height:calc(1 / .75)}.remise{--premier:1}';
    expect(remEnPx(css)).toBe('.p-\[1rem\]{padding:16px}.l{line-height:calc(1 / .75)}.remise{--premier:1}');
  });
});

describe('chargerFeuilleConstruite', () => {
  const HREF = 'https://distante.exemple/remotes/magelian/magelian.css?v=2';

  it('lit la feuille, la prépare pour la racine d\'ombre et la construit', async () => {
    const lire = vi.fn(async () => ({ ok: true, text: async () => "@import url('x.css');.a{color:red}" }));
    const feuille = {} as CSSStyleSheet;
    const construire = vi.fn(async () => feuille);
    await expect(chargerFeuilleConstruite(HREF, lire, construire)).resolves.toBe(feuille);
    expect(lire).toHaveBeenCalledWith(HREF);
    expect(construire).toHaveBeenCalledWith('.a{color:red}', HREF);
  });

  it('réponse en échec : rejette en NOMMANT le fichier, sans rien construire', async () => {
    const construire = vi.fn();
    await expect(chargerFeuilleConstruite(HREF, async () => ({ ok: false, text: async () => '' }), construire))
      .rejects.toThrow("La feuille de style magelian.css n'a pas pu être chargée.");
    expect(construire).not.toHaveBeenCalled();
  });

  it('réseau en échec : rejette aussi en nommant le fichier', async () => {
    await expect(chargerFeuilleConstruite(HREF, async () => { throw new TypeError('Failed to fetch'); }, vi.fn()))
      .rejects.toThrow(/magelian\.css/);
  });

  it('construction en échec : rejette en nommant le fichier', async () => {
    await expect(chargerFeuilleConstruite(HREF, async () => ({ ok: true, text: async () => '.a{}' }), async () => { throw new Error('x'); }))
      .rejects.toThrow(/magelian\.css/);
  });
});
