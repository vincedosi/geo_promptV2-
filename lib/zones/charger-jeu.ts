/**
 * @file lib/zones/charger-jeu.ts — la lecture d'un jeu de zones par les routes (lot 5, T6, arbitrage A-3).
 *
 * Depuis sql/277, `zone_sets` porte deux types de jeu (`TYPES_JEU`). Les routes du module risque lisent ce qu'un jeu
 * de zone n'a pas (profil d'anneaux, `zone_set_cp`, grappes, simulations) : sur un jeu de zone, elles planteraient
 * (profil NULL dans `normaliserJeu`) ou rendraient un jeu vide comme s'il était juste. Chacune passe donc par CE
 * chargeur, qui fait la seule lecture de la ligne et rend une réponse PRÊTE quand il n'y a pas de jeu à servir :
 * - 404 « Jeu de zones introuvable dans cet espace. » — absent, d'un autre espace, ou identifiant qui n'est pas un
 *   UUID (Postgres le refuserait par une erreur 22P02, soit un 500 pour une simple adresse fausse) ;
 * - 409 quand le jeu est de l'autre type, avec l'endroit où il se gère ;
 * - 500 neutre sur une erreur de lecture (détail Postgres au journal seulement).
 *
 * ⚠ Le filtre d'ESPACE est fait ICI et non par RLS : les routes parlent à la base par `createAdminClient()`, qui
 * contourne toute policy. Sans lui, connaître l'identifiant d'un jeu suffirait à lire celui d'un autre espace.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/auth';
import type { Tables } from '@/types/database.types';
import type { TypeJeu } from '@/lib/zones/jeu';

/** Une ligne de `zone_sets`, entière : une seule lecture sert toutes les routes, quelle que soit la colonne lue. */
type LigneJeu = Tables<'zone_sets'>;

/**
 * À passer à la place d'un espace quand la propriété du jeu est déjà PROUVÉE autrement — l'accès à la campagne qui
 * le porte (`pression-classes`). Un symbole et non `null` : `profile.organization_id` vaut `string | null`, et un
 * `null` passé par mégarde lèverait le filtre d'espace sans que le compilateur le voie.
 */
export const SANS_CONTROLE_ESPACE = Symbol('sans contrôle d’espace');

/** Le 404 d'un jeu absent ou d'un autre espace — repris par l'extraction (`MESSAGES_RPC`) : une seule phrase. */
export const MESSAGE_JEU_INTROUVABLE = 'Jeu de zones introuvable dans cet espace.';

/**
 * Où se gère un jeu, selon SON type : le message du 409 quand une route de l'autre type le reçoit. Repris par
 * l'extraction (`MESSAGES_RPC`) et, côté Angular, par `MESSAGE_JEU_RISQUE` (verrouillé par `conversion-paritaire`).
 */
export const OU_SE_GERE: Record<TypeJeu, string> = {
  zone: "Ce jeu de zones se gère à l'étape ⑤ de la carte.",
  risque: 'Ce jeu de zones se gère dans le module risque.',
};

type JeuCharge = { ok: true; jeu: LigneJeu } | { ok: false; reponse: NextResponse };

const refus = (error: string, status: number): JeuCharge =>
  ({ ok: false, reponse: NextResponse.json({ error }, { status }) });

/**
 * Charge un jeu de l'espace, et vérifie son type.
 *
 * @param supabase - Le client admin de la route.
 * @param id - L'identifiant reçu dans l'adresse.
 * @param orgId - L'espace de la session, ou {@link SANS_CONTROLE_ESPACE} si la propriété est prouvée ailleurs.
 * @param options.type - Le type que la route sait servir ; absent : les deux (liste des extractions).
 * @returns Le jeu, ou la réponse 404 / 409 / 500 à renvoyer telle quelle.
 */
export async function chargerJeu(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  orgId: string | typeof SANS_CONTROLE_ESPACE,
  { type }: { type?: TypeJeu } = {},
): Promise<JeuCharge> {
  if (!z.string().uuid().safeParse(id).success) return refus(MESSAGE_JEU_INTROUVABLE, 404);

  let requete = supabase.from('zone_sets').select('*').eq('id', id);
  if (orgId !== SANS_CONTROLE_ESPACE) requete = requete.eq('org_id', orgId);
  const { data: jeu, error } = await requete.maybeSingle();

  if (error) {
    console.error('[chargerJeu] lecture du jeu :', error.message);
    return refus('Jeu de zones illisible.', 500);
  }
  if (!jeu) return refus(MESSAGE_JEU_INTROUVABLE, 404);
  if (type && jeu.type !== type) return refus(OU_SE_GERE[jeu.type as TypeJeu], 409);
  return { ok: true, jeu };
}
