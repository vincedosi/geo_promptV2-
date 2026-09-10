/**
 * GENESIS — Import data.gouv.fr GeoJSON → table poi
 * Route: POST /api/admin/import-datagouv
 *
 * Flux :
 *  1. Fetch GeoJSON distant
 *  2. Filtre les features Point uniquement
 *  3. Avertit si la catégorie a déjà des POIs data_gouv
 *  4. Insère en lots de 500 dans poi_france (vue → poi avec trigger geom)
 *  5. Stream NDJSON de progression vers le client
 */

import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { invalidateCategoriesCache } from '@/lib/poi/categories';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { triggerFilled } from '@/lib/supabase/tables';
import { toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

export const maxDuration = 300; // 5 minutes pour les gros datasets

const CHUNK_SIZE = 500;
const MAX_FEATURES = 250_000; // Sécurité mémoire
const FETCH_TIMEOUT_MS = 90_000;
const MAX_REDIRECTS = 3;

// Validation URL : prévenir les SSRF (Server-Side Request Forgery).
// Réutilisée pour l'URL initiale ET pour chaque Location de redirection
// (fetch() suit les 3xx par défaut sans revalider la cible).
const ALLOWED_DOMAINS = [
  'data.gouv.fr',
  'static.data.gouv.fr',
  'tabular-api.data.gouv.fr',
  'geo.api.gouv.fr',
  'services.arcgis.com',
  'geo.brest-metropole.fr',
  'opendata.reseaux-energies.fr',
  'public.opendatasoft.com',
];

function validateGeojsonUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'URL invalide (URL malformée)' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'geojsonUrl doit utiliser HTTPS' };
  }
  const isAllowed = ALLOWED_DOMAINS.some(
    (d) => url.hostname === d || url.hostname.endsWith('.' + d)
  );
  if (!isAllowed) {
    return {
      ok: false,
      error: `Domaine non autorisé: ${url.hostname}. Domaines acceptés: ${ALLOWED_DOMAINS.join(', ')}`,
    };
  }
  return { ok: true, url };
}

// ─── Types des événements streamés ──────────────────────────────────────────

type StreamEvent =
  | { type: 'status'; message: string }
  | { type: 'warn'; message: string }
  | { type: 'existing'; count: number; categorie: string }
  | { type: 'total'; count: number; original: number; skipped: number }
  | { type: 'progress'; chunk: number; totalChunks: number; inserted: number; errors: number }
  | { type: 'done'; inserted: number; errors: number; total: number }
  | { type: 'error'; message: string };

// ─── Extraction d'un nom lisible depuis les propriétés d'une feature ─────────

function extractNom(props: Record<string, unknown>, categorie: string, index: number): string {
  const candidates = [
    'nom', 'name', 'libelle', 'denomination', 'raison_sociale',
    'label', 'titre', 'nom_station', 'nom_enseigne', 'nom_commune',
    'adresse_station', 'id_station_itinerance',
  ];
  for (const key of candidates) {
    const val = props[key];
    if (val && typeof val === 'string' && val.trim().length > 0) {
      return val.trim().slice(0, 255);
    }
  }
  return `${categorie}_${index}`;
}

// ─── Mapping feature GeoJSON → ligne poi ────────────────────────────────────

function featureToRow(
  feature: { geometry: { coordinates: number[] }; properties: Record<string, unknown> },
  categorie: string,
  index: number
) {
  const props = feature.properties ?? {};
  const [lng, lat] = feature.geometry.coordinates;

  if (isNaN(Number(lat)) || isNaN(Number(lng))) return null;
  if (Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180) return null;

  return triggerFilled<'poi_france', 'geom'>({
    // Colonnes principales — le trigger trg_poi_france_auto_geom calcule geom depuis lat/lng
    lat: Number(lat),
    lng: Number(lng),
    categorie,
    nom: extractNom(props as Record<string, unknown>, categorie, index),
    // Adresse
    adresse: (props.adresse ?? props.ad_voie ?? props.adresse_station ?? props.voie ?? null) as string | null,
    ville: (props.ville ?? props.commune ?? props.nom_commune ?? props.city ?? null) as string | null,
    code_postal: (props.code_postal ?? props.codepostal ?? props.cp ?? null)?.toString().slice(0, 10) ?? null,
    code_departement: (props.code_departement ?? props.departement?.toString().slice(0, 3) ?? null) as string | null,
    region: (props.region ?? props.nom_region ?? null) as string | null,
    // Traçabilité
    source: 'data_gouv',
    date_import: new Date().toISOString(),
    // Toutes les propriétés brutes pour le scoring futur
    metadata: toJson(props),
  });
}

