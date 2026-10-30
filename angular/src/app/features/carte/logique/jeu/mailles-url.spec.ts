import {
  RAYON_PAR_DEFAUT_M, SEUIL_PAR_DEFAUT, ecrireMailles, lireMailles, lireParametresJeu, lireVersion, memesParametres, rayonParDefaut,
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

describe('les quatre paramètres bruts', () => {
  it('lus tels quels (absent = null), comparés clé à clé', () => {
    const url = new URLSearchParams('zoneJeu=z&mailles=dv360.cp.20&etape=jeu');
    const p = lireParametresJeu(url);
    expect(p).toEqual({ zoneJeu: 'z', jeu: null, mailles: 'dv360.cp.20', x: null });
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
