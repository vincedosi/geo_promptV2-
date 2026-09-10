/**
 * GENESIS — Import ArcGIS REST → panneaux_affichage
 * Route: POST /api/admin/import-ooh/arcgis
 *
 * Flux :
 *  1. Crée un import_run_ooh (statut 'running') + une entrée data_sources
 *  2. Pagine l'API ArcGIS (1000 features/page) jusqu'à epuisement
 *  3. Normalise chaque feature → ligne panneaux_affichage
 *  4. Upsert par batch de 50 (ON CONFLICT source+source_ref → update)
 *  5. Met à jour import_run_ooh avec les stats finales
 *  6. Stream NDJSON de progression vers le client
 */

import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { checkImportRateLimit } from '@/lib/api/rate-limit';
import { triggerFilled } from '@/lib/supabase/tables';
import { toJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

export const maxDuration = 300;

const BATCH_SIZE     = 50;
const PAGE_SIZE      = 1000;
const FETCH_TIMEOUT  = 60_000;
const MAX_REDIRECTS  = 3;

// ─── SSRF protection : domaines ArcGIS autorisés ─────────────────────────────
const ALLOWED_ARCGIS_DOMAINS = [
  'services.arcgis.com', 'services1.arcgis.com', 'services2.arcgis.com',
  'services3.arcgis.com', 'services5.arcgis.com', 'services6.arcgis.com',
  'services7.arcgis.com', 'services8.arcgis.com', 'services9.arcgis.com',
  'geo.brest-metropole.fr',
];

function isPrivateHost(hostname: string): boolean {
  let h = hostname.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) → dévoiler l'IPv4 sous-jacente
  if (h.startsWith('::ffff:')) h = h.slice('::ffff:'.length);
  if (h === 'localhost' || h === '[::1]' || h === '::1') return true;
  if (h.startsWith('127.') || h.startsWith('10.')) return true;
  if (h.startsWith('192.168.')) return true;
  if (h.startsWith('169.254.')) return true;
  if (h.startsWith('0.')) return true; // 0.0.0.0/8
  // 172.16.0.0 - 172.31.255.255
  const m = h.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  // fc00::/7 (unique local IPv6)
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true;
  // fe80::/10 (link-local IPv6)
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;
  return false;
}

function validateArcgisUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, error: 'URL invalide' }; }
  if (url.protocol !== 'https:') return { ok: false, error: 'Seul HTTPS est autorisé' };
  if (isPrivateHost(url.hostname)) return { ok: false, error: 'Adresse privée non autorisée' };
  if (!ALLOWED_ARCGIS_DOMAINS.some(d => url.hostname === d || url.hostname.endsWith('.' + d))) {
    return { ok: false, error: `Domaine non autorisé : ${url.hostname}. Domaines acceptés : ${ALLOWED_ARCGIS_DOMAINS.join(', ')}` };
  }
  return { ok: true, url };
}

// ─── Source connues ───────────────────────────────────────────────────────────
const SOURCES: Record<string, { label: string; arcgisUrl: string }> = {
  arcgis_brest_metropole: {
    label:     'Brest Métropole — Panneaux publicitaires',
    arcgisUrl: 'https://geo.brest-metropole.fr/arcgis/rest/services/public/GPB_ESP/MapServer/1410001',
  },
};

// ─── Types stream ─────────────────────────────────────────────────────────────
type StreamEvent =
  | { type: 'status';   message: string }
  | { type: 'progress'; page: number; fetched: number; inserted: number; updated: number; errors: number }
  | { type: 'done';     run_id: string; nb_total: number; nb_inseres: number; nb_maj: number; nb_doublons: number; nb_erreurs: number }
  | { type: 'error';    message: string };

// ─── Normalisation ArcGIS Brest → ligne panneaux_affichage ───────────────────
interface ArcGISFeature {
  attributes: {
    OBJECTID:   number;
    PUBLICITAI: string | null;
    CLASS:      string | null;
    NOIMM:      number | null;
    ADRESSE:    string | null;
    ADR2:       string | null;
    NBRE_FACE:  number | null;
    COMMUNE:    string | null;
    [key: string]: unknown;
  };
  geometry: { x: number; y: number };
}

