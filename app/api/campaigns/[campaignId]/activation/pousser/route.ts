/**
 * POST /api/campaigns/[campaignId]/activation/pousser — pousse le ciblage, ligne par
 * ligne, en disant ce qu'il fait (Tâche 20, 2026-09-13).
 *
 * **Cette route ENVELOPPE le push DV360 existant, elle ne le réécrit pas.**
 * `lib/dsp/dv360/client.ts` et `/api/admin/dsp/dv360/targeting/push` restent
 * intacts : ce qui manquait n'était pas le push, c'était tout ce qui
 * l'entoure — pré-vol, statut par line item, historique, retour arrière.
 *
 * ── Progression NDJSON, et ce n'est pas optionnel ─────────────────────────
 * Règle CLAUDE.md : jamais de traitement silencieux. Un push de vingt line
 * items qui rend une seule réponse à la fin laisse l'utilisateur devant un
 * bouton figé, sans savoir si ça avance, si ça a échoué au troisième, ni ce
 * qui est déjà parti. Chaque ligne du flux porte l'étape, le compteur et le
 * résultat de la cible traitée.
 *
 * ── `etat_avant` est écrit AVANT l'appel sortant ──────────────────────────
 * C'est la seule chose qui rend un retour arrière possible : le push DV360 est
 * ADDITIF, donc sans l'état antérieur on ne saurait pas quoi retirer. L'écrire
 * après l'appel laisserait, en cas d'interruption, une poussée partie et
 * intraçable.
 *
 * ── Ce que cette route refuse ─────────────────────────────────────────────
 * Elle rappelle le pré-vol et s'arrête si `activable` est faux. Un push sur une
 * stratégie non publiée ou dérivée enverrait au DSP un périmètre que personne
 * n'a validé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient, isSuperAdmin } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { lireCorps } from '@/lib/api/valider-corps';
import { zonesModifiees, type EmpreinteZones } from '@/lib/campaigns/version-strategie';
import { fetchAvecDelai } from '@/lib/http/fetch-avec-delai';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import type { TableInsert } from '@/lib/supabase/tables';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const IdSchema = z.string().uuid();

/** Au-delà, ce n'est plus une activation mais un import de masse. */
const MAX_CIBLES = 50;

/**
 * Seul canal réellement câblé. Accepter n'importe quelle chaîne enregistrait un
 * lot étiqueté `tiktok` dans l'historique pendant que le ciblage partait chez
 * DV360 — l'historique, dont c'est l'unique raison d'être, enregistrait un fait
 * FAUX. Le registre `dsp_channel_registry` liste d'autres canaux : ils seront
 * acceptés ici le jour où leur connecteur existe, pas avant.
 */
const CANAUX_CABLES = ['dv360'] as const;

const CorpsSchema = z.object({
  canal: z.enum(CANAUX_CABLES),
  advertiser_id: z.string().regex(/^\d+$/),
  /** Line items visés. Le pré-vol les a listés ; le client confirme lesquels. */
  cibles: z.array(z.object({
    line_item_id: z.string().regex(/^\d+$/),
    line_item_nom: z.string().max(200).optional(),
  })).min(1).max(MAX_CIBLES),
});

