/**
 * POST /api/isochrone-battle/apply-battle
 *
 * Phase 2 : applique ST_Difference (bataille) sur des isochrones déjà calculés.
 * Reçoit les ring features de la Phase 1, appelle get_isochrone_battle PostGIS.
 * Réponse : NDJSON streaming avec événements de progression.
 *
 * Events:
 *   { type: 'progress', step: string, message: string }
 *   { type: 'result',   battleGeoJSON, battleBorders, nb_rings, nb_borders }
 *   { type: 'error',    message: string }
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { createAdminClient } from '@/lib/auth';
import { toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

/**
 * Les anneaux partent TELS QUELS vers `get_isochrone_battle`, une fonction
 * PostGIS protegee par CLAUDE.md. D'ou le `.passthrough()` : Zod retire par
 * defaut les clefs inconnues, et les retirer ici changerait la charge utile
 * recue par la RPC. On verifie la presence et le type des six champs connus,
 * on ne retranche rien.
 */
const AnneauSchema = z.object({
  cirfa_id: z.string(),
  nom: z.string(),
  lat: z.number(),
  lng: z.number(),
  palier: z.number(),
  geojson: z.string(),
}).passthrough();

const AppliquerBatailleSchema = z.object({
  rings: z.array(AnneauSchema).nonempty(),
});

export async function POST(req: NextRequest) {
  const corps = await lireCorps(req, AppliquerBatailleSchema);
  if (!corps.ok) {
    return new Response(JSON.stringify({ error: corps.message }), { status: 400 });
  }
  const { rings } = corps.valeur;

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const emit = (obj: object) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        const supabase = createAdminClient();

        // ── 1. ST_Difference via get_isochrone_battle ──────────────────────
        // Note: clip_rings_to_france (france_boundary) ne couvre pas correctement Lille/Nord
        // → get_isochrone_battle effectue son propre clip via france_borders (correct)
        emit({ type: 'progress', step: 'battle', message: `ST_Difference PostGIS (${rings.length} anneaux)…` });
        console.log(`[apply-battle] get_isochrone_battle → ${rings.length} rings…`);

        const { data: battleRows, error: rpcErr } = await supabase.rpc(
          'get_isochrone_battle',
          // `toJson` est le helper documente pour passer un objet applicatif en
          // argument `jsonb` d'une RPC (ARCHITECTURE.md). Le `.passthrough()` du
          // schema ajoute un index `unknown` que `Json` n'accepte pas : la
          // charge utile est inchangee, seul son type l'est.
          { p_rings: toJson(rings) }
        );

        if (rpcErr) {
          console.error('[apply-battle] Erreur RPC:', rpcErr.message);
          emit({ type: 'error', message: rpcErr.message });
          controller.close();
          return;
        }

        // ── 3. Filtrer géométries dégénérées ──────────────────────────────
        const allFeatures = Array.isArray(battleRows) ? battleRows : [];
        const isValidGeom = (f: any): boolean => {
          const geom = f?.geometry;
          if (!geom) return false;
          const t = geom.type;
          if (t === 'Point' || t === 'LineString' || t === 'MultiLineString') return false;
          if (t === 'Polygon')      return (geom.coordinates?.[0]?.length ?? 0) >= 4;
          if (t === 'MultiPolygon') return (geom.coordinates?.length ?? 0) > 0;
          return false;
        };

        const ringFeatures   = allFeatures.filter((f: any) => f?.properties?.feature_type === 'ring'   && isValidGeom(f));
        const borderFeatures = allFeatures.filter((f: any) => f?.properties?.feature_type === 'border' && isValidGeom(f));
        console.log(`[apply-battle] → ${ringFeatures.length} anneaux, ${borderFeatures.length} bordures`);

        emit({ type: 'progress', step: 'done', message: `${ringFeatures.length} zones, ${borderFeatures.length} bordures` });
        emit({
          type: 'result',
          battleGeoJSON: { type: 'FeatureCollection', features: ringFeatures },
          battleBorders: { type: 'FeatureCollection', features: borderFeatures },
          nb_rings:   ringFeatures.length,
          nb_borders: borderFeatures.length,
        });

      } catch (err: unknown) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  });
}
