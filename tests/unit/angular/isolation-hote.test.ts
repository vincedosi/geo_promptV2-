/**
 * L'élément hôte de chaque racine d'ombre MAGELIAN (`:host`, angular/src/styles.css)
 * est la SEULE prise que le shell AIDA garde sur MAGELIAN : ses sélecteurs
 * n'entrent pas dans l'ombre, mais ils atteignent l'élément hôte, et tout ce
 * qui s'hérite descend de lui.
 *
 * Deux règles de la cascade décident de ce fichier :
 * - pour des déclarations NORMALES, le contexte EXTÉRIEUR l'emporte sur `:host` :
 *   un `* { font-family: Georgia; color: red }` du shell, qui atteint notre hôte,
 *   bat notre `all: initial` et descend sur tout MAGELIAN (constaté à la revue) ;
 * - pour des déclarations `!important`, c'est l'INVERSE : le contexte intérieur
 *   l'emporte. Les propriétés HÉRITÉES sont donc posées en `!important` sur `:host`.
 * `all` lui-même n'est PAS en `!important` : il couvrirait `display` et `height`,
 * et le shell ne pourrait plus dimensionner le cadre. `display` et `height` restent
 * normaux, exprès.
 *
 * `color-scheme` : `all: initial` le remet à `normal`, donc barres de défilement,
 * champs et remplissage automatique en CLAIR dans le thème sombre. Il est reposé
 * sur `:host` (sombre) et `:host(.light)` (clair) — celui du shell ne gouverne pas
 * MAGELIAN.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(__dirname, '../../..');
const CSS = readFileSync(path.join(RACINE, 'angular', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Les déclarations (propriété → valeur brute, `!important` compris) de la règle dont le sélecteur est EXACTEMENT `selecteur`. */
function regle(selecteur: string): Map<string, string> {
  const sortie = new Map<string, string>();
  let trouvee = false;
  for (const m of CSS.matchAll(/(?<=^|\})\s*([^{}@]+?)\s*\{([^{}]*)\}/g)) {
    if (m[1].trim() !== selecteur) continue;
    trouvee = true;
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) sortie.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
  }
  if (!trouvee) throw new Error(`règle ${selecteur} introuvable dans styles.css`);
  return sortie;
}

const important = (v: string | undefined) => !!v && /!important\s*$/.test(v);

/** Au minimum celles que la revue a nommées ; la règle en porte davantage. */
const HERITEES_MINIMUM = [
  'direction', 'color', 'font-family', 'font-size', 'line-height', 'letter-spacing',
  'color-scheme', 'text-transform', 'text-align', 'cursor', 'word-spacing', 'white-space',
  'font-weight', 'font-style', 'text-indent', 'text-shadow', 'list-style-type',
  // Revue finale du lot AIDA : un `pointer-events: none` du shell (voile de
  // menu, écran de chargement) rendrait MAGELIAN inerte ; la surbrillance au
  // toucher du shell teinterait nos boutons sur mobile.
  'pointer-events', '-webkit-tap-highlight-color',
];

describe(":host — ce que le shell ne peut plus changer dans MAGELIAN", () => {
  const hote = regle(':host');

  it('remet tout à zéro (`all: initial`), en déclaration NORMALE (sinon display/height deviendraient intouchables)', () => {
    expect(hote.get('all')).toBe('initial');
  });

  it.each(HERITEES_MINIMUM)('%s est posée en !important (le contexte intérieur gagne alors)', (propriete) => {
    expect(hote.has(propriete), `${propriete} absente de :host`).toBe(true);
    expect(important(hote.get(propriete)), `${propriete}: ${hote.get(propriete)}`).toBe(true);
  });

  it('display, height et visibility restent NORMAUX : le shell peut dimensionner, masquer ou cacher le cadre', () => {
    expect(hote.get('display')).toBe('block');
    expect(hote.get('height')).toBe('100%');
    // `visibility` s'hérite, mais un shell qui cache un onglet par `visibility: hidden` doit pouvoir le faire.
    expect(hote.has('visibility')).toBe(false);
  });

  it("color-scheme suit le thème de MAGELIAN : sombre sur :host, clair sur :host(.light)", () => {
    expect(hote.get('color-scheme')).toBe('dark !important');
    expect(regle(':host(.light)').get('color-scheme')).toBe('light !important');
  });

  it("aucune propriété personnalisée n'est posée en !important (`all` ne les touche pas ; jetons.css les porte)", () => {
    expect([...hote.keys()].filter((p) => p.startsWith('--'))).toEqual([]);
  });
});
