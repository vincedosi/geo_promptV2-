/**
 * lib/chat/tools/carreaux.ts
 * Outil afficher_carreaux — carte thermique carreaux INSEE Filosofi 200m.
 */

import { getCoordsForVille } from '@/lib/geo/locations';
import { CHORO_INDICATORS }  from '@/lib/chat/system-prompt';

export function afficherCarreaux(args: Record<string, unknown>) {
  const indicateur    = args.indicateur ? String(args.indicateur) : 'ind_18_24';
  const known         = CHORO_INDICATORS[indicateur] ?? CHORO_INDICATORS[indicateur.toLowerCase()];
  const resolvedCol   = (known?.col ?? indicateur).toLowerCase();
  const resolvedLabel = args.indicateur_label
    ? String(args.indicateur_label)
    : (known?.label ?? indicateur);

  const ville       = args.ville ? String(args.ville) : undefined;
  const coordonnees = ville ? getCoordsForVille(ville) : { lat: 48.3904, lng: -4.4861 };
  const rayon_km    = args.rayon_km ? Number(args.rayon_km) : undefined;

  console.log(`[chat] afficher_carreaux → col="${resolvedCol}" label="${resolvedLabel}" ville="${ville ?? 'n/a'}"`);

  return {
    action:           'afficher_carreaux' as const,
    indicateur:       resolvedCol,
    indicateur_label: resolvedLabel,
    ville,
    coordonnees,
    rayon_km,
  };
}
