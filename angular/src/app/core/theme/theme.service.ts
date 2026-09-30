import { DOCUMENT, DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
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
 * RÈGLE : **le shell peut poser la classe, MAGELIAN la suit ; MAGELIAN ne la
 * pose que quand son utilisateur bascule.** Dans le shell AIDA, l'hôte possède
 * `<html>` et peut changer `light`/`dark` quand il veut. Un `MutationObserver`
 * (attributeFilter `class`) recopie donc cette classe dans `theme` ET
 * `themeApplique`, pour que les couleurs calculées (carte, courbes) se repeignent.
 * Ce choix venant de l'hôte n'est PAS écrit dans `localStorage` : ce n'est pas
 * la préférence de l'utilisateur de MAGELIAN.
 *
 * ⚠ Origine du choix, sans drapeau à consommer : `themeUtilisateur` ne vaut
 * quelque chose que si le dernier changement vient de `basculer()`. L'`effect`
 * n'écrit dans le stockage que si `theme === themeUtilisateur`. Un changement
 * externe remet `themeUtilisateur` à null — ça marche que l'`effect` tourne
 * avant ou après l'observateur, et ça n'avale pas une bascule ultérieure.
 *
 * Classe absente, ou `light` ET `dark` ensemble : ambigu, on GARDE le thème
 * courant et on ne réécrit rien (on ne se bat pas avec l'hôte).
 *
 * Un script inline dans `index.html` pose déjà la classe et `color-scheme`
 * AVANT ce service (sinon fond sombre/blanc le temps du démarrage) ; ce service
 * reste ensuite la source de vérité côté MAGELIAN. Une seule instance (racine),
 * donc un seul observateur, même si `App` est montée deux fois.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly stockage = stockageDisponible(this.doc);
  private readonly _theme = signal<Theme>(themeInitial(this.stockage));
  private readonly _themeApplique = signal<Theme>(themeInitial(this.stockage));
  /** Dernier thème demandé par l'utilisateur de MAGELIAN ; null si le dernier changement vient de l'hôte. */
  private themeUtilisateur: Theme | null = null;

  readonly theme = this._theme.asReadonly();
  /**
   * Les couleurs calculées ne sont justes qu'une fois la classe posée : qui
   * lit `getComputedStyle` doit dépendre de ce signal-ci, jamais de `theme`.
   */
  readonly themeApplique = this._themeApplique.asReadonly();

  constructor() {
    effect(() => {
      const t = this._theme();
      const racine = this.doc.documentElement;
      racine.classList.toggle('light', t === 'light');
      racine.classList.toggle('dark', t === 'dark');
      // Sans cela, une bascule laisse des barres de défilement et des champs
      // de formulaire dans l'ancien thème.
      racine.style.colorScheme = t;
      if (t === this.themeUtilisateur) {
        try {
          this.stockage?.setItem(CLE_THEME, t);
        } catch {
          // Stockage bloqué : le thème s'applique quand même, il ne sera
          // simplement pas retenu au prochain chargement.
        }
      }
      this._themeApplique.set(t);
    });

    const Observateur = this.doc.defaultView?.MutationObserver;
    if (Observateur) {
      const observateur = new Observateur(() => this.suivreLaClasse());
      observateur.observe(this.doc.documentElement, { attributes: true, attributeFilter: ['class'] });
      inject(DestroyRef).onDestroy(() => observateur.disconnect());
    }
  }

  basculer(): void {
    const suivant = themeSuivant(this._theme());
    this.themeUtilisateur = suivant;
    this._theme.set(suivant);
  }

  /** Rappel de l'observateur : recopie la classe de `<html>` si elle est sans ambiguïté et nouvelle. */
  private suivreLaClasse(): void {
    const classes = this.doc.documentElement.classList;
    const clair = classes.contains('light');
    const sombre = classes.contains('dark');
    if (clair === sombre) return; // absente ou double : on garde le thème courant
    const pose: Theme = clair ? 'light' : 'dark';
    if (pose === this._theme()) return; // c'est notre propre pose (basculer, effect) : rien à faire
    this.themeUtilisateur = null;
    this._theme.set(pose);
    this._themeApplique.set(pose); // la classe est DÉJÀ là : les couleurs sont justes tout de suite
    this.doc.documentElement.style.colorScheme = pose;
  }
}
