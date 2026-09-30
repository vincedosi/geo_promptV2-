import { TestBed } from '@angular/core/testing';
import { CLE_THEME } from './theme';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
  });

  it('pose la classe du thème sur <html>', () => {
    TestBed.inject(ThemeService);
    TestBed.tick();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('bascule, enregistre et change la classe', () => {
    const theme = TestBed.inject(ThemeService);
    theme.basculer();
    TestBed.tick();
    expect(theme.theme()).toBe('light');
    expect(localStorage.getItem(CLE_THEME)).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('ne plante pas si l\'écriture du stockage lève', () => {
    const origine = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('bloqué'); };
    try {
      const theme = TestBed.inject(ThemeService);
      theme.basculer();
      expect(() => TestBed.tick()).not.toThrow();
      expect(document.documentElement.classList.contains('light')).toBe(true);
    } finally {
      Storage.prototype.setItem = origine;
    }
  });

  it('ne plante pas si l\'ACCÈS au stockage lève (Safari privé, politique bloquante)', () => {
    const descripteur = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('bloqué', 'SecurityError');
      },
    });
    try {
      expect(() => TestBed.inject(ThemeService)).not.toThrow();
      const theme = TestBed.inject(ThemeService);
      expect(theme.theme()).toBe('dark');
      theme.basculer();
      expect(() => TestBed.tick()).not.toThrow();
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    } finally {
      if (descripteur) Object.defineProperty(window, 'localStorage', descripteur);
    }
  });

  it('themeApplique ne change qu\'une fois la classe posée', () => {
    const theme = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(theme.themeApplique()).toBe('dark');
    theme.basculer();
    expect(theme.themeApplique()).toBe('dark'); // effet pas encore passé
    TestBed.tick();
    expect(theme.themeApplique()).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it("tient `color-scheme` de <html> d'accord avec le thème, aussi après une bascule", () => {
    const theme = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(document.documentElement.style.colorScheme).toBe('dark');
    theme.basculer();
    TestBed.tick();
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  describe('classe posée par le shell hôte', () => {
    const imposer = async (retirer: string[], ajouter: string[]) => {
      document.documentElement.classList.remove(...retirer);
      document.documentElement.classList.add(...ajouter);
      await Promise.resolve(); // les MutationObserver sont des micro-tâches
      TestBed.tick();
    };

    it("suit une classe posée par le shell hôte", async () => {
      const service = TestBed.inject(ThemeService);
      TestBed.tick();
      await imposer(['dark'], ['light']);
      expect(service.theme()).toBe('light');
      expect(service.themeApplique()).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('dark'); // posé au démarrage autonome, l'hôte le tient ensuite
    });

    it("ne mémorise pas un thème imposé par le shell", async () => {
      const espion = vi.spyOn(Storage.prototype, 'setItem');
      try {
        TestBed.inject(ThemeService);
        TestBed.tick();
        await imposer(['dark'], ['light']);
        TestBed.tick();
        expect(espion).not.toHaveBeenCalled();
        expect(localStorage.getItem(CLE_THEME)).toBeNull();
      } finally {
        espion.mockRestore();
      }
    });

    it("une bascule de l'utilisateur APRÈS un thème imposé est bien mémorisée", async () => {
      const service = TestBed.inject(ThemeService);
      TestBed.tick();
      await imposer(['dark'], ['light']);
      service.basculer(); // light -> dark, geste de l'utilisateur
      TestBed.tick();
      await Promise.resolve();
      expect(service.theme()).toBe('dark');
      expect(localStorage.getItem(CLE_THEME)).toBe('dark');
    });

    it("basculer() ne boucle pas avec l'observateur : une bascule, un setItem", async () => {
      const espion = vi.spyOn(Storage.prototype, 'setItem');
      try {
        const service = TestBed.inject(ThemeService);
        TestBed.tick();
        service.basculer();
        TestBed.tick();
        await Promise.resolve(); // l'observateur voit la classe qu'on vient de poser
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();
        expect(espion).toHaveBeenCalledTimes(1);
        expect(service.theme()).toBe('light');
        expect(service.themeApplique()).toBe('light');
      } finally {
        espion.mockRestore();
      }
    });

    // Règle du CSS (jetons.css : `:root` sombre, `html.light` clair) : `light`
    // présente -> clair, sinon sombre. Absente -> sombre ; les deux -> clair.
    it("classe retirée par l'hôte : la page rend sombre, on suit, sans rien écrire", async () => {
      const service = TestBed.inject(ThemeService);
      TestBed.tick();
      await imposer(['dark'], ['light']);
      expect(service.theme()).toBe('light');
      const schema = document.documentElement.style.colorScheme;
      await imposer(['light'], []); // plus aucune classe
      expect(service.theme()).toBe('dark');
      expect(service.themeApplique()).toBe('dark');
      expect(localStorage.getItem(CLE_THEME)).toBeNull();
      // L'hôte a retiré la classe exprès : on ne la lui remet pas, ni color-scheme.
      expect(document.documentElement.className).toBe('');
      expect(document.documentElement.style.colorScheme).toBe(schema);
    });

    it("les deux classes à la fois : la page rend clair, on suit, sans rien écrire", async () => {
      const service = TestBed.inject(ThemeService);
      TestBed.tick();
      const schema = document.documentElement.style.colorScheme;
      await imposer([], ['light']); // dark + light
      expect(service.theme()).toBe('light');
      expect(service.themeApplique()).toBe('light');
      expect(localStorage.getItem(CLE_THEME)).toBeNull();
      // On ne retire pas le `dark` de l'hôte, et on ne touche pas color-scheme.
      expect([...document.documentElement.classList].sort()).toEqual(['dark', 'light']);
      expect(document.documentElement.style.colorScheme).toBe(schema);
    });

    it("débranche l'observateur à la destruction de l'injecteur", async () => {
      const deconnexion = vi.spyOn(MutationObserver.prototype, 'disconnect');
      try {
        const service = TestBed.inject(ThemeService);
        TestBed.tick();
        TestBed.resetTestingModule();
        expect(deconnexion).toHaveBeenCalled();
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        await Promise.resolve();
        expect(service.theme()).toBe('dark'); // plus personne n'écoute
      } finally {
        deconnexion.mockRestore();
      }
    });
  });

  describe('démarrage dans un shell dont <html> porte déjà un thème', () => {
    for (const memorise of [null, 'dark', 'light'] as const) {
      it(`<html class="light"> + stockage ${memorise ?? 'vide'} : prend le thème de l'hôte, ne le réécrit pas`, () => {
        document.documentElement.className = 'light';
        if (memorise) localStorage.setItem(CLE_THEME, memorise);
        const espion = vi.spyOn(Storage.prototype, 'setItem');
        try {
          const service = TestBed.inject(ThemeService);
          TestBed.tick();
          expect(service.theme()).toBe('light');
          expect(service.themeApplique()).toBe('light');
          expect(document.documentElement.className).toBe('light');
          expect(document.documentElement.style.colorScheme).toBe('');
          expect(espion).not.toHaveBeenCalled();
        } finally {
          espion.mockRestore();
        }
      });
    }

    it('aucune classe (autonome avant le script) : retombe sur le stockage', () => {
      localStorage.setItem(CLE_THEME, 'light');
      const service = TestBed.inject(ThemeService);
      TestBed.tick();
      expect(service.theme()).toBe('light');
    });

    it('les deux classes au démarrage : ambigu, retombe sur le stockage', () => {
      document.documentElement.className = 'light dark';
      localStorage.setItem(CLE_THEME, 'dark');
      const service = TestBed.inject(ThemeService);
      TestBed.tick();
      expect(service.theme()).toBe('dark');
      expect([...document.documentElement.classList].sort()).toEqual(['dark', 'light']);
    });

    it("un thème posé par l'hôte n'est jamais réécrit sur <html> (classes et color-scheme)", () => {
      document.documentElement.className = 'light';
      TestBed.inject(ThemeService);
      TestBed.tick();
      expect(document.documentElement.style.colorScheme).toBe('');
    });
  });

  it("une bascule de l'utilisateur écrit classe, color-scheme et stockage, une seule fois", () => {
    const espion = vi.spyOn(Storage.prototype, 'setItem');
    try {
      const service = TestBed.inject(ThemeService);
      TestBed.tick(); // démarrage autonome : classe et color-scheme posés, rien mémorisé
      espion.mockClear();
      service.basculer();
      TestBed.tick();
      expect(document.documentElement.className).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('light');
      expect(espion).toHaveBeenCalledTimes(1);
    } finally {
      espion.mockRestore();
    }
  });
});
