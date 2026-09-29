import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { CLE_THEME, type Theme, themeInitial, themeSuivant } from './theme';

/**
 * Le getter `localStorage` lui-même peut lever (Safari privé ancien,
 * stockage bloqué par une politique) — pas seulement `getItem`/`setItem`.
 * Sans ce garde, la simple LECTURE de la propriété fait échouer la
 * construction du service, et comme `App` l'injecte dans un champ
 * d'instance, toute l'application refuse de démarrer.
 */
function stockageDisponible(doc: Document): Storage | null {
  try {
    return doc.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Le thème courant. Les jetons clairs vivent sous `html.light` (styles/jetons.css).
 *
 * ⚠ Un script inline dans `index.html` pose déjà `light`/`dark` sur `<html>`
 * AVANT que ce service existe — sans lui, un utilisateur en thème clair verrait
 * le fond sombre pendant tout le démarrage (config + session). Ce service reste
 * la seule source de vérité une fois construit : son `effect()` réapplique la
 * classe depuis le signal, donc le script n'a besoin d'être exact qu'au premier
 * rendu. Dans le shell AIDA, qui possède `index.html`, ce script n'existera
 * plus — la propriété du thème sera à redécider à cette intégration.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly stockage = stockageDisponible(this.doc);
  private readonly _theme = signal<Theme>(themeInitial(this.stockage));
  private readonly _themeApplique = signal<Theme>(themeInitial(this.stockage));

  readonly theme = this._theme.asReadonly();
  /**
   * Les couleurs calculées ne sont justes qu'une fois la classe posée : qui
   * lit `getComputedStyle` doit dépendre de ce signal-ci, jamais de `theme`.
   */
  readonly themeApplique = this._themeApplique.asReadonly();

  constructor() {
    effect(() => {
      const t = this._theme();
      const racine = this.doc.documentElement.classList;
      racine.toggle('light', t === 'light');
      racine.toggle('dark', t === 'dark');
      try {
        this.stockage?.setItem(CLE_THEME, t);
      } catch {
        // Stockage bloqué : le thème s'applique quand même, il ne sera
        // simplement pas retenu au prochain chargement.
      }
      this._themeApplique.set(t);
    });
  }

  basculer(): void {
    this._theme.update(themeSuivant);
  }
}
