/**
 * Lookup côté serveur des départements INSEE. Jumeau de `region-lookup-server`.
 *
 * POURQUOI IL EXISTE
 * `poi_france.departement` ne porte pas le même contenu selon l'import qui l'a
 * remplie — mesuré le 2026-09-13 sur les 5 862 POI non-transport :
 *
 *   | catégorie | contenu             | exemples                     |
 *   |-----------|---------------------|------------------------------|
 *   | bmw       | code                | `13`, `69`, `75`             |
 *   | cirfa     | code, 8 déviants    | `20A`, `20B`, `3`, `4`       |
 *   | lycee     | **nom**             | `Ain`, `Aisne`, `Allier`     |
 *
 * La route `/api/map/pois` cherchait `ilike('departement', '%75%')`. Elle ne
 * pouvait donc RIEN trouver pour les lycées, qui sont pourtant la catégorie
 * la plus fournie du sélecteur (5 584 POI) : filtrer sur Paris rendait zéro
 * lycée, sans erreur ni message.
 *
 * Ce module rend la correspondance `code → nom` pour que la route accepte les
 * deux écritures. C'est un CONTOURNEMENT assumé : la vraie correction est de
 * normaliser la colonne et de remplir `code_departement`, qui n'est renseignée
 * que sur 177 lignes sur 5 862. Elle demande une reprise par jointure spatiale
 * avec un repli pour les ~6 % de points qui tombent hors polygone — voir le
 * point 19 de `docs/audit/QUICK_WINS.md`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface DeptRow { code_dept: string; nom_dept: string }

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

/** Map `code_dept INSEE → nom_dept`. Cache module, comme les régions. */
export async function getDeptNameMap(
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;

  const run = async (): Promise<Map<string, string>> => {
    const { data, error } = await supabase
      .from('ref_departements')
      .select('code_dept, nom_dept');
    if (error) {
      console.error('[dept-lookup]', error.message);
      return new Map<string, string>();
    }
    const m = new Map<string, string>();
    for (const r of (data as DeptRow[] | null) ?? []) {
      m.set(r.code_dept, r.nom_dept);
    }
    cache = m;
    return m;
  };

  inflight = run();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Toutes les écritures sous lesquelles un département peut apparaître dans
 * `poi_france.departement` ou `code_departement`, pour un code demandé.
 *
 * Fonction PURE, testée sans base. Elle couvre les trois formats mesurés :
 *   - le code tel quel (`75`) ;
 *   - le nom (`Paris`), format des 5 584 lycées ;
 *   - le code non complété (`3` pour `03`), présent chez cirfa ;
 *   - l'ancienne écriture corse (`20A`/`20B` pour `2A`/`2B`), idem.
 *
 * Renvoie des valeurs DISTINCTES, sans chaîne vide.
 */
export function ecrituresDuDepartement(
  code: string,
  nomsParCode: Map<string, string>,
): string[] {
  const brut = code.trim();
  if (!brut) return [];

  const ecritures = new Set<string>([brut]);

  const nom = nomsParCode.get(brut);
  if (nom) ecritures.add(nom);

  // `03` est parfois stocké `3` : on accepte les deux sens de lecture.
  if (/^0\d$/.test(brut)) ecritures.add(brut.slice(1));
  if (/^\d$/.test(brut)) ecritures.add(`0${brut}`);

  // Corse : `2A`/`2B` ont été écrits `20A`/`20B` par un import.
  const corse = /^2([AB])$/i.exec(brut);
  if (corse) ecritures.add(`20${corse[1].toUpperCase()}`);
  const corseVieux = /^20([AB])$/i.exec(brut);
  if (corseVieux) ecritures.add(`2${corseVieux[1].toUpperCase()}`);

  return [...ecritures].filter((e) => e.length > 0);
}

/** Invalidation manuelle (utile uniquement si ref_departements change). */
export function invalidateDeptCache(): void {
  cache = null;
}
