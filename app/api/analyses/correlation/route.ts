/**
 * GET /api/analyses/correlation?campaignId=&variable=
 *
 * Corrélation entre les impressions livrées par code postal et un indicateur
 * INSEE (Tâche 13, 2026-09-13). Répond à « ma campagne a-t-elle arrosé les
 * codes postaux qui comptent ? ».
 *
 * Lit `campaign_cp_rollup` — DÉJÀ agrégé — via `correlation_campagne_indicateur`
 * (sql/147), jamais `dsp_campaign_data`. L'appariement et la somme sur les
 * acteurs se font en SQL : voir l'en-tête de la migration pour la mesure qui
 * l'a imposé (10 205 lignes pour 2 041 CP, au-dessus du plafond PostgREST).
 * Le coefficient lui-même est calculé par `lib/analyses/correlation.ts`,
 * testé sans base.
 *
 * Comme `/api/analyses/score`, s'assure que l'indicateur est disponible par
 * code postal avant de corréler (`lib/analyses/indicateurs.ts`) :
 * `indicator_cp_values` est peuplée à la demande, pas référentielle — sans ce
 * filet, la corrélation rendrait « 0 code postal apparié » sur un indicateur
 * parfaitement valide, ce qui se lit comme un résultat et non comme une
 * donnée manquante.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { pearson, type PaireAppariee } from '@/lib/analyses/correlation';
import { assurerIndicateurCp } from '@/lib/analyses/indicateurs';
import { toJson } from '@/lib/supabase/rpc-json';
import type { TableInsert } from '@/lib/supabase/tables';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Même raison que pour le score : une matérialisation coûte une agrégation d'`iris`. */
const limiteur = createRateLimiter({ max: 12, window: '60 s', prefix: 'geo:rl:analyse-correlation' });

const QuerySchema = z.object({
  campaignId: z.string().uuid(),
  variable: z.string().min(1).max(100),
  /** Enregistre le lancement dans `analyses` (Tâche 11) — défaut : oui. */
  enregistrer: z.enum(['true', 'false']).optional(),
});

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée à ce compte.' }, { status: 400 });

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides : campaignId (uuid) et variable sont requis.' }, { status: 400 });
  }
  const { campaignId, variable } = parsed.data;

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();

  // ── Cloisonnement par organisation ────────────────────────────────────
  const acces = await checkCampaignAccess(supabase, profile, campaignId);
  if (acces === 'not_found') return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  if (acces !== 'ok') return NextResponse.json({ error: 'Accès refusé à cette campagne.' }, { status: 403 });

  // ── L'indicateur existe-t-il au registre ? ────────────────────────────
  const { data: meta, error: erreurRegistre } = await supabase
    .from('cible_indicator_registry')
    .select('indicator_code, label, unit')
    .eq('indicator_code', variable)
    .eq('active', true)
    .maybeSingle();
  if (erreurRegistre) {
    console.error('[GET /api/analyses/correlation] registre:', erreurRegistre.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  if (!meta) {
    return NextResponse.json({ error: `Indicateur inconnu ou inactif : ${variable}.` }, { status: 400 });
  }

  // ── Matérialisation paresseuse — logique partagée avec le score ───────
  const etat = await assurerIndicateurCp(supabase, variable);
  if (!etat.ok) {
    console.error('[GET /api/analyses/correlation] indicateur:', variable, etat.raison, etat.message);
    return NextResponse.json(
      { error: etat.message, raison: etat.raison },
      { status: etat.raison === 'inconnu' ? 400 : etat.raison === 'sans_donnees' ? 422 : 500 },
    );
  }
  const calculeLe = etat.calculeLe;

  // ── Les paires ────────────────────────────────────────────────────────
  const { data: lignes, error } = await supabase.rpc('correlation_campagne_indicateur', {
    p_campaign_id: campaignId,
    p_indicator_code: variable,
  });
  if (error) {
    console.error('[GET /api/analyses/correlation] rpc:', error.message);
    return NextResponse.json({ error: 'Calcul de la corrélation impossible.' }, { status: 500 });
  }

  const paires: PaireAppariee[] = (lignes ?? []).map((l) => ({
    code: l.postal_code,
    x: Number(l.impressions),
    y: Number(l.valeur),
  }));

  const r = pearson(paires.map((p) => p.x), paires.map((p) => p.y));

  // Combien de CP la campagne couvre-t-elle en tout ? Un coefficient calculé
  // sur 200 CP quand la campagne en touche 2 041 ne dit pas la même chose —
  // et la jointure de la RPC est INTERNE, donc muette sur ce qu'elle écarte.
  //
  // Par RPC et non par `count: 'exact'` : `campaign_cp_rollup` porte une ligne
  // par (CP, ACTEUR), donc un count exact annoncerait 10 205 « codes postaux »
  // là où la campagne en touche 2 041. supabase-js ne sait pas faire un
  // COUNT(DISTINCT). Et compter ici plutôt que dans la RPC d'appariement, qui
  // ne rend rien quand rien ne s'apparie — le cas où ce chiffre compte le plus.
  const { data: cpCampagne, error: erreurCompte } = await supabase.rpc('compte_cp_campagne', {
    p_campaign_id: campaignId,
  });
  if (erreurCompte) console.error('[GET /api/analyses/correlation] compte:', erreurCompte.message);

  // ── Le lancement devient une analyse enregistrée (Tâche 11) ───────────
  let analyseId: string | null = null;
  if (parsed.data.enregistrer !== 'false') {
    const ligne: TableInsert<'analyses'> = {
      org_id: orgId,
      created_by: profile.id,
      type: 'correlation',
      nom: `Corrélation — impressions × ${meta.label}`,
      parametres: toJson({ campaign_id: campaignId, variable }),
      maillage: 'cp',
      perimetre: toJson({ campaign_id: campaignId }),
      resultat: toJson({ r, n: paires.length }),
      statut: 'termine',
    };
    const { data: analyse, error: erreurAnalyse } = await supabase
      .from('analyses').insert(ligne).select('id').single();
    if (erreurAnalyse) console.error('[GET /api/analyses/correlation] enregistrement:', erreurAnalyse.message);
    else analyseId = analyse.id;
  }

  return NextResponse.json(
    {
      // `r` est TOUJOURS un nombre — `pearson` ne rend jamais NaN, qui
      // traverserait le JSON et casserait l'axe du nuage de points.
      r,
      n: paires.length,
      points: paires,
      indicateur: { code: meta.indicator_code, label: meta.label, unit: meta.unit, calcule_le: calculeLe },
      couverture: { cp_apparies: paires.length, cp_campagne: cpCampagne ?? null },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
