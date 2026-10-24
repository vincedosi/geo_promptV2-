/**
 * La conversion d'une zone dans une maille (lot 5, T5) : la logique PURE que le serveur rejoue à l'extraction et
 * qu'Angular recopiera (T9, test de parité). Ce qu'elle doit dire, toujours : ce que la traduction perd.
 *
 * La fixture `fixtures/couverture-composite-cp.json` est la réponse de `couverture_geometrie` (découpage `cp`, cible
 * `ind`) sur la zone « Cible composite (2 zones) » (`919ca65d…`), tirée de la base locale le 24/10 : 895 CP touchés,
 * 11 224 929 habitants. Ce sont les `lignes` de la mesure M2 du plan.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  MESSAGES_CONVERSION, appliquerSeuil, estRetenue, exactitude, mailleParDefaut, resumeExact, verifierLimites,
} from '@/lib/zones/conversion';
import { MESSAGES_REFUS_COUVERTURE } from '@/lib/zones/couverture';
import { MAILLES, type PlateformeGeo } from '@/lib/zones/plateformes';
import type { LigneCouverture } from '@/lib/zones/couverture';
import type { Recette } from '@/lib/zones/recette';

type LigneFixture = Pick<LigneCouverture, 'code' | 'nom' | 'pop_en_zone' | 'pop_totale' | 'part'>;
const composite = JSON.parse(readFileSync('tests/unit/zones/fixtures/couverture-composite-cp.json', 'utf8')) as {
  population: number; hors_territoire: { population: number }; lignes: LigneFixture[];
};

/**
 * `manques` comparé à une grandeur calculée À PART, par un autre chemin : les habitants de la zone dans les CP écartés
 * (part NULL ou sous le seuil) + ceux qu'aucun CP ne porte (`hors_territoire.population`, rendu par la RPC).
 *
 * Les deux ne sont égaux qu'aux arrondis près : la RPC arrondit à l'entier CHAQUE `pop_en_zone`, `population` et
 * `hors_territoire.population` (sql/275, `round(d.p)`, `round(v_pop)`, `round(v_hors_p)`), alors que les populations
 * de carreaux sont fractionnaires (des demi-habitants). Écart au plus ½ par terme arrondi : ½ × (lignes + 2).
 */
function verifierManques(r: ReturnType<typeof appliquerSeuil>, seuil: number) {
  const ecartees = composite.lignes.filter((l) => l.part === null || l.part < seuil).reduce((t, l) => t + l.pop_en_zone, 0);
  const attendu = ecartees + composite.hors_territoire.population;
  expect(Math.abs(r.manques - attendu)).toBeLessThanOrEqual((r.n_touchees + 2) / 2);
  return r.manques - attendu;
}

describe('appliquerSeuil — la maille CP de la composite (mesure M2)', () => {
  const pop = composite.population;

  it('seuil 20 : 617 CP sur 895, 57,6 % d’utile, 7 541 431 achetés hors zone', () => {
    const r = appliquerSeuil(composite.lignes, pop, 20);
    expect(r).toMatchObject({ n_unites: 617, n_touchees: 895, taux_utile: 57.6, hors_zone: 7_541_431 });
    // M2 : 977 538 habitants manqués DANS les CP écartés ; s'y ajoutent les 3 273 qu'aucun CP ne porte.
    expect(composite.lignes.filter((l) => l.part === null || l.part < 20).reduce((t, l) => t + l.pop_en_zone, 0)).toBe(977_538);
    expect(composite.hors_territoire.population).toBe(3_273);
    // −230 : mesuré en base le 24/10, Σ round(pop_en_zone) = 11 221 886 contre Σ pop_en_zone brute = 11 221 655,5 —
    // les demi-habitants arrondis vers le haut, CP par CP. Même écart à tout seuil : il ne dépend que de l'arrondi.
    expect(verifierManques(r, 20)).toBe(-230);
    expect(r.manques).toBe(980_581);
  });

  it('seuil 0 : tout est retenu, seul le hors-territoire est manqué (à l’arrondi près)', () => {
    const r = appliquerSeuil(composite.lignes, pop, 0);
    expect(r).toMatchObject({ n_unites: 895, n_touchees: 895, taux_utile: 40.8, hors_zone: 16_305_578 });
    expect(verifierManques(r, 0)).toBe(-230);
  });

  it('seuil 50 : 358 CP, 76,6 %', () => {
    const r = appliquerSeuil(composite.lignes, pop, 50);
    expect(r).toMatchObject({ n_unites: 358, taux_utile: 76.6, hors_zone: 2_302_112 });
    expect(verifierManques(r, 50)).toBe(-230);
  });

  it('un CP entièrement dans la zone vaut 100 % et n’achète rien hors zone', () => {
    const r = appliquerSeuil([{ pop_en_zone: 500, pop_totale: 500, part: 100 }], 500, 20);
    expect(r).toEqual({ exacte: false, n_unites: 1, n_touchees: 1, couverte: 500, achetee: 500, manques: 0, hors_zone: 0, taux_utile: 100 });
  });
});

