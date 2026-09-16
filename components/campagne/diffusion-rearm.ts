/**
 * Événement DOM « rallume la carte Diffusion ».
 *
 * `app/map/page.tsx` dérive `diffusionActif` de la session de campagne et ne
 * demande l'exclusivité des dégradés (`lib/carte/degrades.ts`) qu'aux
 * TRANSITIONS. Une fois le dégradé `diffusion` évincé par une autre
 * choroplèthe — cocher IRIS depuis le panneau Calques —, rien ne pouvait le
 * rallumer : décocher IRIS ne repasse pas par `onDegrade('diffusion', true)`,
 * et la barre de contexte continuait d'afficher « Diffusion » sélectionné
 * devant une carte vide. La seule issue était de basculer sur Suivi puis de
 * revenir (constat 9 de la relecture d'interface).
 *
 * Le geste naturel — recliquer « Diffusion » alors qu'on y est déjà — ne
 * changeant AUCUN état de session, il ne peut pas être exprimé par la
 * session : il passe donc par cet événement, que `page.tsx` écoute pour
 * redemander l'exclusivité. Un simple nom de chaîne ici plutôt qu'un import
 * depuis `app/map/_components/` : `BarreContexteCampagne` est montée aussi
 * DANS l'overlay MAGELIAN, et n'a rien à tirer de MapLibre.
 */
export const DIFFUSION_REARM_EVENT = 'magelian:diffusion-rearm';
