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
 * RÈGLE DE PROPRIÉTÉ : **le shell peut poser la classe, MAGELIAN la suit.**
 * MAGELIAN n'écrit `<html>` (classes ET `style.colorScheme`) que dans DEUX cas :
 *  (a) son utilisateur bascule, via `basculer()` ;
 *  (b) au tout premier passage, quand `<html>` ne porte NI `light` NI `dark`
 *      (autonome sans script inline, ou tests).
 * Dans tous les autres cas il suit et n'écrit rien : changement externe,
 * démarrage avec une seule classe (l'hôte a tranché) ou avec les deux (repli
 * sur le stockage pour `theme`, mais aucune classe de l'hôte n'est retirée).
 *
 * Un `MutationObserver` (attributeFilter `class`) recopie la classe de l'hôte
 * dans `theme` ET `themeApplique`, pour que les couleurs calculées (carte,
 * courbes) se repeignent. Lecture = ce que le CSS rend (jetons.css n'a que
 * `:root`, sombre, et `html.light`) : `light` présente -> clair, sinon sombre ;
 * classe absente -> sombre, les deux -> clair. `color-scheme` reste à l'hôte.
 *
 * Persistance : seul un geste de l'utilisateur de MAGELIAN est écrit dans
 * `localStorage`. `themeUtilisateur` n'est renseigné que par `basculer()` ; l'effect
 * n'écrit que si `theme` lui est égal. Pas de drapeau « consommé une fois » :
 * tout changement externe le vide, donc il n'a jamais besoin d'être remis à null
 * après une écriture. `ecrireHtml` (a et b) est levé par `basculer()` ou au
 * démarrage ; il retombe quand l'effect écrit, OU dès qu'un changement externe
 * arrive avant lui (l'hôte gagne : sa classe n'est jamais écrasée, et le geste
 * de l'utilisateur supplanté n'est pas mémorisé non plus).
 *
 * Au DÉMARRAGE, le thème initial vient de `<html>` quand UNE SEULE des deux
 * classes y est ; sinon repli sur le stockage.
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
  /** Autorise l'effect à écrire classes et color-scheme sur `<html>` : cas (a) et (b) de la JSDoc. */
  private ecrireHtml = !this.doc.documentElement.classList.contains('light')
    && !this.doc.documentElement.classList.contains('dark');

  readonly theme = this._theme.asReadonly();
  /**
   * Les couleurs calculées ne sont justes qu'une fois la classe posée : qui
   * lit `getComputedStyle` doit dépendre de ce signal-ci, jamais de `theme`.
   */
  readonly themeApplique = this._themeApplique.asReadonly();

  /**
   * Éléments hôtes des racines d'ombre MAGELIAN. Les jetons y vivent sous
   * `:host` / `:host(.light)` (jetons.css) : ce service y RECOPIE la classe
   * `light`/`dark` au moment même où il pose `themeApplique`, pour que les
   * couleurs calculées soient justes aussitôt. Ce sont NOS éléments : la règle
   * de propriété de `<html>` n'en est pas touchée. `:host(.light)` plutôt que
   * `:host-context(html.light)`, que ni Firefox ni Safari n'implémentent.
   */
  private readonly racines = new Set<Element>();
  private readonly _racine = signal<Element | null>(null);
  readonly racine = this._racine.asReadonly();

  /** Enregistre une racine ; rend la fonction qui la désenregistre. `racine()` = la dernière montée. */
  enregistrerRacine(el: Element): () => void {
    this.racines.add(el);
    this.poserClasseRacines(this._themeApplique());
    this._racine.set(el);
    return () => {
      this.racines.delete(el);
      if (this._racine() === el) this._racine.set([...this.racines].at(-1) ?? null);
    };
  }

  private poserClasseRacines(t: Theme): void {
    for (const r of this.racines) {
      r.classList.toggle('light', t === 'light');
      r.classList.toggle('dark', t === 'dark');
    }
  }

  constructor() {
    effect(() => {
      const t = this._theme();
      const racine = this.doc.documentElement;
      if (this.ecrireHtml) {
        this.ecrireHtml = false;
        racine.classList.toggle('light', t === 'light');
        racine.classList.toggle('dark', t === 'dark');
        // Sans cela, une bascule laisse des barres de défilement et des champs
        // de formulaire dans l'ancien thème.
        racine.style.colorScheme = t;
      }
      if (t === this.themeUtilisateur) {
        try {
          this.stockage?.setItem(CLE_THEME, t);
        } catch {
          // Stockage bloqué : le thème s'applique quand même, il ne sera
          // simplement pas retenu au prochain chargement.
        }
      }
      this.poserClasseRacines(t);
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
    this.ecrireHtml = true;
    this._theme.set(suivant);
  }

  /** Rappel de l'observateur : recopie la classe de `<html>` (règle du CSS) si elle est nouvelle. */
  private suivreLaClasse(): void {
    const pose = themeDeLaClasse(this.doc, false)!;
    // Drapeau armé = l'effect n'a pas encore écrit : la mutation ne peut être que celle de l'hôte,
    // même si elle donne le même thème que le nôtre (l'effect écraserait sinon ses classes).
    const externe = this.ecrireHtml;
    if (pose === this._theme() && !externe) return; // notre propre pose (l'effect a écrit) : rien à faire
    this.themeUtilisateur = null;
    this.ecrireHtml = false; // un changement externe désarme aussi l'écriture (bascule ou démarrage pas encore passés par l'effect)
    this._theme.set(pose);
    this.poserClasseRacines(pose);
    this._themeApplique.set(pose); // la classe est DÉJÀ là : les couleurs sont justes tout de suite
  }
}
