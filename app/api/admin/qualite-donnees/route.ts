/**
 * GET  /api/admin/qualite-donnees          — les DERNIERS relevés, sans rien recalculer
 * POST /api/admin/qualite-donnees          — relance UNE vérification, et une seule
 *
 * (2026-09-13) Rend visibles les trous de données qui ne lèvent aucune erreur.
 * C'est leur silence qui les rend coûteux : une donnée absente se lit comme un
 * résultat, et oriente un achat média. Six relevés en une seule journée de
 * travail sur les scores — dont `part_couples_enfants`, actif au registre donc
 * proposé à l'utilisateur, et pointant sur une colonne vide sur les 49 448 IRIS.
 *
 * ── Quatre familles de panne, jamais mélangées ─────────────────────────────
 *   absente   : la colonne source ne contient rien         → `indicateurs`
 *   partielle : elle ne couvre qu'une part du territoire   → `indicateurs`
 *   périmée   : la donnée existe mais date                 → `fraicheur`
 *   fausse    : elle existe, est fraîche, et ment          → `invariants`
 *
 * La quatrième est la plus dure et la plus utile ; elle s'appuie sur les
 * valeurs déjà validées contre l'INSEE lors de la cascade IRIS.
 *
 * ── Deux règles non négociables, et pourquoi ──────────────────────────────
 *
 * 1. **UNE vérification à la fois, jamais de « tout vérifier ».** Le balayage
 *    des colonnes d'`iris` coûte ~220 Mo de lecture et 1,4 s (mesuré). Un
 *    bouton qui lancerait les quatre d'un coup, sur un disque Nano plafonné à
 *    5 Mo/s et 250 IOPS, serait l'incident du 28/03 rejoué volontairement — à
 *    ceci près qu'il le serait par l'outil censé prévenir ce genre de défaut.
 *
 * 2. **Rouvrir la page ne recalcule RIEN.** Le GET lit `qualite_releves`
 *    (sql/149) : l'utilisateur voit la mesure ET sa date, et décide de
 *    relancer. Un affichage qui se rafraîchit tout seul ferait payer un
 *    balayage complet à chaque coup d'œil.
 *
 * Et une règle de construction : aucune liste de colonnes n'est écrite à la
 * main. Tout se dérive d'`information_schema` et de `cible_indicator_registry`
 * — les colonnes d'`iris` sont dynamiques (CLAUDE.md), une liste tapée serait
 * périmée au prochain import, en silence. Ce serait le problème même que cette
 * page prétend résoudre, réintroduit dans l'outil qui le résout.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { toJson } from '@/lib/supabase/rpc-json';
import type { TableInsert } from '@/lib/supabase/tables';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Les quatre vérifications, et la RPC qui les calcule. Ajouter une
 * vérification = une entrée ici plus une fonction SQL, rien d'autre.
 */
const VERIFICATIONS = {
  indicateurs: {
    rpc: 'qualite_indicateurs',
    libelle: 'Indicateurs du registre pointant vers du vide',
    cout: 'un balayage complet d’iris (~220 Mo, ~1,4 s)',
  },
  fraicheur: {
    rpc: 'qualite_fraicheur',
    libelle: 'Fraîcheur des sources à cadence attendue',
    cout: 'quelques agrégats sur de petites tables',
  },
  invariants: {
    rpc: 'qualite_invariants',
    libelle: 'Invariants métier validés contre l’INSEE',
    cout: 'un balayage complet d’iris (~220 Mo, ~1,4 s)',
  },
  colonnes: {
    rpc: 'qualite_colonnes_iris',
    libelle: 'Taux de remplissage de chaque colonne d’iris',
    cout: 'un balayage complet d’iris (~220 Mo, ~1,4 s)',
  },
} as const;

type CleVerification = keyof typeof VERIFICATIONS;

/**
 * Quota serré, et assumé : chaque relance peut coûter 220 Mo de lecture.
 * Compteur PARTAGÉ en base (`consommer_quota`, sql/135) — jamais une Map
 * locale, qui ne limiterait rien sur Vercel (CLAUDE.md).
 */
const limiteur = createRateLimiter({ max: 6, window: '60 s', prefix: 'geo:rl:qualite-donnees' });

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('qualite_releves')
    .select('verification, releve, calcule_le, duree_ms');

  if (error) {
    console.error('[GET /api/admin/qualite-donnees]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const parCle = new Map((data ?? []).map((r) => [r.verification, r]));

  return NextResponse.json(
    {
      verifications: (Object.keys(VERIFICATIONS) as CleVerification[]).map((cle) => {
        const releve = parCle.get(cle);
        return {
          cle,
          libelle: VERIFICATIONS[cle].libelle,
          cout: VERIFICATIONS[cle].cout,
          // `null` = jamais lancée. Un écran vide qui se présente comme « rien
          // à signaler » serait le pire résultat possible pour cette page.
          releve: releve?.releve ?? null,
          calcule_le: releve?.calcule_le ?? null,
          duree_ms: releve?.duree_ms ?? null,
        };
      }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const CorpsSchema = z.object({
  verification: z.enum(['indicateurs', 'fraicheur', 'invariants', 'colonnes']),
});

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  // UNE seule clé acceptée par requête : le schéma n'admet pas de tableau, et
  // c'est délibéré (voir l'en-tête, règle 1).
  const cle = corps.valeur.verification;
  const supabase = createAdminClient();

  const debut = Date.now();
  const { data, error } = await supabase.rpc(VERIFICATIONS[cle].rpc);
  const duree = Date.now() - debut;

  if (error) {
    console.error('[POST /api/admin/qualite-donnees]', cle, error.message);
    return NextResponse.json(
      { error: `La vérification « ${VERIFICATIONS[cle].libelle} » a échoué.`, detail: error.message },
      { status: 500 },
    );
  }

  const ligne: TableInsert<'qualite_releves'> = {
    verification: cle,
    releve: toJson(data as Record<string, unknown>),
    calcule_le: new Date().toISOString(),
    duree_ms: duree,
  };
  const { error: erreurEcriture } = await supabase
    .from('qualite_releves')
    .upsert(ligne, { onConflict: 'verification' });

  // Un échec d'écriture ne doit pas faire perdre une mesure déjà payée en I/O :
  // le relevé repart au client, en le disant.
  if (erreurEcriture) console.error('[POST /api/admin/qualite-donnees] écriture:', erreurEcriture.message);

  return NextResponse.json(
    {
      cle,
      libelle: VERIFICATIONS[cle].libelle,
      releve: data,
      calcule_le: ligne.calcule_le,
      duree_ms: duree,
      persiste: !erreurEcriture,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
