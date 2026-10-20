import { DOCUMENT, InjectionToken, inject } from '@angular/core';

/**
 * Navigation de PREMIER NIVEAU hors de l'application (arbitrage C11) : le détour par l'écran de
 * consentement d'un fournisseur OAuth (Google pour DV360, TikTok en T10). React écrit
 * `window.location.href = json.url` (`app/admin/api/dv360/page.tsx:139`).
 *
 * Inévitable pour un consentement tiers, y compris dans un hôte : le shell est quitté, puis repris
 * au retour. C'est la SEULE écriture de `location` autorisée dans l'administration, et elle passe
 * par ce jeton — jamais `window.location` en direct : les specs le remplacent par une doublure
 * (aucune navigation réelle pendant les tests, l'URL suivie est vérifiable).
 *
 * Le retour est décidé par l'API, inchangée (D4) : `oauth/callback` redirige vers la page REACT
 * (`${NEXT_PUBLIC_APP_URL}/admin/api/<fournisseur>?oauth=…`). Re-cibler Angular relève du lot 7.
 */
export const NAVIGUER_HORS_APPLICATION = new InjectionToken<(url: string) => void>('NAVIGUER_HORS_APPLICATION', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    return (url: string) => document.defaultView?.location.assign(url);
  },
});
