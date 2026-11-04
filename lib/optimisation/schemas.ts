/**
 * @file lib/optimisation/schemas.ts — Zod sur les RÉPONSES du service d'optimisation Python (tâche 1.6).
 *
 * Les types viennent de l'OpenAPI du service (`types-openapi.ts`, GÉNÉRÉ) ; ces schémas en sont la vérification à
 * l'exécution. Chaque schéma est déclaré `z.ZodType<…généré…>` : si le service change une sortie, l'OpenAPI change,
 * les types régénérés aussi, et `tsc` refuse ce fichier tant qu'il ne suit pas.
 *
 * ⚠ `.passthrough()` PARTOUT : Zod retire par défaut les clés qu'il ne connaît pas (CLAUDE.md, Conventions). Une clé
 * retirée ici changerait ce que Next compare en ombre et ce qu'il écrit en base en mode `python` — et la comparaison
 * mentirait. Les clés connues sont vérifiées, les autres passent telles quelles.
 */
import { z } from 'zod';
import type { components } from '@/lib/optimisation/types-openapi';

type S = components['schemas'];

const nombre = z.number().finite();
const nombreOuNull = nombre.nullable();
const regleGroupe = z.enum(['meme', 'divise']);

const SchemaAlgo: z.ZodType<S['Algo']> = z.object({
  moteur: z.literal('python'),
  version: z.string(),
  entrees_sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).passthrough();

const SchemaBornes = z.object({ min: nombre, max: nombre }).passthrough();

const SchemaAjustement: z.ZodType<S['Ajustement']> = z.object({
  code: z.enum(['multiplicateur_min', 'multiplicateur_max']),
  limite: nombre,
  valeur: nombre,
  n: nombre,
}).passthrough();

const SchemaLigneHorsZone: z.ZodType<S['LigneHorsZone']> = z.object({
  code: z.literal('HORS_ZONE'),
  mode: z.enum(['strict', 'national']),
  multiplicateur: nombre,
  part: nombre,
  classe: nombre,
  volume: nombreOuNull.optional(),
  univers: z.enum(['METRO', 'FR']).nullable().optional(),
  part_prevue: nombreOuNull.optional(),
}).passthrough();

const champsBilan = {
  normalisation: z.literal('non_ponderee'),
  bornes: SchemaBornes,
  moyenne_avant_ecretage: nombreOuNull,
  moyenne_apres_ecretage: nombreOuNull,
  n_ecretes: nombre,
  ajustements: z.array(SchemaAjustement),
  hors_zone: SchemaLigneHorsZone,
};

const SchemaBilan: z.ZodType<S['BilanMultiplicateur']> = z.object(champsBilan).passthrough();

const SchemaBilanZone: z.ZodType<S['BilanMultiplicateurZone']> = z.object({
  ...champsBilan,
  unite_de_compte: z.literal('unite_cp'),
  poids_groupe_cp: regleGroupe,
}).passthrough();

const SchemaLignePlanZone: z.ZodType<S['LignePlanZone']> = z.object({
  code_postal: z.string(),
  code_canonique: z.string(),
  classe: z.string(),
  retenu: z.boolean(),
  multiplicateur: nombre,
  pop_en_zone: nombreOuNull,
  pop_totale: nombreOuNull,
  part_en_zone: nombreOuNull,
  part_prevue: nombreOuNull,
}).passthrough();

const SchemaResumePartPrevue: z.ZodType<S['ResumePartPrevue']> = z.object({
  volume_attendu: z.literal('population_totale'),
  unite_de_somme: z.literal('unite_cp'),
  repartition_groupe: z.literal('egale'),
  hors_zone: nombreOuNull,
  unites_sans_part: nombre,
}).passthrough();

const champsResume = {
  n_cp: nombre,
  n_retenus: nombre,
  n_codes: nombre,
  taux_utile: nombreOuNull,
  part_plan_en_zone: nombreOuNull,
  population_exposee: nombre,
  multiplicateur: SchemaBilanZone,
  part_prevue: SchemaResumePartPrevue,
};

const SchemaPlanZone: z.ZodType<S['PlanZone']> = z.object({
  lignes: z.array(SchemaLignePlanZone),
  resume: z.object(champsResume).passthrough(),
}).passthrough();

const SchemaPlanCommun: z.ZodType<S['PlanCommun']> = z.object({
  lignes: z.array(SchemaLignePlanZone),
  resume: z.object({ ...champsResume, algo: SchemaAlgo }).passthrough(),
}).passthrough();

const SchemaReglage: z.ZodType<S['Reglage']> = z.object({
  bornes: SchemaBornes.optional(),
  poids_groupe_cp: regleGroupe.optional(),
  a_verifier: z.object({ min: z.boolean(), max: z.boolean() }).passthrough().optional(),
}).passthrough();

const SchemaSortiePoids: z.ZodType<S['SortiePoids']> = z.object({
  mecanisme: z.string(),
  branche: z.boolean(),
  poids_groupe_cp: regleGroupe.nullable(),
  parametres_a_verifier: z.array(z.string()),
  n_codes: nombre,
  valeur_min: nombre.optional(),
  valeur_max: nombre.optional(),
  nb_max_entrees: nombre.optional(),
  n_envois: nombre.optional(),
}).passthrough();

const SchemaAvertissementPoids: z.ZodType<S['AvertissementPoids']> = z.object({
  code: z.string(),
  limite: nombre,
  valeur: nombre,
  n: nombre,
  mecanisme: z.string().optional(),
  a_verifier: z.literal(true).optional(),
}).passthrough();

export const SchemaSortiePlanZone: z.ZodType<S['SortiePlanZone']> = z.object({
  commun: SchemaPlanCommun,
  reglage: SchemaReglage,
  par_plateforme: z.array(z.object({
    plateforme: z.string(),
    seuil: nombre,
    reglage: SchemaReglage,
    plan: SchemaPlanZone,
    poids: z.array(SchemaSortiePoids),
    avertissements: z.array(SchemaAvertissementPoids),
  }).passthrough()),
  sorties_poids: z.array(z.object({
    plateforme: z.string(),
    poids: z.array(SchemaSortiePoids),
    avertissements: z.array(SchemaAvertissementPoids),
  }).passthrough()),
  algo: SchemaAlgo,
}).passthrough();

export const SchemaSortiePlanRisque: z.ZodType<S['SortiePlanRisque']> = z.object({
  lignes: z.array(z.object({
    code_postal: z.string(),
    part_plan: nombre,
    multiplicateur: nombre,
    multiplicateur_calcule: nombre.optional(),
    classe: z.string(),
    retenu: z.boolean(),
  }).passthrough()),
  part_plan_en_zone: nombreOuNull,
  taux_utile: nombreOuNull,
  n_retenus: nombre,
  multiplicateur: SchemaBilan.nullable().optional(),
  algo: SchemaAlgo,
}).passthrough();

const paire = z.tuple([z.string(), nombre]);

export const SchemaSortieRecaler: z.ZodType<S['SortieRecaler']> = z.object({
  multiplicateurs: z.array(paire),
  corrections: z.array(paire),
  dilues: z.array(z.string()),
  algo: SchemaAlgo,
}).passthrough();

export type SortiePlanZone = S['SortiePlanZone'];
export type SortiePlanRisque = S['SortiePlanRisque'];
export type SortieRecaler = S['SortieRecaler'];
export type EntreePlanZone = S['PlanZoneEntree'];
export type EntreePlanRisque = S['PlanRisqueEntree'];
export type EntreeRecaler = S['RecalerEntree'];
export type Algo = S['Algo'];
