/**
 * @file lib/import/georisques/classement.ts
 *
 * Classement d'une installation classée (ICPE) : sa GRAVITÉ, qui colore le
 * point, et sa NATURE de risque, qui le filtre. Fonctions pures — aucun accès
 * base, aucun réseau — donc vérifiables sur table de vérité.
 *
 * ── Deux dimensions, deux rôles, décidés à la spec 2026-09-17 ──────────────
 *
 * Un site porte UNE gravité réglementaire (Seveso seuil haut/bas, IED, régime)
 * mais PLUSIEURS natures de risque, une par famille de rubrique. Le mécanisme
 * de filtre existant dans `PoiSection` interroge un champ scalaire
 * (`.in('metadata->>libelle_nature', …)` dans app/api/map/pois/route.ts), donc :
 *
 *   - `natureDominante()` alimente ce champ et porte le filtre ;
 *   - `naturesDuSite()` rend la liste complète, pour le panneau de détail.
 *
 * Contrepartie assumée et écrite dans la spec §4 : le filtre retient les sites
 * dont la nature DOMINANTE correspond, pas tous ceux qui ont cette rubrique
 * quelque part. Un dépôt pétrolier qui stocke aussi un toxique ne remonte pas
 * sur un filtre « toxicité aiguë ».
 *
 * ── Pourquoi la dominante doit être DÉTERMINISTE ───────────────────────────
 *
 * L'API ne garantit pas l'ordre de `rubriques[]`. Si la dominante dépendait de
 * cet ordre, un réimport pourrait changer la couleur d'un point sans qu'aucun
 * test ni aucun compteur ne le signale — le genre de dérive qu'on ne découvre
 * jamais. D'où un départage explicite à trois niveaux : rang de gravité, puis
 * quantité stockée, puis numéro de rubrique.
 */
import { FAMILLES_ICPE_SEED, NATURE_NON_PRECISEE } from './familles';
import { identitePoiSourceExterne } from '../identite-poi';

export const SOURCE_ICPE = 'georisques_icpe';
export const CATEGORIE_ICPE = 'risque_industriel';

/** Une rubrique de la nomenclature ICPE, telle que l'API la renvoie. */
export interface RubriqueIcpe {
  numeroRubrique: string | null;
  nature?: string | null;
  regimeAutoriseAlinea?: string | null;
  quantiteTotale?: string | null;
  unite?: string | null;
}

/** Un site tel que `GET /api/v1/installations_classees` le rend. */
export interface SiteIcpeBrut {
  codeAIOT: string;
  raisonSociale: string | null;
  adresse1?: string | null;
  adresse2?: string | null;
  adresse3?: string | null;
  codePostal?: string | null;
  codeInsee?: string | null;
  commune?: string | null;
  longitude: number | null;
  latitude: number | null;
  regime?: string | null;
  statutSeveso?: string | null;
  ied?: boolean | null;
  prioriteNationale?: boolean | null;
  etatActivite?: string | null;
  serviceAIOT?: string | null;
  siret?: string | null;
  codeNaf?: string | null;
  date_maj?: string | null;
  rubriques?: RubriqueIcpe[] | null;
  inspections?: Array<{ dateInspection?: string | null }> | null;
}

export type GraviteIcpe =
  | 'seveso_haut'
  | 'seveso_bas'
  | 'ied'
  | 'autorisation'
  | 'enregistrement'
  | 'autre';

/** Ligne prête pour `poi_france`. `geom` est posée par le trigger auto_set_geom. */
export interface LignePoiIcpe {
  id: string;
  categorie: string;
  sous_categorie: GraviteIcpe;
  nom: string | null;
  adresse: string | null;
  ville: string | null;
  code_postal: string | null;
  lat: number;
  lng: number;
  source: string;
  metadata: Record<string, unknown>;
}

const PAR_PREFIXE = new Map(FAMILLES_ICPE_SEED.map((f) => [f.prefixe, f]));

/**
 * Gravité réglementaire — PREMIÈRE règle qui s'applique.
 *
 * L'ordre n'est pas arbitraire : un site peut être à la fois Seveso seuil haut,
 * IED et sous régime d'Autorisation (mesuré : les trois cohabitent). C'est le
 * statut Seveso qui prime, parce que c'est lui qui déclenche les servitudes et
 * les plans de prévention.
 *
 * `statutSeveso` vaut `null` sur 31 sites sur 200 mesurés : le `?? ''` n'est pas
 * décoratif.
 */
export function graviteIcpe(site: SiteIcpeBrut): GraviteIcpe {
  const seveso = (site.statutSeveso ?? '').trim();
  if (seveso === 'Seveso seuil haut') return 'seveso_haut';
  if (seveso === 'Seveso seuil bas') return 'seveso_bas';
  if (site.ied === true) return 'ied';

  const regime = (site.regime ?? '').trim();
  if (regime === 'Autorisation') return 'autorisation';
  if (regime === 'Enregistrement') return 'enregistrement';

  // « Autres régimes », « Non ICPE », et l'absence de valeur.
  return 'autre';
}

