import { DOCUMENT, DestroyRef, Injectable, InjectionToken, effect, inject, signal } from '@angular/core';
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
 * MAGELIAN a-t-il le droit d'écrire `<html>` (classes `light`/`dark` et
 * `style.colorScheme`) ? **Défaut racine : `false`** — c'est le cas d'un hôte
 * AIDA, qui ne fournit rien : son `<html>` lui appartient. Seul le lancement
 * AUTONOME (`app.config.ts`) le fournit à `true`, parce que le document y est
 * le nôtre (barres de défilement du document, fond avant le montage).
 * Revue finale du lot AIDA (I1) : la règle « on n'écrit qu'au démarrage sans
 * classe ou sur une bascule » écrivait encore dans un hôte sans classe, et
 * réécrivait la classe du shell à chaque bascule.
 */
export const ECRIRE_HTML = new InjectionToken<boolean>('ECRIRE_HTML', {
  providedIn: 'root',
  factory: () => false,
});

/** Le thème que l'hôte EXPRIME par la classe de `<html>` : null s'il n'en pose aucune (`light` l'emporte si les deux). */
function themeExprime(doc: Document): Theme | null {
  const classes = doc.documentElement.classList;
  if (classes.contains('light')) return 'light';
  return classes.contains('dark') ? 'dark' : null;
}

/**
 * Le thème courant. Les jetons clairs vivent sous `:host(.light)` de NOS
 * racines d'ombre, et sous `html.light` pour le document autonome (styles/jetons.css).
 *
 * DANS UN HÔTE (`ECRIRE_HTML` = `false`, défaut) : **MAGELIAN n'écrit JAMAIS
 * `<html>`**, ni classe ni `color-scheme`, ni au démarrage ni sur `basculer()`.
 *  - Démarrage : thème de l'hôte s'il pose exactement une classe, sinon le
 *    stockage.
 *  - `basculer()` agit sur nos racines d'ombre (`:host(.light)`, dont le
 *    `color-scheme` suit) et sur le stockage — jamais sur `<html>`.
 *  - Suivi : quand le thème EXPRIMÉ par l'hôte change (il pose `light` ou
 *    `dark`), on l'adopte. Une mutation de `<html>` qui ne le change pas (une
 *    classe étrangère au thème) ne défait pas une bascule ; un hôte qui RETIRE
 *    sa classe n'exprime plus rien, et on garde le thème courant.
 *
 * EN AUTONOME (`ECRIRE_HTML` = `true`), RÈGLE DE PROPRIÉTÉ de la tâche 5 :
 * **le shell peut poser la classe, MAGELIAN la suit.**
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
 * courbes) se repeignent. En autonome, lecture = ce que le CSS du document
 * rend (`:root` sombre, `html.light` clair, jetons.css) : `light` présente ->
 * clair, sinon sombre ; classe absente -> sombre, les deux -> clair. Dans un
 * hôte, seul un CHANGEMENT du thème exprimé compte (voir plus haut). Le `color-scheme` de `<html>` reste à
 * l'hôte ; DANS les racines d'ombre, il suit le thème de MAGELIAN (`:host` /
 * `:host(.light)`, styles.css), grâce à la classe que ce service y recopie.
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
 * En autonome, un script inline dans `index.html` pose déjà la classe et `color-scheme`
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
  /** `<html>` est-il à nous ? `false` dans un hôte : on n'y écrit jamais. */
  private readonly proprietaireHtml = inject(ECRIRE_HTML);
  /** Autorise l'effect à écrire classes et color-scheme sur `<html>` : cas (a) et (b) de la JSDoc, autonome seulement. */
  private ecrireHtml = this.proprietaireHtml && themeExprime(this.doc) === null;
  /** Dans un hôte : le dernier thème exprimé par sa classe, pour ne réagir qu'à un CHANGEMENT de celui-ci. */
  private dernierHote = themeExprime(this.doc);

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
        // Sans cela, une bascule laisse les barres de défilement du DOCUMENT
        // autonome dans l'ancien thème (dans les racines d'ombre, c'est `:host`
        // qui fixe `color-scheme`, styles.css).
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
    this.ecrireHtml = this.proprietaireHtml;
    this._theme.set(suivant);
  }

  /** Rappel de l'observateur : recopie la classe de `<html>` (règle du CSS) si elle est nouvelle. */
  private suivreLaClasse(): void {
    if (!this.proprietaireHtml) {
      const exprime = themeExprime(this.doc);
      if (exprime === this.dernierHote) return; // classe étrangère au thème : rien n'a changé
      this.dernierHote = exprime;
      if (exprime === null) return; // l'hôte n'exprime plus de thème : on garde le nôtre
      this.adopter(exprime);
      return;
    }
    const pose = themeDeLaClasse(this.doc, false)!;
    // Drapeau armé = l'effect n'a pas encore écrit : la mutation ne peut être que celle de l'hôte,
    // même si elle donne le même thème que le nôtre (l'effect écraserait sinon ses classes).
    const externe = this.ecrireHtml;
    if (pose === this._theme() && !externe) return; // notre propre pose (l'effect a écrit) : rien à faire
    this.ecrireHtml = false; // un changement externe désarme aussi l'écriture (bascule ou démarrage pas encore passés par l'effect)
    this.adopter(pose);
  }

  /** Adopte le thème posé par l'hôte : ni mémorisé, ni réécrit sur `<html>`. */
  private adopter(t: Theme): void {
    this.themeUtilisateur = null;
    this._theme.set(t);
    this.poserClasseRacines(t);
    this._themeApplique.set(t); // la classe est DÉJÀ là : les couleurs sont justes tout de suite
  }
}
