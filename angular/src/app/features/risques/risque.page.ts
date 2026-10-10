import {
  ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, signal,
} from '@angular/core';
import type { HttpResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import type { Observable } from 'rxjs';
import { ChargementService } from '../../core/chargement/chargement.service';
import { BarreProgressionComponent } from '../../ui/barre-progression/barre-progression.component';
import { FilArianeComponent, type SegmentAriane } from '../../ui/fil-ariane/fil-ariane.component';
import { FilEtapesComponent } from '../../ui/fil-etapes/fil-etapes.component';
import { IconeComponent } from '../../ui/icone/icone.component';
import { PerimeDirective } from '../../ui/perime/perime.directive';
import { VueCartesComponent } from './cartes/vue-cartes.component';
import { EtapeCouvertureComponent } from './etapes/couverture/etape-couverture.component';
import { EtapeRayonComponent } from './etapes/rayon/etape-rayon.component';
import { EtapeZonesComponent } from './etapes/zones/etape-zones.component';
import { BandeauCampagneComponent } from './etapes/campagne/bandeau-campagne.component';
import { PanneauCampagneComponent } from './etapes/campagne/panneau-campagne.component';
import { SimulationService } from './etat/simulation.service';
import { PanneauSitesComponent } from './etapes/sites/panneau-sites.component';
import { BandeauKpiRisqueComponent } from './commandes/bandeau-kpi-risque.component';
import { BarreCommuneComponent } from './commandes/barre-commune.component';
import { PanneauProfilComponent } from './commandes/panneau-profil.component';
import { type ApercuRayon, RegletteRayonsComponent } from './commandes/reglette-rayons.component';
import { ResumeProfilComponent } from './commandes/resume-profil.component';
import { etapesAffichees } from './commandes/etapes';
import { ProfilRisqueApi } from './data/profil-risque.api';
import { CourbeRayonComponent, type PerimetreCourbe } from './etapes/rayon/courbe-rayon.component';
import { AtelierJeuxService } from './etat/atelier-jeux.service';
import { DonneesRisqueService } from './etat/donnees-risque.service';
import { EtatRisqueService } from './etat/etat-risque.service';
import { BoutonExportComponent } from './exports/bouton-export.component';
import { BoutonVoirCarteComponent } from './exports/bouton-voir-carte.component';
import { PONT_CARTE } from '../carte/etat/pont-carte';
import { codeProfil } from './logique/code-profil';
import { LIBELLE_DIMENSION } from './logique/dimensions';
import { ETAPES, type Etape } from './logique/etape';
import { NIVEAUX, type ProfilRayons, anneauxDuNiveau } from './logique/profil';

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
 * la racine d'ombre : l'écran est donc une ROUTE, ENFANT de la carte principale depuis le lot 4 (`carte/risques`,
 * arbitrage B2) — rendue par l'outlet de `CartePage` en surimpression, la carte intacte dessous, comme l'overlay
 * React. Même rendu (plein cadre), même en-tête. Fermer (croix ou Échap) navigue vers le parent RELATIF : la carte
 * (A7 du lot 3 levé). L'ancienne adresse `risques` redirige vers `carte/risques`, paramètres compris.
 *
 * « Voir sur la carte » n'existe que si la carte principale fournit son pont (`PONT_CARTE`, B3) : sous un autre
 * parent, le bouton est ABSENT plutôt qu'inerte.
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
    BandeauCampagneComponent, BandeauKpiRisqueComponent, BarreCommuneComponent, BarreProgressionComponent,
    BoutonExportComponent, BoutonVoirCarteComponent, CourbeRayonComponent, EtapeCouvertureComponent, EtapeRayonComponent, EtapeZonesComponent,
    FilArianeComponent, FilEtapesComponent, IconeComponent, PanneauCampagneComponent, PanneauProfilComponent, PanneauSitesComponent,
    PerimeDirective, RegletteRayonsComponent, ResumeProfilComponent, VueCartesComponent,
  ],
  // Services d'ÉTAT fournis par l'écran (A13) : détruits avec lui, requêtes en cours comprises. T6-T16 y ajoutent les leurs.
  providers: [ChargementService, EtatRisqueService, DonneesRisqueService, AtelierJeuxService, SimulationService],
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
  /** Le pont vers la carte principale qui porte l'écran (B3) ; `null` hors de la carte. */
  protected readonly pont = inject(PONT_CARTE, { optional: true });

  protected readonly etat = this.etatRisque.etat;
  /**
   * La simulation de ⑤ (T16). Fournie par l'écran mais INERTE jusqu'à la première visite de ⑤ (`activer`) : les étapes
   * ① à ④ ne paient pas une simulation qu'elles n'affichent pas. Une fois lue, elle reste : le fil d'étapes continue de
   * marquer ⑤ (`AnalysePopulationOverlay.tsx:385,938`), et le retour à ⑤ ne recharge rien.
   */
  private readonly simulation = inject(SimulationService);
  protected readonly etapes = computed(() => etapesAffichees(this.etat(), !!this.simulation.reponse()?.simulation));
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
  /** Le dernier segment du fil, sous la forme de la courbe et de son export (`AnalysePopulationOverlay.tsx:495`). */
  protected readonly perim = computed<PerimetreCourbe | null>(() => {
    const d = this.donnees.chemin().at(-1);
    return d ? { niveau: d.niveau, code: d.code } : null;
  });

  private readonly profilApi = inject(ProfilRisqueApi);
  /** Un profil sans anneau n'a ni bandes ni territoires : le classeur serait vide (`BoutonExportProfil.tsx:49-51`). */
  protected readonly profilVide = computed(
    () => NIVEAUX.every((n) => anneauxDuNiveau(this.donnees.profilCalcul(), n).length === 0),
  );
  /**
   * « Exporter le profil » — paramètres de `BoutonExportProfil.tsx:57-64`, lus AU CLIC : profil CALCULÉ, cible, maille
   * (`commune` ou `departement`, jamais `region`), libellé de la cible, département du fil, campagne.
   */
  protected readonly chargerExportProfil = (): Observable<HttpResponse<Blob>> => {
    const p = new URLSearchParams({
      profil: codeProfil(this.donnees.profilCalcul()),
      cible: this.etat().cible,
      maille: this.donnees.dimension() === 'commune' ? 'commune' : 'departement',
      libelle_cible: this.donnees.libelleCible(),
    });
    const parent = this.donnees.chemin().find((s) => s.niveau === 'departement')?.code;
    if (parent) p.set('parent', parent);
    const campagne = this.etat().campagne;
    if (campagne) p.set('campagne', campagne);
    return this.profilApi.exportProfil(p);
  };

  /** Le cadre du panneau d'étape : ③ empile ses deux blocs sans marge ; ④ garde les 16 × 18 px de React. */
  protected readonly classePanneau = computed(() => {
    const etape = this.etat().etape;
    // ③ empile ses deux blocs ; ⑤ porte son propre cadre défilant (`Cadre`, `PanneauCampagne.tsx:463`).
    if (etape === 'couverture' || etape === 'campagne') return 'flex min-h-0 min-w-0 flex-1 flex-col';
    return etape === 'zones' ? 'min-w-0 flex-1 overflow-auto px-[18px] py-4' : 'min-w-0 flex-1 overflow-auto px-5 py-4';
  });

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
    // Première visite de ⑤ (`AvecSimulation`, `AnalysePopulationOverlay.tsx:1677-1686`).
    effect(() => {
      if (this.etat().etape === 'campagne') this.simulation.activer();
    });

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
   * Croix, Échap et « Voir sur la carte » : retour au parent RELATIF — la carte principale (B2) ; le préfixe de montage
   * est inconnu. Un Échap déjà consommé par un gestionnaire intérieur (`preventDefault()`) ne ferme pas l'écran. Celui
   * qui le ferme est CONSOMMÉ à son tour : il remonte jusqu'à l'hôte de la carte, dont la pile Échap fermerait en plus
   * le panneau resté ouvert dessous.
   */
  protected fermer(ev?: Event): void {
    if (ev?.defaultPrevented) return;
    ev?.preventDefault();
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
    } else {
      // Refermé par la chip : l'ouvreur ne sert plus. Le garder ferait rendre le focus, à une ouverture ULTÉRIEURE par
      // l'URL, à une chip qui n'a rien ouvert (relecture T10).
      this.ouvreurAtelier = null;
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
