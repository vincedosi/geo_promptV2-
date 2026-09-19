/**
 * Le verrou entre les couleurs de zones et les jetons du design system.
 *
 * ── POURQUOI DEUX COPIES, ET POURQUOI ELLES DOIVENT CONCORDER ────────────
 *
 * MapLibre ne résout pas `var()` dans `paint` : une couleur y arrive en
 * littéral ou ne s'affiche pas. Le DOM, lui, lit les jetons pour suivre la
 * bascule de thème. Les deux copies sont donc nécessaires — et c'est
 * exactement pour cela qu'elles peuvent diverger sans bruit : la carte
 * continuerait de peindre l'ancienne teinte pendant que la légende afficherait
 * la nouvelle, et rien ne l'indiquerait.
 *
 * Même verrou que `tests/unit/campagne/palette-divergente.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COULEUR_NIVEAU,
  COULEUR_NIVEAU_CSS,
  OPACITE_BANDE,
  OPACITE_PPRT,
  opaciteDeClasse,
  expressionCouleurNiveau,
  expressionOpaciteBande,
} from '@/lib/carte/palette-zones-risque';
import { NIVEAUX, ANNEAUX_MAX } from '@/lib/risques/profil';

const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

/**
 * Lit la valeur d'un jeton dans un bloc donné de `globals.css`.
 *
 * Le fichier porte les deux thèmes ; chercher le jeton partout rendrait la
 * PREMIÈRE occurrence, donc toujours celle du thème sombre, et le thème clair
 * ne serait jamais vérifié.
 */
function jeton(nom: string, theme: 'dark' | 'light'): string | null {
  const depart = theme === 'dark' ? css.indexOf(':root {') : css.indexOf('html.light');
  if (depart === -1) return null;
  const bloc = css.slice(depart, theme === 'dark' ? css.indexOf('html.light') : undefined);
  const m = bloc.match(new RegExp(`--${nom}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

describe('les teintes MapLibre concordent avec les jetons CSS', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const niveau of NIVEAUX) {
      it(`--niveau-${niveau} (${theme})`, () => {
        const attendu = jeton(`niveau-${niveau}`, theme);
        expect(
          attendu,
          `--niveau-${niveau} est absent du bloc ${theme} de app/globals.css. `
          + `Le DOM afficherait alors un fond transparent, sans erreur console.`,
        ).not.toBeNull();
        expect(
          COULEUR_NIVEAU[theme][niveau].toLowerCase(),
          `La carte peindrait ${COULEUR_NIVEAU[theme][niveau]} pendant que la légende `
          + `afficherait ${attendu}.`,
        ).toBe((attendu ?? '').toLowerCase());
      });
    }
  }

  it('la table CSS pointe sur les jetons, jamais sur des hex', () => {
    // Un hex en dur ici ne suivrait pas la bascule de thème : la légende
    // garderait la teinte sombre sur fond blanc.
    for (const niveau of NIVEAUX) {
      expect(COULEUR_NIVEAU_CSS[niveau]).toBe(`var(--niveau-${niveau})`);
    }
  });
});

describe('opaciteDeClasse', () => {
  it('le perimetre PPRT est le plus opaque de tous', () => {
    // C'est la seule zone qui ne vient pas d'un rayon que nous avons choisi.
    // Elle doit se distinguer AVANT qu'on lise la légende.
    expect(OPACITE_PPRT).toBeGreaterThan(Math.max(...OPACITE_BANDE));
    expect(opaciteDeClasse('pprt')).toBe(OPACITE_PPRT);
  });

  it('l opacite decroit du coeur vers l exterieur', () => {
    for (let i = 1; i < OPACITE_BANDE.length; i += 1) {
      expect(OPACITE_BANDE[i]).toBeLessThan(OPACITE_BANDE[i - 1]);
    }
  });

  it('couvre exactement le nombre maximal d anneaux', () => {
    // Une bande sans opacité propre retomberait sur celle de sa voisine et
    // deviendrait indistinguable.
    expect(OPACITE_BANDE).toHaveLength(ANNEAUX_MAX);
  });

  it('plafonne au-dela du dernier palier plutot que de rendre undefined', () => {
    expect(opaciteDeClasse(9)).toBe(OPACITE_BANDE[OPACITE_BANDE.length - 1]);
    expect(opaciteDeClasse(0)).toBe(OPACITE_BANDE[0]);
  });
});

describe('les expressions MapLibre', () => {
  it('la couleur couvre tous les niveaux et porte un defaut', () => {
    const e = expressionCouleurNiveau('dark');
    expect(e[0]).toBe('match');
    for (const n of NIVEAUX) expect(e).toContain(n);
    // Le dernier élément d'un `match` MapLibre est la valeur par défaut. Sans
    // elle, une feature dont `niveau` serait inattendu ne serait PAS peinte —
    // invisible, donc indiscernable d'une zone absente.
    expect(typeof e[e.length - 1]).toBe('string');
  });

  it('l opacite distingue le PPRT par l ABSENCE de bande, pas par un zero', () => {
    // sql/205 écrit `bande = NULL` pour un périmètre. Une sentinelle numérique
    // finirait par être lue comme une bande.
    const e = expressionOpaciteBande();
    expect(JSON.stringify(e)).toContain('null');
    expect(e[2]).toBe(OPACITE_PPRT);
  });
});
