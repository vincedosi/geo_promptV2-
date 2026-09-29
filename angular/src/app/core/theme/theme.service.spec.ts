import { TestBed } from '@angular/core/testing';
import { CLE_THEME } from './theme';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
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
});
