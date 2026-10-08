/**
 * Le logo dentsu affiché est-il bien celui du fichier officiel ?
 *
 * `public/dentsu-logo.svg` est le fichier fourni par dentsu (monochrome noir).
 * Il est recopié EN LIGNE dans deux composants, pour être recolorable par le
 * thème (`currentColor`) : `components/ui/LogoDentsu.tsx` (React) et
 * `angular/src/app/ui/logo/logo.component.ts` (Angular). Une copie qu'on
 * retouche à la main — un tracé raccourci, une lettre « corrigée » — dériverait
 * en silence d'une marque qui ne nous appartient pas. Ce test l'interdit.
 *
 * Il vérifie aussi le favicon, fait du seul premier tracé (le « d »).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const racine = join(__dirname, '..', '..', '..');
const lire = (chemin: string) => readFileSync(join(racine, chemin), 'utf8');

/** Les `d` des tracés, espaces normalisés (le fichier officiel coupe ses lignes). */
const traces = (source: string) =>
  [...source.matchAll(/<path\b[^>]*?\sd="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());

const officiel = traces(lire('public/dentsu-logo.svg'));

describe('logo dentsu — fidélité au fichier officiel', () => {
  it('le fichier officiel porte six tracés, un par lettre', () => {
    expect(officiel).toHaveLength(6);
  });

  it.each([
    ['React', 'components/ui/LogoDentsu.tsx'],
    ['Angular', 'angular/src/app/ui/logo/logo.component.ts'],
  ])('%s recopie les six tracés à l’identique, avec la transformation du fichier', (_, chemin) => {
    const source = lire(chemin);
    expect(traces(source)).toEqual(officiel);
    expect(source).toContain('viewBox="0 0 3840 812"');
    expect(source).toContain('transform="translate(0,812) scale(0.1,-0.1)"');
    expect(source).toContain('fill="currentColor"');
  });

  it.each(['public/dentsu-favicon.svg', 'angular/public/dentsu-favicon.svg'])(
    '%s est le « d » du fichier officiel, inchangé',
    (chemin) => {
      expect(traces(lire(chemin))).toEqual([officiel[0]]);
    },
  );
});
