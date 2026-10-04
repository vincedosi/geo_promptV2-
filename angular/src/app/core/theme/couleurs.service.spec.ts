import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DemarrageService } from '../demarrage/demarrage.service';
import { CouleursService, type RegleCss, jetonsDuBloc } from './couleurs.service';
import { ECRIRE_HTML, ThemeService } from './theme.service';

describe('CouleursService', () => {
  beforeEach(() => {
    // Ces specs raisonnent sur la classe de <html> écrite en autonome.
    TestBed.configureTestingModule({ providers: [{ provide: ECRIRE_HTML, useValue: true }] });
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.style.setProperty('--essai-a', '#112233');
    document.documentElement.style.setProperty('--essai-b', ' rgba(1, 2, 3, 0.5) ');
  });
  afterEach(() => {
    document.documentElement.style.removeProperty('--essai-a');
    document.documentElement.style.removeProperty('--essai-b');
  });

  it('rend la valeur calculée de chaque jeton, sous les clés de l\'appelant', () => {
    const p = TestBed.inject(CouleursService).palette({ fond: 'essai-a', trait: 'essai-b' });
    TestBed.tick();
    expect(p()).toEqual({ fond: '#112233', trait: 'rgba(1, 2, 3, 0.5)' });
  });

  it('relit après une bascule de thème', () => {
    const p = TestBed.inject(CouleursService).palette({ fond: 'essai-a' });
    TestBed.tick();
    expect(p().fond).toBe('#112233');
    document.documentElement.style.setProperty('--essai-a', '#445566');
    TestBed.inject(ThemeService).basculer();
    TestBed.tick();
    expect(p().fond).toBe('#445566');
  });

  it('échoue en nommant un jeton inconnu, au lieu de peindre en noir', () => {
    const p = TestBed.inject(CouleursService).palette({ fond: 'jeton-qui-nexiste-pas' });
    TestBed.tick();
    expect(() => p()).toThrow(/--jeton-qui-nexiste-pas/);
  });

  it('suit le thème APPLIQUÉ (la classe sur <html>), pas le thème demandé', () => {
    const original = window.getComputedStyle;
    window.getComputedStyle = ((_elt: Element) => ({
      getPropertyValue: (nom: string) =>
        nom === '--essai-a'
          ? (document.documentElement.classList.contains('light') ? '#222222' : '#111111')
          : '',
    })) as typeof window.getComputedStyle;
    try {
      const theme = TestBed.inject(ThemeService);
      const p = TestBed.inject(CouleursService).palette({ fond: 'essai-a' });
      TestBed.tick();
      expect(p().fond).toBe('#111111');
      theme.basculer();
      p(); // lecture avant que l'effet pose la classe : la classe n'a pas encore changé
      TestBed.tick();
      expect(p().fond).toBe('#222222');
    } finally {
      window.getComputedStyle = original;
    }
  });

  it('repeint quand le shell hôte change la classe de <html> (sans passer par basculer)', async () => {
    const original = window.getComputedStyle;
    window.getComputedStyle = ((_elt: Element) => ({
      getPropertyValue: (nom: string) =>
        nom === '--essai-a'
          ? (document.documentElement.classList.contains('light') ? '#222222' : '#111111')
          : '',
    })) as typeof window.getComputedStyle;
    try {
      TestBed.inject(ThemeService);
      const p = TestBed.inject(CouleursService).palette({ fond: 'essai-a' });
      TestBed.tick();
      expect(p().fond).toBe('#111111');
      document.documentElement.classList.replace('dark', 'light');
      await Promise.resolve();
      TestBed.tick();
      expect(p().fond).toBe('#222222');
    } finally {
      window.getComputedStyle = original;
    }
  });

  it("lit les valeurs calculées sur l'HÔTE de la racine d'ombre enregistrée, plus sur <html>", () => {
    const hote = document.createElement('mg-racine-distante');
    document.body.appendChild(hote);
    hote.style.setProperty('--essai-a', '#abcdef');
    try {
      const theme = TestBed.inject(ThemeService);
      const p = TestBed.inject(CouleursService).palette({ fond: 'essai-a' });
      TestBed.tick();
      expect(p().fond).toBe('#112233'); // aucune racine : repli sur <html>
      theme.enregistrerRacine(hote);
      theme.basculer(); // relecture
      TestBed.tick();
      expect(p().fond).toBe('#abcdef');
    } finally {
      hote.remove();
    }
  });

  it("suit un changement de classe du shell par l'hôte de la racine (`:host(.light)`)", async () => {
    const original = window.getComputedStyle;
    const hote = document.createElement('mg-racine-distante');
    const lus: Element[] = [];
    window.getComputedStyle = ((elt: Element) => {
      lus.push(elt);
      return { getPropertyValue: (nom: string) => (nom === '--essai-a' ? (elt.classList.contains('light') ? '#222222' : '#111111') : '') };
    }) as typeof window.getComputedStyle;
    try {
      document.documentElement.className = 'dark';
      const theme = TestBed.inject(ThemeService);
      theme.enregistrerRacine(hote);
      const p = TestBed.inject(CouleursService).palette({ fond: 'essai-a' });
      TestBed.tick();
      expect(p().fond).toBe('#111111');
      document.documentElement.classList.replace('dark', 'light');
      await Promise.resolve();
      TestBed.tick();
      expect(p().fond).toBe('#222222');
      expect(lus.at(-1)).toBe(hote);
    } finally {
      window.getComputedStyle = original;
    }
  });
});

