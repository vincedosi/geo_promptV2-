/**
 * POST /api/radio/import-arcom-ods
 * Import Arcom ODS reference file — creates/updates radios with frequencies.
 * Super-admin only. Accepts multipart/form-data with .ods file.
 * Returns NDJSON streaming progress.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { lireFormulaire, fichierDeFormulaire } from '@/lib/api/valider-corps';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { ImportLogger } from '@/lib/radio/import-logger';
import { parseArcomODS, aggregateByRadio } from '@/lib/radio/arcom-ods-parser';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_UPLOAD = 25 * 1024 * 1024; // 25 Mo

export async function POST(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  // `req.formData()` levait sur un corps qui n'est pas multipart : la route
  // repondait 500 pour une faute d'appelant. Et `as File` mentait sur une valeur
  // texte deposee sous « file ».
  const depot = await lireFormulaire(req, z.object({}));
  if (!depot.ok) return Response.json({ error: depot.message }, { status: 400 });

  const file = fichierDeFormulaire(depot.formulaire, 'file');
  if (!file) {
    return Response.json({ error: 'Fichier .ods requis (champ "file")' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD) {
    return Response.json(
      { error: `Fichier trop volumineux (limite : ${MAX_UPLOAD / 1024 / 1024} Mo)` },
      { status: 413 },
    );
  }

  const supabase = createAdminClient();

  // Create import log
  const { data: logData } = await supabase
    .from('radio_imports_log')
    .insert({ type: 'arcom', status: 'running', source_file: file.name })
    .select('id')
    .single();
  const logId = logData?.id ?? 'unknown';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { /* closed */ }
      };
      const logger = new ImportLogger(supabase, logId, send);

      try {
        // Phase PARSE
        const buffer = Buffer.from(await file.arrayBuffer());
        await logger.info('PARSE', `Parsing du fichier ${file.name} (${(buffer.length / 1024).toFixed(0)} Ko)...`);

        const entries = await parseArcomODS(buffer, file.name);
        const aggregated = aggregateByRadio(entries);

        await logger.info('PARSE', `${entries.length} entrées parsées, ${aggregated.length} radios uniques`);

        // Category breakdown
        const catCounts: Record<string, number> = {};
        for (const e of entries) {
          catCounts[e.categorie_arcom] = (catCounts[e.categorie_arcom] ?? 0) + 1;
        }
        await logger.info('VALIDATE', `Catégories : ${Object.entries(catCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);

        // Phase CLEANUP — remove junk auto-created radios
        await logger.phase('CLEANUP', async () => {
          // Nullify FK references to junk radios
          const { data: junkRadios } = await supabase
            .from('radios')
            .select('id')
            .or('nom.like.Radio %.% MHz%,nom.eq.TDF,nom.eq.TOWERCAST,nom.eq.Site privé,nom.eq.ARCOM');

          if (junkRadios && junkRadios.length > 0) {
            const junkIds = junkRadios.map(r => r.id);
            for (let i = 0; i < junkIds.length; i += 200) {
              const batch = junkIds.slice(i, i + 200);
              await supabase.from('emetteurs_radio').update({ radio_id: null }).in('radio_id', batch);
            }
            for (let i = 0; i < junkIds.length; i += 200) {
              const batch = junkIds.slice(i, i + 200);
              await supabase.from('radios').delete().in('id', batch);
            }
            await logger.info('CLEANUP', `${junkRadios.length} radios bidons supprimées`);
          } else {
            await logger.info('CLEANUP', 'Aucune radio bidon à supprimer');
          }
        });

        // Phase UPSERT — insert/update all radios from ODS
        //
        // ── PERF-004 : de plus de 2 000 requêtes à une trentaine ────────────
        //
        // Cette boucle faisait un SELECT puis un UPDATE ou un INSERT **par
        // radio**. Avec ~1 175 radios, cela représentait plus de 2 300
        // requêtes séquentielles par import, sur une instance dont le budget
        // d'I/O a déjà mis l'application à terre trois fois.
        //
        // Le remède tient en deux idées :
        //   1. UNE lecture des noms déjà connus, au lieu d'une par radio. Elle
        //      sert uniquement à distinguer « créée » de « mise à jour » dans
        //      le rapport — l'écriture, elle, n'en a pas besoin ;
        //   2. un `upsert` sur `nom`, par lots de 50 (règle du projet). La
        //      contrainte `radios_nom_unique` rend `onConflict: 'nom'`
        //      inférable par PostgREST.
        //
        // Les compteurs restent exacts : ils viennent de la comparaison
        // d'ensembles, pas du nombre de requêtes.
        let created = 0, updated = 0;
        await logger.phase('UPSERT', async () => {
          const { data: dejaConnues, error: lectureErr } = await supabase
            .from('radios').select('nom');
          if (lectureErr) {
            throw new Error(`Lecture des radios existantes impossible : ${lectureErr.message}`);
          }
          const nomsConnus = new Set((dejaConnues ?? []).map(r => r.nom));

          const lignes = aggregated.map(r => ({
            nom: r.nom,
            categorie_arcom: r.categorie_arcom,
            portee: r.portee,
            groupe_media: r.titulaire,
            metadata: {
              frequences_fm: r.frequences_fm,
              frequences_dab: r.frequences_dab,
              blocs_dab: r.blocs_dab,
              categorie_label: r.categorie_label,
              titulaire: r.titulaire,
              source: 'arcom_ods',
              import_date: new Date().toISOString().slice(0, 10),
            },
          }));

          created = lignes.filter(l => !nomsConnus.has(l.nom)).length;
          updated = lignes.length - created;

          const TAILLE_LOT = 50;
          for (let i = 0; i < lignes.length; i += TAILLE_LOT) {
            const lot = lignes.slice(i, i + TAILLE_LOT);
            const { error } = await supabase
              .from('radios').upsert(lot, { onConflict: 'nom' });
            if (error) {
              // Un lot perdu en silence, c'est un import qui se dit réussi sur
              // des données partielles. On arrête et on nomme le lot.
              throw new Error(
                `Écriture du lot ${Math.floor(i / TAILLE_LOT) + 1} échouée `
                + `(radios ${i + 1} à ${i + lot.length}) : ${error.message}`,
              );
            }
            await logger.info('UPSERT', `${Math.min(i + TAILLE_LOT, lignes.length)}/${lignes.length} radios écrites`);
          }
          await logger.info('UPSERT', `Terminé : ${created} créées, ${updated} mises à jour`);
        });

        // Phase FINALIZE
        const totalFm = aggregated.reduce((s, r) => s + r.frequences_fm.length, 0);
        const totalDab = aggregated.reduce((s, r) => s + r.frequences_dab.length, 0);

        await supabase.from('radio_imports_log').update({
          status: 'success',
          completed_at: new Date().toISOString(),
          stats: { radios: aggregated.length, created, updated, frequences_fm: totalFm, frequences_dab: totalDab },
        }).eq('id', logId);

        await logger.success('FINALIZE', `Import terminé : ${aggregated.length} radios (${created} créées, ${updated} mises à jour), ${totalFm} fréquences FM, ${totalDab} fréquences DAB+`);

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await logger.error('FATAL', msg, { stack: err instanceof Error ? err.stack : undefined });
        await supabase.from('radio_imports_log').update({
          status: 'error', completed_at: new Date().toISOString(), error_message: msg,
        }).eq('id', logId);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
