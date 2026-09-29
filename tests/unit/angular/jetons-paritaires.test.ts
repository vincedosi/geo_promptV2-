/**
 * Les jetons MAGELIAN du projet Angular sont ceux de app/globals.css, à la
 * valeur près, dans les deux thèmes.
 *
 * Pendant la cohabitation, un écran Angular est comparé à l'écran React qu'il
 * remplace. Si un gris diffère d'une nuance, la comparaison devient un débat
 * de goût au lieu d'une vérification. Les jetons shadcn/ui (triplets HSL sans
 * fonction, `--background: 0 0% 2%`) sont propres à React et ne sont PAS
 * repris : seules les valeurs qui sont des couleurs ou des longueurs le sont.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(__dirname, '../../..');

/** Les déclarations `--nom: valeur;` du PREMIER bloc qui suit `selecteur {`. */
function bloc(css: string, selecteur: string): Map<string, string> {
  const debut = css.indexOf(`${selecteur} {`);
  if (debut < 0) throw new Error(`bloc ${selecteur} introuvable`);
  let profondeur = 0;
  let fin = debut;
  for (let i = css.indexOf('{', debut); i < css.length; i++) {
    if (css[i] === '{') profondeur++;
    if (css[i] === '}') profondeur--;
    if (profondeur === 0) { fin = i; break; }
  }
  const corps = css.slice(debut, fin).replace(/\/\*[\s\S]*?\*\//g, '');
  const sortie = new Map<string, string>();
  for (const m of corps.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    sortie.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  }
  return sortie;
}

/** Un triplet HSL shadcn (`0 0% 2%`) n'est pas une couleur utilisable seule. */
const estTripletShadcn = (v: string) => /^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/.test(v);

const react = readFileSync(path.join(RACINE, 'app', 'globals.css'), 'utf8');
const angular = readFileSync(path.join(RACINE, 'angular', 'src', 'styles', 'jetons.css'), 'utf8');

describe.each([':root', 'html.light'])('jetons %s', (selecteur) => {
  const source = bloc(react, selecteur);
  const copie = bloc(angular, selecteur);

  it('reprend chaque jeton MAGELIAN de globals.css à la même valeur', () => {
    const ecarts: string[] = [];
    for (const [nom, valeur] of source) {
      if (estTripletShadcn(valeur)) continue;
      if (copie.get(nom) !== valeur) ecarts.push(`${nom}: attendu « ${valeur} », lu « ${copie.get(nom) ?? 'absent'} »`);
    }
    expect(ecarts).toEqual([]);
  });

  it('n\'invente aucun jeton absent de globals.css', () => {
    const inventes = [...copie.keys()].filter((n) => !source.has(n));
    expect(inventes).toEqual([]);
  });
});
