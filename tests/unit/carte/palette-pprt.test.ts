import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COULEURS_PPRT, JETONS_PPRT, couleursPprt } from '@/lib/carte/palette-pprt';

/**
 * Même garde-fou que `palette-sequentielle-css.test.ts` : les couleurs du
 * périmètre PPRT sont écrites DEUX fois — jetons CSS pour le DOM, littéraux
 * pour MapLibre, qui ne résout pas `var()` dans `paint` — et ce test est la
 * seule chose qui empêche les deux copies de diverger. On lit le VRAI fichier
 * CSS, on ne simule pas son contenu.
 */

const CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

/**
 * Rend le bloc du sélecteur qui porte réellement les jetons `--pprt-*`.
 * `html.light` apparaît plusieurs fois dans globals.css : prendre le premier
 * bloc venu attraperait celui qui ne déclare que `color-scheme`.
 */
function blocPorteurDeJetons(selecteur: string): string {
  const blocs: string[] = [];
  let i = 0;
  while ((i = CSS.indexOf(selecteur, i)) !== -1) {
    const debut = CSS.indexOf('{', i);
    if (debut === -1) break;
    const fin = CSS.indexOf('}', debut);
    if (fin === -1) break;
    blocs.push(CSS.slice(debut, fin));
    i = debut + 1;
  }
  const bloc = blocs.find((b) => b.includes('--pprt-'));
  if (!bloc) throw new Error(`aucun bloc « ${selecteur} » ne porte de jeton --pprt-*`);
  return bloc;
}

/** Les valeurs sont en `rgba(...)`, pas en hex : les espaces sont normalisés. */
function valeurDuJeton(bloc: string, nom: string): string | null {
  const m = bloc.match(new RegExp(`${nom}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim().replace(/\s+/g, '') : null;
}

describe('correspondance entre les jetons CSS et la palette PPRT de MapLibre', () => {
  it.each([
    [':root', 'dark'],
    ['html.light', 'light'],
  ] as const)('le bloc %s vaut COULEURS_PPRT.%s, jeton par jeton', (selecteur, theme) => {
    const bloc = blocPorteurDeJetons(selecteur);
    expect(valeurDuJeton(bloc, '--pprt-contour')).toBe(
      COULEURS_PPRT[theme].contour.replace(/\s+/g, ''),
    );
    expect(valeurDuJeton(bloc, '--pprt-fond')).toBe(
      COULEURS_PPRT[theme].fond.replace(/\s+/g, ''),
    );
  });

  it.each([':root', 'html.light'])('aucun jeton PPRT ne manque dans %s', (selecteur) => {
    const bloc = blocPorteurDeJetons(selecteur);
    const manquants = JETONS_PPRT.filter((nom) => valeurDuJeton(bloc, nom) === null);
    expect(manquants, `jetons absents de « ${selecteur} »`).toEqual([]);
  });

  it('la palette est ACHROMATIQUE dans les deux themes', () => {
    // C'est la decision de conception, pas un detail : la couleur de cette
    // carte porte le TYPE DE RISQUE. Un perimetre reglementaire qui prendrait
    // une teinte entrerait en concurrence avec les quatre de palette-risques,
    // et un lecteur chercherait « de quel risque » elle parle.
    for (const theme of ['dark', 'light'] as const) {
      for (const valeur of [COULEURS_PPRT[theme].contour, COULEURS_PPRT[theme].fond]) {
        const m = valeur.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        expect(m, `${valeur} n'est pas un rgba() analysable`).not.toBeNull();
        const [r, g, b] = [Number(m![1]), Number(m![2]), Number(m![3])];
        expect([r === g, g === b], `${theme} : ${valeur} a une teinte`).toEqual([true, true]);
      }
    }
  });

  it("n'emprunte aucune couleur de palette-risques", async () => {
    // Un garde-fou d'intention : si quelqu'un remplace un jour le gris par une
    // teinte, qu'au moins ce ne soit pas l'une des quatre du type de risque.
    const { COULEURS_MAPLIBRE } = await import('@/lib/carte/palette-risques');
    const risques = new Set(
      (['dark', 'light'] as const).flatMap((t) =>
        Object.values(COULEURS_MAPLIBRE[t]).map((c) => c.toLowerCase()),
      ),
    );
    for (const theme of ['dark', 'light'] as const) {
      expect(risques.has(COULEURS_PPRT[theme].contour.toLowerCase())).toBe(false);
      expect(risques.has(COULEURS_PPRT[theme].fond.toLowerCase())).toBe(false);
    }
  });

  it('couleursPprt rend bien le theme demande', () => {
    expect(couleursPprt('dark')).toBe(COULEURS_PPRT.dark);
    expect(couleursPprt('light')).toBe(COULEURS_PPRT.light);
    expect(couleursPprt('dark')).not.toEqual(couleursPprt('light'));
  });
});