/** Une règle CSSOM factice : sélecteur et déclarations, ou un bloc (`@layer`, `@media`) qui en contient d'autres. */
function regle(selectorText: string, decl: Record<string, string>): RegleCss {
  const noms = Object.keys(decl);
  return { selectorText, style: { getPropertyValue: (n) => decl[n] ?? '', length: noms.length, item: (i) => noms[i] } };
}
const bloc = (...cssRules: RegleCss[]): RegleCss => ({ cssRules });

/** Les règles de `magelian.css` telles que Tailwind les range : jetons dans un `@layer`, le clair imbriqué à part. */
const REGLES: RegleCss[] = [
  bloc(regle(':root, :host', { '--font-sans': 'Inter' })),
  bloc(
    regle(':root, :host', { '--seq-1': ' #132625', '--brand-teal': '#4ecdc4', '--alias': 'var(--seq-1)' }),
    bloc(regle('html.light, :host(.light)', { '--seq-1': '#eaf7f5', color: 'red' })),
  ),
  regle('.bg-x', { '--seq-1': '#000000' }),
];

describe('jetonsDuBloc', () => {
  it('lit les `--x` du bloc demandé, en descendant dans les @layer/@media, et rien d’autre', () => {
    const sombre = jetonsDuBloc(REGLES, ':host');
    expect(sombre.get('--seq-1')).toBe('#132625');
    expect(sombre.get('--font-sans')).toBe('Inter');
    expect([...jetonsDuBloc(REGLES, ':host(.light)').entries()]).toEqual([['--seq-1', '#eaf7f5']]);
  });
});

describe('CouleursService.paletteDuTheme (A11)', () => {
  function service() {
    TestBed.configureTestingModule({
      providers: [
        { provide: ECRIRE_HTML, useValue: true },
        { provide: DemarrageService, useValue: { feuille: signal({ cssRules: REGLES } as unknown as CSSStyleSheet) } },
      ],
    });
    return TestBed.inject(CouleursService);
  }
  afterEach(() => localStorage.clear());

  it('rend la palette SOMBRE même quand le thème courant est clair', () => {
    localStorage.setItem('magelian-theme', 'light');
    const s = service();
    TestBed.inject(ThemeService);
    TestBed.tick();
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(s.paletteDuTheme({ a: 'seq-1' }, 'sombre')).toEqual({ a: '#132625' });
  });

  it('rend la palette CLAIRE (le clair ne redéfinit pas tout : cascade) et résout un alias `var()`', () => {
    const s = service();
    expect(s.paletteDuTheme({ a: 'seq-1', t: 'brand-teal', al: 'alias' }, 'clair')).toEqual({ a: '#eaf7f5', t: '#4ecdc4', al: '#eaf7f5' });
    expect(s.paletteDuTheme({ al: 'alias' }, 'sombre')).toEqual({ al: '#132625' });
  });

  it('feuille illisible : repli sur la valeur calculée du thème COURANT (coût écrit dans A11)', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: DemarrageService, useValue: { feuille: signal(null) } }],
    });
    document.documentElement.style.setProperty('--essai-repli', '#123456');
    try {
      expect(TestBed.inject(CouleursService).paletteDuTheme({ a: 'essai-repli' }, 'sombre')).toEqual({ a: '#123456' });
    } finally {
      document.documentElement.style.removeProperty('--essai-repli');
    }
  });

  it('lève en nommant un jeton inconnu, comme `palette()`', () => {
    expect(() => service().paletteDuTheme({ a: 'inconnu' }, 'sombre')).toThrow('Jeton de couleur inconnu : --inconnu');
  });
});
