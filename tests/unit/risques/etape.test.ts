/**
 * Les quatre étapes du parcours, et la lecture des liens qui portaient les
 * trois anciens onglets.
 *
 * ── POURQUOI LES ALIAS SONT TESTÉS UN PAR UN ──────────────────────────────
 *
 * Un lien partagé est la seule chose du module qui vive HORS du dépôt : dans
 * un message, un ticket, un courriel. On ne peut pas le corriger après coup.
 * Un alias perdu renvoie silencieusement son lecteur sur la première étape, et
 * personne ne saura jamais que la vue partagée n'était pas celle-là.
 */
import { describe, it, expect } from 'vitest';
import {
  ETAPES, ETAPES_HERITEES, LIBELLE_ETAPE, rangEtape, etapeRenseignee,
  type Etape,
} from '@/lib/risques/etape';
import { PROFIL_DEFAUT, type ProfilRayons } from '@/lib/risques/profil';

const parcours = {
  gravites: ['seveso_haut', 'seveso_bas'],
  profil: PROFIL_DEFAUT,
  chemin: [] as string[],
  jeu: null as string | null,
};

describe('ETAPES', () => {
  it('porte les cinq etapes du parcours, dans l ordre', () => {
    expect(ETAPES).toEqual(['sites', 'rayon', 'couverture', 'zones', 'campagne']);
  });

  it('numerote a partir de l ordre du tableau, jamais a la main', () => {
    expect(ETAPES.map(rangEtape)).toEqual([1, 2, 3, 4, 5]);
  });

  it('donne un libelle a chacune', () => {
    // Un libellé manquant rendrait `undefined` dans le fil d'Ariane, ce qui
    // s'affiche mais ne se lit pas.
    for (const e of ETAPES) expect(LIBELLE_ETAPE[e]).toBeTruthy();
  });
});

describe('ETAPES_HERITEES', () => {
  it.each([
    ['rayons', 'rayon'],
    ['territoires', 'couverture'],
    ['zones', 'zones'],
    ['diffusion', 'zones'],
  ] as [string, Etape][])('un lien portant onglet=%s ouvre %s', (ancien, attendu) => {
    expect(ETAPES_HERITEES[ancien]).toBe(attendu);
  });

  it('ne perd pas l alias diffusion, deja herite avant celui-ci', () => {
    // `diffusion` était un alias vers `zones` depuis le 2026-09-20. Introduire
    // une nouvelle génération d'alias ne doit pas casser la précédente, sinon
    // les liens les plus anciens sont les premiers perdus.
    expect(ETAPES_HERITEES.diffusion).toBe('zones');
  });

  it('ne resout rien pour une valeur inconnue', () => {
    expect(ETAPES_HERITEES.nimportequoi).toBeUndefined();
  });
});

describe('etapeRenseignee', () => {
  it('sites : vraie des qu un regime est retenu', () => {
    expect(etapeRenseignee('sites', parcours)).toBe(true);
    expect(etapeRenseignee('sites', { ...parcours, gravites: [] })).toBe(false);
  });

  it('rayon : vraie des qu un anneau existe, sur n importe quel niveau', () => {
    expect(etapeRenseignee('rayon', parcours)).toBe(true);
    const sansAnneau: ProfilRayons = {
      haut: [], bas: [], autres: [], lie: false, inclurePPRT: true,
    };
    expect(etapeRenseignee('rayon', { ...parcours, profil: sansAnneau })).toBe(false);
  });

  it('rayon : un anneau sur le seul niveau bas suffit', () => {
    const basSeul: ProfilRayons = {
      haut: [], bas: [500], autres: [], lie: false, inclurePPRT: true,
    };
    expect(etapeRenseignee('rayon', { ...parcours, profil: basSeul })).toBe(true);
  });

  it('couverture : vraie seulement si on est descendu dans un territoire', () => {
    // C'est une LECTURE : son seul choix propre est le territoire regardé. La
    // marquer sur l'arrivée d'un résultat ferait clignoter le fil d'Ariane à
    // chaque recalcul, et un résultat n'est pas un choix.
    expect(etapeRenseignee('couverture', parcours)).toBe(false);
    expect(etapeRenseignee('couverture', { ...parcours, chemin: ['13'] })).toBe(true);
  });

  it('zones : vraie seulement pour un jeu ENREGISTRE', () => {
    expect(etapeRenseignee('zones', parcours)).toBe(false);
    expect(etapeRenseignee('zones', { ...parcours, jeu: 'abc' })).toBe(true);
  });

  it('campagne : vraie seulement quand une campagne a ete simulee', () => {
    expect(etapeRenseignee('campagne', parcours)).toBe(false);
    expect(etapeRenseignee('campagne', { ...parcours, jeu: 'abc' })).toBe(false);
    expect(etapeRenseignee('campagne', { ...parcours, jeu: 'abc', simulation: true })).toBe(true);
  });
});
