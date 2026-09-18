import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verrou sur le tracé de la mini-carte de France.
 *
 * ── LE DÉFAUT ─────────────────────────────────────────────────────────────
 *
 * `versChemin()` ne traitait que `Polygon` et `MultiPolygon`. Or
 * `get_zone_polygons('departement')` rend **66 `GeometryCollection` sur 104**
 * (mesure en production le 2026-09-18), dont Paris, le Rhône, les
 * Bouches-du-Rhône et le Nord.
 *
 * Une collection porte `geometries`, jamais `coordinates`. La garde
 * `!Array.isArray(g.coordinates)` rendait donc une chaîne vide, et ces 66
 * départements n'étaient pas dessinés du tout.
 *
 * ── POURQUOI PERSONNE NE L'A VU ───────────────────────────────────────────
 *
 * Le symptôme ment. Un département non dessiné laisse voir le fond de page,
 * donc du BLANC — à l'œil, indiscernable d'une unité sans donnée, qui est
 * grise et bel et bien tracée. Le défaut se lisait donc comme « il manque des
 * sites », une piste de données, alors que c'était un défaut de rendu.
 *
 * Aucune erreur, aucun avertissement : `versChemin` est écrite pour tolérer
 * une géométrie absente plutôt que de faire tomber toute la carte. Cette
 * tolérance, nécessaire, est exactement ce qui a rendu le défaut silencieux.
 *
 * ── CE QUE CE TEST VÉRIFIE ────────────────────────────────────────────────
 *
 * Il lit le SOURCE du composant. Un test de rendu aurait exigé un DOM et une
 * fixture de géométrie ; ce qu'on veut garantir est plus simple et plus
 * durable : que les trois types que la base émet soient nommés dans le code.
 */

const SOURCE = readFileSync(
  join(process.cwd(), 'components/risques/CarteMiniFrance.tsx'),
  'utf-8',
);

describe('mini-carte de France — les trois types de géométrie', () => {
  it('traite GeometryCollection — 66 départements sur 104 en sont une', () => {
    expect(SOURCE).toMatch(/g\.type === 'GeometryCollection'/);
    // Et elle descend dans `geometries`, le seul champ qu'une collection porte.
    expect(SOURCE).toMatch(/g\.geometries/);
  });

  it('descend récursivement plutôt que de traiter un seul niveau', () => {
    // GeoJSON n'interdit pas une collection dans une collection. Un `.map` sur
    // `versChemin` elle-même couvre le cas sans le supposer absent.
    expect(SOURCE).toMatch(/g\.geometries\.map\(versChemin\)/);
  });

  it('traite toujours Polygon et MultiPolygon', () => {
    expect(SOURCE).toMatch(/g\.type === 'Polygon'/);
    expect(SOURCE).toContain('MultiPolygon');
  });

  it('ne lève jamais sur une géométrie absente ou malformée', () => {
    // Une seule feature sans coordonnées faisait tomber TOUT le composant dans
    // son ErrorBoundary, donc toute la carte, pour un département manquant.
    expect(SOURCE).toMatch(/if \(!g\) return '';/);
    expect(SOURCE).toMatch(/Array\.isArray\(g\.coordinates\)/);
  });
});

describe('mini-carte de France — ce que la couleur dit', () => {
  it('peint une unité sans valeur en `--donnee-absente`, jamais en bas de rampe', () => {
    // « Pas de site ici » et « peu de population exposée » ne doivent pas se
    // ressembler. Deux départements de métropole sont dans ce cas — les
    // Hautes-Alpes et la Lozère, tous deux à 0 site Seveso.
    expect(SOURCE).toContain("var(--donnee-absente)");
  });

  it('la légende NOMME la couleur du vide', () => {
    // Sans cette ligne, un département gris se lit « peu exposé ».
    expect(SOURCE).toContain('aucune exposition');
  });

  it('reçoit sa palette de l’appelant, sans rampe figée', () => {
    // Le catalogue est celui des carreaux et des IRIS : une seconde façon de
    // choisir une palette dans le même produit serait un dialecte de plus.
    expect(SOURCE).toMatch(/stops: string\[\]/);
    expect(SOURCE).not.toContain('RAMPE_SEQUENTIELLE');
  });
});
