import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { DepotFichiersComponent } from '../../commun/depot-fichiers.component';
import { ProgressionImportComponent } from '../../commun/progression-import.component';
import { fmtBytes } from '../../logique/formats';
import { ImportShapefileService } from '../etat/import-shapefile.service';

/**
 * Étape 1 de l'import Shapefile — portage de `app/admin/carreaux-import/_components/FilesStep.tsx` (lot 6, T14) :
 * dépôt du bundle (`mg-depot-fichiers`, sélection multiple), lecture dans le navigateur, puis le résumé (nom,
 * features, colonnes, CRS, tailles des fichiers, colonnes détectées) et « Continuer — Mapping des colonnes ».
 *
 * Progression de la lecture (C5) : `mg-progression-import`, étape nommée « Lecture des fichiers », DÉTERMINÉE
 * seulement quand le total est connu (enregistrements reprojetés / total du `.dbf`), indéterminée avant ; le
 * libellé de phase de React (« .shp chargé », « CRS détecté: … — reprojection... ») est gardé sous la barre.
 * React affichait des pourcentages fixes (20, 40, 50, 55, 70, 85, 90 %) qui ne mesuraient rien.
 *
 * Écarts à React, voulus : couleurs en jetons (C9) — `#f87171` → `--danger`, `rgba(…)` → `color-mix`, `#505050`
 * → `--text-tertiary`, `#000` du bouton → `--brand-teal-fg` ; vert et rouge en TEXTE lisibles en clair
 * (`light-dark`) ; barre UNIE, sans dégradé (flat total) ; survol de la zone en teal (`mg-depot-fichiers`,
 * React : vert) ; zone focalisable au clavier. Gardés : textes, tailles, bords 1 px et rayon 2.
 */
@Component({
  selector: 'mg-shapefile-fichiers',
  imports: [DepotFichiersComponent, IconeComponent, ProgressionImportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './etape-shapefile.css',
  template: `
    <div class="pile">
      <mg-depot-fichiers
        #depot
        accepter=".shp,.dbf,.prj,.shx"
        [multiple]="true"
        fondRepos="surface"
        marge="48px 24px"
        (fichiers)="etat.lire($event)"
      >
        <div class="consigne">
          <div class="vignette" [class.survol]="depot.survol()">
            <mg-icone nom="televerser" [taille]="28" [trait]="1.5" />
          </div>
          <div>
            <p class="titre-depot">Glissez vos fichiers Shapefile ici</p>
            <p class="mono note">.shp + .dbf + .prj + .shx — sélection multiple obligatoire</p>
          </div>
        </div>
      </mg-depot-fichiers>

      @if (etat.lectureEnCours() && etat.lecture(); as l) {
        <mg-progression-import data-lecture etape="Lecture des fichiers" [traitees]="l.lus" [total]="l.total">
          <p class="mono note phase" data-phase>{{ l.libelle }}</p>
        </mg-progression-import>
      }

      @if (etat.erreurLecture()) {
        <div class="alerte" role="alert">
          <p class="mono">! {{ etat.erreurLecture() }}</p>
        </div>
      }

      @if (resume(); as r) {
        <div class="carte resume" data-resume>
          <div class="ligne">
            <div class="pastille"><mg-icone nom="coche" [taille]="18" /></div>
            <div>
              <p class="mono nom" data-nom>{{ r.nom }}</p>
              <p class="mono note" data-detail>{{ r.detail }}</p>
            </div>
          </div>
          <div class="puces">
            @for (f of r.tailles; track f.ext) {
              <span class="puce mono">{{ f.ext }} <span class="discret">{{ f.taille }}</span></span>
            }
          </div>
          <div>
            <p class="sous-titre">Colonnes détectées</p>
            <div class="puces serrees">
              @for (c of r.colonnes; track c.nom) {
                <span class="puce mono colonne">{{ c.nom }}<span class="type">{{ c.type }}</span></span>
              }
            </div>
          </div>
          <button type="button" class="principal" (click)="etat.choisirEtape(2)">Continuer — Mapping des colonnes</button>
        </div>
      }
    </div>
  `,
  styles: `
    .consigne { display: flex; flex-direction: column; align-items: center; gap: 16px; }
    .vignette {
      width: 56px; height: 56px; border-radius: 2px; background: var(--bg-level-2); border: 1px solid var(--border-subtle);
      display: flex; align-items: center; justify-content: center; color: var(--text-tertiary);
    }
    .vignette.survol { color: var(--brand-teal); }
    .titre-depot { font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--text-primary); margin: 0; }
    .note { font-size: 11px; color: var(--text-tertiary); margin: 6px 0 0; }
    .phase { margin: 0; }
    .alerte {
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent); border-radius: 2px; padding: 12px 16px;
    }
    .alerte p { font-size: 12px; color: var(--rouge-texte); margin: 0; }
    .resume { border-color: color-mix(in srgb, var(--success) 25%, transparent); padding: 20px; display: flex; flex-direction: column; gap: 16px; }
    .ligne { display: flex; align-items: center; gap: 12px; }
    .pastille {
      width: 36px; height: 36px; border-radius: 2px; display: flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--success) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--success) 20%, transparent); color: var(--vert-texte);
    }
    .nom { font-weight: 700; color: var(--vert-texte); margin: 0; font-size: 13px; }
    [data-detail] { margin-top: 2px; }
    .puces { display: flex; gap: 8px; flex-wrap: wrap; }
    .puces.serrees { gap: 6px; }
    .puce {
      padding: 3px 10px; border-radius: 2px; background: var(--bg-level-2); border: 1px solid var(--border-subtle);
      font-size: 11px; color: var(--text-secondary);
    }
    .puce.colonne { padding: 2px 8px; color: var(--text-primary); }
    .type { color: var(--text-tertiary); margin-left: 4px; }
    .discret { color: var(--text-tertiary); }
    .sous-titre { font-family: var(--font-sans); font-size: 12px; font-weight: 500; color: var(--text-primary); margin: 0 0 8px; }
    .principal { width: 100%; padding: 12px 0; }
  `,
})
export class FichiersComponent {
  protected readonly etat = inject(ImportShapefileService);

  /** Le résumé, quand la lecture a abouti (`bundle && features.length > 0`). */
  protected readonly resume = computed(() => {
    const b = this.etat.bundle();
    const n = this.etat.features().length;
    if (!b || n === 0) return null;
    const fields = this.etat.fields();
    return {
      nom: b.fileName,
      detail: `${formaterNombre(n)} features · ${fields.length} colonnes · CRS: ${this.etat.crs()}`,
      tailles: [
        { ext: '.shp', taille: fmtBytes(b.shp.byteLength) },
        { ext: '.dbf', taille: fmtBytes(b.dbf.byteLength) },
        ...(b.prj ? [{ ext: '.prj', taille: fmtBytes(b.prj.length) }] : []),
        ...(b.shx ? [{ ext: '.shx', taille: fmtBytes(b.shx.byteLength) }] : []),
      ],
      colonnes: fields.map((f) => ({ nom: f.name, type: f.type === 'N' || f.type === 'F' ? '123' : 'abc' })),
    };
  });
}
