/**
 * Le signal de chargement mutualisé de l'écran de risque.
 *
 * Le critère d'acceptation du lot est comportemental — « en changeant un
 * filtre, la barre apparaît immédiatement, les KPI sont grisés » — et il se
 * vérifie à l'écran. Ce qui se teste ici est la RÈGLE qui le décide : ce qui
 * rend la barre visible, et ce qui distingue un écran vide d'un écran dont
 * les chiffres viennent de périmer.
 */
import { describe, it, expect } from 'vitest';
import { agregerChargement, estPerime, type Piste } from '@/lib/risques/chargement';

const piste = (cle: string, libelle: string, actif: boolean): Piste => ({ cle, libelle, actif });

describe('agregerChargement', () => {
  it('rend inactif quand aucune piste ne charge', () => {
    const c = agregerChargement([piste('a', 'Calcul…', false), piste('b', 'Zones…', false)]);
    expect(c.actif).toBe(false);
    expect(c.texte).toBeNull();
  });

  it('rend inactif sur une liste vide', () => {
    // Un écran qui n'a encore déclaré aucune piste ne doit pas afficher une
    // barre « au cas où » : elle se lirait comme un chargement qui ne finit pas.
    expect(agregerChargement([]).actif).toBe(false);
  });

  it('nomme la piste quand une seule charge', () => {
    const c = agregerChargement([piste('a', 'Calcul de la population…', true)]);
    expect(c.actif).toBe(true);
    expect(c.texte).toBe('Calcul de la population…');
  });

  it('nomme la premiere et COMPTE les autres', () => {
    // Trois phrases à la suite se lisent comme une panne. On en montre une.
    const c = agregerChargement([
      piste('a', 'Calcul de la population…', true),
      piste('b', 'Découpage des zones…', true),
      piste('c', 'Comptage des sites…', true),
    ]);
    expect(c.texte).toBe('Calcul de la population… (+2)');
    expect(c.libelles).toHaveLength(3);
  });

  it('dedoublonne deux pistes au meme libelle', () => {
    // Deux sources peuvent décrire le même travail pour l'utilisateur. Les
    // compter deux fois afficherait « (+1) » sans rien de plus à montrer.
    const c = agregerChargement([
      piste('a', 'Calcul de la population…', true),
      piste('b', 'Calcul de la population…', true),
    ]);
    expect(c.libelles).toEqual(['Calcul de la population…']);
    expect(c.texte).toBe('Calcul de la population…');
  });

  it('garde l ordre de declaration', () => {
    // L'ordre des pistes est celui du parcours : la population avant les
    // zones, les zones avant les sites. Trier alphabétiquement ferait changer
    // la phrase affichée selon les libellés, sans raison lisible.
    const c = agregerChargement([
      piste('z', 'Zones…', true),
      piste('a', 'Population…', true),
    ]);
    expect(c.libelles).toEqual(['Zones…', 'Population…']);
  });

  it('ignore les pistes inactives dans le compte', () => {
    const c = agregerChargement([
      piste('a', 'Population…', true),
      piste('b', 'Zones…', false),
    ]);
    expect(c.texte).toBe('Population…');
  });
});

describe('estPerime', () => {
  it('ne perime rien au tout premier chargement', () => {
    // Rien à l'écran : le griser ne dirait rien de plus que la barre.
    expect(estPerime(true, false)).toBe(false);
  });

  it('perime des chiffres deja affiches pendant un recalcul', () => {
    expect(estPerime(true, true)).toBe(true);
  });

  it('ne perime rien quand plus rien ne charge', () => {
    expect(estPerime(false, true)).toBe(false);
  });
});
