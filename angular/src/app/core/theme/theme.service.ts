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
 * Thème lu sur la classe de `<html>`. `strict` : au démarrage, on n'y croit que
 * si exactement une des deux classes est posée (null sinon). Hors `strict`, on
 * reproduit le CSS : `light` présente -> clair, sinon sombre.
 */
function themeDeLaClasse(doc: Document, strict: boolean): Theme | null {
  const classes = doc.documentElement.classList;
  const clair = classes.contains('light');
  if (strict && clair === classes.contains('dark')) return null;
  return clair ? 'light' : 'dark';
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
 * Lecture de la classe = ce que le CSS rend réellement (jetons.css n'a que
 * `:root`, sombre, et `html.light`) : `light` présente -> clair, sinon sombre.
 * Classe absente -> sombre ; les deux ensemble -> clair. Jamais persisté.
 *
 * Au DÉMARRAGE, le thème initial vient de `<html>` quand UNE SEULE des deux
 * classes y est (l'hôte a déjà tranché : sans cela, notre premier passage
 * d'`effect` écraserait son thème par celui de notre stockage). Sinon — aucune
 * classe, ou les deux — on est en autonome avant le script inline, ou dans un
 * cas ambigu : repli sur le stockage. Un thème repris de l'hôte n'est pas persisté.
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
  private readonly initial = themeDeLaClasse(this.doc, true) ?? themeInitial(this.stockage);
  private readonly _theme = signal<Theme>(this.initial);
  private readonly _themeApplique = signal<Theme>(this.initial);
  /**
   * Dernier thème demandé par l'utilisateur de MAGELIAN ; null si le dernier
   * changement vient de l'hôte (ou du démarrage). Jamais remis à null après une
   * écriture réussie : tout changement externe le vide déjà, et l'effect
   * n'écrit que si `theme` lui est égal.
   */
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

  /** Rappel de l'observateur : recopie la classe de `<html>` (règle du CSS) si elle est nouvelle. */
  private suivreLaClasse(): void {
    const pose = themeDeLaClasse(this.doc, false)!;
    if (pose === this._theme()) return; // c'est notre propre pose (basculer, effect) : rien à faire
    this.themeUtilisateur = null;
    this._theme.set(pose);
    this._themeApplique.set(pose); // la classe est DÉJÀ là : les couleurs sont justes tout de suite
    this.doc.documentElement.style.colorScheme = pose;
  }
}
