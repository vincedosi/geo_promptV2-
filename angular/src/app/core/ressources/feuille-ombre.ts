import { DOCUMENT, InjectionToken, inject } from '@angular/core';
import type { ConstruireFeuille, LireFeuille } from './feuilles';

/**
 * Isolation CSS (tâche 8 du lot AIDA) : toute l'interface MAGELIAN vit dans une
 * RACINE D'OMBRE. `magelian.css` n'est jamais posée dans le document, ni dans
 * le shell AIDA ni en lancement autonome : elle est construite une fois
 * (`chargerFeuilleConstruite`) puis ADOPTÉE par chaque racine d'ombre.
 * Mesuré : 0 différence sur les styles calculés de l'hôte, 0 propriété
 * personnalisée ajoutée sur `<html>`, et une feuille d'hôte hostile ne change
 * plus rien à MAGELIAN.
 *
 * Les trois jetons ci-dessous sont les coutures qui laissent les specs
 * s'affranchir de jsdom (qui n'a ni `fetch` réel ni `adoptedStyleSheets`).
 */

/** Lit une feuille : `fetch` du document. La feuille est servie par l'application distante, CORS ouvert (mesuré). */
export const LIRE_FEUILLE = new InjectionToken<LireFeuille>('LIRE_FEUILLE', {
  providedIn: 'root',
  factory: () => {
    const vue = inject(DOCUMENT).defaultView!;
    return (href) => vue.fetch(href);
  },
});

/**
 * Construit une `CSSStyleSheet`. `baseURL` = l'adresse de la feuille : une
 * `url()` relative s'y résout, et non contre la page du SHELL (même piège que
 * `urlRessourceDistante`).
 */
export const CONSTRUIRE_FEUILLE = new InjectionToken<ConstruireFeuille>('CONSTRUIRE_FEUILLE', {
  providedIn: 'root',
  factory: () => {
    const vue = inject(DOCUMENT).defaultView!;
    return (texte, href) => new vue.CSSStyleSheet({ baseURL: href }).replace(texte);
  },
});

/** Ajoute une feuille aux `adoptedStyleSheets` d'une racine d'ombre, une seule fois. */
export type AdopterFeuille = (racine: ShadowRoot, feuille: CSSStyleSheet) => void;

export const ADOPTER_FEUILLE = new InjectionToken<AdopterFeuille>('ADOPTER_FEUILLE', {
  providedIn: 'root',
  factory: () => (racine, feuille) => {
    if (!racine.adoptedStyleSheets.includes(feuille)) {
      racine.adoptedStyleSheets = [...racine.adoptedStyleSheets, feuille];
    }
  },
});
