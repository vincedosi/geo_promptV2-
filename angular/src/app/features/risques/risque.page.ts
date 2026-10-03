import {
  ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ChargementService } from '../../core/chargement/chargement.service';
import { BarreProgressionComponent } from '../../ui/barre-progression/barre-progression.component';
import { FilArianeComponent, type SegmentAriane } from '../../ui/fil-ariane/fil-ariane.component';
import { FilEtapesComponent } from '../../ui/fil-etapes/fil-etapes.component';
import { IconeComponent } from '../../ui/icone/icone.component';
import { VueCartesComponent } from './cartes/vue-cartes.component';
import { etapesAffichees } from './commandes/etapes';
import { EtatRisqueService } from './etat/etat-risque.service';
import { ETAPES, type Etape } from './logique/etape';
import type { Niveau } from './logique/profil';

/**
 * Ce qu'on est en train de régler, tant que le doigt n'a pas lâché (`RegletteRayons.tsx:63`).
 * ⚠ Ce n'est PAS un profil : une intention sans géométrie en base. La carte s'en sert pour un aperçu,
 * et rien d'autre ne doit le lire — surtout pas un calcul de population.
 */
export interface ApercuRayon {
  /** Le niveau dont on déplace le bord, ou `null` quand ils sont liés. */
  niveau: Niveau | null;
  rayonM: number;
}

/** Bornes de la poignée (React : sous 320 px le tableau de ③ devient illisible, au-delà de 900 la carte ne montre plus rien). */
export const LARGEUR_PANNEAU_MIN = 320;
export const LARGEUR_PANNEAU_MAX = 900;
const LARGEUR_PANNEAU_DEFAUT = 480;

/**
 * L'écran « Population à risque industriel » — portage de `AnalysePopulationOverlay.tsx` (lot 3).
 *
 * ── UNE ROUTE PLEIN ÉCRAN, PAS UN OVERLAY (arbitrage A1) ─────────────────
 *
 * React montait un `role="dialog"` en `position: fixed` au-dessus de `/map`. `position: fixed` est interdit dans
 * la racine d'ombre : l'écran est donc la route `risques`, sœur de `essai-carte` sous `remoteRoutes`, hors
 * coquille, gardée par `authGuard`. Même rendu (plein cadre), même en-tête. Fermer (croix ou Échap, A7) navigue
 * vers le parent RELATIF, l'accueil — `/map` n'existe pas encore en Angular.
 *
 * ── CE QUE L'ÉCRAN PORTE, ET CE QUI RESTE LOCAL ──────────────────────────
 *
 * L'état qui décide d'un chiffre vit dans `EtatRisqueService`, reflété dans `?risque=` (A2). La largeur du
 * panneau, le repli « Carte seule » et l'aperçu de rayon restent LOCAUX, comme React (l.393-403) : ils ne
 * changent aucun chiffre, et un lien partagé n'impose pas sa mise en page au destinataire.
 *
 * ── RIEN NE SE DÉMONTE ENTRE LES ÉTAPES ──────────────────────────────────
 *
 * Changer d'étape réécrit le paramètre de requête : même route, le composant est RÉUTILISÉ par le routeur,
 * donc ni l'écran ni la carte ne sont recréés. Le panneau replié garde `visibility: hidden` et une largeur
 * nulle, jamais `display: none` ni `@if` : ses composants restent montés, un jeu en construction survit.
 */
@Component({
  selector: 'mg-risque',
  imports: [BarreProgressionComponent, FilArianeComponent, FilEtapesComponent, IconeComponent, VueCartesComponent],
  // Services d'ÉTAT fournis par l'écran (A13) : détruits avec lui. T5-T16 y ajoutent les leurs.
  providers: [ChargementService, EtatRisqueService],
  templateUrl: './risque.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex h-full flex-col overflow-hidden bg-[var(--bg-primary)] outline-none',
    // Échap écouté sur l'HÔTE, jamais sur `document` — qui serait celui du shell.
    '(keydown.escape)': 'fermer()',
    tabindex: '-1',
  },
})
export class RisquePage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly etatRisque = inject(EtatRisqueService);

  protected readonly etat = this.etatRisque.etat;
  /** Une campagne simulée sur le jeu ouvert allume l'étape ⑤ — branché en T16. */
  private readonly simulation = signal(false);
  protected readonly etapes = computed(() => etapesAffichees(this.etat(), this.simulation()));
  /** Le territoire regardé : « France entière » en T4 ; T5 résout `etat.chemin` (A3). */
  protected readonly segmentsAriane: SegmentAriane[] = [{ cle: 'france', libelle: 'France entière' }];
  /** La maille listée, en minuscules comme `FilAriane` (elements.tsx) : « région » à la France entière (A4). */
  protected readonly precisionAriane = 'région';
  /** Le libellé de la cible : « Population totale » en T4 ; T5 le lit dans le catalogue des cibles. */
  protected readonly libelleCible = 'Population totale';

  /** Panneau d'étape : largeur réglée à la poignée, repli « Carte seule ». Locaux (React l.393-394). */
  readonly largeurPanneau = signal(LARGEUR_PANNEAU_DEFAUT);
  readonly carteSeule = signal(false);
  /** Le rayon en cours de glissement d'une réglette (T6), relayé à la carte (T8). Ni URL, ni état du module. */
  readonly apercuRayon = signal<ApercuRayon | null>(null);

  constructor() {
    // Le focus sur l'hôte à l'ouverture : sans lui, Échap ne l'atteint pas avant le premier clic dans l'écran.
    afterNextRender(() => {
      const el = this.hote.nativeElement;
      if (!el.contains(el.ownerDocument.activeElement)) el.focus({ preventScroll: true });
    });
  }

  protected choisirEtape(cle: string): void {
    if ((ETAPES as readonly string[]).includes(cle)) this.etatRisque.maj({ etape: cle as Etape });
  }

  /** Croix et Échap : retour au parent RELATIF (A7) — le préfixe de montage est inconnu. */
  protected fermer(): void {
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  /**
   * Poignée du panneau : capture du pointeur sur ELLE-MÊME, écoute sur l'élément et non sur `window`
   * (React écoutait `window` ; dans un hôte, ce serait celui du shell). La carte suit par le
   * `ResizeObserver` de `mg-carte`.
   */
  protected saisirPoignee(ev: PointerEvent): void {
    const poignee = ev.currentTarget as HTMLElement;
    poignee.setPointerCapture?.(ev.pointerId);
    const depart = ev.clientX;
    const initiale = this.largeurPanneau();
    const deplacer = (e: PointerEvent) => {
      this.largeurPanneau.set(Math.max(LARGEUR_PANNEAU_MIN, Math.min(LARGEUR_PANNEAU_MAX, initiale + e.clientX - depart)));
    };
    const relacher = () => {
      poignee.removeEventListener('pointermove', deplacer);
      poignee.removeEventListener('pointerup', relacher);
      poignee.removeEventListener('pointercancel', relacher);
    };
    poignee.addEventListener('pointermove', deplacer);
    poignee.addEventListener('pointerup', relacher);
    poignee.addEventListener('pointercancel', relacher);
  }
}
