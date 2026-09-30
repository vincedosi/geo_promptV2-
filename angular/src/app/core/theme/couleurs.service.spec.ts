import { TestBed } from '@angular/core/testing';
import { CouleursService } from './couleurs.service';
import { ThemeService } from './theme.service';

describe('CouleursService', () => {
  beforeEach(() => {
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
