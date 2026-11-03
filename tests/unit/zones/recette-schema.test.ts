import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { formaterNombre } from '@/lib/format/nombre';
import {
  CAPACITE_SYNCHRONE_POI_RAYON, MAX_CARREAUX_SEUIL, MAX_SOMMETS_FORME, MAX_TERRITOIRES_SEUIL, MESSAGES_REFUS, RAYON_POINT_MAX_M,
  SEUIL_TERRITOIRE_MAX_ABS, type Recette,
} from '@/lib/zones/recette';
import { RecetteSchema, RecetteUnionSchema, lireRecette } from '@/lib/zones/recette-schema';

const PER = { type: 'departement', code: '13' } as const;
const UUID_A = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const UUID_B = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';
const UUID_C = '3f2504e0-4f89-11d3-9a0c-0305e82c3303';
const ANGLAIS = /Expected|Invalid|must be|Unrecognized|Required/;

// Vérification de TYPE (tsc --noEmit) : ce que le schéma laisse passer est une `Recette`, sans cast. Si le type et le
// schéma divergent, c'est la compilation qui échoue, pas un test qui passe au vert.
const sortieEstUneRecette = (x: z.infer<typeof RecetteSchema>): Recette => x;

describe('lireRecette (Zod) — revue de la Task 2', () => {
  it('le type de sortie du schéma est une Recette', () => {
    const r = RecetteSchema.parse({ v: 1, type: 'dessin' });
    expect(sortieEstUneRecette(r).type).toBe('dessin');
  });

  it('accepte une union de trois zones, une différence de deux, une intersection de deux', () => {
    expect(lireRecette({ v: 1, type: 'combinaison', operation: 'union', zones: [UUID_A, UUID_B, UUID_C] }).ok).toBe(true);
    expect(lireRecette({ v: 1, type: 'combinaison', operation: 'difference', zones: [UUID_A, UUID_B] }).ok).toBe(true);
    expect(lireRecette({ v: 1, type: 'combinaison', operation: 'intersection', zones: [UUID_A, UUID_B] }).ok).toBe(true);
  });

  it('C20 : l’intersection admet 2 à 20 zones, comme l’union et la différence', () => {
    const vingt = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    for (const operation of ['union', 'intersection', 'difference'] as const) {
      expect(lireRecette({ v: 1, type: 'combinaison', operation, zones: [UUID_A, UUID_B, UUID_C] }).ok, operation).toBe(true);
      expect(lireRecette({ v: 1, type: 'combinaison', operation, zones: vingt.slice(0, 20) }).ok, operation).toBe(true);
      expect(lireRecette({ v: 1, type: 'combinaison', operation, zones: vingt }).ok, operation).toBe(false);
      expect(lireRecette({ v: 1, type: 'combinaison', operation, zones: [UUID_A] }).ok, operation).toBe(false);
    }
  });

  it('une zone ne figure qu’une fois dans une combinaison', () => {
    const r = lireRecette({ v: 1, type: 'combinaison', operation: 'union', zones: [UUID_A, UUID_B, UUID_A] });
    expect(r).toEqual({ ok: false, message: 'Recette invalide : zones : Une zone ne peut figurer qu’une fois.' });
  });

  it('rayon autour d’un point : borné par RAYON_POINT_MAX_M', () => {
    const point = (rayon_m: number) => ({ v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m });
    expect(lireRecette(point(RAYON_POINT_MAX_M)).ok).toBe(true);
    expect(lireRecette(point(RAYON_POINT_MAX_M + 1)).ok).toBe(false);
  });

  it('B8 (ARB-5) : une recette enregistrée sous 250 m (100 m avant le 31/10) se RELIT — le refus est au calcul, pas à la lecture', () => {
    const point = (rayon_m: number) => ({ v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3, rayon_m });
    const lue = lireRecette(point(100));
    expect(lue.ok && lue.recette.type === 'rayon_point' && lue.recette.rayon_m).toBe(100);
    expect(lireRecette(point(99)).ok).toBe(false);
  });

  it('A3 : rayon autour d’un point — `part_retenue` (posée par la base, sql/307) admise entre 0 et 1, rien au-delà', () => {
    const point = (part_retenue: unknown) => ({ v: 1, type: 'rayon_point', lon: 7.75, lat: 48.57, rayon_m: 20_000, part_retenue });
    expect(lireRecette(point(1)).ok).toBe(true);
    expect(lireRecette(point(0.6586)).ok).toBe(true);
    expect(lireRecette(point(1.01)).ok).toBe(false);
    expect(lireRecette(point(-0.1)).ok).toBe(false);
    expect(lireRecette(point('1')).ok).toBe(false);
    // Réservée au rayon autour d'un point.
    expect(lireRecette({ v: 1, type: 'dessin', part_retenue: 1 }).ok).toBe(false);
  });

  it('seuil sur territoires : fini et borné par SEUIL_TERRITOIRE_MAX_ABS, négatif admis', () => {
    const seuil = (s: number) => ({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: s, perimetre: PER });
    expect(lireRecette(seuil(-12.5)).ok).toBe(true);
    expect(lireRecette(seuil(SEUIL_TERRITOIRE_MAX_ABS)).ok).toBe(true);
    expect(lireRecette(seuil(SEUIL_TERRITOIRE_MAX_ABS + 1)).ok).toBe(false);
    expect(lireRecette(seuil(-SEUIL_TERRITOIRE_MAX_ABS - 1)).ok).toBe(false);
    expect(lireRecette(seuil(1e300)).ok).toBe(false);
  });

  it.each([
    ['version inconnue', { v: 2, type: 'dessin' }],
    ['type inconnu', { v: 1, type: 'pluie' }],
    ['rayon trop grand', { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 60_000, perimetre: PER }],
    ['indicateur hors liste', { v: 1, type: 'seuil_carreaux', indicateur: 'men', operateur: '>=', seuil: 1, perimetre: PER }],
    ['opérateur', { v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>', seuil: 1, perimetre: PER }],
    ['combinaison d’une seule zone', { v: 1, type: 'combinaison', operation: 'union', zones: [UUID_A] }],
    ['zone non UUID dans une combinaison', { v: 1, type: 'combinaison', operation: 'union', zones: [UUID_A, 'abc'] }],
    ['périmètre zone non UUID', { v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m: 500, perimetre: { type: 'zone', code: 'abc' } }],
    ['catégorie hors format', { v: 1, type: 'rayon_poi', categorie: 'Lycée !', rayon_m: 500, perimetre: PER }],
    ['clé en trop', { v: 1, type: 'dessin', geometrie: {} }],
    ['champ manquant', { v: 1, type: 'rayon_point', lon: 5.4, lat: 43.3 }],
    ['seuil infini', { v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: Infinity, perimetre: PER }],
    ['trop de paramètres d’isochrone', { v: 1, type: 'isochrone', parametres: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, i])) }],
    ['pas un objet', 'dessin'],
  ])('refuse : %s, avec un message français — sans un mot d’anglais', (_n, v) => {
    const r = lireRecette(v);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/^Recette invalide : .+\.$/);
      expect(r.message).not.toMatch(ANGLAIS);
      expect(r.message).not.toMatch(/\.\.$/);
    }
  });

  it('seuil sur carreaux : min_menages entier de 0 à 1 000, OBLIGATOIRE (A5 : aucun défaut implicite, sql/310)', () => {
    const c = (extra: Record<string, unknown>) => lireRecette({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: PER, ...extra });
    expect(c({}).ok).toBe(false);
    const onze = c({ min_menages: 11 });
    expect(onze.ok && onze.recette).toMatchObject({ min_menages: 11 });
    expect(c({ min_menages: 0 }).ok).toBe(true);
    expect(c({ min_menages: 1000 }).ok).toBe(true);
    for (const v of [-1, 1001, 2.5, '11', null]) expect(c({ min_menages: v }).ok, String(v)).toBe(false);
  });

  it('capture du score composite : sa provenance (indicateurs, poids, sens, maille, seuil) admise, facultative (V-6, A-6)', () => {
    const c = (extra: Record<string, unknown>) => lireRecette({ v: 1, type: 'capture', source_type: 'score', ...extra });
    expect(c({}).ok).toBe(true);
    const parametres = { indicateurs: [{ code: 'taux_pauvrete', poids: 2, sens: 'croissant' }, { code: 'revenu_median', poids: 1, sens: 'decroissant' }], maille: 'cp', seuil_score: 70 };
    const lue = c({ parametres });
    expect(lue.ok && lue.recette).toEqual({ v: 1, type: 'capture', source_type: 'score', parametres });
    const mauvais = [
      { ...parametres, indicateurs: [] },
      { ...parametres, indicateurs: Array.from({ length: 7 }, (_, i) => ({ code: `i${i}`, poids: 1, sens: 'croissant' })) },
      { ...parametres, indicateurs: [{ code: 'x', poids: 0, sens: 'croissant' }] },
      { ...parametres, indicateurs: [{ code: 'x', poids: 1, sens: 'haut' }] },
      { ...parametres, maille: 'iris' },
      { ...parametres, seuil_score: 101 },
      { ...parametres, autre: 1 },
    ];
    for (const p of mauvais) expect(c({ parametres: p }).ok, JSON.stringify(p)).toBe(false);
  });

  it('codes de région et de département rangés en majuscules, sans espaces (V-8) ; les autres seulement taillés', () => {
    const per = (type: string, code: string) => {
      const r = lireRecette({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type, code } });
      return r.ok && r.recette.type === 'seuil_territoire' ? r.recette.perimetre : r;
    };
    expect(per('departement', ' 2a ')).toEqual({ type: 'departement', code: '2A' });
    expect(per('departement', '2b')).toEqual({ type: 'departement', code: '2B' });
    expect(per('region', ' 84')).toEqual({ type: 'region', code: '84' });
    expect(per('commune', ' martigues ')).toEqual({ type: 'commune', code: 'martigues' });
    expect(per('cp', '13001 ')).toEqual({ type: 'cp', code: '13001' });
    expect((per('departement', '   ') as { ok: boolean }).ok).toBe(false);
  });

  it('RecetteUnionSchema est l’union nue, avec ses onze options (`pays` : ④ finitions, T2)', () => {
    expect(RecetteUnionSchema.options).toHaveLength(11);
  });
});