// ─── Handler principal ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  let geojsonUrl: string;
  let categorie: string;

  try {
    const body = await req.json();
    geojsonUrl = body.geojsonUrl?.trim();
    categorie = body.categorie?.trim().toLowerCase().replace(/\s+/g, '_');
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  if (!geojsonUrl || !categorie) {
    return Response.json({ error: 'geojsonUrl et categorie sont requis' }, { status: 400 });
  }

  // Validation URL : prévenir les SSRF (Server-Side Request Forgery)
  const initialCheck = validateGeojsonUrl(geojsonUrl);
  if (!initialCheck.ok) {
    return Response.json({ error: initialCheck.error }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          // Controller already closed
        }
      };

      try {
        // ── 0. Connexion Supabase ────────────────────────────────────────────
        const supabase = createAdminClient();

        // ── 1. Vérifier si la catégorie a déjà des données data_gouv ────────
        send({ type: 'status', message: 'Vérification des données existantes...' });
        const { data: countData } = await supabase
          .rpc('count_poi_by_categorie_source', { p_categorie: categorie, p_source: 'data_gouv' });
        const existingCount = (countData as number) ?? 0;
        if (existingCount > 0) {
          send({ type: 'existing', count: existingCount, categorie });
        }

        // ── 2. Téléchargement du GeoJSON ─────────────────────────────────────
        send({ type: 'status', message: `Téléchargement de ${geojsonUrl}...` });

        let response: Response;
        try {
          let currentUrl = geojsonUrl;
          for (let hop = 0; ; hop++) {
            if (hop > MAX_REDIRECTS) {
              throw new Error(`Trop de redirections (max ${MAX_REDIRECTS})`);
            }
            // Revalider CHAQUE URL (initiale + chaque Location de redirection)
            // contre la même whitelist — fetch() suit les 3xx sans revalider.
            const hopCheck = validateGeojsonUrl(currentUrl);
            if (!hopCheck.ok) {
              throw new Error(`Redirection vers une cible non autorisée : ${hopCheck.error}`);
            }
            const res = await fetch(currentUrl, {
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
              headers: { 'Accept': 'application/geo+json, application/json, */*' },
              redirect: 'manual',
            });
            if (res.status >= 300 && res.status < 400) {
              const location = res.headers.get('location');
              if (!location) throw new Error('Redirection sans en-tête Location');
              currentUrl = new URL(location, currentUrl).toString();
              continue;
            }
            response = res;
            break;
          }
        } catch (fetchErr) {
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          send({ type: 'error', message: `Téléchargement échoué: ${msg}` });
          controller.close();
          return;
        }

        if (!response.ok) {
          send({ type: 'error', message: `HTTP ${response.status}: ${response.statusText}` });
          controller.close();
          return;
        }

        // Avertissement taille
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 200 * 1024 * 1024) {
          send({ type: 'warn', message: 'Fichier > 200 MB — le parsing peut être lent.' });
        }

        // ── 3. Parse JSON ────────────────────────────────────────────────────
        send({ type: 'status', message: 'Parsing GeoJSON...' });
        let geojson: { type: string; features: unknown[] };
        try {
          geojson = await response.json();
        } catch {
          send({ type: 'error', message: 'Le fichier n\'est pas du JSON valide.' });
          controller.close();
          return;
        }

        if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
          send({ type: 'error', message: 'Format invalide : attendu FeatureCollection GeoJSON.' });
          controller.close();
          return;
        }

        // ── 4. Filtre : Points uniquement ────────────────────────────────────
        type GeoFeature = { geometry: { type: string; coordinates: number[] }; properties: Record<string, unknown> };
        const pointFeatures = (geojson.features as GeoFeature[]).filter(
          (f) => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)
        );

        const skipped = geojson.features.length - pointFeatures.length;
        const total = Math.min(pointFeatures.length, MAX_FEATURES);

        if (total === 0) {
          send({ type: 'error', message: 'Aucun Point GeoJSON trouvé. Le dataset contient peut-être des Polygones ou MultiLineStrings.' });
          controller.close();
          return;
        }

        send({ type: 'total', count: total, original: geojson.features.length, skipped });

        // ── 5. Insert par chunks ─────────────────────────────────────────────
        let totalInserted = 0;
        let totalErrors = 0;
        const totalChunks = Math.ceil(total / CHUNK_SIZE);

        for (let i = 0; i < total; i += CHUNK_SIZE) {
          const chunkFeatures = pointFeatures.slice(i, i + CHUNK_SIZE);
          const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;

          send({ type: 'progress', chunk: chunkNum, totalChunks, inserted: totalInserted, errors: totalErrors });

          // Convertir les features en lignes valides
          const rows = chunkFeatures
            .map((f, idx) => featureToRow(f, categorie, i + idx))
            .filter((r): r is NonNullable<typeof r> => r !== null);

          if (rows.length === 0) continue;

          // Insert (pas upsert : pas de doublon possible sans ID stable)
          const { error } = await supabase
            .from('poi_france')
            .insert(rows);

          if (error) {
            totalErrors += rows.length;
            send({ type: 'warn', message: `Chunk ${chunkNum}/${totalChunks} erreur: ${error.message}` });
          } else {
            totalInserted += rows.length;
          }
        }

        // ── 6. Invalider le cache des catégories ─────────────────────────────
        if (totalInserted > 0) {
          invalidateCategoriesCache();
        }

        send({ type: 'done', inserted: totalInserted, errors: totalErrors, total });

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