describe('appliquerSeuil — cas limites', () => {
  it('une part NULL n’est jamais retenue, même au seuil 0, mais compte comme touchée et manquée', () => {
    const r = appliquerSeuil([
      { pop_en_zone: 300, pop_totale: 1000, part: 30 },
      { pop_en_zone: 200, pop_totale: null, part: null },
    ], 500, 0);
    expect(r).toEqual({ exacte: false, n_unites: 1, n_touchees: 2, couverte: 300, achetee: 1000, manques: 200, hors_zone: 700, taux_utile: 30 });
  });

  it('aucune unité retenue : taux d’utile null (pas 0 : rien n’est acheté), tout est manqué', () => {
    const r = appliquerSeuil([{ pop_en_zone: 10, pop_totale: 1000, part: 1 }], 10, 20);
    expect(r).toEqual({ exacte: false, n_unites: 0, n_touchees: 1, couverte: 0, achetee: 0, manques: 10, hors_zone: 0, taux_utile: null });
  });

  it('aucune ligne : zone sans territoire', () => {
    expect(appliquerSeuil([], 0, 20)).toEqual({ exacte: false, n_unites: 0, n_touchees: 0, couverte: 0, achetee: 0, manques: 0, hors_zone: 0, taux_utile: null });
  });

  it('la borne appartient aux retenues (part ≥ seuil)', () => {
    expect(appliquerSeuil([{ pop_en_zone: 20, pop_totale: 100, part: 20 }], 20, 20).n_unites).toBe(1);
  });
});

describe('resumeExact — une maille exacte ne calcule rien', () => {
  it('zéro perte, tout acheté est dans la zone', () => {
    expect(resumeExact(12_345, 67.8)).toEqual({
      exacte: true, n_unites: 1, population: 12_345, surface_km2: 67.8, couverte: 12_345, achetee: 12_345, manques: 0, hors_zone: 0, taux_utile: 100,
    });
  });
  it('une liste de codes postaux exacte compte ses unités (une par code)', () => {
    expect(resumeExact(100, 2, 4).n_unites).toBe(4);
  });
});

describe('estRetenue — la règle du seuil, une seule fois', () => {
  it('la borne est retenue ; une part NULL ne l’est jamais', () => {
    expect(estRetenue({ part: 20 }, 20)).toBe(true);
    expect(estRetenue({ part: 19.9 }, 20)).toBe(false);
    expect(estRetenue({ part: null }, 0)).toBe(false);
  });
});

describe('MESSAGES_CONVERSION — les refus de paver_cercles en français', () => {
  it('un message par refus de la RPC (sql/276), en français, sans limite écrite', () => {
    expect(Object.keys(MESSAGES_CONVERSION).sort()).toEqual([
      'couverture_non_construite', 'cible_inconnue', 'trop_de_candidates', 'trop_de_cercles', 'zone_introuvable', 'zone_trop_vaste',
    ].sort());
    for (const m of Object.values(MESSAGES_CONVERSION)) {
      expect(m).toMatch(/^[A-ZÉ]/);
      expect(m).not.toMatch(/\d/);
    }
  });
  it('les refus communs avec la couverture disent la même chose (copie verrouillée : ce module n’importe que des types)', () => {
    for (const k of ['zone_introuvable', 'cible_inconnue', 'couverture_non_construite'] as const) {
      expect(MESSAGES_CONVERSION[k], k).toBe(MESSAGES_REFUS_COUVERTURE[k]);
    }
  });
});

// Une recette valide de chaque type (formes de `RecetteSchema`).
const PERIM = { type: 'departement', code: '13' } as const;
const RECETTES: Record<Recette['type'], Recette> = {
  rayon_point: { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 10_000 },
  rayon_poi: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 2_000, perimetre: PERIM },
  seuil_carreaux: { v: 1, type: 'seuil_carreaux', indicateur: 'densite_ind', operateur: '>=', seuil: 5, perimetre: PERIM },
  seuil_territoire: { v: 1, type: 'seuil_territoire', indicateur: 'revenu', operateur: '>=', seuil: 5, perimetre: PERIM },
  codes_postaux: { v: 1, type: 'codes_postaux', codes: ['13001', '13002'] },
  dessin: { v: 1, type: 'dessin' },
  import: { v: 1, type: 'import', format: 'geojson', fichier: 'a.geojson' },
  isochrone: { v: 1, type: 'isochrone', parametres: { minutes: 15 } },
  combinaison: { v: 1, type: 'combinaison', operation: 'union', zones: ['a', 'b'] },
  capture: { v: 1, type: 'capture', source_type: 'iris' },
};

