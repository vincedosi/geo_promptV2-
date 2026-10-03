import {
  ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ChargementService } from '../../core/chargement/chargement.service';
import { BarreProgressionComponent } from '../../ui/barre-progression/barre-progression.component';
import { FilArianeComponent, type SegmentAriane } from '../../ui/fil-ariane/fil-ariane.component';
import { FilEtapesComponent } from '../../ui/fil-etapes/fil-etapes.component';
import { IconeComponent } from '../../ui/icone/icone.component';
import { PerimeDirective } from '../../ui/perime/perime.directive';
import { VueCartesComponent } from './cartes/vue-cartes.component';
import { EtapeRayonComponent } from './etapes/rayon/etape-rayon.component';
import { PanneauSitesComponent } from './etapes/sites/panneau-sites.component';
import { BandeauKpiRisqueComponent } from './commandes/bandeau-kpi-risque.component';
import { BarreCommuneComponent } from './commandes/barre-commune.component';
import { PanneauProfilComponent } from './commandes/panneau-profil.component';
import { type ApercuRayon, RegletteRayonsComponent } from './commandes/reglette-rayons.component';
import { ResumeProfilComponent } from './commandes/resume-profil.component';
import { etapesAffichees } from './commandes/etapes';
import { DonneesRisqueService } from './etat/donnees-risque.service';
import { EtatRisqueService } from './etat/etat-risque.service';
import { LIBELLE_DIMENSION } from './logique/dimensions';
import { ETAPES, type Etape } from './logique/etape';
import type { ProfilRayons } from './logique/profil';

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
  imports: [
    BandeauKpiRisqueComponent, BarreCommuneComponent, BarreProgressionComponent, EtapeRayonComponent,
    FilArianeComponent, FilEtapesComponent, IconeComponent, PanneauProfilComponent, PanneauSitesComponent,
    PerimeDirective, RegletteRayonsComponent, ResumeProfilComponent, VueCartesComponent,
  ],
  // Services d'ÉTAT fournis par l'écran (A13) : détruits avec lui, requêtes en cours comprises. T6-T16 y ajoutent les leurs.
  providers: [ChargementService, EtatRisqueService, DonneesRisqueService],
  templateUrl: './risque.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex h-full flex-col overflow-hidden bg-[var(--bg-primary)] outline-none',
    // Échap écouté sur l'HÔTE, jamais sur `document` — qui serait celui du shell. Un gestionnaire INTÉRIEUR
    // (le tiroir des anneaux) qui consomme Échap appelle `preventDefault()` : l'écran ne se ferme alors pas.
    '(keydown.escape)': 'fermer($event)',
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
  /** Les données partagées (T5) : bandes, courbe, sites, cibles, référentiel. */
  protected readonly donnees = inject(DonneesRisqueService);
  /**
   * Le territoire regardé, résolu depuis `etat.chemin` (A3). Le titre porte le NIVEAU et le code
   * (`elements.tsx:104`) : 18 codes INSEE désignent une région ET un département.
   */
  protected readonly segmentsAriane = computed<SegmentAriane[]>(() => [
    { cle: 'france', libelle: 'France entière' },
    ...this.donnees.chemin().map((s) => ({
      cle: `${s.niveau}:${s.code}`,
      libelle: s.nom,
      titre: `${s.niveau === 'region' ? 'Région' : 'Département'} ${s.code}`,
    })),
  ]);
  /**
   * Le territoire regardé, nommé pour les panneaux — DEUX formes, comme React : ① dit « sur la France entière »
   * (`AnalysePopulationOverlay.tsx:1333`), ② « France entière, carroyage INSEE 200 m » (l.1369).
   */
  protected readonly libelleTerritoire = computed(() => this.donnees.chemin().at(-1)?.nom ?? 'la France entière');
  protected readonly nomPerimetre = computed(() => this.donnees.chemin().at(-1)?.nom ?? 'France entière');
  /** La maille LISTÉE, en minuscules comme `FilAriane` (elements.tsx:119). */
  protected readonly precisionAriane = computed(() => LIBELLE_DIMENSION[this.donnees.dimension()].toLowerCase());

  /** Panneau d'étape : largeur réglée à la poignée, repli « Carte seule ». Locaux (React l.393-394). */
  readonly largeurPanneau = signal(LARGEUR_PANNEAU_DEFAUT);
  readonly carteSeule = signal(false);
  /**
   * Le panneau réellement replié. « Carte seule » est MASQUÉ à ④ avec un jeu et à ⑤ (`mg-vue-cartes`) : actif en
   * y entrant, il laissait le panneau replié sans aucun bouton pour le rouvrir. Le repli ne vaut donc que là où le
   * bouton existe ; `carteSeule` est gardé, et reprend effet en ressortant.
   */
  protected readonly panneauReplie = computed(() => {
    const e = this.etat();
    const sansBouton = (e.etape === 'zones' && !!e.jeu) || e.etape === 'campagne';
    return this.carteSeule() && !sansBouton;
  });
  /**
   * Le rayon en cours de glissement d'une réglette, relayé à la carte (T8). Ni URL, ni état du module : il ne
   * dure que le temps d'un geste, et un lien partagé porterait sinon un rayon que personne n'a validé.
   */
  readonly apercuRayon = signal<ApercuRayon | null>(null);

  constructor() {
    // Le focus sur l'hôte à l'ouverture : sans lui, Échap ne l'atteint pas avant le premier clic dans l'écran.
    afterNextRender(() => {
      const el = this.hote.nativeElement;
      // `getRootNode()` et non `ownerDocument` : dans une racine d'ombre, `document.activeElement` est l'HÔTE
      // de la racine, jamais l'élément focalisé à l'intérieur.
      const actif = (el.getRootNode() as Document | ShadowRoot).activeElement;
      if (!el.contains(actif)) el.focus({ preventScroll: true });
    });
  }

  protected choisirEtape(cle: string): void {
    if ((ETAPES as readonly string[]).includes(cle)) this.etatRisque.maj({ etape: cle as Etape });
  }

  /**
   * Croix et Échap : retour au parent RELATIF (A7) — le préfixe de montage est inconnu. Un Échap déjà consommé
   * par un gestionnaire intérieur (`preventDefault()`) ne ferme pas l'écran.
   */
  protected fermer(ev?: Event): void {
    if (ev?.defaultPrevented) return;
    void this.router.navigate(['..'], { relativeTo: this.route });
  }

  /** Le cadenas, une réglette relâchée ou un geste du tiroir : le profil va dans l'état, donc dans l'URL. */
  protected poserProfil(profil: ProfilRayons): void {
    this.etatRisque.maj({ profil });
  }

  /** Une chip du résumé : déplie ou replie le tiroir des anneaux (`AnalysePopulationOverlay.tsx:952`). */
  protected basculerAtelier(): void {
    const ouvrir = !this.etat().atelier;
    // L'élément qui OUVRE le tiroir (une chip du résumé, en général) : le focus lui reviendra à Échap. Lu par
    // `getRootNode()` : dans une racine d'ombre, `document.activeElement` serait l'hôte de la racine.
    if (ouvrir) {
      const el = this.hote.nativeElement;
      const actif = (el.getRootNode() as Document | ShadowRoot).activeElement;
      this.ouvreurAtelier = actif instanceof HTMLElement && actif !== el && el.contains(actif) ? actif : null;
    }
    this.etatRisque.maj({ atelier: ouvrir });
  }

  /** L'élément focalisé à l'ouverture du tiroir — `null` s'il a été ouvert par l'URL (`atelier=1`). */
  private ouvreurAtelier: HTMLElement | null = null;

  /**
   * Échap DANS le tiroir le referme, sans fermer l'écran (`preventDefault`, lu par `fermer`). Le focus revient à
   * l'élément qui l'avait OUVERT (la chip réellement cliquée, relecture T8) ; à défaut — tiroir ouvert par l'URL, ou
   * ouvreur disparu entre-temps —, à la première chip du résumé, puis à l'hôte : l'élément focalisé disparaît avec le
   * tiroir, et Échap n'atteindrait plus l'écran ensuite. Tous sont DANS l'hôte : un second Échap y remonte et ferme.
   */
  protected fermerAtelier(ev: Event): void {
    ev.preventDefault();
    this.etatRisque.maj({ atelier: false });
    const hote = this.hote.nativeElement;
    const ouvreur = this.ouvreurAtelier;
    this.ouvreurAtelier = null;
    const cible = ouvreur && ouvreur.isConnected && hote.contains(ouvreur)
      ? ouvreur
      : hote.querySelector<HTMLElement>('mg-resume-profil button') ?? hote;
    cible.focus({ preventScroll: true });
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
