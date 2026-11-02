import {
  DIVISEUR_RAYON_SURFACE, PAS_RAYON_M, RAYON_PAR_DEFAUT_M, rayonDefautExplique, lireModeJeu, parametresDe, SEUIL_PAR_DEFAUT, ecrireMailles, lireMailles, lireParametresJeu, lireVersion, memesParametres, rayonParDefaut,
} from './mailles-url';

describe('?mailles= (A-10)', () => {
  it('lit le format du plan : CP, polygone, cercle avec rayon, commune', () => {
    expect(lireMailles('dv360.cp.20,ttd.polygone,meta.cercle.10000.20,tiktok.departement.20')).toEqual({
      dv360: { maille: 'cp', seuil: 20 },
      ttd: { maille: 'polygone', seuil: SEUIL_PAR_DEFAUT },
      meta: { maille: 'cercle', seuil: 20, rayon_m: 10000 },
      tiktok: { maille: 'departement', seuil: 20 },
    });
  });
  it('n’importe quoi → défauts (aucun choix), sans lever', () => {
    expect(lireMailles('n importe quoi')).toEqual({});
    expect(lireMailles(null)).toEqual({});
    expect(lireMailles(undefined)).toEqual({});
    expect(lireMailles('')).toEqual({});
    expect(lireMailles(',,,.')).toEqual({});
  });
  it('une entrée illisible est écartée seule, les autres restent', () => {
    expect(lireMailles('dv360.cp.20,inconnue.cp.20,ttd.hexagone.20,meta.cercle.20,tiktok.commune.150')).toEqual({
      dv360: { maille: 'cp', seuil: 20 },
    });
  });
  it('un cercle exige un rayon entier positif ; une autre maille n’en porte pas', () => {
    expect(lireMailles('meta.cercle.0.20')).toEqual({});
    expect(lireMailles('meta.cercle.1500.5.2.0')).toEqual({});
    expect(lireMailles('meta.cercle.20')).toEqual({});
    expect(lireMailles('dv360.cp.5000.20')).toEqual({});
    expect(lireMailles('meta.cercle.12000.12.5')).toEqual({ meta: { maille: 'cercle', seuil: 12.5, rayon_m: 12000 } });
  });
  it('seuil hors de [0, 100] ou non numérique : écarté ; une plateforme en double : la première gagne', () => {
    expect(lireMailles('dv360.cp.-1,ttd.cp.abc,meta.cp.,tiktok.commune.1e2')).toEqual({});
    expect(lireMailles('dv360.cp.12.5')).toEqual({ dv360: { maille: 'cp', seuil: 12.5 } });
    expect(lireMailles('dv360.cp.0,dv360.cp.50')).toEqual({ dv360: { maille: 'cp', seuil: 0 } });
  });
  it('écrit dans l’ordre des plateformes ; le polygone sans seuil ; rien → null', () => {
    expect(ecrireMailles({
      tiktok: { maille: 'departement', seuil: 20 }, meta: { maille: 'cercle', seuil: 20, rayon_m: 10000 },
      ttd: { maille: 'polygone', seuil: 35 }, dv360: { maille: 'cp', seuil: 20 },
    })).toBe('dv360.cp.20,ttd.polygone,meta.cercle.10000.20,tiktok.departement.20');
    expect(ecrireMailles({})).toBeNull();
  });
  it('aller-retour : ce qui s’écrit se relit à l’identique', () => {
    const choix = { dv360: { maille: 'cp' as const, seuil: 12.5 }, meta: { maille: 'cercle' as const, seuil: 0, rayon_m: 2500 } };
    expect(lireMailles(ecrireMailles(choix))).toEqual(choix);
  });
});

describe('?x= : la version d’une extraction', () => {
  it('un entier positif, sinon null', () => {
    expect(lireVersion('3')).toBe(3);
    for (const v of ['0', '-1', '1.5', 'abc', '', null, undefined, '2a']) expect(lireVersion(v)).toBeNull();
  });
});

describe('rayon proposé à une plateforme en cercle', () => {
  const bornes = { limites: { rayon_min_m: 2000, rayon_max_m: 30000 } };
  it('celui de la recette, ramené dans les bornes de la ligne', () => {
    expect(rayonParDefaut(bornes, { v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 20000 })).toBe(20000);
    expect(rayonParDefaut(bornes, { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 500, perimetre: null })).toBe(2000);
    expect(rayonParDefaut(bornes, { v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 90000 })).toBe(30000);
  });
  it('sans rayon dans la recette : le défaut d’écran ; sans borne : tel quel', () => {
    expect(rayonParDefaut({ limites: {} }, { v: 1, type: 'dessin' })).toBe(RAYON_PAR_DEFAUT_M);
    expect(rayonParDefaut(undefined, null)).toBe(RAYON_PAR_DEFAUT_M);
    expect(rayonParDefaut({ limites: { rayon_min_m: 15000 } }, null)).toBe(15000);
  });
});