describe('exactitude — dix recettes × six mailles (A-6)', () => {
  // Le polygone est exact pour toute recette ; hors de lui, ces deux cases seulement.
  const EXACTES = new Set(['codes_postaux.cp', 'rayon_point.cercle']);
  for (const [type, recette] of Object.entries(RECETTES)) {
    for (const maille of MAILLES) {
      const attendu = EXACTES.has(`${type}.${maille}`) || maille === 'polygone' ? 'exacte' : 'calculee';
      it(`${type} × ${maille} → ${attendu}`, () => expect(exactitude(recette, maille)).toBe(attendu));
    }
  }
});

/** Une ligne de `plateformes_geo` ; les limites des tests sont arbitraires (jamais celles de la seed). */
function ligne(p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo {
  return {
    libelle: p.maille, natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14',
    a_verifier: false, note: null, ordre: 0, ...p,
  };
}

describe('exactitude — un cercle n’est exact que dans les bornes de rayon de la plateforme', () => {
  const p = ligne({ plateforme: 'meta', maille: 'cercle', limites: { rayon_min_m: 2_500, rayon_max_m: 40_000 } });
  const point = (rayon_m: number): Recette => ({ ...RECETTES.rayon_point, rayon_m } as Recette);
  it('dans les bornes (bornes comprises)', () => {
    expect(exactitude(point(2_500), 'cercle', p)).toBe('exacte');
    expect(exactitude(point(40_000), 'cercle', p)).toBe('exacte');
  });
  it('trop petit ou trop grand : la zone se pave, la perte se calcule', () => {
    expect(exactitude(point(2_499), 'cercle', p)).toBe('calculee');
    expect(exactitude(point(40_001), 'cercle', p)).toBe('calculee');
  });
  it('sans borne connue : exact', () => {
    expect(exactitude(point(7), 'cercle', ligne({ plateforme: 'ttd', maille: 'cercle' }))).toBe('exacte');
  });
});

describe('mailleParDefaut (A-4)', () => {
  const lignes: PlateformeGeo[] = [
    ligne({ plateforme: 'dv360', maille: 'cp' }),
    ligne({ plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 2_500 } }),
    ligne({ plateforme: 'dv360', maille: 'polygone', natif: false, disponible: false }),
    ligne({ plateforme: 'ttd', maille: 'cp', a_verifier: true }),
    ligne({ plateforme: 'ttd', maille: 'polygone', a_verifier: true }),
    ligne({ plateforme: 'meta', maille: 'cp', a_verifier: true }),
    ligne({ plateforme: 'meta', maille: 'cercle' }),
    ligne({ plateforme: 'tiktok', maille: 'departement' }),
    ligne({ plateforme: 'tiktok', maille: 'commune', a_verifier: true }),
    ligne({ plateforme: 'tiktok', maille: 'cp', natif: false, disponible: false }),
  ];
  it('la plus fine des natives non « à vérifier »', () => {
    expect(mailleParDefaut(lignes, 'dv360', RECETTES.dessin)).toBe('cp');
    expect(mailleParDefaut(lignes, 'meta', RECETTES.dessin)).toBe('cercle');
    expect(mailleParDefaut(lignes, 'tiktok', RECETTES.dessin)).toBe('departement');
  });
  it('toutes « à vérifier » : la plus fine quand même (polygone pour TTD)', () => {
    expect(mailleParDefaut(lignes, 'ttd', RECETTES.dessin)).toBe('polygone');
  });
  it('une maille exacte mais « à vérifier » ne passe pas devant une maille sûre', () => {
    const ttd = [ligne({ plateforme: 'ttd', maille: 'cercle', a_verifier: true }), ligne({ plateforme: 'ttd', maille: 'cp' })];
    expect(exactitude(RECETTES.rayon_point, 'cercle', ttd[0])).toBe('exacte');
    expect(mailleParDefaut(ttd, 'ttd', RECETTES.rayon_point)).toBe('cp');
  });
  it('parmi les mailles sûres, une maille exacte pour la recette passe devant une plus fine', () => {
    expect(mailleParDefaut(lignes, 'dv360', RECETTES.rayon_point)).toBe('cercle');
    // Rayon sous la borne de la plateforme : le cercle n'est plus exact, la plus fine reprend la main.
    expect(mailleParDefaut(lignes, 'dv360', { ...RECETTES.rayon_point, rayon_m: 1_000 } as Recette)).toBe('cp');
  });
  it('une maille indisponible ou non native n’est jamais proposée ; aucune ligne : null', () => {
    expect(mailleParDefaut(lignes.filter((l) => l.maille === 'polygone'), 'dv360', RECETTES.dessin)).toBeNull();
    expect(mailleParDefaut([], 'meta', RECETTES.dessin)).toBeNull();
  });
});