/** Rubriques exploitables : numéro d'au moins 2 caractères ET préfixe connu. */
function rubriquesConnues(site: SiteIcpeBrut) {
  return (site.rubriques ?? [])
    .map((r) => {
      const num = (r.numeroRubrique ?? '').trim();
      if (num.length < 2) return null;
      const famille = PAR_PREFIXE.get(num.slice(0, 2));
      if (!famille) return null; // préfixe hors registre : ignoré, jamais une exception
      const quantite = Number(r.quantiteTotale ?? 0);
      return { num, famille, quantite: Number.isFinite(quantite) ? quantite : 0 };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Toutes les natures de risque du site, dédoublonnées, du plus grave au moins. */
export function naturesDuSite(site: SiteIcpeBrut): string[] {
  const parRang = [...rubriquesConnues(site)].sort(
    (a, b) => b.famille.rang_gravite - a.famille.rang_gravite,
  );
  const vues = new Set<string>();
  for (const r of parRang) vues.add(r.famille.libelle);
  return [...vues];
}

/**
 * Nature retenue pour le filtre. Départage : rang de gravité, puis quantité
 * stockée décroissante, puis numéro de rubrique croissant — pour que le
 * résultat ne dépende jamais de l'ordre de réponse de l'API.
 */
export function natureDominante(site: SiteIcpeBrut): string {
  const candidates = rubriquesConnues(site);
  if (candidates.length === 0) return NATURE_NON_PRECISEE;
  candidates.sort(
    (a, b) =>
      b.famille.rang_gravite - a.famille.rang_gravite ||
      b.quantite - a.quantite ||
      a.num.localeCompare(b.num),
  );
  return candidates[0].famille.libelle;
}

/** `2026-06-11/15-11-56` → `2026-06-11`. La source colle l'heure à la date. */
function dateSeule(valeur: string | null | undefined): string | null {
  const v = (valeur ?? '').trim();
  return v ? v.split('/')[0] : null;
}

/**
 * Transforme un site brut en ligne `poi_france`, ou rend `null` si le site est
 * inexploitable.
 *
 * Deux refus explicites, plutôt qu'une ligne dégradée :
 *  - pas de `codeAIOT` → aucune identité stable possible, donc aucune
 *    idempotence : l'importer créerait un doublon à chaque rejeu ;
 *  - pas de coordonnées → un POI à (0, 0) atterrit dans le golfe de Guinée et
 *    pollue toute analyse spatiale en silence.
 * L'appelant compte ces refus et les affiche (`ecartes`).
 */
export function normaliserSiteIcpe(site: SiteIcpeBrut): LignePoiIcpe | null {
  const codeAiot = (site.codeAIOT ?? '').trim();
  if (!codeAiot) return null;
  if (typeof site.longitude !== 'number' || typeof site.latitude !== 'number') return null;
  if (!Number.isFinite(site.longitude) || !Number.isFinite(site.latitude)) return null;

  // `.trim()` sur chaque partie : les données publiques portent des espaces
  // invisibles (règle CLAUDE.md sur les CSV INSEE, valable ici aussi).
  const adresse =
    [site.adresse1, site.adresse2, site.adresse3]
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(' ') || null;

  const inspections = (site.inspections ?? [])
    .map((i) => (i.dateInspection ?? '').trim())
    .filter(Boolean)
    .sort()
    .reverse();

  return {
    id: identitePoiSourceExterne(SOURCE_ICPE, codeAiot),
    categorie: CATEGORIE_ICPE,
    sous_categorie: graviteIcpe(site),
    nom: (site.raisonSociale ?? '').trim() || null,
    adresse,
    ville: (site.commune ?? '').trim() || null,
    code_postal: (site.codePostal ?? '').trim() || null,
    lat: site.latitude,
    lng: site.longitude,
    source: SOURCE_ICPE,
    metadata: {
      libelle_nature: natureDominante(site),
      natures_risque: naturesDuSite(site),
      code_aiot: codeAiot,
      code_insee: (site.codeInsee ?? '').trim() || null,
      regime: site.regime ?? null,
      statut_seveso: site.statutSeveso ?? null,
      ied: site.ied === true,
      priorite_nationale: site.prioriteNationale === true,
      etat_activite: site.etatActivite ?? null,
      dreal: site.serviceAIOT ?? null,
      siret: (site.siret ?? '').trim() || null,
      code_naf: (site.codeNaf ?? '').trim() || null,
      rubriques: (site.rubriques ?? []).map((r) => ({
        numero: r.numeroRubrique,
        nature: r.nature ?? null,
        regime: r.regimeAutoriseAlinea ?? null,
        quantite: r.quantiteTotale ?? null,
        unite: r.unite ?? null,
      })),
      date_maj_source: dateSeule(site.date_maj),
      derniere_inspection: inspections[0] ?? null,
      nb_inspections: inspections.length,
    },
  };
}
