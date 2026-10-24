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
  appliquerSeuil, exactitude, mailleParDefaut, resumeExact, verifierLimites,
} from '@/lib/zones/conversion';
import { MAILLES, type PlateformeGeo } from '@/lib/zones/plateformes';
import type { LigneCouverture } from '@/lib/zones/couverture';
import type { Recette } from '@/lib/zones/recette';

type LigneFixture = Pick<LigneCouverture, 'code' | 'nom' | 'pop_en_zone' | 'pop_totale' | 'part'>;
const composite = JSON.parse(readFileSync('tests/unit/zones/fixtures/couverture-composite-cp.json', 'utf8')) as {
  population: number; lignes: LigneFixture[];
};

/** Les deux égalités de la perte honnête (Review Focus 1), aux arrondis des sommes `numeric` près. */
function verifierConservation(r: ReturnType<typeof appliquerSeuil>, population: number) {
  expect(r.manques + r.couverte).toBeCloseTo(population, 6);
  expect(r.hors_zone + r.couverte).toBeCloseTo(r.achetee, 6);
}

describe('appliquerSeuil — la maille CP de la composite (mesure M2)', () => {
  const pop = composite.population;
  // La population hors de tout territoire (carreaux sans CP) : M2 la tenait à part, la règle la compte comme manquée.
  const horsTerritoire = pop - composite.lignes.reduce((t, l) => t + l.pop_en_zone, 0);

  it('seuil 20 : 617 CP sur 895, 57,6 % d’utile, 7 541 431 achetés hors zone', () => {
    const r = appliquerSeuil(composite.lignes, pop, 20);
    expect(r).toMatchObject({ n_unites: 617, n_touchees: 895, taux_utile: 57.6, hors_zone: 7_541_431 });
    // M2 : 977 538 habitants manqués DANS les CP non retenus ; s'y ajoutent ceux qu'aucun CP ne porte.
    expect(horsTerritoire).toBe(3_043);
    expect(r.manques).toBe(977_538 + horsTerritoire);
    verifierConservation(r, pop);
  });

  it('seuil 0 : tout est retenu, seul le hors-territoire est manqué', () => {
    const r = appliquerSeuil(composite.lignes, pop, 0);
    expect(r).toMatchObject({ n_unites: 895, n_touchees: 895, taux_utile: 40.8, hors_zone: 16_305_578, manques: horsTerritoire });
    verifierConservation(r, pop);
  });

  it('seuil 50 : 358 CP, 76,6 %', () => {
    const r = appliquerSeuil(composite.lignes, pop, 50);
    expect(r).toMatchObject({ n_unites: 358, taux_utile: 76.6, hors_zone: 2_302_112 });
    verifierConservation(r, pop);
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
      exacte: true, population: 12_345, surface_km2: 67.8, couverte: 12_345, achetee: 12_345, manques: 0, hors_zone: 0, taux_utile: 100,
    });
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
  // Les seules cases exactes ; toutes les autres sont calculées.
  const EXACTES = new Set(['*.polygone', 'codes_postaux.cp', 'rayon_point.cercle']);
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
  it('une maille exacte pour la recette passe devant', () => {
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
  it('une maille exacte : le groupe est la zone entière', () => {
    expect(verifierLimites(resumeExact(50, 1), ligne({ plateforme: 'tiktok', maille: 'commune', limites: { pop_min_groupe: 51 } })))
      .toEqual([{ code: 'pop_min_groupe', limite: 51, valeur: 50 }]);
  });
});

describe('les règles des plateformes vivent dans plateformes_geo', () => {
  it('aucun nombre de la seed dans lib/zones/conversion.ts', () => {
    const source = readFileSync('lib/zones/conversion.ts', 'utf8');
    for (const n of ['200', '80000', '80_000', '3000', '3_000', '50000', '50_000', '1000', '1_000']) {
      expect(source, n).not.toMatch(new RegExp(`(^|[^\\d_])${n}([^\\d_]|$)`));
    }
  });
});
