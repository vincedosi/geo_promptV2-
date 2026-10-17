import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';

/** Une ligne de `poi_categories` telle que la rend `GET /api/admin/poi-categories` (catégories actives). */
export interface CategoriePoi {
  id?: string;
  categorie: string;
  sous_categorie?: string | null;
  label_fr: string | null;
  icone: string | null;
  couleur_carte?: string | null;
  description?: string | null;
  actif?: boolean;
}

/** Réponse de la lecture : `{ success, categories }`, ou `{ success: false, error }` (500). */
export interface ReponseCategoriesPoi {
  success: boolean;
  categories?: CategoriePoi[];
  error?: string;
}

/**
 * Réponse de la création : `{ success, categorie }` — le nom NORMALISÉ par la route (minuscules, sans
 * accent, `_`) —, `message: 'Categorie existante'` si elle existait déjà ; `{ success: false, error }`
 * en 400 / 500.
 */
export interface ReponseCreationCategoriePoi {
  success: boolean;
  categorie?: string;
  message?: string;
  error?: string;
}

/**
 * Catégories POI — `app/api/admin/poi-categories/route.ts` (`requireAdmin`), lot 6, T12.
 *
 * - `lister()` : les catégories actives, triées par `label_fr`.
 * - `creer(nom)` : ⚠ ÉCRIT dans `poi_categories` (une ligne, couleur tirée au hasard par la route si
 *   absente) ; corps `{ categorie }` seul, comme `CategoryStep.tsx:50`.
 *
 * Pas de cache ici : il est tenu par l'écran (une lecture à son ouverture, règle d'I/O « cache avant
 * appel »), comme `OrganisationsListeApi`. Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class CategoriesPoiApi extends HttpBaseService {
  lister(): Observable<ReponseCategoriesPoi> {
    return this.httpClient.get<ReponseCategoriesPoi>(`${this.baseUrl}/admin/poi-categories`);
  }

  creer(nom: string): Observable<ReponseCreationCategoriePoi> {
    return this.httpClient.post<ReponseCreationCategoriePoi>(`${this.baseUrl}/admin/poi-categories`, { categorie: nom });
  }
}
