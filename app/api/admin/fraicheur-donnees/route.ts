/**
 * GET  /api/admin/fraicheur-donnees — le DERNIER relevé, sans rien remesurer
 * POST /api/admin/fraicheur-donnees — relance la mesure
 *
 * (2026-09-13) D'où vient chaque donnée non socio-démo, comment elle entre, où
 * elle atterrit, et de quand elle date. Le périmètre est tout SAUF POI, IRIS et
 * Filosofi, qui relèvent de `/admin/qualite-donnees`.
 *
 * Ce qui est déclaré et ce qui est mesuré ne se mélangent pas :
 *   - `lib/donnees/registre-fraicheur.ts` déclare l'identité d'une source
 *     (fournisseur, mode de collecte, table d'atterrissage, nature).
 *   - La RPC `fraicheur_sources` (sql/161) MESURE en base ce qui est mesurable.
 * Aucune date n'est écrite en dur nulle part : tout chiffre affiché vient d'une
 * mesure, et porte l'heure de cette mesure.
 *
 * ── Trois règles, et pourquoi ──────────────────────────────────────────────
 *
 * 1. **Rouvrir l'onglet ne mesure RIEN.** Le GET lit `qualite_releves`
 *    (sql/149). Un affichage qui se rafraîchit tout seul ferait payer les
 *    lectures à chaque coup d'œil, sur un disque Nano plafonné à 5 Mo/s.
 *
 * 2. **Le flux routier ne part jamais avec les autres.** Mesuré au plan
 *    d'exécution : `max(created_at)` sur `comptages_routiers` est un Parallel
 *    Seq Scan de 44 505 blocs, soit 347 Mo lus et 1,78 s — la table n'a qu'un
 *    index BRIN sur cette colonne, et un BRIN n'accélère pas un `max()`. Les
 *    neuf autres sources réunies lisent moins de 15 Mo. Mélanger les deux
 *    ferait payer 347 Mo à chaque rafraîchissement ordinaire.
 *
 * 3. **Une mesure légère n'efface pas une mesure lourde déjà payée.** Le relevé
 *    persisté est FUSIONNÉ, source par source : une source non mesurée cette
 *    fois-ci garde sa valeur précédente, avec sa date. Écraser le relevé entier
 *    ferait disparaître le millésime du flux routier au premier clic sur
 *    « Relancer la mesure », et il faudrait repayer 347 Mo pour le retrouver.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import type { TableInsert } from '@/lib/supabase/tables';
import {
  SOURCES_DONNEES,
  CLE_RELEVE_FRAICHEUR,
  descripteursDeMesure,
  etatDeSource,
  fusionnerMesures,
  type ReleveFraicheur,
} from '@/lib/donnees/registre-fraicheur';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Deux quotas, parce que les deux chemins ne coûtent pas la même chose.
 *
 * Léger : moins de 15 Mo par passe. À 6/min, 90 Mo/min — sous le budget d'un
 * Nano (~300 Mo/min soutenu).
 * Lourd : 347 Mo par passe (mesuré). Un seul appel par minute, et c'est déjà
 * le plafond de ce que le disque encaisse sans entamer la réserve de burst.
 *
 * Compteurs PARTAGÉS en base (`consommer_quota`, sql/135), jamais une Map
 * locale : sur Vercel chaque invocation peut être une instance différente, et
 * un compteur en mémoire de processus ne limite rien (CLAUDE.md).
 */
const limiteurLeger = createRateLimiter({ max: 6, window: '60 s', prefix: 'geo:rl:fraicheur' });
const limiteurLourd = createRateLimiter({ max: 1, window: '60 s', prefix: 'geo:rl:fraicheur-lourd' });

/** Le registre, rendu tel quel au client. Il ne porte aucune mesure. */
function catalogue() {
  return SOURCES_DONNEES.map((s) => ({
    id: s.id,
    libelle: s.libelle,
    nature: s.nature,
    provenance: s.provenance,
    collecte: s.collecte,
    table: s.table,
    cadenceAttendueJours: s.cadenceAttendueJours,
    coutMesure: s.coutMesure,
    note: s.note,
  }));
}