/** 'LE RELECQ-KERHUON' → 'Le Relecq-Kerhuon' */
function titleCaseVille(v: string | null): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  return s.toLowerCase().replace(/(^|[\s\-'])\p{L}/gu, c => c.toUpperCase());
}

function normalizeFeature(f: ArcGISFeature, source: string) {
  const a = f.attributes;
  const lat = f.geometry?.y;
  const lng = f.geometry?.x;

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;

  // Adresse composée : numéro + rue principale (+ rue secondaire si distincte)
  const num    = a.NOIMM ? Math.round(a.NOIMM).toString() : '';
  const rue1   = (a.ADRESSE ?? '').trim();
  const rue2   = (a.ADR2 ?? '').trim();
  const adresse = [num, rue1, rue2 && rue2 !== rue1 ? rue2 : '']
    .filter(Boolean).join(' ').trim() || null;

  const sourceRef = a.OBJECTID.toString();

  return {
    source,
    source_ref:        sourceRef,
    reference_panneau: sourceRef,
    regie:             (a.PUBLICITAI ?? '').trim() || null,
    type_panneau:      (a.CLASS ?? '').trim() || null,
    adresse,
    ville:             titleCaseVille(a.COMMUNE),
    nb_faces:          a.NBRE_FACE != null ? Math.round(a.NBRE_FACE) : null,
    actif:             true,
    lat,
    lng,
    metadata:          a,
    date_import:       new Date().toISOString(),
    date_maj:          new Date().toISOString(),
  };
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const rl = checkImportRateLimit('import-ooh-arcgis');
  if (!rl.ok) {
    return Response.json(
      { error: `Trop d'imports simultanés. Réessayez dans ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  let sourceKey: string;
  let customUrl: string | undefined;
  let customLabel: string | undefined;

  let replace = false;
  try {
    const body = await req.json();
    sourceKey   = body.source?.trim() ?? 'custom';
    customUrl   = body.arcgisUrl?.trim();
    customLabel = body.label?.trim();
    replace     = body.replace === true;
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  // ── Validation SSRF sur les URLs personnalisées ─────────────────────────────
  if (customUrl) {
    const check = validateArcgisUrl(customUrl);
    if (!check.ok) return Response.json({ error: check.error }, { status: 400 });
  }

  // Source prédéfinie ou URL personnalisée
  let sourceConfig = SOURCES[sourceKey];
  if (!sourceConfig) {
    if (!customUrl) {
      return Response.json({ error: `Source inconnue: ${sourceKey} — fournir arcgisUrl` }, { status: 400 });
    }
    sourceConfig = { label: customLabel ?? customUrl, arcgisUrl: customUrl };
    sourceKey    = 'custom_' + new URL(customUrl).hostname.replace(/\./g, '_');
  } else if (customUrl) {
    // Override URL même sur source connue
    sourceConfig = { ...sourceConfig, arcgisUrl: customUrl };
  }

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { /* closed */ }
      };

      const supabase   = createAdminClient();
      let runId: string | null = null;

      try {
        // ── 1. Créer l'import_run ────────────────────────────────────────────
        send({ type: 'status', message: `Démarrage import "${sourceConfig.label}"…` });
        const { data: runData, error: runErr } = await supabase
          .from('import_runs_ooh')
          .insert({ source: sourceKey, url: sourceConfig.arcgisUrl, statut: 'running' })
          .select('id')
          .single();

        if (runErr) throw new Error(`Création import_run: ${runErr.message}`);
        runId = runData.id;

        // ── 1b. Supprimer les données existantes si replace=true ─────────────
        if (replace) {
          send({ type: 'status', message: `Suppression des données existantes (${sourceKey})…` });
          await supabase.from('panneaux_affichage').delete().eq('source', sourceKey);
          // Supprimer aussi l'entrée data_sources existante
          await supabase.from('data_sources').delete().filter('mapping->>source_key', 'eq', sourceKey);
        }

        // ── 1c. Entrée data_sources (réutilisée si elle existe déjà) ─────────
        const { data: existingDs } = await supabase
          .from('data_sources')
          .select('id')
          .filter('mapping->>source_key', 'eq', sourceKey)
          .maybeSingle();

        let dataSourceId: string | null = existingDs?.id ?? null;
        if (!dataSourceId) {
          const { data: dsData, error: dsErr } = await supabase.from('data_sources').insert({
            name:              sourceConfig.label,
            type:              'panneaux',
            original_filename: sourceConfig.arcgisUrl,
            file_format:       'arcgis',
            status:            'active',
            organization_id:   profile.organization_id,
            mapping:           { source_key: sourceKey, run_id: runId },
          }).select('id').single();
          if (dsErr) throw new Error(`Création data_sources: ${dsErr.message}`);
          dataSourceId = dsData.id;
        }

        // ── 1d. Références déjà en base pour cette source (compteurs insérés/MAJ)
        const { data: existingRefRows } = await supabase
          .from('panneaux_affichage')
          .select('source_ref')
          .eq('source', sourceKey)
          .limit(100000);
        const existingRefs = new Set((existingRefRows ?? []).map(r => r.source_ref as string));

        // ── 2. Paginer ArcGIS REST ───────────────────────────────────────────
        let offset       = 0;
        let hasMore      = true;
        let nbTotal      = 0;
        let nbInseres    = 0;
        let nbMaj        = 0;
        let nbDoublons   = 0;
        let nbErreurs    = 0;
        const erreurs: string[] = [];
        let page         = 0;

        while (hasMore) {
          page++;
          const url = new URL(`${sourceConfig.arcgisUrl}/query`);
          url.searchParams.set('where',             '1=1');
          url.searchParams.set('outFields',         '*');
          url.searchParams.set('outSR',             '4326');
          url.searchParams.set('f',                 'json');
          url.searchParams.set('resultOffset',      offset.toString());
          url.searchParams.set('resultRecordCount', PAGE_SIZE.toString());

          send({ type: 'status', message: `Page ${page} — offset ${offset}…` });

          // Revalider CHAQUE URL (initiale + chaque Location de redirection)
          // contre la même whitelist — fetch() suit les 3xx sans revalider.
          let resp: Response;
          {
            let currentUrl = url.toString();
            for (let hop = 0; ; hop++) {
              if (hop > MAX_REDIRECTS) {
                throw new Error(`Trop de redirections (max ${MAX_REDIRECTS})`);
              }
              const hopCheck = validateArcgisUrl(currentUrl);
              if (!hopCheck.ok) {
                throw new Error(`Redirection vers une cible non autorisée : ${hopCheck.error}`);
              }
              const r = await fetch(currentUrl, {
                signal: AbortSignal.timeout(FETCH_TIMEOUT),
                redirect: 'manual',
              });
              if (r.status >= 300 && r.status < 400) {
                const location = r.headers.get('location');
                if (!location) throw new Error('Redirection sans en-tête Location');
                currentUrl = new URL(location, currentUrl).toString();
                continue;
              }
              resp = r;
              break;
            }
          }

          if (!resp.ok) throw new Error(`ArcGIS HTTP ${resp.status}`);

          const contentType = resp.headers.get('content-type') ?? '';
          if (!contentType.includes('json')) {
            const preview = await resp.text();
            throw new Error(
              `La réponse n'est pas du JSON (${contentType}). ` +
              `Vérifiez l'URL — elle doit pointer vers un endpoint ArcGIS REST, pas une page web. ` +
              `Début de la réponse : ${preview.slice(0, 80)}`
            );
          }

          const json = await resp.json() as {
            features?: ArcGISFeature[];
            exceededTransferLimit?: boolean;
            error?: { message: string };
          };

          if (json.error) throw new Error(`ArcGIS error: ${json.error.message}`);

          const features = json.features ?? [];
          hasMore = json.exceededTransferLimit === true && features.length > 0;
          offset += features.length;
          nbTotal += features.length;

          if (features.length === 0) break;

          // ── 3. Normaliser ────────────────────────────────────────────────
          const rows = features
            .map(f => normalizeFeature(f, sourceKey))
            .filter((r): r is NonNullable<typeof r> => r !== null);

          // ── 4. Upsert par batch (ON CONFLICT source+source_ref → update) ──
          for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            // `batch` garde sa forme inferee (les compteurs plus bas lisent
            // `r.source_ref`) ; `triggerFilled` n'est applique qu'a la frontiere
            // de l'upsert, ou `geom` — posee par trg_panneaux_auto_geom — est
            // reclamee par les types generes.
            const batch = rows.slice(i, i + BATCH_SIZE).map(r => ({
              ...r,
              organization_id: profile.organization_id,
              data_source_id:  dataSourceId,
            }));

            const { error: upsertErr } = await supabase
              .from('panneaux_affichage')
              .upsert(
                batch.map(r => triggerFilled<'panneaux_affichage', 'geom'>({ ...r, metadata: toJson(r.metadata) })),
                { onConflict: 'source,source_ref' },
              );

            if (upsertErr) {
              nbErreurs += batch.length;
              erreurs.push(upsertErr.message);
              send({ type: 'error', message: `Batch upsert: ${upsertErr.message}` });
            } else {
              for (const r of batch) {
                if (existingRefs.has(r.source_ref)) {
                  nbMaj++;
                } else {
                  nbInseres++;
                  existingRefs.add(r.source_ref);
                }
              }
            }
          }

          send({
            type:     'progress',
            page,
            fetched:  nbTotal,
            inserted: nbInseres,
            updated:  nbMaj,
            errors:   nbErreurs,
          });
        }

        // ── 5. Finaliser l'import_run ────────────────────────────────────────
        await supabase.from('import_runs_ooh').update({
          statut:      'done',
          termine_le:  new Date().toISOString(),
          nb_total:    nbTotal,
          nb_inseres:  nbInseres,
          nb_maj:      nbMaj,
          nb_doublons: nbDoublons,
          nb_erreurs:  nbErreurs,
          erreurs:     erreurs.slice(0, 50),
        }).eq('id', runId);

        // ── 6. Mettre à jour l'entrée data_sources (visible dans /admin/sources)
        await supabase.from('data_sources').update({
          row_count:   nbInseres + nbMaj,
          valid_count: nbInseres + nbMaj,
          error_count: nbErreurs,
          mapping:     { source_key: sourceKey, run_id: runId },
        }).eq('id', dataSourceId);

        send({ type: 'done', run_id: runId!, nb_total: nbTotal, nb_inseres: nbInseres, nb_maj: nbMaj, nb_doublons: nbDoublons, nb_erreurs: nbErreurs });

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message: msg });

        if (runId) {
          await supabase.from('import_runs_ooh').update({
            statut:     'error',
            termine_le: new Date().toISOString(),
            erreurs:    [msg],
          }).eq('id', runId);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':             'application/x-ndjson; charset=utf-8',
      'Transfer-Encoding':        'chunked',
      'Cache-Control':            'no-cache, no-store',
      'X-Content-Type-Options':   'nosniff',
    },
  });
}

// ─── GET : liste des imports récents ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('import_runs_ooh')
    .select('*')
    .order('lance_le', { ascending: false })
    .limit(20);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ runs: data, sources: SOURCES });
}

// ─── PATCH : renommer un run + data_sources ───────────────────────────────────
export async function PATCH(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const { id, label } = await req.json().catch(() => ({}));
  if (!id || !label?.trim()) return Response.json({ error: 'id et label requis' }, { status: 400 });

  const supabase = createAdminClient();

  // 1. Mettre à jour import_runs_ooh
  const { error: runErr } = await supabase.from('import_runs_ooh').update({ source: label.trim() }).eq('id', id);
  if (runErr) return Response.json({ error: runErr.message }, { status: 500 });

  // 2. Mettre à jour data_sources (cherche par run_id dans mapping)
  await supabase.from('data_sources')
    .update({ name: label.trim() })
    .filter('mapping->>run_id', 'eq', id);

  return Response.json({ ok: true });
}

// ─── DELETE : supprimer un run de l'historique ────────────────────────────────
export async function DELETE(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const { id } = await req.json().catch(() => ({}));
  if (!id) return Response.json({ error: 'id requis' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('import_runs_ooh').delete().eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
