import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { ConfirmationComponent } from '../../../../ui/confirmation/confirmation.component';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { JournalComponent, type LigneJournal } from '../../commun/journal.component';
import { ProgressionImportComponent } from '../../commun/progression-import.component';
import { ImportPoiService } from '../etat/import-poi.service';
import { ORGANISATION_DEFAUT } from '../logique/constantes';

/**
 * Étape 05 « Import reel » — portage de `app/admin/import/_components/ImportStep.tsx` et `ImportLogPanel.tsx`
 * (lot 6, T13). Nom de la source, organisation, puis l'import en flux SSE (⚠ ÉCRIT : une ligne `data_sources`,
 * puis les POI dans `poi_france`).
 *
 * - **Confirmation** (C6) : le `confirm('Lancer l\'import reel en base Supabase ?')` de React devient
 *   `mg-confirmation` au MÊME texte (C16, sans accent) ; annuler n'envoie rien.
 * - **Progression** (C5) : `mg-progression-import` au lieu de la barre de 6 px de React. Étape NOMMÉE du
 *   `message` de la route (« Parsing du fichier... », « Traitement des coordonnees... », « Source "…" creee »,
 *   puis « Insertion en base Supabase » pour les événements d'insertion qui n'en portent pas) ; barre
 *   DÉTERMINÉE seulement quand l'événement porte un total (`processed` / `total`), indéterminée sinon. Sous la
 *   barre, la ligne de compteurs de React (« traites: … inseres: … ignores: … erreurs: … »), gardée à la fin
 *   (React la perdait : l'événement `complete` n'a pas de total).
 * - **Journal** : l'en-tête de `ImportLogPanel` (« // JOURNAL EN DIRECT », OK / SKIP / ERR, nombre de lignes)
 *   puis `mg-journal` (C14) ; « > en cours... » en teal sous le terminal pendant l'import.
 * - **Rapport** : « [OK] Import termine avec succes », « ! Import partiel — … », « ! Import echoue — … »,
 *   total / inseres / ignores / erreurs. `ignores` compte les lignes DÉJÀ PRÉSENTES (identité déterministe,
 *   `ON CONFLICT DO NOTHING` + `.select('id')`) et celles sans coordonnées : un second import du même fichier
 *   rapporte `ignores: 10`, `inseres: 0`.
 *
 * Écarts à React, voulus :
 * - **flux tronqué** (ni `complete` ni `error`) : « ! Le flux s’est interrompu avant la fin. » ; React rendait le
 *   bouton sans un mot. Un échec s'écrit aussi au journal ;
 * - refus HTTP : l'`error` de la route (React lisait le corps comme un flux et se taisait) ;
 * - libellés reliés aux champs (`for` / `id`) ;
 * - couleurs (C9) : `#f87171`, `#fbbf24`, `rgba(…)` → jetons et `color-mix`, texte lisible en clair
 *   (`light-dark`) ; journal sur `--bg-level-0` (React : `--bg-primary`, la même valeur) ; les lignes `---` n'ont
 *   plus de filet (le journal partagé ne le porte pas).
 * Gardés par parité : « LANCER L'IMPORT REEL » en capitales, textes sans accents, exemple de nom daté
 *  `Import POI — <date fr-FR>`, option de repli « dentsu.explore (interne) », nombres `fr-FR`.
 */
@Component({
  selector: 'mg-import-reel',
  imports: [ConfirmationComponent, IconeComponent, JournalComponent, ProgressionImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./etape.css', './etape-actions.css', './import.component.css'],
  templateUrl: './import.component.html',
})
export class ImportComponent {
  protected readonly etat = inject(ImportPoiService);
  protected readonly orgDefaut = ORGANISATION_DEFAUT;
  protected readonly exempleNom = `Import POI — ${new Date().toLocaleDateString('fr-FR')}`;

  protected readonly lignesFichier = computed(() => formaterNombre(this.etat.analyse()?.totalRows ?? 0));

  /** `ImportProgress` d'un échec (`importProgress?.type === 'error'`). */
  protected readonly erreur = computed(() => {
    const p = this.etat.progression();
    return p?.type === 'error' ? p.message ?? '' : null;
  });

  /** Ligne de compteurs de React (l.126-131), `ignores` et `erreurs` seulement au-dessus de zéro. */
  protected readonly compteurs = computed(() => {
    const c = this.etat.compteurs();
    if (!c) return null;
    return {
      traites: `${formaterNombre(c.processed)}/${formaterNombre(c.total)}`,
      inseres: c.inserted !== undefined ? formaterNombre(c.inserted) : null,
      ignores: c.ignored !== undefined && c.ignored > 0 ? formaterNombre(c.ignored) : null,
      erreurs: c.errors !== undefined && c.errors > 0 ? formaterNombre(c.errors) : null,
    };
  });

  /** Bilan et grille du rapport (l.150-170). */
  protected readonly bilan = computed(() => {
    const r = this.etat.rapport();
    if (!r) return null;
    const sorte = r.errors > 0 && r.inserted === 0 ? 'rouge' : r.errors > 0 ? 'ambre' : 'vert';
    const texte = sorte === 'rouge'
      ? `! Import echoue — ${r.errors} erreurs, 0 inseres`
      : sorte === 'ambre' ? `! Import partiel — ${r.inserted} inseres, ${r.errors} erreurs` : '[OK] Import termine avec succes';
    return {
      sorte, texte, inseres: formaterNombre(r.inserted), erreursPositives: r.errors > 0,
      cellules: [
        { libelle: 'total', valeur: formaterNombre(r.total), classe: 'primaire-t' },
        { libelle: 'inseres', valeur: formaterNombre(r.inserted), classe: 'vert-t' },
        { libelle: 'ignores', valeur: formaterNombre(r.ignored), classe: 'ambre-t' },
        { libelle: 'erreurs', valeur: formaterNombre(r.errors), classe: r.errors > 0 ? 'rouge-t' : 'primaire-t' },
      ],
    };
  });

  /** Lignes du journal : `error` rouge, `warn` ambre, `[OK]` vert, le reste discret (`ImportLogPanel.tsx:72-78`). */
  protected readonly lignesJournal = computed<LigneJournal[]>(() => this.etat.journal().map((l) => ({
    message: l.line,
    niveau: l.level === 'error' ? 'error' : l.level === 'warn' ? 'warn' : l.line.startsWith('[OK]') ? 'success' : 'debug',
  })));

  /** Compteurs de l'en-tête du journal (`ImportLogPanel.tsx:41-51`). */
  protected readonly enteteJournal = computed(() => {
    const j = this.etat.journal();
    return {
      ok: j.filter((l) => l.level === 'info' && l.line.startsWith('[OK]')).length,
      skip: j.filter((l) => l.level === 'warn' && l.line.startsWith('[SKIP]')).length,
      err: j.filter((l) => l.level === 'error' && l.line.startsWith('[ERR]')).length,
      total: j.length,
    };
  });

  protected saisirNom(e: Event): void {
    this.etat.nomSource.set((e.target as HTMLInputElement).value);
  }

  protected choisirOrganisation(e: Event): void {
    this.etat.organisationId.set((e.target as HTMLSelectElement).value);
  }
}
