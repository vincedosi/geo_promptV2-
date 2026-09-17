import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/auth';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';
import { resolveCategory, normVille } from '@/lib/geo/locations';
import { getDistinctCategories } from '@/lib/poi/categories';
import type { ZoneData } from '@/types/spatial';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const poisPostSchema = z.object({
  poi_types:    z.array(z.string().min(1).max(100)).min(1, 'Aucun type de POI sélectionné'),
  scope:        z.enum(['metro', 'all']).nullable().default(null),
  regions:      z.array(z.string()).default([]),
  depts:        z.array(z.string()).default([]),
  ville:        z.string().max(200).default(''),
  rayon_poi:    z.string().max(20).nullable().default(null),
  poi_natures:  z.record(z.string(), z.array(z.string())).optional(),
  /**
   * Inclure les installations classees « En fin d'exploitation ».
   *
   * Par defaut FAUX, et c'est un choix de justesse, pas de performance : au
   * premier import reel, 289 sites sur 1 534 du departement 13 etaient en fin
   * d'exploitation (19 %). Les peindre a cote des sites actifs ferait lire un
   * risque industriel la ou l'activite a cesse. Ils restent en base — un sol
   * pollue survit a la fermeture du site — mais hors carte sauf demande
   * explicite. N'agit que sur la categorie `risque_industriel`, seule a porter
   * `metadata.etat_activite`.
   */
  poi_inclure_inactifs: z.boolean().optional().default(false),
  // [west, south, east, north] — lib/carte/filtre.ts (Tache 4, corrigee
  // round 1). Optionnelle : useMapDirectActions ne l'envoie QUE si un filtre
  // est actif (bboxDuFiltre(filtre)) — un premier essai l'envoyait toujours
  // en repli sur BBOX_METRO, ce qui masquait 339 POI d'outre-mer et rendait
  // le scope 'all' (pill France + DROM) inerte. Absente, le comportement est
  // celui d'avant cette tache : scope/regions/depts/ville seuls decident.
  bbox:         z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

// ── Filtre org : retourne les IDs de sources autorisées pour cette session ─────
// La copie locale de `getOrgSourceIds` a été supprimée le 2026-09-11 (`DUP-002`).
// C'est une règle d'AUTORISATION — elle décide quelles sources une organisation
// voit — et elle était écrite à trois endroits identiques : ici, dans
// `app/api/map/categories/route.ts` et dans `lib/auth/getOrgSourceIds.ts`.
// Le jour où la règle évolue, en oublier une ouvrirait ou fermerait des données
// en silence. Contrat figé par `tests/unit/auth/get-org-source-ids-caracterisation.test.ts`
// AVANT la fusion, notamment la distinction entre `null` (aucun filtre) et `[]`
// (organisation sans source, donc aucun accès).
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { getRegionNameMap, ecrituresDeLaRegion } from '@/lib/geo/region-lookup-server';
import { getDeptNameMap, ecrituresDuDepartement } from '@/lib/geo/dept-lookup-server';

// Codes départements DROM (exclus en mode France métro)
const DROM_CODES = ['971', '972', '973', '974', '976'];
// Codes région INSEE des DOM (pour détection "sélection DROM" par le user)
const DROM_REGION_CODES = new Set(['01', '02', '03', '04', '06']);

const SELECT_COLS = 'id, nom, lat, lng, categorie, sous_categorie, adresse, ville, region, departement';
const PAGE_SIZE   = 1000;

interface PoiRow {
  id: string; nom: string; lat: number; lng: number;
  categorie: string; sous_categorie?: string; adresse?: string; ville?: string;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parsed = poisPostSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join(', ') }, { status: 400 });
    }
    const { poi_types, scope, regions, depts, ville, rayon_poi, poi_natures, bbox, poi_inclure_inactifs } = parsed.data;

    const session   = await getSessionOrg(req);
    const supabase  = createAdminClient();
    const validCats = await getDistinctCategories();
    const poisMap   = new Map<string, PoiRow>();

    // ── Filtre org : sources autorisées (null = tout voir) ───────────────────
    const allowedSourceIds = await getOrgSourceIds(session);
    if (allowedSourceIds !== null && allowedSourceIds.length === 0) {
      // Org configurée mais aucune source → aucun POI accessible
      logger.debug('map/pois', 'Org sans sources configurées — résultat vide');
      return NextResponse.json({
        ville: ville ?? 'France',
        region: null, departement: null, categorie_poi: poi_types[0] ?? null,
        rayon_metres: null, rayon_poi_metres: null,
        coordonnees: { lat: 46.8, lng: 2.3 },
        pois: [], nb_pois: 0, categories: {},
      } satisfies ZoneData);
    }

    // ── helper: pagination avec retry schema cache ──────────────────────────
    interface PoiPageRow {
      id: string;
      nom?: string | null;
      lat: number | string;
      lng: number | string;
      categorie?: string | null;
      sous_categorie?: string | null;
      adresse?: string | null;
      ville?: string | null;
      region?: string | null;
      departement?: string | null;
    }
    // buildQuery returns a Supabase chained builder. Typed as `any` because
    // PostgrestFilterBuilder's deep generic chain triggers TS2589 ("Type
    // instantiation excessively deep") when narrowed.
    async function fetchAllPages(
      buildQuery: (from: number, to: number) => any,
      max = 10000,
      filter?: (p: PoiPageRow) => boolean,
    ) {
      let from = 0;
      while (from < max) {
        const to = from + PAGE_SIZE - 1;
        let data: PoiPageRow[] | null = null;
        let error: { message: string } | null = null;
        // Retry jusqu'à 3× si erreur schema cache (cold start Supabase PostgREST)
        for (let attempt = 0; attempt < 3; attempt++) {
          const result = await Promise.race([
            buildQuery(from, to),
            new Promise<{ data: null; error: { message: string } }>(resolve =>
              setTimeout(() => resolve({ data: null, error: { message: 'DB timeout (20s)' } }), 20000)
            ),
          ]);
          ({ data, error } = result);
          if (!error || !String(error.message).includes('schema cache')) break;
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        }
        if (error) {
          console.error('[map/pois] pagination error:', error.message);
          if (String(error.message).includes('timeout')) throw new Error('Base de données temporairement indisponible — réessayez dans quelques instants');
          break;
        }
        if (!data?.length) break;
        for (const p of data) {
          if (filter && !filter(p)) continue;
          const lat = Number(p.lat), lng = Number(p.lng);
          if (isNaN(lat) || isNaN(lng)) continue;
          poisMap.set(p.id, { id: p.id, nom: p.nom ?? 'Inconnu', lat, lng, categorie: p.categorie ?? 'autre', sous_categorie: p.sous_categorie ?? undefined, adresse: p.adresse ?? undefined, ville: p.ville ?? undefined });
        }
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }

    // ── rayon_poi → mètres ──────────────────────────────────────────────────
    const rayonPoiM = rayon_poi
      ? rayon_poi.endsWith('km')
        ? parseFloat(rayon_poi) * 1000
        : parseFloat(rayon_poi)
      : null;

    // ── Pour chaque type de POI sélectionné ────────────────────────────────
    for (const poiType of poi_types) {
      const resolvedCat = resolveCategory(poiType, validCats);
      const natures = poi_natures?.[poiType] ?? [];

      // Helper : applique cat + filtres nature + filtre org (data_source_id)
      // + bbox si presente (Tache 4, envoyee uniquement quand un filtre carte
      // est actif — voir schema ci-dessus).
      // Note: typed as `any` because Supabase's PostgrestFilterBuilder generic
      // chain causes "Type instantiation excessively deep" errors when narrowed.
      const applyFilters = (q: any): any => {
        if (resolvedCat) q = q.eq('categorie', resolvedCat);
        if (natures.length > 0) q = q.in('metadata->>libelle_nature', natures);
        // Sites dont l'activite a cesse : masques par defaut (voir le schema).
        // `.not(... 'in' ...)` laisse passer les lignes dont `etat_activite`
        // est NUL, ce qui est voulu : l'absence d'information n'est pas une
        // cessation d'activite.
        if (resolvedCat === 'risque_industriel' && !poi_inclure_inactifs) {
          q = q.not('metadata->>etat_activite', 'eq', "En fin d'exploitation");
        }
        if (allowedSourceIds !== null) q = q.in('data_source_id', allowedSourceIds);
        if (bbox) q = q.gte('lat', bbox[1]).lte('lat', bbox[3]).gte('lng', bbox[0]).lte('lng', bbox[2]);
        return q;
      };

      // ── Filtrage géographique ─────────────────────────────────────────────

      // 1. Par département(s)
      //
      // `departement` ne porte PAS le meme contenu selon l'import qui l'a
      // remplie (mesure du 2026-09-13) : code pour bmw, NOM pour les 5 584
      // lycees, code deviant pour 8 cirfa (`20A`, `3`). Un `ilike('%75%')` ne
      // pouvait donc rien trouver pour un lycee — filtrer sur Paris rendait
      // ZERO lycee, sans erreur ni message.
      //
      // On interroge desormais les ecritures possibles du departement demande,
      // sur `code_departement` (renseignee sur 177 lignes) ET `departement`.
      // C'est un contournement assume : la vraie correction est de normaliser
      // la colonne — point 19 de docs/audit/QUICK_WINS.md.
      if (depts?.length > 0) {
        const nomsDept = await getDeptNameMap(supabase);
        for (const dept of depts) {
          const ecritures = ecrituresDuDepartement(dept, nomsDept);
          if (ecritures.length === 0) continue;
          // PostgREST : les valeurs d'un `or()` sont separees par des virgules,
          // donc une valeur qui en contient une casserait le filtre. Aucun nom
          // de departement francais n'en porte, mais on les ecarte plutot que
          // de le supposer.
          const sures = ecritures.filter((e) => !/[,()"]/.test(e));
          const clauses = sures.flatMap((e) => [
            `code_departement.eq.${e}`,
            `departement.eq.${e}`,
          ]);
          if (clauses.length === 0) continue;
          await fetchAllPages((from, to) => {
            let q = supabase.from('poi_france').select(SELECT_COLS)
              .or(clauses.join(','))
              .order('id')
              .range(from, to);
            return applyFilters(q);
          });
        }
        continue;
      }

      // 2. Par région(s) — filtre SQL sur les écritures connues
      //
      // Avant le 2026-09-13, cette branche ne posait AUCUN prédicat
      // géographique : elle tirait les 10 000 premiers POI par `id`, puis
      // filtrait en JavaScript sur le nom de région normalisé. Deux défauts.
      //   - Le coût : 10 allers-retours et 10 000 lignes transférées pour en
      //     rendre 1 015 en Île-de-France. Le filtre SQL équivalent lit
      //     239 blocs en 1,4 ms via `idx_poi_france_region` (mesuré).
      //   - La justesse : au-delà de 10 000 POI d'une catégorie, le plafond
      //     tronquait SILENCIEUSEMENT la région. Latent aujourd'hui — seuls les
      //     arrêts de transport dépassent ce seuil, et ils ne passent pas ici.
      //
      // La normalisation JS existait pour une vraie raison : l'Île-de-France
      // est stockée sous DEUX orthographes (`Ile-de-France` sur 981 POI,
      // `Île-de-France` sur 34). `ecrituresDeLaRegion` génère les variantes en
      // amont, ce qui garde l'insensibilité aux accents SANS renoncer à l'index.
      if (regions?.length > 0) {
        const regionNames = await getRegionNameMap(supabase);
        const ecritures = [...new Set(
          regions.flatMap((code: string) => ecrituresDeLaRegion(code, regionNames)),
        )];
        // Détection "DROM sélectionné" : au moins une des régions est un DOM.
        // Repli conservé à l'identique — certains POI portent le département
        // mais pas la région.
        const hasDrom = regions.some((code: string) => DROM_REGION_CODES.has(code));

        if (ecritures.length > 0) {
          await fetchAllPages((from, to) => {
            let q = supabase.from('poi_france').select(SELECT_COLS)
              .in('region', ecritures)
              .order('id')
              .range(from, to);
            return applyFilters(q);
          });
        }
        if (hasDrom) {
          // Requête SÉPARÉE plutôt qu'un `or()` : les noms de région portent
          // apostrophes et traits d'union (`Provence-Alpes-Côte d'Azur`), que
          // la syntaxe `or()` de PostgREST demanderait d'échapper. Les deux
          // jeux se fondent de toute façon dans `poisMap`, qui dédoublonne
          // par `id`.
          await fetchAllPages((from, to) => {
            let q = supabase.from('poi_france').select(SELECT_COLS)
              .in('departement', DROM_CODES)
              .order('id')
              .range(from, to);
            return applyFilters(q);
          });
        }
        continue;
      }

      // 3. Par ville
      if (ville?.trim()) {
        const villeKey = normVille(ville.trim());
        await fetchAllPages((from, to) => {
          let q = supabase.from('poi_france').select(SELECT_COLS)
            .ilike('ville', `%${villeKey}%`)
            .order('id')
            .range(from, to);
          return applyFilters(q);
        }, 4000);
        continue;
      }

      // 4. Scope national
      await fetchAllPages((from, to) => {
        let q = supabase.from('poi_france').select(SELECT_COLS).order('id').range(from, to);
        if (scope === 'metro') q = q.or(`departement.is.null,departement.not.in.(${DROM_CODES.join(',')})`);
        return applyFilters(q);
      }, 10000);
    }

    // ── Résumé ─────────────────────────────────────────────────────────────
    const pois = Array.from(poisMap.values());
    const categories: Record<string, number> = {};
    for (const p of pois) {
      const cat = p.categorie || 'autre';
      categories[cat] = (categories[cat] ?? 0) + 1;
    }

    // Centroïde
    const coordonnees = pois.length > 0
      ? {
          lat: pois.reduce((s, p) => s + p.lat, 0) / pois.length,
          lng: pois.reduce((s, p) => s + p.lng, 0) / pois.length,
        }
      : { lat: 46.8, lng: 2.3 };

    // Label lieu
    let locationLabel = 'France';
    if (ville?.trim()) locationLabel = ville.trim();
    else if (depts?.length === 1) locationLabel = `Département ${depts[0]}`;
    else if (depts?.length > 1) locationLabel = `${depts.length} départements`;
    else if (regions?.length === 1) {
      const regionNames = await getRegionNameMap(supabase);
      locationLabel = regionNames.get(regions[0]) ?? regions[0];
    }
    else if (regions?.length > 1) locationLabel = `${regions.length} régions`;
    else if (scope === 'metro') locationLabel = 'France métropolitaine';
    else if (scope === 'all')   locationLabel = 'France entière';

    const zoneRegionName = regions?.[0] ? (await getRegionNameMap(supabase)).get(regions[0]) ?? regions[0] : null;
    const zoneData: ZoneData = {
      ville:           locationLabel,
      region:          zoneRegionName,
      departement:     depts?.[0] ?? null,
      categorie_poi:   poi_types[0] ?? null,
      rayon_metres:    null,
      rayon_poi_metres: rayonPoiM,
      coordonnees,
      pois,
      nb_pois:         pois.length,
      categories,
    };

    logger.debug('api/map/pois', `${pois.length} POIs — types: ${poi_types.join(', ')} — lieu: ${locationLabel}`);
    return NextResponse.json(zoneData);

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[api/map/pois] ERREUR:', errMsg);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