function ligne(objet: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(objet)}\n`);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée à ce compte.' }, { status: 400 });

  const { campaignId } = await params;
  if (!IdSchema.safeParse(campaignId).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  // Le corps est lu AVANT d'ouvrir le flux. Le lire dans `start()` du
  // ReadableStream consommerait un corps déjà parti — c'est exactement
  // l'incident du 08/04 (« request.formData() dans ReadableStream.start() »).
  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { canal, advertiser_id, cibles } = corps.valeur;

  const supabase = createAdminClient();
  const acces = await checkCampaignAccess(supabase, profile, campaignId);
  if (acces !== 'ok') return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });

  // ── Le droit de pousser, VÉRIFIÉ AVANT d'écrire quoi que ce soit ───────
  // Chaque cible ré-appelle en HTTP `/api/admin/dsp/dv360/targeting/push`,
  // dont le guard est `isSuperAdmin` STRICT — `requireAdmin()` de ce projet
  // n'est pas « admin », c'est « super_admin » (ARCHITECTURE.md, audit du
  // 2026-09-10). Un utilisateur `admin` ou `client` de l'org propriétaire
  // franchissait `requireAuth` + `checkCampaignAccess`, écrivait un
  // `activation_lots` et jusqu'à 50 `activation_cibles`, encaissait 50
  // réponses 401 des appels internes, et refermait le lot en `echec` :
  // 51 lignes écrites pour rien et un historique vide de sens. C'est
  // fail-closed côté sécurité — rien ne part chez DV360 — mais le refus doit
  // arriver en amont, pas se découvrir line item par line item.
  if (!isSuperAdmin(profile)) {
    return NextResponse.json(
      {
        error: 'droit_insuffisant',
        message: 'La poussée de ciblage vers un DSP est réservée aux super-administrateurs.',
      },
      { status: 403 },
    );
  }

  // ── Le pré-vol, rejoué côté serveur ───────────────────────────────────
  // Le client a pu l'appeler, mais on ne pousse pas sur la foi d'un appel
  // client : une zone a pu bouger entre son pré-vol et son clic.
  const { data: strategie } = await supabase
    .from('bidding_strategies')
    .select('id, zone_id')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!strategie) {
    return NextResponse.json({ error: 'Aucune stratégie pour cette campagne.' }, { status: 409 });
  }

  const { data: derniere } = await supabase
    .from('strategie_versions')
    .select('version, empreinte_zones')
    .eq('strategie_id', strategie.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!derniere) {
    return NextResponse.json(
      { error: 'strategie_non_publiee', message: 'Publiez la stratégie avant d’activer.' },
      { status: 409 },
    );
  }

  let courante: EmpreinteZones = {};
  if (strategie.zone_id) {
    const { data: emp } = await supabase.rpc('empreinte_zones', {
      p_zone_ids: [strategie.zone_id],
    });
    courante = rpcJson<EmpreinteZones>(emp) ?? {};
  }
  const modifiees = zonesModifiees((derniere.empreinte_zones ?? {}) as EmpreinteZones, courante);
  if (modifiees.length) {
    return NextResponse.json(
      {
        error: 'strategie_derivee',
        message: `${modifiees.length} zone(s) ont changé depuis la publication de la v${derniere.version}. Republiez avant d’activer.`,
        zones_modifiees: modifiees,
      },
      { status: 409 },
    );
  }

  if (!strategie.zone_id) {
    return NextResponse.json(
      { error: 'strategie_sans_zone', message: 'Cette stratégie n’a pas de zone à pousser.' },
      { status: 409 },
    );
  }
  const zoneId = strategie.zone_id;

  // ── Le lot, créé AVANT toute sortie ───────────────────────────────────
  const lotLigne: TableInsert<'activation_lots'> = {
    campaign_id: campaignId,
    org_id: orgId,
    canal,
    version_strategie: derniere.version,
    lance_par: profile.id,
    statut: 'en_cours',
  };
  const { data: lot, error: erreurLot } = await supabase
    .from('activation_lots').insert(lotLigne).select('id').single();
  if (erreurLot || !lot) {
    console.error('[activation/pousser] lot:', erreurLot?.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const origine = new URL(request.url).origin;
  const autorisation = request.headers.get('authorization') ?? '';

  // Partage entre `start()` et `cancel()` : le second signale l'abandon du
  // client, le premier le lit a chaque tour de boucle.
  let annule = false;

  const flux = new ReadableStream({
    async start(controller) {
      let pousses = 0;
      let echecs = 0;
      let interrompu = false;

      /**
       * Écrit dans le flux sans jamais laisser une exception sortir de la
       * boucle (B5). Si le client ferme son onglet, `enqueue` lève
       * « Controller is already closed » : sans cette garde, l'exception
       * remontait hors du `for`, la mise à jour finale du lot n'était JAMAIS
       * atteinte, et le lot restait `en_cours` pour toujours — alors que huit
       * poussées étaient bel et bien parties chez DV360.
       */
      const emettre = (objet: Record<string, unknown>) => {
        if (interrompu) return;
        try { controller.enqueue(ligne(objet)); }
        catch { interrompu = true; }
      };

      /**
       * Toute mise à jour d'état est LUE (B7). supabase-js ne lève pas : un
       * `update` qui échoue laisserait une cible `en_attente` alors que sa
       * poussée est partie, et le lot `en_cours` indéfiniment.
       */
      const majCible = async (id: string, champs: Record<string, unknown>) => {
        const { error } = await supabase.from('activation_cibles')
          .update({ ...champs, maj_le: new Date().toISOString() })
          .eq('id', id);
        if (error) console.error('[activation/pousser] maj cible:', id, error.message);
      };

      emettre({
        etape: 'debut', lot_id: lot.id, canal,
        version_strategie: derniere.version, total: cibles.length,
      });

      try {

      for (const [i, cible] of cibles.entries()) {
        // Le client est parti : on arrête d'appeler DV360 plutôt que de
        // continuer à pousser dans le vide pendant cinq minutes.
        if (interrompu || annule) { interrompu = true; break; }

        emettre({
          etape: 'cible', n: i + 1, total: cibles.length,
          line_item_id: cible.line_item_id, statut: 'en_cours',
        });

        // La ligne de cible est écrite AVANT l'appel sortant — voir l'en-tête.
        const cibleLigne: TableInsert<'activation_cibles'> = {
          lot_id: lot.id,
          line_item_id: cible.line_item_id,
          line_item_nom: cible.line_item_nom ?? null,
          statut: 'en_attente',
          etat_avant: toJson({
            // Le push DV360 est ADDITIF : l'état antérieur qu'il faut retenir
            // est l'ensemble des geo IDs déjà assignés. La route existante ne
            // les rend pas ; on garde donc le contexte qui permet de les
            // relire au moment du retour arrière, plutôt que d'inventer une
            // valeur qu'on n'a pas.
            advertiser_id, line_item_id: cible.line_item_id, zone_id: zoneId,
            releve_le: new Date().toISOString(),
          }),
        };
        const { data: cibleCreee, error: erreurCible } = await supabase
          .from('activation_cibles').insert(cibleLigne).select('id').single();
        if (erreurCible || !cibleCreee) {
          echecs++;
          emettre({
            etape: 'cible', n: i + 1, line_item_id: cible.line_item_id,
            statut: 'echec', erreur: 'Enregistrement impossible — poussée non tentée.',
          });
          continue;
        }

        // ── L'appel sortant : la route DV360 EXISTANTE, telle quelle ────
        try {
          // `fetchAvecDelai` et non `fetch` nu : cet appel en déclenche un
          // autre vers Google. Sans délai, un DV360 qui pend bloque les 49
          // cibles suivantes jusqu'au `maxDuration` (ARCHITECTURE.md impose ce
          // module pour tout appel sortant vers un tiers).
          const res = await fetchAvecDelai(
            `${origine}/api/admin/dsp/dv360/targeting/push`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', authorization: autorisation },
              body: JSON.stringify({
                zone_id: zoneId,
                advertiser_id,
                line_item_id: cible.line_item_id,
              }),
            },
            60_000,
          );
          const resultat = await res.json().catch(() => ({}));

          // ── LE point qui rendait cette tâche inutile ──────────────────
          // `bulkEditAssignedTargetingOptions` répond **HTTP 200 avec
          // `failedLineItemIds` non vide** quand DV360 refuse un line item :
          // la route de push le remonte fidèlement dans
          // `failed_line_item_ids` et répond quand même `{ ok: true }`.
          // Ne tester que `res.ok` marquait donc la cible « poussée »,
          // `echecs = 0`, lot « terminé », historique vert — alors que RIEN
          // n'était parti. C'est exactement le défaut que cette tâche
          // prétendait corriger : « un push raté à moitié était
          // indiscernable d'un push réussi ».
          const refuse = Array.isArray(resultat.failed_line_item_ids)
            && resultat.failed_line_item_ids.includes(cible.line_item_id);

          if (res.ok && !refuse) {
            pousses++;
            await majCible(cibleCreee.id, { statut: 'pousse' });
            emettre({
              etape: 'cible', n: i + 1, line_item_id: cible.line_item_id,
              // Le champ rendu par la route s'appelle `pushed_geo_ids` — ni
              // `assigned` ni `count`, qui valaient donc toujours `null`.
              statut: 'pousse', n_geo_ids: resultat.pushed_geo_ids ?? null,
              // Un CP sans geo ID Google n'est pas une erreur, mais c'est une
              // perte de couverture : la taire serait mentir par omission.
              cp_non_resolus: Array.isArray(resultat.unmapped_postal_codes)
                ? resultat.unmapped_postal_codes.length : null,
            });
          } else {
            echecs++;
            const message = refuse
              ? 'DV360 a refusé ce line item (réponse 200, line item dans failedLineItemIds).'
              : (resultat.error ?? `HTTP ${res.status}`);
            await majCible(cibleCreee.id, { statut: 'echec', erreur: String(message).slice(0, 500) });
            emettre({
              etape: 'cible', n: i + 1, line_item_id: cible.line_item_id,
              statut: 'echec', erreur: message,
            });
          }
        } catch (e) {
          echecs++;
          const message = e instanceof Error ? e.message : String(e);
          await majCible(cibleCreee.id, { statut: 'echec', erreur: message.slice(0, 500) });
          emettre({
            etape: 'cible', n: i + 1, line_item_id: cible.line_item_id,
            statut: 'echec', erreur: message,
          });
        }
      }

      } finally {
        // ── Le lot est TOUJOURS clos, quoi qu'il arrive (B5) ────────────
        // Sans ce `finally`, une déconnexion du client au 8e line item sur 20
        // laissait le lot `en_cours` POUR TOUJOURS — alors que huit poussées
        // étaient parties chez DV360 — et l'historique affichait indéfiniment
        // une activation en cours que rien ne pouvait terminer.
        //
        // « partiel » existe comme statut propre : un lot où trois line items
        // sur vingt ont échoué n'est ni un succès ni un échec, et le ranger
        // dans l'un des deux ferait perdre l'information qui compte.
        // Un lot interrompu est `partiel` dès qu'une poussée est partie : il
        // reste des cibles non traitées, ce n'est pas un `termine`.
        const traitees = pousses + echecs;
        const statut = interrompu && traitees < cibles.length
          ? (pousses > 0 ? 'partiel' : 'echec')
          : echecs === 0 ? 'termine'
          : pousses === 0 ? 'echec'
          : 'partiel';

        // L'erreur est LUE (B7) : une clôture qui échoue en silence
        // ramènerait le défaut que ce `finally` vient de fermer.
        const { error: erreurCloture } = await supabase.from('activation_lots')
          .update({ statut, termine_le: new Date().toISOString() })
          .eq('id', lot.id);
        if (erreurCloture) console.error('[activation/pousser] cloture du lot:', erreurCloture.message);

        emettre({
          etape: 'fin', lot_id: lot.id, statut,
          pousses, echecs, total: cibles.length,
          interrompu, non_traitees: cibles.length - traitees,
        });
        try { controller.close(); } catch { /* deja ferme par le client */ }
      }
    },

    /**
     * Le client a fermé son onglet. On le NOTE pour que la boucle s'arrête à
     * la cible suivante, plutôt que de continuer à appeler DV360 dans le vide
     * — chaque appel poussé après un abandon est un ciblage parti que
     * personne n'a demandé.
     */
    cancel() {
      annule = true;
    },
  });

  return new Response(flux, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