describe('verifierLimites — lit les limites de la ligne, n’en écrit aucune', () => {
  const resume = appliquerSeuil([{ pop_en_zone: 40, pop_totale: 60, part: 66.7 }, { pop_en_zone: 30, pop_totale: 30, part: 100 }], 70, 20);
  it('dans les limites : aucun avertissement ; aucune limite : aucun', () => {
    expect(verifierLimites(resume, ligne({ plateforme: 'tiktok', maille: 'commune', limites: { max_unites: 2, pop_min_groupe: 90 } }))).toEqual([]);
    expect(verifierLimites(resume, ligne({ plateforme: 'ttd', maille: 'cp' }))).toEqual([]);
  });
  it('trop d’unités et groupe trop petit : deux avertissements chiffrés', () => {
    expect(verifierLimites(resume, ligne({ plateforme: 'tiktok', maille: 'commune', limites: { max_unites: 1, pop_min_groupe: 91 } }))).toEqual([
      { code: 'max_unites', limite: 1, valeur: 2 },
      { code: 'pop_min_groupe', limite: 91, valeur: 90 },
    ]);
  });
  it('une maille exacte compte aussi ses unités : une liste de CP plus longue que max_unites avertit', () => {
    expect(verifierLimites(resumeExact(500, 3, 4), ligne({ plateforme: 'meta', maille: 'cp', limites: { max_unites: 3 } })))
      .toEqual([{ code: 'max_unites', limite: 3, valeur: 4 }]);
    expect(verifierLimites(resumeExact(500, 3, 3), ligne({ plateforme: 'meta', maille: 'cp', limites: { max_unites: 3 } }))).toEqual([]);
  });
  it('une maille exacte : le groupe est la zone entière', () => {
    expect(verifierLimites(resumeExact(50, 1), ligne({ plateforme: 'tiktok', maille: 'commune', limites: { pop_min_groupe: 51 } })))
      .toEqual([{ code: 'pop_min_groupe', limite: 51, valeur: 50 }]);
  });
});

describe('les règles des plateformes vivent dans plateformes_geo', () => {
  // Le code seul (commentaires retirés) : une limite écrite en dur est un nombre de la seed comparé, affecté ou pris
  // par défaut — pas l'arrondi `* 1000` du taux d'utile.
  // `conversion.ts` (pur) et `conversion-serveur.ts` (lecture des règles et appel de `paver_cercles`, T8).
  const code = ['lib/zones/conversion.ts', 'lib/zones/conversion-serveur.ts']
    .map((f) => readFileSync(f, 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const OP = String.raw`(?:<=?|>=?|===?|!==?|\?\?|\|\||:|=)`;
  const enContexte = (n: string) => new RegExp(String.raw`${OP}\s*${n}(?![\d_])|(?<![\d_])${n}\s*${OP}`);
  it('aucun nombre de la seed en contexte de limite dans lib/zones/conversion*.ts', () => {
    for (const n of ['200', '80000', '80_000', '3000', '3_000', '50000', '50_000', '1000', '1_000']) {
      expect(code, n).not.toMatch(enContexte(n));
    }
  });
  it('aucune clé de limite reçoit un nombre écrit', () => {
    expect(code).not.toMatch(/(max_unites|rayon_min_m|rayon_max_m|pop_min_unite|pop_min_groupe|max_sommets)\s*(?:<=?|>=?|===?|!==?|\?\?|\|\||:|=)\s*\d/);
  });
  it('le contrôle mord : une limite écrite en dur serait vue', () => {
    expect('if (n > 200)').toMatch(enContexte('200'));
    expect('const MAX = 3_000;').toMatch(enContexte('3_000'));
    expect('Math.round(x * 1000) / 10').not.toMatch(enContexte('1000'));
    expect('max_unites ?? 3000').toMatch(/max_unites\s*\?\?\s*\d/);
  });
});
