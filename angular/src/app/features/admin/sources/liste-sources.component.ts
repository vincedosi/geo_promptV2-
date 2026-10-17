import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formaterNombre } from '../../../core/format/nombre';
import { IconeComponent } from '../../../ui/icone/icone.component';
import type { DataSource } from '../logique/types/admin';
import type { StatsRadio } from '../radio/data/radio-admin.api';
import type { StatsSources } from './data/sources-admin.api';
import { badgeType, formatDate, type BadgeType, type OngletSources } from './logique/constantes';

interface VueSource {
  id: string;
  nom: string;
  badge: BadgeType;
  meta: string[];
}

/**
 * Colonne gauche de la vue « Toutes » (`app/admin/sources/page.tsx:417-543`) : données système (IRIS,
 * Transport — hors `data_sources`), bloc Radio, puis les sources importées. `mode="radio"` ne rend que
 * le bloc Radio (onglet Radio, voir `SourcesPage`).
 *
 * Écarts à React :
 * - les cartes cliquables sont des `<button>` (clavier, `aria-pressed` sur la source choisie) — React
 *   posait `onClick` sur des `div`, inatteignables au clavier.
 * - « lignes » en `fr-FR` : React écrit `valid_count.toLocaleString()` SANS langue (celle du
 *   navigateur) ; le reste de l'écran est en `fr-FR`.
 * - « Gérer → » (`href="/admin/radio"`) : lien RELATIF vers l'écran Radio porté (T16),
 *   `../importer/radio` depuis l'onglet Sources de Données — jamais vers React.
 * - teintes (C9) : `#06b6d4` → `--info`, `#22c55e` → `--success`, `rgba(78,205,196,0.05)` →
 *   `color-mix` du teal à 5 %.
 *
 * Gardés par parité : nombres BRUTS du bloc Radio (`11602 émetteurs FM`), libellés « table: … »,
 * textes sans accents (« Aucune source de donnees… »).
 */
