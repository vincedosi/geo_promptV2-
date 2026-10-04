/**
 * Copie Angular (lot 4, P6) VERBATIM de `app/map/_components/panneaux/panneau-filtre-logique.ts` (imports relatifs seuls
 * changes), verrouillee par tests/unit/angular/carte-logique-paritaire.test.ts
 * (gel P5 etendu a /map). Ne pas corriger un defaut ici sans le corriger dans React.
 *
 * @file app/map/_components/panneaux/panneau-filtre-logique.ts
 *
 * Logique pure de `PanneauFiltre`, extraite pour être testable sans monter
 * React (`tests/unit/carte/panneau-filtre.test.ts`).
 *
 * Round 1 de correction (2026-09-12) : rouvrir le panneau (remontage React)
 * appelait le MÊME composeur que la frappe utilisateur, avec un état local
 * remis à vide → le filtre commune/CP actif s'auto-retirait en quelques
 * millisecondes, sans rien dire. Les deux usages sont maintenant deux
 * familles de fonctions PURES et distinctes :
 *   - `seedDepuisFiltre`   : ce que le widget affiche au montage — jamais un
 *     retrait, jamais un appel à `onFiltre` : un simple affichage.
 *   - `composerFiltreVille` / `composerFiltreCodePostal` : ce qu'une frappe
 *     utilisateur (débouncée) doit composer comme nouveau filtre.
 *
 * Round 2 de correction : `filtreApresChangementScope` — cliquer un pill
 * Métro/+DROM vide déjà les sélecteurs région/département/ville/CP du
 * widget (`use-territory-selection.ts`, non modifié : hook partagé avec
 * `FilterPanel`), mais ne disait rien au `FiltreActif` — le chip et le
 * panneau divergeaient, le chip continuant de borner les requêtes et la
 * bataille isochrone sur un territoire que le panneau prétendait avoir
 * quitté.
 */
import { poserFiltre, type FiltreActif } from './filtre';

export interface SeedWidgetPerimetre {
  ville: string;
  codePostal: string;
  selectedRegions: string[];
  selectedDepts: string[];
}

const SEED_VIDE: SeedWidgetPerimetre = { ville: '', codePostal: '', selectedRegions: [], selectedDepts: [] };

/**
 * État initial du widget de découpage administratif, dérivé du filtre actif.
 * Pure : ne modifie rien, n'appelle jamais `onFiltre`. Un filtre `'zone'`
 * (ou aucun filtre) n'a pas d'équivalent dans ce widget → seed vide.
 */
export function seedDepuisFiltre(filtre: FiltreActif | null): SeedWidgetPerimetre {
  if (!filtre) return SEED_VIDE;
  switch (filtre.type) {
    case 'commune':     return { ...SEED_VIDE, ville: filtre.label };
    case 'cp':          return { ...SEED_VIDE, codePostal: filtre.code };
    case 'region':      return { ...SEED_VIDE, selectedRegions: [filtre.code] };
    case 'departement': return { ...SEED_VIDE, selectedDepts: [filtre.code] };
    default:            return SEED_VIDE;
  }
}

/** Filtre résultant d'une saisie (débouncée) dans le champ ville. */
export function composerFiltreVille(filtreCourant: FiltreActif | null, valeur: string): FiltreActif | null {
  const trimmed = valeur.trim();
  if (trimmed) return poserFiltre(filtreCourant, { type: 'commune', code: trimmed.toLowerCase(), label: trimmed });
  return filtreCourant?.type === 'commune' ? null : filtreCourant;
}

/** Filtre résultant d'une saisie (débouncée) dans le champ code postal. */
export function composerFiltreCodePostal(filtreCourant: FiltreActif | null, valeur: string): FiltreActif | null {
  const trimmed = valeur.trim();
  if (/^\d{5}$/.test(trimmed)) return poserFiltre(filtreCourant, { type: 'cp', code: trimmed, label: `CP ${trimmed}` });
  return filtreCourant?.type === 'cp' ? null : filtreCourant;
}

/** Types de filtre « territorial » au sens administratif — un changement de
 *  périmètre global (Métro/+DROM) les retire, puisqu'il vide déjà les
 *  sélecteurs région/département/ville/CP correspondants dans le widget. */
const TYPES_FILTRE_TERRITORIAL = new Set<FiltreActif['type']>(['region', 'departement', 'commune', 'cp']);

/**
 * Filtre résultant d'un changement de périmètre global (pill Métro/+DROM).
 * Retire le filtre actif s'il est territorial (region/departement/commune/cp) ;
 * laisse en place un filtre `'zone'` (zone enregistrée) — pas administratif,
 * pas concerné par le pill.
 */
export function filtreApresChangementScope(filtreCourant: FiltreActif | null): FiltreActif | null {
  return filtreCourant && TYPES_FILTRE_TERRITORIAL.has(filtreCourant.type) ? null : filtreCourant;
}