describe('MESSAGES_REFUS — revue de la Task 2', () => {
  it('la France refusée ne renvoie pas vers un périmètre que la recette refuserait (la région, pour les carreaux)', () => {
    expect(MESSAGES_REFUS.perimetre_national_refuse).not.toMatch(/région/);
    expect(MESSAGES_REFUS.perimetre_national_refuse).toContain('plus petit');
  });

  it('les plafonds cités viennent des constantes, mis en forme par formaterNombre', () => {
    expect(MESSAGES_REFUS.trop_de_poi).toContain(`Plus de ${formaterNombre(CAPACITE_SYNCHRONE_POI_RAYON)} POI`);
    expect(MESSAGES_REFUS.trop_de_carreaux).toContain(`Plus de ${formaterNombre(MAX_CARREAUX_SEUIL)} carreaux`);
    expect(MESSAGES_REFUS.trop_de_territoires).toContain(`Plus de ${formaterNombre(MAX_TERRITOIRES_SEUIL)} territoires`);
    expect(MESSAGES_REFUS.trop_de_sommets).toContain(`dépasse ${formaterNombre(MAX_SOMMETS_FORME)} sommets`);
    for (const m of Object.values(MESSAGES_REFUS)) expect(m).not.toMatch(/\d \d{3}/);
  });
});