@Component({
  selector: 'mg-liste-sources',
  imports: [IconeComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Badge de type : `sources-commun.css`, partagé avec le détail.
  styleUrls: ['./sources-commun.css'],
  template: `
    @if (mode() === 'toutes' && stats(); as s) {
      <div class="bloc">
        <div class="etiquette">Données système</div>
        <div class="pile-6">
          <button type="button" class="carte systeme" data-systeme="iris" data-teinte="info" (click)="choisirOnglet.emit('iris')">
            <div class="corps">
              <div class="ligne-titre">
                <span class="titre">IRIS — Contours géographiques INSEE</span>
                <span class="etiquette-type">IRIS</span>
              </div>
              <div class="meta">
                <span class="fort">{{ systeme().irisZones }} zones</span>
                <span>{{ systeme().irisEnrichis }} enrichies (population)</span>
                <span class="discret">table: iris</span>
              </div>
            </div>
          </button>
          <button type="button" class="carte systeme" data-systeme="transport" data-teinte="succes" (click)="choisirOnglet.emit('transport')">
            <div class="corps">
              <div class="ligne-titre">
                <span class="titre">Transport &amp; Flux routier</span>
                <span class="etiquette-type">Transport</span>
              </div>
              <div class="meta retour">
                <span class="fort">{{ systeme().entrees }} entrées</span>
                <span>{{ systeme().arrets }} arrêts</span>
                <span class="teinte">bus {{ systeme().bus }}</span>
                <span class="teinte">train {{ systeme().train }}</span>
                <span class="teinte">tram {{ systeme().tram }}</span>
                <span>{{ systeme().flux }} flux routiers</span>
                <span class="discret">tables: poi_france + comptages_routiers</span>
              </div>
            </div>
          </button>
        </div>
      </div>
    }

    <div class="carte radio" data-radio>
      <div class="radio-tete">
        <span class="radio-badge">Radio</span>
        <span class="radio-titre">Radio — Émetteurs FM &amp; DAB+</span>
      </div>
      <div class="radio-meta">
        <span>{{ radio()?.emetteurs_fm ?? 0 }} émetteurs FM</span>
        <span>{{ radio()?.emetteurs_dab ?? 0 }} émetteurs DAB+</span>
        <span>{{ radio()?.total_radios ?? 0 }} radios identifiées</span>
        <span class="discret">table: emetteurs_radio</span>
      </div>
      <a class="gerer" data-gerer routerLink="../importer/radio">Gérer →</a>
    </div>

    @if (mode() === 'toutes') {
      <div class="etiquette">Sources importées</div>
      @if (chargement()) {
        <div class="carte">
          <div class="message mono" data-chargement-sources>
            <mg-icone nom="chargement" [taille]="20" class="tourne" /> Chargement...
          </div>
        </div>
      } @else if (vues().length === 0) {
        <div class="carte">
          <div class="message" data-vide>
            Aucune source de donnees dans cet onglet.<br />
            <span class="message-sous">Importez des donnees via Import Universel</span>
          </div>
        </div>
      } @else {
        <div class="pile-8">
          @for (v of vues(); track v.id) {
            <button type="button" class="carte source" [attr.data-source]="v.id" [attr.aria-pressed]="v.id === selection()"
              (click)="choisir.emit(v.id)">
              <div class="corps">
                <div class="ligne-titre">
                  <span class="titre">{{ v.nom }}</span>
                  <span class="badge-type" data-badge-type [attr.data-famille]="v.badge.famille">{{ v.badge.libelle }}</span>
                </div>
                <div class="meta retour" data-meta>
                  @for (m of v.meta; track $index) { <span>{{ m }}</span> }
                </div>
              </div>
            </button>
          }
        </div>
      }
    }
  `,
  styles: [`
    :host { display: block; font-family: var(--font-sans); }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .tourne { animation: spin 1s linear infinite; }
    .bloc { margin-bottom: 16px; }
    .etiquette { font-size: 9px; font-weight: 500; color: var(--text-secondary); margin-bottom: 8px; }
    .pile-6 { display: flex; flex-direction: column; gap: 6px; }
    .pile-8 { display: flex; flex-direction: column; gap: 8px; }
    .carte {
      display: block; width: 100%; box-sizing: border-box; background: var(--bg-surface); border: 0.5px solid var(--border-subtle);
      border-radius: 2px; overflow: hidden; transition: all 0.2s ease; text-align: left; font: inherit; color: inherit; padding: 0;
    }
    button.carte { cursor: pointer; }
    button.carte:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 1px; }
    .systeme[data-teinte='info'] { --teinte: var(--info); }
    .systeme[data-teinte='succes'] { --teinte: var(--success); }
    .systeme:hover { border-color: var(--teinte); }
    .source[aria-pressed='true'] { border-color: var(--brand-teal); background: color-mix(in srgb, var(--brand-teal) 5%, transparent); }
    .corps { padding: 12px 16px; }
    .ligne-titre { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .titre { font-weight: 600; font-size: 14px; color: var(--text-primary); flex: 1; }
    .etiquette-type {
      font-size: 9px; font-weight: 500; color: var(--teinte); padding: 2px 7px; border-radius: 2px;
      background: color-mix(in srgb, var(--teinte) 10%, transparent); border: 0.5px solid color-mix(in srgb, var(--teinte) 30%, transparent);
    }
    .meta { display: flex; gap: 16px; font-size: 11px; font-family: var(--font-mono); color: var(--text-secondary); }
    .meta.retour { flex-wrap: wrap; }
    .fort { color: var(--teinte); font-weight: 700; }
    .teinte { color: var(--teinte); }
    .discret { color: var(--text-tertiary); }
    .radio { margin-bottom: 12px; }
    .radio-tete { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .radio-badge {
      font-size: 10px; padding: 2px 8px; background: var(--brand-teal-10); border: 0.5px solid var(--brand-teal-30); border-radius: 4px;
      color: var(--brand-teal);
    }
    .radio-titre { font-weight: 500; font-size: 12px; color: var(--text-primary); }
    .radio-meta { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
    /* Teal lisible en clair (≈ 1,8:1 sinon) : light-dark suit le color-scheme de :host (styles.css). */
    .gerer { font-size: 11px; color: light-dark(color-mix(in srgb, var(--brand-teal) 50%, var(--text-primary)), var(--brand-teal)); text-decoration: none; }
    .gerer:focus-visible { outline: 1px solid var(--brand-teal-50); outline-offset: 1px; }
    .message { text-align: center; padding: 40px; color: var(--text-secondary); font-size: 13px; }
    .message.mono { display: flex; align-items: center; justify-content: center; gap: 8px; font-family: var(--font-mono); font-size: 12px; }
    .message-sous { font-size: 12px; color: var(--text-tertiary); }
  `],
})
export class ListeSourcesComponent {
  /** `toutes` : la colonne complète ; `radio` : le bloc Radio seul. */
  readonly mode = input<'toutes' | 'radio'>('toutes');
  readonly sources = input<readonly DataSource[]>([]);
  readonly chargement = input(false);
  readonly stats = input<StatsSources | null>(null);
  readonly radio = input<StatsRadio | null>(null);
  readonly selection = input<string | null>(null);
  readonly choisir = output<string>();
  readonly choisirOnglet = output<OngletSources>();

  protected readonly systeme = computed(() => {
    const s = this.stats();
    if (!s) return { irisZones: '', irisEnrichis: '', entrees: '', arrets: '', bus: '', train: '', tram: '', flux: '' };
    return {
      irisZones: formaterNombre(s.iris.total),
      irisEnrichis: formaterNombre(s.iris.enrichis),
      entrees: formaterNombre(s.transport.total + s.flux.total),
      arrets: formaterNombre(s.transport.total),
      bus: formaterNombre(s.transport.bus),
      train: formaterNombre(s.transport.train),
      tram: formaterNombre(s.transport.tram),
      flux: formaterNombre(s.flux.total),
    };
  });

  protected readonly vues = computed<VueSource[]>(() =>
    this.sources().map((s) => ({
      id: s.id,
      nom: s.name,
      badge: badgeType(s.type, s.category, s.regie),
      meta: [
        `${formaterNombre(s.valid_count)} lignes`,
        formatDate(s.import_date),
        s.organizations?.name || '—',
        ...(s.original_filename ? [s.original_filename] : []),
      ],
    })),
  );
}
