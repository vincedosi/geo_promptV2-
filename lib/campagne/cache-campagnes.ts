'use client';

/**
 * Fetch dédupliqué de `/api/digital/campaigns` (liste des campagnes pour le
 * sélecteur de `BarreContexteCampagne`) — portée module, pas `useRef` : la
 * barre est montée à deux endroits sans ancêtre commun (`app/map/page.tsx`
 * en vue carte, `SuiviV2` en vue suivi), potentiellement EN MÊME TEMPS (le
 * contenu de l'overlay MAGELIAN reste monté, masqué, quand on bascule vers
 * la carte). Sans dédoublonnage, deux montages simultanés — ou React Strict
 * Mode en dev, qui monte-démonte-remonte chaque effet une fois — produisaient
 * deux requêtes concurrentes à la même route (constaté : 2 appels à
 * `/api/digital/campaigns` dans la même milliseconde).
 *
 * PAS un cache permanent : l'entrée est effacée dès que la promesse se
 * résout (succès ou échec), donc un DEUXIÈME montage plus tard (l'overlay
 * rouvert bien après) redemande une liste fraîche — seul le chevauchement
 * EN VOL est dédupliqué, pas la fraîcheur au long cours.
 *
 * Passe par `semaphoreEcranSuivi` comme tous les autres appels de cet écran
 * (Ruling T15-1) — dans la fonction qui émet réellement la requête, pas chez
 * l'appelant.
 */
import { adminFetch } from '@/lib/admin-fetch';
import { semaphoreEcranSuivi } from './semaphore-suivi';

export interface CampagneListItem {
  id: string;
  name: string;
  dsp_source: string | null;
  date_start: string | null;
  date_end: string | null;
}

let enVol: Promise<CampagneListItem[]> | null = null;

export function obtenirListeCampagnesPartagee(): Promise<CampagneListItem[]> {
  if (enVol) return enVol;
  const promesse = (async (): Promise<CampagneListItem[]> => {
    const liberer = await semaphoreEcranSuivi.acquerir();
    try {
      const res = await adminFetch('/api/digital/campaigns', { cache: 'no-store' });
      const data = res.ok ? await res.json() : [];
      return Array.isArray(data) ? data as CampagneListItem[] : [];
    } catch {
      return [];
    } finally {
      liberer();
    }
  })();
  enVol = promesse;
  promesse.finally(() => { if (enVol === promesse) enVol = null; });
  return promesse;
}
