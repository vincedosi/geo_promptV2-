/**
 * La conversion d'une zone dans une maille (lot 5, T5) : la logique PURE que le serveur rejoue à l'extraction et
 * qu'Angular recopiera (T9, test de parité). Ce qu'elle doit dire, toujours : ce que la traduction perd.
 *
 * La fixture `fixtures/couverture-composite-cp.json` est la réponse de `couverture_geometrie` (découpage `cp`, cible
 * `ind`) sur la zone « Cible composite (2 zones) » (`919ca65d…`), tirée de la base locale le 24/10 : 895 CP touchés,
 * 11 224 929 habitants. Ce sont les `lignes` de la mesure M2 du plan. A2 (31/10) : chaque ligne porte `membres`, les
 * codes de son unité (sql/304), tirés de la base le 31/10 — 53 des 895 unités sont des groupes de CP indiscernables.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  MESSAGES_CONVERSION, MESSAGES_MAILLE_SANS_OBJET, NOMS_PAYS, appliquerSeuil, estRetenue, exactitude, mailleParDefaut,
  NOTE_PAYS_A_VERIFIER, avertissementsDisque, mailleSansObjet, paysAVerifier, resumeExact, unitesPays, verifierLimites,
  LIBELLE_POPULATION_INCONNUE, resumePays,
} from '@/lib/zones/conversion';
import { MESSAGES_REFUS_COUVERTURE } from '@/lib/zones/couverture';
import { MAILLES, type PlateformeGeo } from '@/lib/zones/plateformes';
import type { LigneCouverture } from '@/lib/zones/couverture';
import type { Recette } from '@/lib/zones/recette';

type LigneFixture = Pick<LigneCouverture, 'code' | 'nom' | 'pop_en_zone' | 'pop_totale' | 'part' | 'part_brute' | 'membres'>;
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
  const ecartees = composite.lignes.filter((l) => l.part_brute === null || l.part_brute < seuil).reduce((t, l) => t + (l.pop_en_zone ?? 0), 0);
  const attendu = ecartees + composite.hors_territoire.population;
  expect(Math.abs(r.manques - attendu)).toBeLessThanOrEqual((r.n_touchees + 2) / 2);
  return r.manques - attendu;
}

describe('appliquerSeuil — la maille CP de la composite (mesure M2)', () => {
  const pop = composite.population;

  // B11 (31/10) : attendus changés, le seuil compare la part NON arrondie — 06130 (19,993 %), 57230 (19,963 %) et 79180
  // (19,969 %), affichés 20,0 %, sortent : 617 → 614 CP, 57,6 → 57,7 % d'utile, 7 541 431 → 7 489 082 hors zone.
  it('seuil 20 : 614 CP sur 895, 57,7 % d’utile, 7 489 082 achetés hors zone', () => {
    const r = appliquerSeuil(composite.lignes, pop, 20);
    expect(r).toMatchObject({ n_unites: 614, n_touchees: 895, taux_utile: 57.7, hors_zone: 7_489_082 });
    // M2 : 990 615 habitants manqués DANS les CP écartés (977 538 avant B11) ; s'y ajoutent les 3 273 qu'aucun CP ne porte.
    expect(composite.lignes.filter((l) => l.part_brute === null || l.part_brute < 20).reduce((t, l) => t + (l.pop_en_zone ?? 0), 0)).toBe(990_615);
    expect(composite.hors_territoire.population).toBe(3_273);
    // −230 : mesuré en base le 24/10, Σ round(pop_en_zone) = 11 221 886 contre Σ pop_en_zone brute = 11 221 655,5 —
    // les demi-habitants arrondis vers le haut, CP par CP. Même écart à tout seuil : il ne dépend que de l'arrondi.
    expect(verifierManques(r, 20)).toBe(-230);
    expect(r.manques).toBe(993_658);
  });

  it('seuil 0 : tout est retenu, seul le hors-territoire est manqué (à l’arrondi près)', () => {
    const r = appliquerSeuil(composite.lignes, pop, 0);
    expect(r).toMatchObject({ n_unites: 895, n_touchees: 895, taux_utile: 40.8, hors_zone: 16_305_578 });
    expect(verifierManques(r, 0)).toBe(-230);
  });

  // B11 : 31880 (49,965 %, affiché 50,0 %) sort — 358 → 357 CP, 76,6 → 76,7 %, 2 302 112 → 2 297 867 hors zone.
  it('seuil 50 : 357 CP, 76,7 %', () => {
    const r = appliquerSeuil(composite.lignes, pop, 50);
    expect(r).toMatchObject({ n_unites: 357, taux_utile: 76.7, hors_zone: 2_297_867 });
    expect(verifierManques(r, 50)).toBe(-230);
  });

  // A2 (31/10) : attendus AJOUTÉS, rien de changé — les compteurs du bilan sont des UNITÉS (une ligne par groupe de CP
  // indiscernables) ; ce que reçoit la plateforme, ce sont les codes, plus nombreux.
  it.each([[0, 895, 981], [20, 614, 668], [50, 357, 385]])('seuil %i : %i unités retenues, soit %i codes postaux envoyés', (seuil, unites, codes) => {
    const retenues = composite.lignes.filter((l) => estRetenue(l, seuil));
    expect(appliquerSeuil(composite.lignes, pop, seuil).n_unites).toBe(unites);
    expect(retenues.length).toBe(unites);
    expect(retenues.reduce((t, l) => t + (l.membres ?? [l.code]).length, 0)).toBe(codes);
    // A1 : le bilan porte lui-même les codes envoyés (`n_codes`), ce que comptent les limites de la plateforme.
    expect(appliquerSeuil(composite.lignes, pop, seuil).n_codes).toBe(codes);
  });

  // A1 (relecture de A2, M-2) : une limite d'unités se compte en CODES envoyés au CP — 981 codes pour 895 unités.
  it('verifierLimites au CP : la limite compte les codes (981), pas les unités (895)', () => {
    const r = appliquerSeuil(composite.lignes, pop, 0);
    const cp = ligne({ plateforme: 'meta', maille: 'cp', limites: { max_unites: 900 } });
    expect(verifierLimites(r, cp)).toEqual([{ code: 'max_unites', limite: 900, valeur: 981 }]);
  });

  it('chaque ligne nomme ses membres, son code compris ; 53 groupes', () => {
    expect(composite.lignes.every((l) => l.membres?.includes(l.code))).toBe(true);
    expect(composite.lignes.filter((l) => (l.membres?.length ?? 1) > 1).length).toBe(53);
  });

  it('un CP entièrement dans la zone vaut 100 % et n’achète rien hors zone', () => {
    const r = appliquerSeuil([{ pop_en_zone: 500, pop_totale: 500, part: 100, part_brute: 100 }], 500, 20);
    expect(r).toEqual({ exacte: false, n_unites: 1, n_touchees: 1, couverte: 500, achetee: 500, manques: 0, hors_zone: 0, taux_utile: 100 });
  });
});

describe('appliquerSeuil — cas limites', () => {
  it('une part NULL n’est jamais retenue, même au seuil 0, mais compte comme touchée et manquée', () => {
    const r = appliquerSeuil([
      { pop_en_zone: 300, pop_totale: 1000, part: 30, part_brute: 30 },
      { pop_en_zone: 200, pop_totale: null, part: null, part_brute: null },
    ], 500, 0);
    expect(r).toEqual({ exacte: false, n_unites: 1, n_touchees: 2, couverte: 300, achetee: 1000, manques: 200, hors_zone: 700, taux_utile: 30 });
  });

  it('aucune unité retenue : taux d’utile null (pas 0 : rien n’est acheté), tout est manqué', () => {
    const r = appliquerSeuil([{ pop_en_zone: 10, pop_totale: 1000, part: 1, part_brute: 1 }], 10, 20);
    expect(r).toEqual({ exacte: false, n_unites: 0, n_touchees: 1, couverte: 0, achetee: 0, manques: 10, hors_zone: 0, taux_utile: null });
  });

  it('aucune ligne : zone sans territoire', () => {
    expect(appliquerSeuil([], 0, 20)).toEqual({ exacte: false, n_unites: 0, n_touchees: 0, couverte: 0, achetee: 0, manques: 0, hors_zone: 0, taux_utile: null });
  });

  it('la borne appartient aux retenues (part ≥ seuil)', () => {
    expect(appliquerSeuil([{ pop_en_zone: 20, pop_totale: 100, part: 20, part_brute: 20 }], 20, 20).n_unites).toBe(1);
  });

  it('B11 : le seuil compare la part NON arrondie — 19,96 % (affichée 20,0 %) ne passe pas 20 % ; bilan cohérent', () => {
    const r = appliquerSeuil([
      { pop_en_zone: 1996, pop_totale: 10_000, part: 20, part_brute: 19.96 },
      { pop_en_zone: 2000, pop_totale: 10_000, part: 20, part_brute: 20 },
    ], 3996, 20);
    expect(r).toMatchObject({ n_unites: 1, n_touchees: 2, couverte: 2000, achetee: 10_000, manques: 1996 });
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
    // A1 : et ses codes, quand on les donne ; absent sinon (aucun chiffre existant ne change).
    expect(resumeExact(100, 2, 4, 4).n_codes).toBe(4);
    expect('n_codes' in resumeExact(100, 2, 4)).toBe(false);
  });
});

describe('estRetenue — la règle du seuil, une seule fois', () => {
  it('la borne est retenue ; une part NULL ne l’est jamais', () => {
    expect(estRetenue({ part_brute: 20 }, 20)).toBe(true);
    expect(estRetenue({ part_brute: 19.9 }, 20)).toBe(false);
    expect(estRetenue({ part_brute: null }, 0)).toBe(false);
  });
  it('B11 : part 19,96 % et seuil 20 % → non retenue (l’arrondi au dixième, 20,0 %, ne compte plus)', () => {
    expect(estRetenue({ part_brute: 19.96 }, 20)).toBe(false);
  });
  it('B11 : à seuil 0, part 0,02 % (affichée 0,0 %) → retenue ; part 0 → non retenue', () => {
    expect(estRetenue({ part_brute: 0.02 }, 0)).toBe(true);
    expect(estRetenue({ part_brute: 0 }, 0)).toBe(false);
  });
});

describe('A4 (ARB-3) — une unité à population inconnue : retenue si elle est ENTIÈRE dans la zone, jamais au seuil', () => {
  // Une ligne d'un territoire non carroyé (sql/308) : ni population, ni part — `incluse` dit si la zone la contient.
  const inconnue = (incluse: boolean) => ({ pop_en_zone: null, pop_totale: null, part: null, part_brute: null, incluse });
  it('part inconnue et unité entière dans la zone → retenue, QUEL QUE SOIT le seuil (0, 20, 100)', () => {
    for (const seuil of [0, 20, 100]) expect(estRetenue(inconnue(true), seuil)).toBe(true);
  });
  it('part inconnue et unité seulement touchée (ou inclusion non dite) → jamais retenue', () => {
    for (const seuil of [0, 100]) {
      expect(estRetenue(inconnue(false), seuil)).toBe(false);
      expect(estRetenue({ part_brute: null }, seuil)).toBe(false);
    }
  });
  it('part connue : `incluse` ne change rien, le seuil de B11 décide seul', () => {
    expect(estRetenue({ part_brute: 10, incluse: true }, 20)).toBe(false);
    expect(estRetenue({ part_brute: 20, incluse: false }, 20)).toBe(true);
  });
  it('appliquerSeuil : l’unité inconnue est achetée et comptée à part (`n_inconnues`), hors des chiffres d’habitants', () => {
    const connue = { pop_en_zone: 80, pop_totale: 100, part: 80, part_brute: 80 };
    const r = appliquerSeuil([connue, inconnue(true), inconnue(false)], 80, 50);
    expect(r).toEqual({
      exacte: false, n_unites: 2, n_touchees: 3, n_inconnues: 1,
      couverte: 80, achetee: 100, manques: 0, hors_zone: 20, taux_utile: 80,
    });
  });
  it('appliquerSeuil sans unité inconnue retenue : pas de clé `n_inconnues` (le bilan ne change pas de forme)', () => {
    const r = appliquerSeuil([{ pop_en_zone: 80, pop_totale: 100, part: 80, part_brute: 80 }, inconnue(false)], 80, 50);
    expect('n_inconnues' in r).toBe(false);
  });
  it('resumePays : la maille pays d’une zone pays, exacte, compte ses territoires non carroyés', () => {
    const unites = unitesPays(['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'], 1000, [
      { code: '972', pop_en_zone: 100, pop_totale: 100 },
      { code: '974', pop_en_zone: 50, pop_totale: 50 },
      // Les lignes départementales non carroyées (sql/308) : population nulle, jamais 0, et sans effet sur la métropole.
      { code: '971', pop_en_zone: null, pop_totale: null },
      { code: '973', pop_en_zone: null, pop_totale: null },
      { code: '976', pop_en_zone: null, pop_totale: null },
    ]);
    expect(unites.find((u) => u.code === 'FR')!.population).toBe(850);
    expect(unites.filter((u) => u.population === null).map((u) => u.code)).toEqual(['GP', 'GF', 'YT']);
    expect(resumePays(unites, 1000, 5)).toEqual({ ...resumeExact(1000, 5, 6), n_inconnues: 3 });
    expect('n_inconnues' in resumePays(unitesPays(['FR'], 1000, null), 1000, 5)).toBe(false);
  });
  it('le libellé de la ligne séparée du bilan', () => {
    expect(LIBELLE_POPULATION_INCONNUE).toBe('Diffusion à population inconnue');
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
  it('E8 (⑤ finitions) : les clés sont EXACTEMENT les refus que sql/276 écrit — un refus ajouté sans phrase échoue ici', () => {
    const sql = readFileSync('sql/276_paver_cercles.sql', 'utf8');
    const refus = [...new Set([...sql.matchAll(/'refus',\s*'([a-z_]+)'/g)].map((m) => m[1]))].sort();
    expect(refus.length).toBeGreaterThan(0);
    expect(Object.keys(MESSAGES_CONVERSION).sort()).toEqual(refus);
  });
});

describe('MESSAGES_MAILLE_SANS_OBJET — le refus « maille_sans_objet » a ses phrases (E8)', () => {
  it('trois phrases, en français ; celle du découpage trop fin est celle de la couverture (copie verrouillée)', () => {
    expect(Object.keys(MESSAGES_MAILLE_SANS_OBJET).sort()).toEqual(['cercles_pays', 'decoupage_pays', 'pays_hors_zone_nationale']);
    for (const m of Object.values(MESSAGES_MAILLE_SANS_OBJET)) expect(m).toMatch(/^[A-ZÉ].+\.$/);
    expect(MESSAGES_MAILLE_SANS_OBJET.decoupage_pays).toBe(MESSAGES_REFUS_COUVERTURE.decoupage_trop_fin_pays);
  });
});

// Une recette valide de chaque type (formes de `RecetteSchema`).
const PERIM = { type: 'departement', code: '13' } as const;
const RECETTES: Record<Recette['type'], Recette> = {
  // Disque entier en France (`part_retenue` = 1, posée par la base, sql/307) : la seule forme exacte au cercle (A3).
  rayon_point: { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m: 10_000, part_retenue: 1 },
  rayon_poi: { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 2_000, perimetre: PERIM },
  seuil_carreaux: { v: 1, type: 'seuil_carreaux', indicateur: 'densite_ind', operateur: '>=', seuil: 5, perimetre: PERIM },
  seuil_territoire: { v: 1, type: 'seuil_territoire', indicateur: 'revenu', operateur: '>=', seuil: 5, perimetre: PERIM },
  codes_postaux: { v: 1, type: 'codes_postaux', codes: ['13001', '13002'] },
  dessin: { v: 1, type: 'dessin' },
  import: { v: 1, type: 'import', format: 'geojson', fichier: 'a.geojson' },
  isochrone: { v: 1, type: 'isochrone', parametres: { minutes: 15 } },
  combinaison: { v: 1, type: 'combinaison', operation: 'union', zones: ['a', 'b'] },
  capture: { v: 1, type: 'capture', source_type: 'iris' },
  pays: { v: 1, type: 'pays', code: 'METRO' },
};

describe('exactitude — onze recettes × sept mailles (A-6 ; le pays, ⑤ finitions A-4)', () => {
  // Le polygone est exact pour toute recette ; hors de lui, ces trois cases seulement.
  const EXACTES = new Set(['codes_postaux.cp', 'rayon_point.cercle', 'pays.pays']);
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
  });  it('le rayon CHOISI pour la plateforme : absent ou égal à celui de la recette → exact ; différent → calculé', () => {
    expect(exactitude(point(5_000), 'cercle', p, 5_000)).toBe('exacte');
    expect(exactitude(point(5_000), 'cercle', p, undefined)).toBe('exacte');
    expect(exactitude(point(5_000), 'cercle', p, 2_500)).toBe('calculee');
    // Égal mais hors des bornes de la plateforme : toujours calculé.
    expect(exactitude(point(2_000), 'cercle', p, 2_000)).toBe('calculee');
  });
  it('le rayon choisi ne joue que pour le cercle : polygone et CP d’une liste restent exacts', () => {
    expect(exactitude(RECETTES.codes_postaux, 'cp', undefined, 3_000)).toBe('exacte');
    expect(exactitude(RECETTES.dessin, 'polygone', undefined, 3_000)).toBe('exacte');
  });
});

describe('A3 — le cercle d’un rayon autour d’un point n’est exact que si le disque est entier en France', () => {
  const p = ligne({ plateforme: 'meta', maille: 'cercle', limites: { rayon_min_m: 1_000, rayon_max_m: 80_000 } });
  // Mesures de la base locale (sql/307, 31/10) : Strasbourg 20 km → 0,6586 (le reste en Allemagne) ; Clermont 5 km → 1.
  const STRASBOURG: Recette = { v: 1, type: 'rayon_point', lon: 7.7521, lat: 48.5734, rayon_m: 20_000, part_retenue: 0.6586 };
  const CLERMONT: Recette = { v: 1, type: 'rayon_point', lon: 3.087, lat: 45.7772, rayon_m: 5_000, part_retenue: 1 };
  it('Strasbourg 20 km : non exact (perte calculée par le pavage, comme pour les POI) ; Clermont-Ferrand 5 km : exact', () => {
    expect(exactitude(STRASBOURG, 'cercle', p)).toBe('calculee');
    expect(exactitude(STRASBOURG, 'cercle', p, 20_000)).toBe('calculee');
    expect(exactitude(CLERMONT, 'cercle', p)).toBe('exacte');
  });
  it('part inconnue (zone jamais réécrite par la base) : non exact — on ne prétend pas à l’exactitude', () => {
    const { part_retenue: _, ...sansPart } = CLERMONT as Extract<Recette, { type: 'rayon_point' }>;
    void _;
    expect(exactitude(sansPart, 'cercle', p)).toBe('calculee');
  });
  it('0,9999 (perte de 0,01 %) : non exact — seul 1 l’est', () => {
    expect(exactitude({ ...CLERMONT, part_retenue: 0.9999 } as Recette, 'cercle', p)).toBe('calculee');
  });
  it('le polygone reste exact : la forme découpée part telle quelle', () => {
    expect(exactitude(STRASBOURG, 'polygone', p)).toBe('exacte');
  });
  it('la maille par défaut ne préfère plus le cercle d’un disque tronqué', () => {
    const regles = [ligne({ plateforme: 'dv360', maille: 'cp' }), ligne({ plateforme: 'dv360', maille: 'cercle' })];
    expect(mailleParDefaut(regles, 'dv360', CLERMONT)).toBe('cercle');
    expect(mailleParDefaut(regles, 'dv360', STRASBOURG)).toBe('cp');
  });
  it('avertissementsDisque : au cercle, la part en France AVANT/APRÈS (100 % → 65,9 %) ; rien sinon', () => {
    expect(avertissementsDisque(STRASBOURG, 'cercle')).toEqual([{ code: 'disque_hors_france', limite: 100, valeur: 65.9 }]);
    expect(avertissementsDisque(CLERMONT, 'cercle')).toEqual([]);
    expect(avertissementsDisque(STRASBOURG, 'cp')).toEqual([]);
    expect(avertissementsDisque(STRASBOURG, 'polygone')).toEqual([]);
    expect(avertissementsDisque(RECETTES.rayon_poi, 'cercle')).toEqual([]);
    expect(avertissementsDisque(null, 'cercle')).toEqual([]);
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

describe('mailleSansObjet — une seule règle, serveur et écran (⑤ finitions, A-3)', () => {
  const PAYS = RECETTES.pays;
  it('zone pays : cercles et découpages trop fins sans objet, avec leur phrase ; le reste a un sens', () => {
    expect(mailleSansObjet(PAYS, 'cercle')).toBe('Sur toute la France, le ciblage par cercles n’a pas de sens : choisissez le pays.');
    expect(mailleSansObjet(PAYS, 'commune')).toBe(MESSAGES_REFUS_COUVERTURE.decoupage_trop_fin_pays);
    expect(mailleSansObjet(PAYS, 'iris')).toBe(MESSAGES_REFUS_COUVERTURE.decoupage_trop_fin_pays);
    for (const m of ['cp', 'departement', 'polygone', 'pays'] as const) expect(mailleSansObjet(PAYS, m), m).toBeNull();
    expect(mailleSansObjet({ v: 1, type: 'pays', code: 'FR' }, 'cercle')).toBe(MESSAGES_MAILLE_SANS_OBJET.cercles_pays);
  });
  it('toute autre recette (et une recette illisible) : seule la maille pays est sans objet', () => {
    for (const recette of [...Object.values(RECETTES).filter((r) => r.type !== 'pays'), null]) {
      for (const m of MAILLES) {
        const attendu = m === 'pays' ? 'La maille pays ne s’achète que pour une zone nationale.' : null;
        expect(mailleSansObjet(recette, m), `${recette?.type ?? 'null'} × ${m}`).toBe(attendu);
      }
    }
  });
});

describe('le pays : défaut d’une zone nationale, jamais d’une autre (⑤ finitions, A-4)', () => {
  const CODES = { METRO: ['FR'], FR: ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'] };
  const lignes: PlateformeGeo[] = [
    ligne({ plateforme: 'dv360', maille: 'cp' }),
    ligne({ plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 2_500 } }),
    ligne({ plateforme: 'ttd', maille: 'polygone', a_verifier: true }),
    ligne({ plateforme: 'ttd', maille: 'cercle', a_verifier: true }),
    ligne({ plateforme: 'ttd', maille: 'cp', a_verifier: true }),
    ligne({ plateforme: 'meta', maille: 'cercle' }),
    ligne({ plateforme: 'meta', maille: 'cp', a_verifier: true }),
    ligne({ plateforme: 'tiktok', maille: 'departement' }),
    ligne({ plateforme: 'tiktok', maille: 'commune', a_verifier: true }),
  ];
  const pays: PlateformeGeo[] = (['dv360', 'ttd', 'meta', 'tiktok'] as const).map((p) =>
    ligne({ plateforme: p, maille: 'pays', a_verifier: p === 'ttd', codes_pays: CODES }));
  const avecPays = [...lignes, ...pays];
  it('zone pays : les quatre plateformes au pays', () => {
    for (const p of ['dv360', 'ttd', 'meta', 'tiktok'] as const) {
      expect(mailleParDefaut(avecPays, p, RECETTES.pays), p).toBe('pays');
      expect(mailleParDefaut(avecPays, p, { v: 1, type: 'pays', code: 'FR' }), p).toBe('pays');
    }
  });
  it('zone pays sans ligne pays : une maille sans objet n’est jamais le défaut (Meta : pas le cercle)', () => {
    expect(mailleParDefaut(lignes, 'meta', RECETTES.pays)).toBe('cp');
    expect(mailleParDefaut(lignes, 'tiktok', RECETTES.pays)).toBe('departement');
  });
  it('AUCUNE autre recette ne change de défaut quand les lignes pays existent', () => {
    for (const recette of Object.values(RECETTES).filter((r) => r.type !== 'pays')) {
      for (const p of ['dv360', 'ttd', 'meta', 'tiktok'] as const) {
        expect(mailleParDefaut(avecPays, p, recette), `${recette.type} × ${p}`).toBe(mailleParDefaut(lignes, p, recette));
      }
    }
  });
  it('verifierLimites : aucune limite, aucun avertissement', () => {
    expect(verifierLimites(resumeExact(62_528_975, 547_779, 1), pays[0])).toEqual([]);
  });
});

describe('unitesPays — les unités d’une plateforme au pays (⑤ finitions, A-6, E10)', () => {
  const DEPARTEMENTS = [
    { code: '13', pop_en_zone: 2_000_000, pop_totale: 2_000_000, part: 100 },
    { code: '972', pop_en_zone: 306_745, pop_totale: 306_745, part: 100 },
    { code: '974', pop_en_zone: 884_165, pop_totale: 884_165, part: 100 },
  ];
  it('METRO → FR seul, à la population de la zone, sans lire les départements', () => {
    expect(unitesPays(['FR'], 62_528_975, null)).toEqual([{ code: 'FR', nom: 'France', population: 62_528_975 }]);
  });
  it('FR → la métropole (zone moins les DROM peuplés) et chaque DROM par son département ; non carroyé = null', () => {
    expect(unitesPays(['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'], 63_711_780, DEPARTEMENTS)).toEqual([
      { code: 'FR', nom: 'France', population: 63_711_780 - 306_745 - 884_165 },
      { code: 'GP', nom: 'Guadeloupe', population: null },
      { code: 'MQ', nom: 'Martinique', population: 306_745 },
      { code: 'GF', nom: 'Guyane', population: null },
      { code: 'RE', nom: 'La Réunion', population: 884_165 },
      { code: 'YT', nom: 'Mayotte', population: null },
    ]);
  });
  it('un code inconnu de la table des noms garde son code, population inconnue', () => {
    expect(unitesPays(['PM'], 100, DEPARTEMENTS)).toEqual([{ code: 'PM', nom: 'PM', population: null }]);
  });
  it('les six libellés, en français', () => {
    expect(NOMS_PAYS).toEqual({ FR: 'France', GP: 'Guadeloupe', MQ: 'Martinique', GF: 'Guyane', RE: 'La Réunion', YT: 'Mayotte' });
  });
});

describe('verifierLimites — lit les limites de la ligne, n’en écrit aucune', () => {
  const resume = appliquerSeuil([{ pop_en_zone: 40, pop_totale: 60, part: 66.7, part_brute: 66.7 }, { pop_en_zone: 30, pop_totale: 30, part: 100, part_brute: 100 }], 70, 20);
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

describe('paysAVerifier — « à vérifier » propre au code de la recette (relecture 1)', () => {
  const pays = ligne({ plateforme: 'meta', maille: 'pays', pays_a_verifier: ['FR'] });
  it('France entière : à vérifier ; France métropolitaine : rien', () => {
    expect(paysAVerifier({ v: 1, type: 'pays', code: 'FR' }, pays)).toBe(true);
    expect(paysAVerifier({ v: 1, type: 'pays', code: 'METRO' }, pays)).toBe(false);
  });
  it('une autre maille, une autre recette, une ligne sans la colonne : rien', () => {
    expect(paysAVerifier({ v: 1, type: 'pays', code: 'FR' }, ligne({ plateforme: 'meta', maille: 'cp' }))).toBe(false);
    expect(paysAVerifier(RECETTES.dessin, pays)).toBe(false);
    expect(paysAVerifier({ v: 1, type: 'pays', code: 'FR' }, ligne({ plateforme: 'meta', maille: 'pays' }))).toBe(false);
  });
  it('la note dit ce qui n’est pas confirmé, en français', () => {
    expect(NOTE_PAYS_A_VERIFIER).toMatch(/^France entière/);
    expect(NOTE_PAYS_A_VERIFIER).toMatch(/\.$/);
  });
});
