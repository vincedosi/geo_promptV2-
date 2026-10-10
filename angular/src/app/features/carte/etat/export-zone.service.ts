import { DOCUMENT, DestroyRef, Injectable, inject } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ENREGISTRER_FICHIER } from '../../../core/http/telecharger';
import { MESSAGE_EXPORT_SANS_REPONSE, messageExport } from '../../risques/exports/bouton-export.component';
import { type FormatExportZone, ZonesCustomApi } from '../data/zones-custom.api';

/**
 * Le téléchargement d'un export de zone enregistrée — `downloadZoneExport` (`lib/custom-geo/download-export.ts`) :
 * la carte de zone du panneau (script DV360, ciblage TikTok) et le bouton flottant « Script bidding DV360 ».
 *
 * Le fichier passe par `HttpClient` (jeton, limiteur), jamais par un `<a href>` nu qui partirait sans jeton ; le nom
 * vient de `Content-Disposition`, `zone_<id>_<format>` sinon, et l'ancre n'est jamais posée dans le `<body>` du shell
 * (`enregistrerFichier`). Le message d'un refus est celui de la route (`messageExport` du lot 3, réutilisé).
 *
 * Écart voulu : React n'écrivait l'échec qu'en console ; il est ici RENDU à l'appelant, qui l'affiche.
 * N'ENVOIE RIEN à DV360 : `bidding_script` produit un fichier à coller dans DV360, aucun appel à Google.
 *
 * `@Injectable()` sans `providedIn` : fourni par la page carte ; les téléchargements en vol sont abandonnés avec elle.
 */
@Injectable()
export class ExportZoneService {
  private readonly api = inject(ZonesCustomApi);
  private readonly enregistrer = inject(ENREGISTRER_FICHIER);
  private readonly doc = inject(DOCUMENT);
  private readonly enVol = new Set<Subscription>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const s of this.enVol) s.unsubscribe();
      this.enVol.clear();
    });
  }

  /**
   * Télécharge l'export ; rend `null` s'il est enregistré, le message d'échec sinon. `params` : les poids et le budget
   * du plan média (T15), ajoutés après le format.
   */
  exporter(id: string, format: FormatExportZone, params?: Record<string, string>): Promise<string | null> {
    return new Promise((resoudre) => {
      const lecture = (params ? this.api.exporter(id, format, params) : this.api.exporter(id, format)).subscribe({
        next: (reponse) => {
          try {
            this.enregistrer(this.doc, reponse, `zone_${id}_${format}`);
            resoudre(null);
          } catch {
            resoudre(MESSAGE_EXPORT_SANS_REPONSE);
          }
        },
        error: (e: unknown) => void messageExport(e).then(resoudre),
      });
      // Une lecture déjà terminée (réponse synchrone) est close : rien à suivre. Sinon elle sort du suivi à sa fin.
      if (!lecture.closed) {
        this.enVol.add(lecture);
        lecture.add(() => this.enVol.delete(lecture));
      }
    });
  }
}
