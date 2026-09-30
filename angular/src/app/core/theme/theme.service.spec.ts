import { TestBed } from '@angular/core/testing';
import { CLE_THEME } from './theme';
import { ECRIRE_HTML, ThemeService } from './theme.service';

// Lancement AUTONOME (`app.config.ts` fournit ECRIRE_HTML = true) : règle de
// propriété de la tâche 5, inchangée. Le cas de l'hôte est plus bas.
describe('ThemeService en autonome (ECRIRE_HTML = true)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: ECRIRE_HTML, useValue: true }] });
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

    it("bascule PUIS l'hôte retire toute classe avant l'effect : l'hôte gagne, rien n'est réécrit ni mémorisé", async () => {
      const service = TestBed.inject(ThemeService);
      TestBed.tick(); // démarrage autonome : classe dark et color-scheme posés
      const schema = document.documentElement.style.colorScheme;
      service.basculer(); // drapeau d'écriture armé, effect pas encore passé
      document.documentElement.classList.remove('dark');
      await Promise.resolve(); // l'observateur voit l'absence de classe -> dark
      TestBed.tick();
      expect(service.theme()).toBe('dark');
      expect(document.documentElement.className).toBe('');
      expect(document.documentElement.style.colorScheme).toBe(schema);
      // Le geste de l'utilisateur a été supplanté avant de prendre effet : non mémorisé.
      expect(localStorage.getItem(CLE_THEME)).toBeNull();
    });

    it("bascule PUIS l'hôte pose les deux classes avant l'effect : classes de l'hôte intactes", async () => {
      const service = TestBed.inject(ThemeService);
      TestBed.tick();
      service.basculer();
      document.documentElement.classList.add('light'); // dark + light
      await Promise.resolve();
      TestBed.tick();
      expect([...document.documentElement.classList].sort()).toEqual(['dark', 'light']);
      expect(service.theme()).toBe('light');
      expect(localStorage.getItem(CLE_THEME)).toBeNull();
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

    it("aucune classe au démarrage, puis l'hôte en pose une avant le premier effect : elle est respectée", async () => {
      const service = TestBed.inject(ThemeService); // drapeau armé, effect pas encore passé
      document.documentElement.classList.add('light');
      await Promise.resolve();
      TestBed.tick();
      expect(document.documentElement.className).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('');
      expect(service.theme()).toBe('light');
    });

    it("aucune classe au démarrage, puis l'hôte pose les deux avant le premier effect : intactes", async () => {
      TestBed.inject(ThemeService);
      document.documentElement.classList.add('light', 'dark');
      await Promise.resolve();
      TestBed.tick();
      expect([...document.documentElement.classList].sort()).toEqual(['dark', 'light']);
      expect(document.documentElement.style.colorScheme).toBe('');
    });

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

  describe("racines d'ombre : la classe est recopiée sur NOTRE hôte (`:host(.light)`)", () => {
    const racine = () => document.createElement('mg-racine-distante');

    it("à l'enregistrement, l'hôte reçoit aussitôt la classe du thème appliqué", () => {
      document.documentElement.className = 'light';
      const theme = TestBed.inject(ThemeService);
      TestBed.tick();
      const el = racine();
      theme.enregistrerRacine(el);
      expect(el.className).toBe('light');
      expect(theme.racine()).toBe(el);
    });

    it("suit une bascule de l'utilisateur", () => {
      const theme = TestBed.inject(ThemeService);
      TestBed.tick();
      const el = racine();
      theme.enregistrerRacine(el);
      expect(el.className).toBe('dark');
      theme.basculer();
      TestBed.tick();
      expect(el.className).toBe('light');
    });

    it("suit un changement EXTERNE de la classe de <html> (le shell), sans écrire <html>", async () => {
      document.documentElement.className = 'dark';
      const theme = TestBed.inject(ThemeService);
      TestBed.tick();
      const el = racine();
      theme.enregistrerRacine(el);
      document.documentElement.classList.replace('dark', 'light');
      await Promise.resolve(); // MutationObserver
      expect(el.className).toBe('light');
      TestBed.tick();
      // Règle de propriété intacte : c'est la classe de l'hôte, MAGELIAN n'a rien réécrit.
      expect(document.documentElement.className).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('');
      expect(localStorage.getItem(CLE_THEME)).toBeNull();
    });

    it("désenregistrée, elle n'est plus suivie et `racine()` retombe sur la précédente", () => {
      const theme = TestBed.inject(ThemeService);
      TestBed.tick();
      const a = racine();
      const b = racine();
      theme.enregistrerRacine(a);
      const retirerB = theme.enregistrerRacine(b);
      expect(theme.racine()).toBe(b);
      retirerB();
      expect(theme.racine()).toBe(a);
      theme.basculer();
      TestBed.tick();
      expect(a.className).toBe('light');
      expect(b.className).toBe('dark');
    });

    it("n'écrit <html> que dans les deux cas de la règle, racine enregistrée ou non", () => {
      document.documentElement.className = 'dark';
      const theme = TestBed.inject(ThemeService);
      theme.enregistrerRacine(racine());
      TestBed.tick();
      expect(document.documentElement.style.colorScheme).toBe(''); // l'hôte a tranché : rien écrit au démarrage
    });
  });
});

/**
 * I1 (revue finale du lot AIDA) : dans un hôte, `ECRIRE_HTML` vaut son défaut
 * racine `false` — MAGELIAN n'écrit JAMAIS le `<html>` du shell, ni classe ni
 * `color-scheme`, ni au démarrage ni sur `basculer()`. Le thème ne vit que sur
 * NOS racines d'ombre (`:host(.light)`) et dans le stockage.
 */
describe("ThemeService dans un hôte (ECRIRE_HTML par défaut : false)", () => {
  const racine = () => document.createElement('mg-racine-distante');

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
  });

  it("hôte sans classe : <html> intact (classe ET style), racines dans le thème stocké", () => {
    localStorage.setItem(CLE_THEME, 'light');
    const theme = TestBed.inject(ThemeService);
    const el = racine();
    theme.enregistrerRacine(el);
    TestBed.tick();
    expect(document.documentElement.className).toBe('');
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(theme.theme()).toBe('light');
    expect(theme.themeApplique()).toBe('light');
    expect(el.className).toBe('light');
  });

  it("hôte sans classe, stockage vide : racines en sombre, <html> intact", () => {
    const theme = TestBed.inject(ThemeService);
    const el = racine();
    theme.enregistrerRacine(el);
    TestBed.tick();
    expect(document.documentElement.className).toBe('');
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(el.className).toBe('dark');
  });

  it("hôte sans classe + bascule : <html> intact, racines basculées, stockage écrit", async () => {
    const theme = TestBed.inject(ThemeService);
    const el = racine();
    theme.enregistrerRacine(el);
    TestBed.tick();
    theme.basculer();
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();
    expect(document.documentElement.className).toBe('');
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(theme.theme()).toBe('light');
    expect(theme.themeApplique()).toBe('light');
    expect(el.className).toBe('light');
    expect(localStorage.getItem(CLE_THEME)).toBe('light');
  });

  it("hôte avec classe : la classe est suivie (démarrage puis changement), jamais réécrite", async () => {
    document.documentElement.className = 'light';
    const theme = TestBed.inject(ThemeService);
    const el = racine();
    theme.enregistrerRacine(el);
    TestBed.tick();
    expect(theme.theme()).toBe('light');
    expect(el.className).toBe('light');
    document.documentElement.classList.replace('light', 'dark');
    await Promise.resolve();
    TestBed.tick();
    expect(theme.theme()).toBe('dark');
    expect(el.className).toBe('dark');
    expect(document.documentElement.className).toBe('dark');
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(localStorage.getItem(CLE_THEME)).toBeNull();
  });

  it("hôte avec classe + bascule : <html> garde la classe de l'hôte, seules nos racines basculent", async () => {
    document.documentElement.className = 'light';
    const theme = TestBed.inject(ThemeService);
    const el = racine();
    theme.enregistrerRacine(el);
    TestBed.tick();
    theme.basculer();
    TestBed.tick();
    await Promise.resolve();
    TestBed.tick();
    expect(document.documentElement.className).toBe('light');
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(theme.theme()).toBe('dark');
    expect(el.className).toBe('dark');
    expect(localStorage.getItem(CLE_THEME)).toBe('dark');
  });

  it("une mutation de <html> qui ne change PAS le thème exprimé par l'hôte ne défait pas la bascule", async () => {
    const theme = TestBed.inject(ThemeService);
    const el = racine();
    theme.enregistrerRacine(el);
    TestBed.tick();
    theme.basculer(); // -> clair, <html> toujours sans classe
    TestBed.tick();
    document.documentElement.classList.add('menu-ouvert'); // classe étrangère au thème
    await Promise.resolve();
    TestBed.tick();
    expect(theme.theme()).toBe('light');
    expect(el.className).toBe('light');
    expect(document.documentElement.className).toBe('menu-ouvert');
  });

  it("l'hôte retire sa classe : il n'exprime plus de thème, on garde le nôtre sans rien écrire", async () => {
    document.documentElement.className = 'light';
    const theme = TestBed.inject(ThemeService);
    const el = racine();
    theme.enregistrerRacine(el);
    TestBed.tick();
    document.documentElement.classList.remove('light');
    await Promise.resolve();
    TestBed.tick();
    expect(theme.theme()).toBe('light');
    expect(el.className).toBe('light');
    expect(document.documentElement.className).toBe('');
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });
});
