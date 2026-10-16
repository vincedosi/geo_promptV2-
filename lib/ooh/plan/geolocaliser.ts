/**
 * Géolocalisation des emplacements d'un plan (spec 2026-10-16-ooh-campagnes § 7) :
 *   - gares → référentiel SNCF et alias (`gares-sncf.ts`) : score 1 pour une correspondance sûre, 0,5 pour une gare à vérifier ;
 *   - adresses (Stride, Basic-Fit) → BAN `/search/csv/` par `geocodeBatchDetailed`, en UN lot :
 *     score ≥ 0,6 → `sure` ; de 0,3 à 0,6 → `a_verifier` ; sous 0,3 → non placé.
 *     Commune seule (Basic-Fit sans rue), ville ou code postal rendus différents de ceux de la régie → `a_verifier`.
 * Un emplacement introuvable n'est pas placé : il est rendu dans `non_places` avec sa raison. Le géocodeur est
 * INJECTÉ (tests sans réseau ; le script passe `geocodeBatchDetailed`).
 */
import { extractDeptFromCP } from '@/lib/import/geocoder';
import type { GeocodeDetailedResult } from '@/lib/import/types';
import type { EmplacementBrut, EmplacementNonPlace, EmplacementPlace, GeolocQualite } from '@/types/campagnes-media';
import { fusionnerEmplacements } from './fusion';
import { indexerGares, trouverGare, type GareSncf } from './gares-sncf';
import { departementDeInsee, normaliser } from './texte';

const SEUIL_SUR = 0.6;
const SEUIL_NON_PLACE = 0.3;

/** Une ligne envoyée à la BAN — la forme de `geocodeBatchDetailed`. */
export interface LigneAdresse {
  adresse?: string;
  code_postal?: string;
  ville?: string;
}

type GeocodeurLot = (rows: LigneAdresse[], onProgress?: (fait: number, total: number) => void) => Promise<GeocodeDetailedResult[]>;

interface DependancesGeoloc {
  gares: readonly GareSncf[];
  geocoder: GeocodeurLot;
  progression?: (fait: number, total: number) => void;
}

interface ResultatGeoloc {
  places: EmplacementPlace[];
  non_places: EmplacementNonPlace[];
}

/** Même ville, à la normalisation près, ou l'une prolonge l'autre d'un mot (« Aix en Provence La Pioline »). */
export function villeCorrespond(attendue: string, rendue: string): boolean {
  const a = normaliser(attendue);
  const r = normaliser(rendue);
  return a === r || a.startsWith(`${r} `) || r.startsWith(`${a} `);
}

const virgule = (n: number) => n.toFixed(2).replace('.', ',');

function nonPlace(e: EmplacementBrut, raison: string): EmplacementNonPlace {
  return { adaptateur: e.adaptateur, cle: e.cle, nom: e.nom_lieu, raison, metadata: e.metadata };
}

function deciderAdresse(e: EmplacementBrut, r: GeocodeDetailedResult | undefined): EmplacementPlace | string {
  if (e.recherche.type !== 'adresse') return 'recherche inattendue';
  const rech = e.recherche;
  if (!r || r.lat === null || r.lng === null) return 'adresse introuvable (BAN)';
  if (r.score < SEUIL_NON_PLACE) return `score BAN ${virgule(r.score)} sous ${virgule(SEUIL_NON_PLACE)}`;
  let qualite: GeolocQualite = r.score >= SEUIL_SUR ? 'sure' : 'a_verifier';
  if (rech.commune_seule) qualite = 'a_verifier';
  if (rech.ville !== null && r.resultCity !== '' && !villeCorrespond(rech.ville, r.resultCity)) qualite = 'a_verifier';
  if (rech.code_postal !== null && r.resultPostcode !== '' && r.resultPostcode !== rech.code_postal) qualite = 'a_verifier';
  const codePostal = e.code_postal ?? (r.resultPostcode === '' ? null : r.resultPostcode);
  const insee = r.resultCitycode ? r.resultCitycode : null;
  return {
    ...e,
    source_ref: e.cle,
    lat: r.lat,
    lng: r.lng,
    adresse: rech.commune_seule ? null : (e.adresse ?? (r.resultLabel === '' ? null : r.resultLabel)),
    code_postal: codePostal,
    ville: e.ville ?? (r.resultCity === '' ? null : r.resultCity),
    code_insee: insee,
    code_departement: insee !== null ? departementDeInsee(insee) : extractDeptFromCP(codePostal),
    geoloc_methode: 'adresse_ban',
    geoloc_qualite: qualite,
    geoloc_score: r.score,
    geoloc_libelle: r.resultLabel,
  };
}

/** Place tous les emplacements ; rend les placés (réunis par adaptateur et `source_ref`) et les non placés. */
export async function geolocaliser(emplacements: readonly EmplacementBrut[], deps: DependancesGeoloc): Promise<ResultatGeoloc> {
  const total = emplacements.length;
  const places: EmplacementPlace[] = [];
  const nonPlaces: EmplacementNonPlace[] = [];
  const index = indexerGares(deps.gares);
  const adresses: EmplacementBrut[] = [];
  let fait = 0;

  for (const e of emplacements) {
    if (e.recherche.type !== 'gare') {
      adresses.push(e);
      continue;
    }
    const r = trouverGare(e.recherche.nom, e.recherche.bloc, index);
    if (r.trouvee) {
      places.push({
        ...e,
        source_ref: r.gare.uic,
        nom_lieu: r.gare.nom,
        lat: r.gare.lat,
        lng: r.gare.lng,
        code_insee: r.gare.code_insee,
        code_departement: departementDeInsee(r.gare.code_insee),
        geoloc_methode: r.methode,
        geoloc_qualite: r.qualite,
        geoloc_score: r.qualite === 'sure' ? 1 : 0.5,
        geoloc_libelle: `${r.gare.nom} (UIC ${r.gare.uic}, INSEE ${r.gare.code_insee})`,
      });
    } else {
      nonPlaces.push(nonPlace(e, r.raison));
    }
    fait++;
  }
  deps.progression?.(fait, total);

  if (adresses.length > 0) {
    const lignes: LigneAdresse[] = adresses.map((e) => {
      const rech = e.recherche.type === 'adresse' ? e.recherche : null;
      return { adresse: rech?.adresse ?? '', code_postal: rech?.code_postal ?? '', ville: rech?.ville ?? '' };
    });
    const resultats = await deps.geocoder(lignes, (n) => deps.progression?.(fait + n, total));
    // Une panne de la BAN rend « Erreur API BAN » pour tout le lot : la classer « introuvable » ferait écrire
    // des lignes sans leurs panneaux. On échoue avant toute écriture.
    if (resultats.some((r) => r.resultLabel === 'Erreur API BAN')) throw new Error("BAN indisponible : rien n'est écrit.");
    adresses.forEach((e, i) => {
      const d = deciderAdresse(e, resultats[i]);
      if (typeof d === 'string') nonPlaces.push(nonPlace(e, d));
      else places.push(d);
    });
  }
  deps.progression?.(total, total);

  return { places: fusionnerEmplacements(places, (p) => `${p.adaptateur}|${p.source_ref}`), non_places: nonPlaces };
}