describe('B10 : rayon par défaut tiré de la surface de la zone', () => {
  const meta = { limites: { rayon_min_m: 1000, rayon_max_m: 80000 } };
  const dessin = { v: 1, type: 'dessin' } as const;
  it('zone de 20 km² sur Meta : √(20 / π) / 3 ≈ 0,84 km, ramené au minimum de Meta (1 km), dit', () => {
    const d = rayonDefautExplique(meta, dessin, 20);
    expect(d).toEqual({ rayon_m: 1000, source: 'surface', calcule_m: 840, surface_km2: 20, borne: 'rayon_min_m' });
    expect(rayonParDefaut(meta, dessin, 20)).toBe(1000);
  });
  it('zone de 30 000 km² : ≈ 32,6 km, au pas de la réglette (32,5 km), sans borne', () => {
    const d = rayonDefautExplique(meta, dessin, 30000);
    expect(d).toEqual({ rayon_m: 32500, source: 'surface', calcule_m: 32570, surface_km2: 30000 });
    expect(d.rayon_m % PAS_RAYON_M).toBe(0);
    expect(DIVISEUR_RAYON_SURFACE).toBe(3);
  });
  it('zone plus vaste que le maximum : ramenée au maximum, dit', () => {
    expect(rayonDefautExplique(meta, dessin, 550000)).toMatchObject({ rayon_m: 80000, borne: 'rayon_max_m' });
  });
  it('le rayon de la recette l’emporte sur la surface (son ajustement est dit par avertissementsRayon, B8)', () => {
    expect(rayonDefautExplique(meta, { v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 500 }, 20))
      .toEqual({ rayon_m: 1000, source: 'recette', calcule_m: 500, borne: 'rayon_min_m' });
  });
  it('surface inconnue : le repli d’écran (10 km), dit', () => {
    expect(rayonDefautExplique(meta, dessin, null)).toEqual({ rayon_m: RAYON_PAR_DEFAUT_M, source: 'repli', calcule_m: RAYON_PAR_DEFAUT_M });
    expect(rayonDefautExplique(meta, dessin, 0).source).toBe('repli');
  });
  it('une ligne sans borne : jamais sous un pas de réglette', () => {
    expect(rayonDefautExplique({ limites: {} }, dessin, 0.01).rayon_m).toBe(PAS_RAYON_M);
  });
});

describe('les quatre paramètres bruts', () => {
  it('lus tels quels (absent = null), comparés clé à clé', () => {
    const url = new URLSearchParams('zoneJeu=z&mailles=dv360.cp.20&etape=jeu');
    const p = lireParametresJeu(url);
    expect(p).toEqual({ zoneJeu: 'z', jeu: null, mailles: 'dv360.cp.20', x: null, cibleJeu: null, modeJeu: null });
    expect(memesParametres(p, { ...p })).toBe(true);
    expect(memesParametres(p, { ...p, x: '1' })).toBe(false);
  });
});

describe('?mailles= — la maille pays (⑤ finitions, T4)', () => {
  it('`dv360.pays` se lit et s’écrit sans seuil, comme le polygone (exacte) ; avec un seuil, il est admis', () => {
    expect(lireMailles('dv360.pays')).toEqual({ dv360: { maille: 'pays', seuil: SEUIL_PAR_DEFAUT } });
    expect(lireMailles('dv360.pays.30')).toEqual({ dv360: { maille: 'pays', seuil: 30 } });
    expect(ecrireMailles({ dv360: { maille: 'pays', seuil: 20 }, meta: { maille: 'cp', seuil: 20 } })).toBe('dv360.pays,meta.cp.20');
  });
});

describe('?cibleJeu= et ?modeJeu= (⑤ finitions, T5, Q-5)', () => {
  it('écrits avec une zone seulement, hors défauts ; jamais avec un jeu (il les porte)', () => {
    // ARB-2 (ticket A1) : le défaut d'un jeu de zone est exclusif — c'est pondéré qui s'écrit.
    const avant = { cible: 'jeunes_15_29', mode: 'pondere' } as const;
    expect(parametresDe(null, 'z', {}, null, avant)).toMatchObject({ cibleJeu: 'jeunes_15_29', modeJeu: 'pondere' });
    expect(parametresDe('j', 'z', {}, null, avant)).toMatchObject({ cibleJeu: null, modeJeu: null });
    expect(parametresDe(null, null, {}, null, avant)).toMatchObject({ cibleJeu: null, modeJeu: null });
    expect(parametresDe(null, 'z', {}, null, { cible: 'ind', mode: 'exclusif' })).toMatchObject({ cibleJeu: null, modeJeu: null });
  });
  it('le mode : un des modes de plan, sinon null, sans lever', () => {
    expect(lireModeJeu('exclusif')).toBe('exclusif');
    for (const v of ['zz', '', null, undefined]) expect(lireModeJeu(v)).toBeNull();
  });
});
