import {
  ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, model, viewChild,
} from '@angular/core';
import { NotificationsService } from '../../../ui/notifications/notifications.service';

/** Une ligne de journal d'import. `message` est affiché tel quel (React y écrit souvent déjà l'heure). */
export interface LigneJournal {
  message: string;
  niveau: 'debug' | 'info' | 'warn' | 'error' | 'success' | 'log' | 'rapport';
  phase?: string;
  /** Horodatage en millisecondes : affiché `[HH:MM:SS]` devant le message quand il est fourni. */
  horodatage?: number;
}

export type NiveauJournal = LigneJournal['niveau'];
type Niveau = NiveauJournal;

/** Ordre des boutons de filtre de `radio/page.tsx:470`. */
const NIVEAUX_FILTRABLES: readonly Niveau[] = ['info', 'warn', 'error', 'success', 'debug'];
/** Niveaux actifs au départ, comme React : `debug` est masqué. */
export const NIVEAUX_ACTIFS_INITIAUX: readonly Niveau[] = ['info', 'warn', 'error', 'success'];
/** Écart en px sous lequel on considère que l'utilisateur est « en bas » (`radio/page.tsx:506`). */
const MARGE_BAS = 30;

/**
 * Palette du journal radio (`logLevelColor`, `radio/page.tsx:228`) ramenée aux jetons (C9) : les hex
 * gris/ambre/rouge/vert de React deviennent le jeton sémantique le plus proche, lisible dans les
 * deux thèmes.
 */
const COULEURS: Record<Niveau, string> = {
  debug: 'var(--text-tertiary)',
  info: 'var(--text-secondary)',
  log: 'var(--text-secondary)',
  warn: 'var(--warning)',
  error: 'var(--danger)',
  success: 'var(--success)',
  // Lignes « RAPPORT » / « ═══ » de l'import Shapefile (`carreaux-import/_components/ImportStep.tsx:262`, `C.blue`
  // = `#3b82f6`) : le jeton informatif, lisible dans les deux thèmes (T14).
  rapport: 'var(--info)',
};

/**
 * Couleur du TEXTE de chaque niveau (revue des vagues du lot 6, Important 2) : la propriété `--*-texte` du cadre
 * admin (F-3, DESIGN_SYSTEM § 3), lisible sur le fond clair du terminal, avec repli sur le jeton brut quand le
 * catalogue monte le journal hors du cadre. `COULEURS` reste le jeton brut, pour le fond et la bordure des boutons
 * de filtre (aplats et bordures gardent le jeton brut).
 */
const COULEURS_TEXTE: Record<Niveau, string> = {
  debug: COULEURS.debug,
  info: COULEURS.info,
  log: COULEURS.log,
  warn: 'var(--warning-texte, var(--warning))',
  error: 'var(--danger-texte, var(--danger))',
  success: 'var(--success-texte, var(--success))',
  rapport: 'var(--info-texte, var(--info))',
};

/**
 * Journal d'import (arbitrage C14), rendu du terminal de la page radio (`radio/page.tsx:459-518`) :
 * lignes colorées par niveau, filtre par niveau avec compteurs (`filtrable`), « Copier »
 * (`copiable`), défilement automatique.
 *
 * Défilement par `conteneur.scrollTop = conteneur.scrollHeight`, JAMAIS `scrollIntoView` (que React
 * emploie, `radio/page.tsx:338`) : dans un hôte, `scrollIntoView` fait aussi défiler la page du
 * SHELL. Et seulement tant que l'utilisateur n'a pas remonté pour lire (`userScrolledRef`).
 *
 * Un niveau hors des cinq boutons (`log`, `rapport`) n'est jamais masqué par le filtre.
 *
 * Le filtre est un `model()` (`niveauxActifs`) : un écran qui masque le journal sous un `@if` le
 * tient lui-même, sinon il repartirait du défaut à chaque réaffichage (React le tient au niveau de la
 * page ; vague finale, A7). Une liste qui repart de zéro (nouvel import) réarme le suivi du bas,
 * comme `userScrolledRef.current = false` de React (`radio/page.tsx:257`, A6). « Copier » copie le
 * texte AFFICHÉ (horodatage compris) de toutes les lignes (A8).
 *
 * Contenu projeté `[outils]` : des boutons de plus, rendus après « Copier » dans la même rangée (le
 * « Fermer » d'un journal passé de la radio, `radio/page.tsx:489-497`) ; style `.outil` à reprendre par
 * l'écran (le style d'un composant ne s'applique pas au contenu projeté).
 */
