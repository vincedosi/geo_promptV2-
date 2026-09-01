import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveCssRgb } from '@/app/map/_hooks/useMapMarkers';

/**
 * Regression : la couleur de heatmap POI etait parsee comme un hex alors que
 * son fallback est devenu un token du design system (`var(--brand-teal)`),
 * produisant `rgba(10,NaN,-11,0)` — MapLibre rejetait toute l'expression et la
 * heatmap restait bleue.
 */
describe('resolveCssRgb', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /** L'env de test est `node` : on simule :root et getComputedStyle. */
  function stubRootTokens(tokens: Record<string, string>) {
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => tokens[name] ?? '',
    }));
  }

  it('parse un hex 6 caractères', () => {
    expect(resolveCssRgb('#4ecdc4')).toEqual({ r: 78, g: 205, b: 196 });
  });

  it('parse un hex 3 caractères', () => {
    expect(resolveCssRgb('#0af')).toEqual({ r: 0, g: 170, b: 255 });
  });

  it('parse un rgb() et un rgba()', () => {
    expect(resolveCssRgb('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(resolveCssRgb('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('résout un token du design system sur :root', () => {
    stubRootTokens({ '--brand-teal': ' #4ecdc4 ' });
    expect(resolveCssRgb('var(--brand-teal)')).toEqual({ r: 78, g: 205, b: 196 });
  });

  it('renvoie null sur un token introuvable — pas de composante NaN', () => {
    stubRootTokens({});
    expect(resolveCssRgb('var(--inexistant)')).toBeNull();
  });

  it('renvoie null hors navigateur (pas de document)', () => {
    expect(resolveCssRgb('var(--brand-teal)')).toBeNull();
  });

  it('renvoie null sur une valeur non reconnue', () => {
    expect(resolveCssRgb('cornflowerblue')).toBeNull();
    expect(resolveCssRgb('')).toBeNull();
  });
});
