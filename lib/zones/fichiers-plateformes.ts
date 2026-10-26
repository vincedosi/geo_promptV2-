/**
 * @file lib/zones/fichiers-plateformes.ts — le fichier d'une plateforme pour une extraction figée (lot 7, T2, A-6).
 *
 * Fonctions PURES, aucune I/O : la route `GET /api/zones/jeux/[id]/extractions/[version]/fichier` lit les unités, ce
 * module les écrit. Un format par (plateforme, maille) :
 *
 * | Maille | Formats | Fichier |
 * |---|---|---|
 * | `cp` (DV360) | `cp`, `sdf` | un CP par ligne ; geo IDs Google du SDF — `lib/digital/fichiers-dv360.ts`, les fichiers de l'export de zone |
 * | `cp` (TTD, Meta, TikTok) | `cp` | CSV `code_postal` (Meta : `FR:<cp>`) |
 * | `cercle` | `cercles` | CSV `nom;latitude;longitude;rayon_km` |
 * | `commune`, `departement` | `territoires` | CSV `code;nom` |
 * | `polygone` | `polygone` | GeoJSON `FeatureCollection` d'une `Feature` (la `forme` figée) |
 *
 * Seules les unités RETENUES. Les CSV : séparateur `;`, UTF-8 avec BOM (Excel FR), en-tête de méthode en lignes `#`
 * (jeu, version, plateforme, maille, date du relevé des limites, « à vérifier ») ; le GeoJSON la porte dans
 * `properties.methode`. Les deux fichiers DV360 n'ont NI BOM NI en-tête : ce sont des textes à coller tels quels dans
 * DV360, identiques à ceux de l'export de zone.
 *
 * ⚠ `formatsDe` est recopié dans l'Angular (T3) avec un test de parité : le changer ici, c'est le changer là-bas.
 */
import { toSlug } from '@/lib/custom-geo/slug';
import { texteCpDv360, texteSdfDv360 } from '@/lib/digital/fichiers-dv360';
import type { MAILLES, PLATEFORMES } from '@/lib/zones/plateformes';

export type Plateforme = (typeof PLATEFORMES)[number];
type Maille = (typeof MAILLES)[number];

export const FORMATS_FICHIER = ['cp', 'sdf', 'cercles', 'polygone', 'territoires'] as const;
export type FormatFichier = (typeof FORMATS_FICHIER)[number];

/** Une unité d'extraction (`zone_set_extraction_unites`), `centre` en GeoJSON tel que PostgREST le rend. */
export interface UniteFichier {
  ordinal: number;
  code: string | null;
  nom: string | null;
  centre: { type: string; coordinates: number[] } | null;
  rayon_m: number | null;
  retenu: boolean;
}

/** Ce que le fichier dit de lui-même : l'extraction, la plateforme, et la fraîcheur du registre `plateformes_geo`. */
export interface EnteteFichier {
  /** Nom du jeu. */
  jeu: string;
  version: number;
  plateforme: Plateforme;
  maille: Maille;
  /** `plateformes_geo.a_verifier` : la règle de la plateforme n'a pas été confirmée sur sa documentation. */
  aVerifier: boolean;
  /** `plateformes_geo.releve_le` (AAAA-MM-JJ). */
  releveLe: string;
}

/** En-têtes de colonnes des CSV, une seule définition (lus aussi par les tests). */
export const EN_TETES_CSV = {
  cp: 'code_postal',
  cercles: 'nom;latitude;longitude;rayon_km',
  territoires: 'code;nom',
} as const;

const BOM = '﻿';

/**
 * Les formats qu'offre une plateforme à une maille. Une maille sans fichier (IRIS : aucune plateforme ne l'achète)
 * rend une liste vide.
 */
export function formatsDe(plateforme: Plateforme, maille: Maille): FormatFichier[] {
  switch (maille) {
    case 'cp': return plateforme === 'dv360' ? ['cp', 'sdf'] : ['cp'];
    case 'cercle': return ['cercles'];
    case 'polygone': return ['polygone'];
    case 'commune':
    case 'departement': return ['territoires'];
    default: return [];
  }
}