@Component({
  selector: 'mg-journal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (filtrable() || copiable()) {
      <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
        @if (filtrable()) {
          @for (b of boutons(); track b.niveau) {
            <button
              type="button"
              class="filtre"
              [attr.data-niveau]="b.niveau"
              [attr.aria-pressed]="b.actif"
              [class.actif]="b.actif"
              [style.--couleur]="b.couleur"
              [style.--couleur-texte]="b.couleurTexte"
              (click)="basculer(b.niveau)"
            >{{ b.libelle }}</button>
          }
        }
        <div class="flex-1"></div>
        @if (copiable()) {
          <button type="button" data-copier class="outil" (click)="copier()">Copier</button>
        }
        <ng-content select="[outils]" />
      </div>
    }
    <div
      #terminal
      data-terminal
      class="terminal"
      [style.height.px]="hauteur()"
      (scroll)="surDefilement()"
    >
      @for (l of visibles(); track $index) {
        <div class="whitespace-pre-wrap break-words" [style.color]="l.couleur">{{ l.texte }}</div>
      }
    </div>
  `,
  styles: `
    .filtre {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 10px;
      font-family: var(--font-mono);
      background: transparent;
      border: 0.5px solid var(--border-default);
      color: var(--text-tertiary);
      cursor: pointer;
      transition: all 0.15s;
    }
    /* React : fond = couleur + « 20 » (alpha 32/255 ≈ 12,5 %). */
    .filtre.actif {
      background: color-mix(in srgb, var(--couleur) 12.5%, transparent);
      border-color: var(--couleur);
      color: var(--couleur-texte);
    }
    .outil {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 10px;
      font-family: inherit;
      background: transparent;
      border: 0.5px solid var(--border-default);
      color: var(--text-tertiary);
      cursor: pointer;
    }
    /* React : #080808 ; ramené à --bg-level-0 (C9), qui suit le thème comme les couleurs de ligne. */
    .terminal {
      background: var(--bg-level-0);
      border: 0.5px solid var(--border-subtle);
      border-radius: 6px;
      padding: 12px;
      overflow-y: auto;
      font-family: var(--font-mono);
      font-size: 11px;
      line-height: 1.7;
    }
  `,
})
export class JournalComponent {
  readonly lignes = input.required<readonly LigneJournal[]>();
  readonly filtrable = input(false);
  readonly copiable = input(false);
  readonly hauteur = input(240);

  private readonly notifications = inject(NotificationsService, { optional: true });
  private readonly terminal = viewChild.required<ElementRef<HTMLElement>>('terminal');
  /** Niveaux affichés par le filtre ; à lier en `[(niveauxActifs)]` pour survivre à un masquage. */
  readonly niveauxActifs = model<ReadonlySet<Niveau>>(new Set(NIVEAUX_ACTIFS_INITIAUX));
  private readonly actifs = this.niveauxActifs;
  /** L'utilisateur a remonté pour lire : on ne le ramène plus en bas (`userScrolledRef`). */
  private remonte = false;
  /** Longueur vue au dernier rendu : une liste plus courte est un nouvel import (les écrans ne font qu'ajouter). */
  private longueurVue = 0;

  private readonly compteurs = computed(() => {
    const c = new Map<Niveau, number>();
    for (const l of this.lignes()) c.set(l.niveau, (c.get(l.niveau) ?? 0) + 1);
    return c;
  });

  protected readonly boutons = computed(() => {
    const actifs = this.actifs();
    const compteurs = this.compteurs();
    return NIVEAUX_FILTRABLES.map((niveau) => {
      const n = compteurs.get(niveau);
      return {
        niveau,
        actif: actifs.has(niveau),
        couleur: COULEURS[niveau],
        couleurTexte: COULEURS_TEXTE[niveau],
        libelle: `${niveau.toUpperCase()}${n ? ` (${n})` : ''}`,
      };
    });
  });

  protected readonly visibles = computed(() => {
    const filtrer = this.filtrable();
    const actifs = this.actifs();
    return this.lignes()
      .filter((l) => !filtrer || !NIVEAUX_FILTRABLES.includes(l.niveau) || actifs.has(l.niveau))
      .map((l) => ({ texte: texteAffiche(l), couleur: COULEURS_TEXTE[l.niveau] ?? COULEURS_TEXTE.info }));
  });

  constructor() {
    afterRenderEffect(() => {
      this.visibles();
      const lignes = this.lignes();
      if (lignes.length < this.longueurVue) this.remonte = false;
      this.longueurVue = lignes.length;
      if (this.remonte) return;
      const el = this.terminal().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }

  protected basculer(niveau: Niveau): void {
    this.actifs.update((a) => {
      const n = new Set(a);
      if (n.has(niveau)) n.delete(niveau); else n.add(niveau);
      return n;
    });
  }

  protected surDefilement(): void {
    const el = this.terminal().nativeElement;
    this.remonte = el.scrollTop + el.clientHeight < el.scrollHeight - MARGE_BAS;
  }

  /**
   * Copie TOUTES les lignes (pas seulement les visibles), comme React, avec le texte affiché
   * (`[HH:MM:SS]` devant quand la ligne est horodatée). Le presse-papiers peut être
   * absent (contexte non sécurisé) ou refusé : une notification d'erreur, jamais une exception.
   */
  protected copier(): void {
    const texte = this.lignes().map(texteAffiche).join('\n');
    const echec = (e: unknown) =>
      this.notifications?.error('Copie impossible', e instanceof Error ? e.message : 'Le presse-papiers est indisponible.');
    try {
      navigator.clipboard.writeText(texte).then(() => this.notifications?.success('Logs copiés'), echec);
    } catch (e) {
      echec(e);
    }
  }
}

function texteAffiche(l: LigneJournal): string {
  return l.horodatage === undefined ? l.message : `[${heure(l.horodatage)}] ${l.message}`;
}

function heure(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
