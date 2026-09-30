import type { Provider } from '@angular/core';
import { ADOPTER_FEUILLE, CONSTRUIRE_FEUILLE, LIRE_FEUILLE } from '../feuille-ombre';

/**
 * Les feuilles de l'isolation CSS, pour jsdom : il ne sert pas l'application
 * distante (`fetch`) et n'implémente pas `adoptedStyleSheets`. Lecture,
 * construction et adoption sont donc simulées — et TRACÉES, pour que les specs
 * vérifient ce qui a été lu (l'adresse distante) et adopté (par quelle racine).
 */
export function feuillesFactices() {
  const lectures: string[] = [];
  const adoptions: { racine: ShadowRoot; feuille: CSSStyleSheet }[] = [];
  const feuille = { factice: 'magelian.css' } as unknown as CSSStyleSheet;
  const providers: Provider[] = [
    {
      provide: LIRE_FEUILLE,
      useValue: async (href: string) => {
        lectures.push(href);
        return { ok: true, text: async () => '' };
      },
    },
    { provide: CONSTRUIRE_FEUILLE, useValue: async () => feuille },
    { provide: ADOPTER_FEUILLE, useValue: (racine: ShadowRoot, f: CSSStyleSheet) => void adoptions.push({ racine, feuille: f }) },
  ];
  return { providers, lectures, adoptions, feuille };
}

/** jsdom ne charge pas les feuilles : on joue le `load` des polices, posées dans le <head> du document. */
export function policesChargees(doc: Document = document): void {
  doc.head.querySelector('link[data-mg-polices]')?.dispatchEvent(new Event('load'));
}

export function retirerPolices(doc: Document = document): void {
  doc.head.querySelector('link[data-mg-polices]')?.remove();
}

/**
 * Le contenu d'une racine d'ombre MAGELIAN montée sous `conteneur` —
 * `RacineDistanteComponent` par défaut. L'interface y vit (Isolation CSS) :
 * un `querySelector` depuis l'extérieur ne la voit pas.
 */
export function ombre(conteneur: Element, selecteur = 'mg-racine-distante'): ShadowRoot {
  const hote = conteneur.querySelector(selecteur);
  if (!hote?.shadowRoot) throw new Error(`Pas de racine d'ombre sous ${selecteur}.`);
  return hote.shadowRoot;
}
