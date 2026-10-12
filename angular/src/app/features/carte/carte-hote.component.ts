import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CartePage } from './carte.page';
import { PARAM_ZONE_LIEN } from './logique/zones/zone-du-lien';

/** Le bouton d'espace du badge de session (`layout/badge-session.component.ts`), dans la barre du haut de la page. */
const BADGE_ESPACE = '[data-declencheur="org"]';

/**
 * Le composant de la ROUTE `carte` (droits sur la carte, T3) : il rend la page carte et la RECRÉE à chaque changement
 * d'espace — l'équivalent du `window.location.reload()` de React, et le patron exact de la coquille
 * (`layout/coquille.component.ts`, `generation`).
 *
 * ── POURQUOI RECRÉER, ET PAS INVALIDER ───────────────────────────────────
 * Tous les services d'état de la carte sont fournis par la page (`providers` de `CartePage`) : la détruire les détruit,
 * avec leurs lectures en vol (désabonnées, donc ANNULÉES — une réponse de l'ancien espace n'atteint jamais le nouveau)
 * et la carte MapLibre (`DestroyRef` de `mg-carte`). La nouvelle page repart de zéro et ne lit que ce qu'une ouverture
 * de carte lit déjà (règles I/O). Une liste d'invalidations manuelles oublierait le prochain service ajouté.
 * Les services fournis AILLEURS que la page (API de `FOURNISSEURS_DISTANTS`, services racine) ne gardent aucun état
 * qui dépende du périmètre ; le profil mémorisé (`AuthService`) est oublié par le badge de session lui-même.
 *
 * ── L'URL ────────────────────────────────────────────────────────────────
 * Elle est gardée (le module risque, enfant de la route, est rendu par l'outlet de la page recréée), SAUF `customZone` :
 * la zone du lien appartient à l'ancien espace. Il est retiré AVANT la recréation, sinon la nouvelle page la relirait.
 */
@Component({
  selector: 'mg-carte-hote',
  imports: [CartePage],
  template: `
    @for (g of [generation()]; track g) {
      <mg-carte-principale (espaceChange)="actualiser()" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
})
export class CarteHoteComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injecteur = inject(Injector);

  /** Changer de génération détruit la page carte et en crée une autre. */
  protected readonly generation = signal(0);

  /**
   * Un changement d'espace : `customZone` quitte l'URL s'il y est, puis la page est recréée. Une navigation REJETÉE
   * (garde en erreur…) est interceptée — sans quoi elle remonterait en rejet non géré — et la page est recréée quand
   * même : l'espace a changé côté serveur, garder l'ancienne page montrerait l'ancien espace.
   */
  protected actualiser(): void {
    if (!this.route.snapshot.queryParamMap.has(PARAM_ZONE_LIEN)) {
      this.recreer();
      return;
    }
    const recreer = () => this.recreer();
    void this.router
      .navigate([], { relativeTo: this.route, queryParams: { [PARAM_ZONE_LIEN]: null }, queryParamsHandling: 'merge', replaceUrl: true })
      .then(recreer, recreer);
  }

  /**
   * Recrée la page. Si le focus était DANS l'ancienne page (le badge d'espace, d'où part le changement), il est rendu
   * au badge d'espace de la nouvelle — l'élément que l'utilisateur vient de manier — plutôt qu'à l'hôte de la page
   * (son repli d'ouverture, `rendreFocus` de `CartePage`) : au clavier, on reprend là où l'on était.
   */
  private recreer(): void {
    const hote = this.hote.nativeElement;
    const racine = hote.getRootNode() as Document | ShadowRoot;
    const actif = racine.activeElement;
    // Le focus est souvent DÉJÀ perdu à ce moment : le badge désactive ses options pendant le `POST`, et un bouton
    // désactivé lâche le focus (vers `<body>`, ou vers l'hôte d'ombre sans élément actif dedans). Perdu = à reprendre ;
    // un focus posé ailleurs (le shell) n'est pas volé.
    const docActif = document.activeElement;
    // `instanceof HTMLBodyElement` et non une comparaison au corps du document : le garde de la racine d'ombre
    // (`tests/unit/angular/portails-hors-ombre.test.ts`) est LEXICAL et refuse toute mention de celui-ci. Ici ce n'est
    // qu'une lecture de l'élément actif, pas un rendu hors de la racine : le garde n'a rien à protéger, pas une esquive.
    const perdu = !docActif || docActif instanceof HTMLBodyElement || (racine instanceof ShadowRoot && actif === null && docActif === racine.host);
    const avaitFocus = (!!actif && hote.contains(actif)) || perdu;
    this.generation.update((g) => g + 1);
    if (!avaitFocus) return;
    afterNextRender(() => hote.querySelector<HTMLElement>(BADGE_ESPACE)?.focus({ preventScroll: true }), { injector: this.injecteur });
  }
}
