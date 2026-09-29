import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { CLE_THEME, type Theme, themeInitial, themeSuivant } from './theme';

/** Le thème courant. Les jetons clairs vivent sous `html.light` (styles/jetons.css). */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly stockage = this.doc.defaultView?.localStorage ?? null;
  private readonly _theme = signal<Theme>(themeInitial(this.stockage));

  readonly theme = this._theme.asReadonly();

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
    });
  }

  basculer(): void {
    this._theme.update(themeSuivant);
  }
}
