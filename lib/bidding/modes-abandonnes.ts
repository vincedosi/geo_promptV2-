/**
 * @file lib/bidding/modes-abandonnes.ts — modes de pondération ABANDONNÉS (décision du propriétaire, 05/11).
 *
 * `by_tier` (« par palier » : le poids suivait une liste de départements écrite à la main, sans donnée INSEE) et
 * `by_subzone` (« par sous-zone » : un poids fixe sur des groupes de CP choisis à la main). Aucune stratégie en base ne
 * les emploie (mesuré le 05/11 : 1 `by_insee_variable`, 4 `by_zone_set`) ; le service d'optimisation ne les calcule
 * pas et rend 422 `mode_abandonne` (`services/optimisation/src/optimisation/noyau/pression.py`).
 *
 * Les routes de création et de modification d'une stratégie les REFUSENT ici, avec le même message : dans
 * `weighting_mode`, et dans le `mode` des poids en zone / hors zone (`in_zone_weights`, `out_zone_weights`), que
 * `apply_zone_weights_to_strategy` lit aussi. Les LECTURES de stratégies existantes ne sont pas concernées.
 */
import { z } from 'zod';

export const MODES_ABANDONNES = { by_tier: 'par palier', by_subzone: 'par sous-zone' } as const;
export type ModeAbandonne = keyof typeof MODES_ABANDONNES;

/** Code d'erreur stable des refus (`params.refus` de l'issue Zod, `error` de la réponse). */
export const REFUS_MODE_ABANDONNE = 'mode_abandonne';

function estAbandonne(mode: unknown): mode is ModeAbandonne {
  return typeof mode === 'string' && Object.prototype.hasOwnProperty.call(MODES_ABANDONNES, mode);
}

/** Le message français d'un mode abandonné — le même que celui du service d'optimisation. */
export function messageModeAbandonne(mode: ModeAbandonne): string {
  return `Mode de pondération « ${MODES_ABANDONNES[mode]} » abandonné : il n'est plus calculé. `
    + 'Choisissez une pondération par donnée INSEE, uniforme ou par liste de codes postaux.';
}

function signaler(ctx: z.RefinementCtx, mode: ModeAbandonne, chemin: (string | number)[]): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: chemin,
    message: messageModeAbandonne(mode),
    params: { refus: REFUS_MODE_ABANDONNE, mode },
  });
}

/**
 * À poser en `.superRefine(refuserModesAbandonnes)` sur le schéma d'une création ou d'une modification de stratégie :
 * signale `weighting_mode`, `in_zone_weights.mode` et `out_zone_weights.mode` abandonnés.
 */
export function refuserModesAbandonnes(
  corps: { weighting_mode?: string; in_zone_weights?: Record<string, unknown>; out_zone_weights?: Record<string, unknown> },
  ctx: z.RefinementCtx,
): void {
  if (estAbandonne(corps.weighting_mode)) signaler(ctx, corps.weighting_mode, ['weighting_mode']);
  for (const cle of ['in_zone_weights', 'out_zone_weights'] as const) {
    const mode = corps[cle]?.mode;
    if (estAbandonne(mode)) signaler(ctx, mode, [cle, 'mode']);
  }
}

/** La première issue « mode abandonné » d'un échec Zod, s'il y en a une. */
export function issueModeAbandonne(issues: z.ZodIssue[]): z.ZodIssue | undefined {
  return issues.find((i) => i.code === z.ZodIssueCode.custom && i.params?.refus === REFUS_MODE_ABANDONNE);
}
