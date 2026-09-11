/**
 * @file lib/import/schemas.ts
 *
 * Schémas de validation du pipeline d'import universel (`SEC-001`).
 *
 * Ils vivent ici et non dans les routes parce que `dry-run` et `execute`
 * reçoivent le MÊME corps : un `ImportConfig`. Le dupliquer ferait diverger les
 * deux étapes d'un même parcours, et c'est précisément l'incohérence qu'on
 * voyait déjà — `dry-run` vérifiait `geolocation.mode`, `execute` ne vérifiait
 * rien et levait plus loin, dans le flux, sous la forme d'un 500.
 *
 * Les champs reproduisent `ImportConfig` et `GeoConfig` de `./types.ts`. Ils
 * restent délibérément permissifs sur tout ce qui est libre (noms de colonnes,
 * catégories) : le but est d'écarter ce qui ne pouvait que finir en erreur.
 */
import { z } from 'zod';
import type { DataType, GeoMode } from './types';

/** Les trois modes de géolocalisation réellement implémentés (`GeoMode`). */
const MODES_GEO = ['gps', 'address', 'lambert93'] as const satisfies readonly GeoMode[];

/** Le seul type de données que ce pipeline traite (`DataType`). */
const TYPES_DONNEES = ['poi'] as const satisfies readonly DataType[];

export const MappageChampsSchema = z.object({
  nom: z.string().optional(),
  adresse: z.string().optional(),
  ville: z.string().optional(),
  code_postal: z.string().optional(),
  departement: z.string().optional(),
  region: z.string().optional(),
  reference_panneau: z.string().optional(),
  type_panneau: z.string().optional(),
});

export const ConfigGeoSchema = z.object({
  mode: z.enum(MODES_GEO),
  colLat: z.string().optional(),
  colLng: z.string().optional(),
  colAdresse: z.string().optional(),
  colCodePostal: z.string().optional(),
  colVille: z.string().optional(),
  colX: z.string().optional(),
  colY: z.string().optional(),
});

/**
 * Corps de `/api/admin/import-poi/dry-run` et `/execute`.
 *
 * `fileId` est un `randomUUID()` posé par `/parse` : l'exiger au format UUID
 * n'est pas cosmétique. Les deux routes s'en servent en PRÉFIXE de filtre sur le
 * contenu du répertoire temporaire (`readdirSync(...).filter(f =>
 * f.startsWith(fileId))`) ; une valeur vide ou fantaisiste y sélectionnerait le
 * premier fichier venu.
 *
 * `mapping` vaut `{}` par défaut : absent, il faisait lever
 * `Object.entries(undefined)` dans `applyMapping`.
 */
export const ConfigImportSchema = z.object({
  fileId: z.string().uuid(),
  dataType: z.enum(TYPES_DONNEES),
  category: z.string().optional(),
  regie: z.string().optional(),
  mapping: MappageChampsSchema.default({}),
  geolocation: ConfigGeoSchema,
  limit: z.number().int().positive().optional(),
  sourceName: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  importedColumns: z.array(z.string()).optional(),
  filterFields: z.array(z.string()).optional(),
  /** Résultats de géocodage validés à l'étape de revue. Vérifié ensuite par
   *  `resolveSafeJsonPath`, qui en exige un UUID — c'est lui qui prévient la
   *  traversée de chemin. */
  geocodeId: z.string().optional(),
});
