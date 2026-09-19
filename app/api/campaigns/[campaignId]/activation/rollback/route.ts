/**
 * POST /api/campaigns/[campaignId]/activation/rollback — marque un lot comme annulé
 *
 * Tâche 20 (2026-09-13).
 *
 * ── Ce que cette route fait, et ce qu'elle NE fait PAS ────────────────────
 *
 * Elle marque le lot et ses cibles `annule`, et enregistre qui l'a demandé.
 * Elle **ne rappelle aucun DSP**, et c'est un choix explicite, pas un oubli.
 *
 * Le push DV360 est ADDITIF : il ajoute des geo IDs au ciblage existant d'un
 * line item sans effacer ce qui s'y trouvait. Défaire réellement une poussée
 * demanderait donc de RETIRER exactement les geo IDs ajoutés — ce que
 * `bulkEditAssignedTargetingOptions` sait faire, mais qui exige de connaître la
 * liste exacte assignée par ce lot. Or la route de push existante
 * (`/api/admin/dsp/dv360/targeting/push`) ne rend pas cette liste : elle rend
 * un compte. Inventer une reconstitution à partir de la zone reviendrait à
 * retirer aussi des geo IDs qu'un autre lot, ou un opérateur, avait assignés —
 * c'est-à-dire à casser un ciblage qu'on n'a pas posé.
 *
 * **Un retour arrière qui retire le ciblage de quelqu'un d'autre est pire
 * qu'un retour arrière qui n'existe pas.** La route est donc honnête sur sa
 * portée : elle rend `retire_du_dsp: false` et la marche à suivre, plutôt que
 * de laisser croire que la poussée a été défaite.
 *
 * Le vrai retour arrière suppose que la route de push rende les geo IDs
 * assignés. C'est une modification de `/api/admin/dsp/dv360/targeting/push`,
 * donc hors du périmètre de cette tâche — qui devait ENVELOPPER ce push, pas
 * le réécrire.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { lireCorps } from '@/lib/api/valider-corps';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

const CorpsSchema = z.object({
  lot_id: z.string().uuid(),
  /**
   * Confirmation explicite. C'est une action sortante et difficilement
   * réversible : on n'annule pas un lot par un clic distrait.
   */
  confirme: z.literal(true),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const { campaignId } = await params;
  if (!IdSchema.safeParse(campaignId).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { lot_id } = corps.valeur;

  const supabase = createAdminClient();
  const acces = await checkCampaignAccess(supabase, profile, campaignId);
  if (acces !== 'ok') return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });

  // Le lot doit appartenir à CETTE campagne : un uuid de lot d'une autre
  // campagne ne doit pas être annulable par ce chemin.
  const { data: lot, error: erreurLot } = await supabase
    .from('activation_lots')
    .select('id, statut, canal, version_strategie')
    .eq('id', lot_id)
    .eq('campaign_id', campaignId)
    .maybeSingle();
  if (erreurLot) {
    console.error('[activation/rollback] lot:', erreurLot.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  if (!lot) return NextResponse.json({ error: 'Lot introuvable.' }, { status: 404 });
  if (lot.statut === 'annule') {
    return NextResponse.json({ error: 'Ce lot est déjà annulé.' }, { status: 409 });
  }
  // Un lot `en_cours` a une boucle de poussée qui tourne ENCORE : elle
  // repasserait les cibles en `pousse` puis le lot en `termine` juste après
  // cette annulation. L'utilisateur verrait sa confirmation, puis le lot
  // redeviendrait « terminé » au rechargement suivant — une annulation qui
  // ment est pire qu'une annulation refusée.
  if (lot.statut === 'en_cours') {
    return NextResponse.json(
      {
        error: 'lot_en_cours',
        message: 'Cette activation est encore en cours. Attendez qu’elle se termine avant de l’annuler.',
      },
      { status: 409 },
    );
  }

  // supabase-js ne lève pas : une mise à jour qui échoue passerait inaperçue,
  // et le lot resterait « terminé » alors qu'on le croit annulé (CLAUDE.md).
  const maintenant = new Date().toISOString();
  const { error: erreurCibles, count: nCibles } = await supabase
    .from('activation_cibles')
    .update({ statut: 'annule', maj_le: maintenant }, { count: 'exact' })
    .eq('lot_id', lot_id)
    .neq('statut', 'annule');
  if (erreurCibles) {
    console.error('[activation/rollback] cibles:', erreurCibles.message);
    return NextResponse.json({ error: 'Annulation impossible.' }, { status: 500 });
  }

  const { error: erreurMaj } = await supabase
    .from('activation_lots')
    .update({ statut: 'annule', termine_le: maintenant })
    .eq('id', lot_id);
  if (erreurMaj) {
    console.error('[activation/rollback] maj lot:', erreurMaj.message);
    return NextResponse.json({ error: 'Annulation impossible.' }, { status: 500 });
  }

  return NextResponse.json({
    lot_id,
    statut: 'annule',
    // `count` ne vaut quelque chose QUE parce que `{ count: 'exact' }` a été
    // passé : sans l'option il vaudrait `null`, et un rapport affichant
    // `count || 0` annoncerait « 0 annulée » après en avoir annulé vingt
    // (CLAUDE.md, constaté sur /api/admin/sources/[id]).
    n_cibles_annulees: nCibles ?? 0,
    // Dit franchement ce qui n'a PAS été fait — voir l'en-tête.
    retire_du_dsp: false,
    message:
      'Le lot est marqué annulé dans MAGELIAN. Le ciblage déjà poussé n’a PAS été retiré '
      + 'du DSP : la poussée est additive et la route de push ne rend pas la liste exacte '
      + 'des geo IDs assignés, donc les retirer risquerait d’effacer un ciblage posé '
      + 'ailleurs. Retirez-les depuis l’interface du DSP si nécessaire.',
  });
}