/** Une cellule CSV : entre guillemets dès qu'elle contient le séparateur, un guillemet ou un saut de ligne. */
function cellule(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Les lignes `#` de méthode d'un CSV. */
function methodeCsv(e: EnteteFichier): string[] {
  return [
    `# Jeu : ${e.jeu}`,
    `# Extraction : v${e.version}`,
    `# Plateforme : ${e.plateforme}`,
    `# Maille : ${e.maille}`,
    `# Relevé des limites de la plateforme : ${e.releveLe}`,
    ...(e.aVerifier ? ['# À vérifier : la règle de ciblage de cette plateforme n’a pas été confirmée sur sa documentation.'] : []),
  ];
}

/** `5000` → `5`, `1500` → `1.5` : des kilomètres sans zéros inutiles. */
const km = (m: number) => String(Number((m / 1000).toFixed(3)));

/**
 * Écrit le fichier d'une plateforme.
 *
 * @param unites - Les unités lues (les non retenues sont écartées ici). Pour une maille CP : les CP achetés
 *   (`lireCpPlateforme`), en `code`.
 * @param forme - La `forme` GeoJSON de l'extraction (format `polygone`), sinon `null`.
 * @throws {Error} Si le format ne s'applique pas à (plateforme, maille) — l'appelant le refuse avant, en 400.
 */
export function fichierPlateforme(
  e: EnteteFichier, unites: UniteFichier[], forme: unknown | null, format: FormatFichier,
): { nom: string; type: string; contenu: string } {
  if (!formatsDe(e.plateforme, e.maille).includes(format)) {
    throw new Error(`Format ${format} sans objet pour ${e.plateforme} à la maille ${e.maille}.`);
  }
  const retenues = unites.filter((u) => u.retenu);
  const base = `extraction_${toSlug(e.jeu)}_v${e.version}_${e.plateforme}_${format}`;
  const csv = (lignes: string[]) => ({
    nom: `${base}.csv`, type: 'text/csv; charset=utf-8', contenu: BOM + [...methodeCsv(e), ...lignes].join('\n'),
  });
  const cps = retenues.flatMap((u) => (u.code ? [u.code] : []));

  switch (format) {
    case 'sdf':
      return {
        nom: `${base}.txt`, type: 'text/plain; charset=utf-8',
        contenu: texteSdfDv360(`${e.jeu} — extraction v${e.version}`, cps),
      };
    case 'cp':
      if (e.plateforme === 'dv360') return { nom: `${base}.txt`, type: 'text/plain; charset=utf-8', contenu: texteCpDv360(cps) };
      return csv([EN_TETES_CSV.cp, ...cps.map((cp) => (e.plateforme === 'meta' ? `FR:${cp}` : cp))]);
    case 'cercles':
      return csv([
        EN_TETES_CSV.cercles,
        ...retenues.map((u) => {
          const [lon, lat] = u.centre?.coordinates ?? [];
          // Un cercle sans centre ni rayon est un défaut de l'extraction : le taire rendrait un fichier incomplet.
          if (!Number.isFinite(lon) || !Number.isFinite(lat) || !u.rayon_m) {
            throw new Error(`Cercle ${u.ordinal} de l’extraction sans centre ou sans rayon.`);
          }
          const nom = u.nom ?? u.code ?? `Cercle ${u.ordinal}`;
          return [cellule(nom), lat.toFixed(6), lon.toFixed(6), km(u.rayon_m)].join(';');
        }),
      ]);
    case 'territoires':
      return csv([EN_TETES_CSV.territoires, ...retenues.map((u) => `${cellule(u.code ?? '')};${cellule(u.nom ?? '')}`)]);
    case 'polygone':
      return {
        nom: `${base}.geojson`,
        type: 'application/geo+json; charset=utf-8',
        contenu: JSON.stringify({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: forme,
            properties: {
              methode: {
                jeu: e.jeu, version: e.version, plateforme: e.plateforme, maille: e.maille,
                releve_le: e.releveLe, a_verifier: e.aVerifier,
              },
            },
          }],
        }),
      };
  }
}