/** Assemble catalogue et mesures, et dérive l'état de chaque source. */
function assembler(releve: ReleveFraicheur | null) {
  const maintenant = new Date();
  const parId = new Map((releve?.mesures ?? []).map((m) => [m.id, m]));

  return SOURCES_DONNEES.map((source) => {
    const mesure = parId.get(source.id);
    const { etat, ageJours } = etatDeSource(source, mesure, maintenant);
    return {
      ...catalogue().find((c) => c.id === source.id)!,
      etat,
      ageJours,
      nLignes: mesure?.n_lignes ?? null,
      nEstime: mesure?.n_estime ?? false,
      donneeMin: mesure?.donnee_min ?? null,
      donneeMax: mesure?.donnee_max ?? null,
      ingestionMax: mesure?.ingestion_max ?? null,
      nonMesure: mesure?.non_mesure ?? null,
    };
  });
}

async function lireReleve(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ releve: ReleveFraicheur | null; calculeLe: string | null; dureeMs: number | null }> {
  const { data, error } = await supabase
    .from('qualite_releves')
    .select('releve, calcule_le, duree_ms')
    .eq('verification', CLE_RELEVE_FRAICHEUR)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { releve: null, calculeLe: null, dureeMs: null };

  return {
    releve: data.releve as unknown as ReleveFraicheur,
    calculeLe: data.calcule_le,
    dureeMs: data.duree_ms,
  };
}

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();
  try {
    const { releve, calculeLe, dureeMs } = await lireReleve(supabase);
    return NextResponse.json(
      {
        sources: assembler(releve),
        // `null` = jamais mesuré. Un tableau vide qui se présenterait comme
        // « rien à signaler » serait le pire résultat possible pour cet onglet.
        mesureLe: calculeLe,
        dureeMs,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('[GET /api/admin/fraicheur-donnees]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
}

const CorpsSchema = z.object({
  /** Inclut le flux routier, seule source dont la mesure balaye sa table. */
  inclureLourd: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { inclureLourd } = corps.valeur;

  // Le quota est choisi APRÈS lecture du corps : une mesure lourde ne doit pas
  // consommer le quota léger, ni l'inverse.
  const quota = inclureLourd ? await limiteurLourd(profile.id) : await limiteurLeger(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();
  const debut = Date.now();

  const { data, error } = await supabase.rpc('fraicheur_sources', {
    p_sources: toJson(descripteursDeMesure()),
    p_inclure_lourd: inclureLourd,
  });
  const duree = Date.now() - debut;

  if (error) {
    console.error('[POST /api/admin/fraicheur-donnees]', error.message);
    return NextResponse.json(
      { error: 'La mesure de fraîcheur a échoué.', detail: error.message },
      { status: 500 },
    );
  }

  const frais = rpcJson<ReleveFraicheur>(data);

  // Fusion, règle 3 de l'en-tête : une source non mesurée cette fois-ci garde
  // sa mesure précédente. Sans cela, un rafraîchissement léger effacerait le
  // millésime du flux routier, payé 347 Mo.
  let precedent: ReleveFraicheur | null = null;
  try {
    precedent = (await lireReleve(supabase)).releve;
  } catch (e) {
    console.error('[POST /api/admin/fraicheur-donnees] lecture précédente:', e);
  }

  const mesures = fusionnerMesures(frais?.mesures ?? [], precedent?.mesures ?? []);

  const releve: ReleveFraicheur = { mesures, mesure_le: frais?.mesure_le ?? new Date().toISOString() };

  const ligne: TableInsert<'qualite_releves'> = {
    verification: CLE_RELEVE_FRAICHEUR,
    releve: toJson(releve as unknown as Record<string, unknown>),
    calcule_le: new Date().toISOString(),
    duree_ms: duree,
  };
  const { error: erreurEcriture } = await supabase
    .from('qualite_releves')
    .upsert(ligne, { onConflict: 'verification' });

  // Un échec d'écriture ne doit pas faire perdre une mesure déjà payée en I/O :
  // le relevé repart au client, en le disant.
  if (erreurEcriture) {
    console.error('[POST /api/admin/fraicheur-donnees] écriture:', erreurEcriture.message);
  }

  return NextResponse.json(
    {
      sources: assembler(releve),
      mesureLe: ligne.calcule_le,
      dureeMs: duree,
      inclureLourd,
      persiste: !erreurEcriture,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
