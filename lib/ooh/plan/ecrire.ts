/**
 * Écriture d'un plan OOH géolocalisé dans une campagne d'espace (spec 2026-10-16-ooh-campagnes § 4.4, § 7).
 *
 * Ordre — chaque étape lit son erreur (supabase-js ne lève pas, il rend `{ error }`) :
 *   0. contrôle, AVANT toute écriture : les panneaux déjà en base sous `plan-ooh:<cle>:<réseau>` appartiennent à CET
 *      espace. La clé d'import n'est unique que dans un espace : sans ce contrôle, un autre espace qui choisirait la
 *      même clé réécrirait (upsert sur source, source_ref) puis retirerait les panneaux du premier ;
 *   1. campagne : upsert sur (organization_id, cle_import) → son id, stable d'un rejeu à l'autre ;
 *   2. une source PRIVÉE de l'espace par réseau (`data_sources`, `mapping.source_key = plan-ooh:<cle>:<réseau>`) :
 *      la RLS existante (`source_visible`) cache ses panneaux aux autres espaces ;
 *   3. panneaux : upsert sur (source, source_ref), `id` DÉTERMINISTE (UUIDv5 de source + source_ref, comme
 *      `lib/import/identite-poi.ts`), lots de 50, une requête par lot, repli ligne à ligne sur échec ;
 *   4. lignes de la campagne : DELETE ciblé (erreur lue) puis INSERT — les liens partent en cascade ;
 *   5. liens ligne ↔ panneau : lots de 50, repli ligne à ligne. Seuls les panneaux que l'étape 3 a effectivement
 *      écrits sous la source privée DE LA LIGNE sont liés (la base ne vérifie pas qu'un panneau lié est de l'espace) ;
 *   6. panneaux de la source qui ne sont plus dans la liste : retirés (lots de 50, erreur lue). Sans cela un club
 *      disparu de la liste resterait visible dans l'espace, hors campagne. Un panneau toujours listé mais dont
 *      l'upsert a échoué n'est PAS retiré : l'erreur est rapportée, le rejeu le reprend.
 * Une liste fournie dont aucun emplacement n'est placé garde sa source (vide) : ses anciens panneaux sont retirés et
 * la ligne ne passe pas pour « liste non fournie ».
 * Non transactionnel (PostgREST) : un échec au milieu laisse un état partiel que le REJEU répare (même clé).
 *
 * Écrivain du script `scripts/ooh/importer-plan.ts` (service_role, hors route) : exception assumée de
 * `tests/unit/securite/perimetre-routes.test.ts`, il ne rend rien à un appelant HTTP.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { uuidV5 } from '@/lib/import/identite-poi';
import { lireTout } from '@/lib/supabase/lire-tout';
import type { AdaptateurId, EmplacementNonPlace, EmplacementPlace, LignePlan } from '@/types/campagnes-media';

/** Taille de lot imposée par CLAUDE.md. */
const LOT = 50;
/** Espace de noms UUIDv5 des panneaux d'un plan : distinct de celui des POI (`identite-poi.ts`). */
const ESPACE_PANNEAUX_PLAN = 'e2a4c6f8-1b3d-4f5a-8c7e-9d0b2a4c6e8f';
/** Borne de lecture des panneaux d'une source (TF4 : ≈ 900 clubs au plus par réseau). */
const PLAFOND_PANNEAUX_SOURCE = 20_000;

export interface EmplacementsDeLigne {
  adaptateur: AdaptateurId;
  places: EmplacementPlace[];
  non_places: EmplacementNonPlace[];
}

interface CampagneAEcrire {
  nom: string;
  annonceur: string | null;
  vague: string | null;
  cle_import: string;
  date_debut: string | null;
  date_fin: string | null;
  budget_total_ttc: number | null;
  metadata: Record<string, unknown>;
}

export interface EntreeEcriture {
  organizationId: string;
  campagne: CampagneAEcrire;
  lignes: readonly LignePlan[];
  /** Par `ordre` de ligne : les emplacements de sa liste. Une ligne absente n'a pas de liste (DROM). */
  emplacements: ReadonlyMap<number, EmplacementsDeLigne>;
}

interface BilanEcriture {
  campagne_id: string;
  lignes: number;
  panneaux_ecrits: number;
  liens: number;
  panneaux_retires: number;
  erreurs: string[];
}

type Progression = (etape: string, fait: number, total: number) => void;

/** Un panneau déjà en base sous une source de plan. */
interface PanneauPresent {
  id: string;
  organization_id: string | null;
  data_source_id: string | null;
}

/** `plan-ooh:<cle_import>:<réseau>` — la vague suivante a sa propre clé, donc ses propres panneaux. */
export function sourcePanneaux(cleImport: string, adaptateur: AdaptateurId): string {
  return `plan-ooh:${cleImport}:${adaptateur}`;
}

/** L'id d'un panneau de plan : UUIDv5 de (source, source_ref) — le même à chaque rejeu. */
function identitePanneau(source: string, sourceRef: string): string {
  return uuidV5(`${source}|${sourceRef}`, ESPACE_PANNEAUX_PLAN);
}

function echouer(quoi: string, erreur: { message: string } | null): never {
  throw new Error(`${quoi} : ${erreur?.message ?? 'aucune donnée rendue'}`);
}

/** Écrit `lignes` par lots de 50, une requête par lot ; sur échec d'un lot, ligne à ligne pour nommer la fautive. */
async function parLots<T>(
  lignes: readonly T[],
  envoyer: (lot: T[]) => PromiseLike<{ error: { message: string } | null; data: unknown[] | null }>,
  nommer: (l: T) => string,
  erreurs: string[],
  avancer: (fait: number) => void,
): Promise<unknown[]> {
  const rendues: unknown[] = [];
  for (let i = 0; i < lignes.length; i += LOT) {
    const lot = lignes.slice(i, i + LOT);
    const { data, error } = await envoyer(lot);
    if (!error) {
      rendues.push(...(data ?? []));
    } else {
      for (const l of lot) {
        const r = await envoyer([l]);
        if (r.error) erreurs.push(`${nommer(l)} : ${r.error.message}`);
        else rendues.push(...(r.data ?? []));
      }
    }
    avancer(Math.min(i + LOT, lignes.length));
  }
  return rendues;
}

/** Les panneaux déjà en base sous `source`, lus en entier (lecture paginée qui échoue au-delà du plafond). */
async function panneauxPresents(sb: SupabaseClient, source: string): Promise<PanneauPresent[]> {
  const { lignes } = await lireTout<PanneauPresent>(
    (de, a) => sb.from('panneaux_affichage').select('id, organization_id, data_source_id').eq('source', source).order('id').range(de, a),
    PLAFOND_PANNEAUX_SOURCE,
  );
  return lignes;
}

async function sourcePrivee(
  sb: SupabaseClient, e: EntreeEcriture, ligne: LignePlan, adaptateur: AdaptateurId, source: string, d: EmplacementsDeLigne,
): Promise<string> {
  const champs = {
    name: `${e.campagne.nom} — ${ligne.regie}`,
    type: 'panneaux',
    category: 'ooh',
    regie: ligne.regie,
    visibilite: 'privee',
    status: 'active',
    file_format: 'xlsx',
    original_filename: typeof e.campagne.metadata.fichier === 'string' ? e.campagne.metadata.fichier : null,
    row_count: d.places.length + d.non_places.length,
    valid_count: d.places.length,
    error_count: d.non_places.length,
    mapping: { source_key: source, campagne_cle: e.campagne.cle_import, adaptateur },
  };
  const { data: existante, error: eLecture } = await sb.from('data_sources').select('id')
    .eq('organization_id', e.organizationId).eq('type', 'panneaux').eq('mapping->>source_key', source).maybeSingle();
  if (eLecture) echouer(`source ${source} (lecture)`, eLecture);
  if (existante) {
    const { error } = await sb.from('data_sources').update(champs).eq('id', existante.id);
    if (error) echouer(`source ${source} (mise à jour)`, error);
    return existante.id as string;
  }
  const { data, error } = await sb.from('data_sources').insert({ ...champs, organization_id: e.organizationId }).select('id').single();
  if (error || !data) echouer(`source ${source} (création)`, error);
  return data.id as string;
}

function ligneDePanneau(p: EmplacementPlace, source: string, dataSourceId: string, organizationId: string, regie: string) {
  return {
    id: identitePanneau(source, p.source_ref),
    lat: p.lat,
    lng: p.lng,
    source,
    source_ref: p.source_ref,
    data_source_id: dataSourceId,
    organization_id: organizationId,
    regie,
    type_panneau: p.reseau,
    reseau: p.reseau,
    nom_lieu: p.nom_lieu,
    type_lieu: p.type_lieu,
    numerique: p.numerique,
    nb_ecrans: p.nb_ecrans,
    nb_faces: p.nb_ecrans,
    formats: p.formats,
    contacts_semaine: p.contacts_semaine,
    contacts_18_25_semaine: p.contacts_18_25_semaine,
    adresse: p.adresse,
    ville: p.ville,
    code_postal: p.code_postal,
    code_insee: p.code_insee,
    code_departement: p.code_departement,
    reference_panneau: p.reference_panneau,
    geoloc_methode: p.geoloc_methode,
    geoloc_qualite: p.geoloc_qualite,
    geoloc_score: p.geoloc_score,
    geoloc_libelle: p.geoloc_libelle,
    metadata: p.metadata,
    actif: true,
    date_maj: new Date().toISOString(),
  };
}

/** Écrit (ou réécrit) une campagne, ses lignes, ses panneaux et leurs liens. */
export async function ecrirePlan(sb: SupabaseClient, e: EntreeEcriture, progression?: Progression): Promise<BilanEcriture> {
  const erreurs: string[] = [];

  // 0. Contrôle d'appartenance, avant toute écriture.
  const presentsParSource = new Map<string, PanneauPresent[]>();
  for (const ligne of e.lignes) {
    const d = e.emplacements.get(ligne.ordre);
    if (!d) continue;
    const source = sourcePanneaux(e.campagne.cle_import, d.adaptateur);
    if (presentsParSource.has(source)) {
      throw new Error(`Deux lignes portent la liste ${d.adaptateur} : ses panneaux seraient liés deux fois. Rien n'est écrit.`);
    }
    const presents = await panneauxPresents(sb, source);
    if (presents.some((p) => p.organization_id !== e.organizationId)) {
      throw new Error(`Les panneaux de la source ${source} appartiennent à un autre espace : choisir une autre --cle. Rien n'est écrit.`);
    }
    presentsParSource.set(source, presents);
  }

  // 1. Campagne.
  const { data: campagne, error: eCampagne } = await sb.from('campagnes')
    .upsert({ organization_id: e.organizationId, ...e.campagne }, { onConflict: 'organization_id,cle_import' })
    .select('id').single();
  if (eCampagne || !campagne) echouer('campagne', eCampagne);
  const campagneId = campagne.id as string;

  // 2-3. Une source privée et ses panneaux, par ligne qui a une liste.
  const sourceDeLigne = new Map<number, string>();
  const idsEcrits = new Map<string, Set<string>>();
  const idsListes = new Map<string, Set<string>>();
  let panneauxEcrits = 0;
  for (const ligne of e.lignes) {
    const d = e.emplacements.get(ligne.ordre);
    if (!d) continue;
    const source = sourcePanneaux(e.campagne.cle_import, d.adaptateur);
    const dataSourceId = await sourcePrivee(sb, e, ligne, d.adaptateur, source, d);
    if ((presentsParSource.get(source) ?? []).some((p) => p.data_source_id !== null && p.data_source_id !== dataSourceId)) {
      throw new Error(`Des panneaux de la source ${source} sont rattachés à une autre source de données que ${dataSourceId}.`);
    }
    sourceDeLigne.set(ligne.ordre, dataSourceId);
    const lignesPanneaux = d.places.map((p) => ligneDePanneau(p, source, dataSourceId, e.organizationId, ligne.regie));
    idsListes.set(source, new Set(lignesPanneaux.map((l) => l.id)));
    const rendus = await parLots(
      lignesPanneaux,
      (lot) => sb.from('panneaux_affichage').upsert(lot, { onConflict: 'source,source_ref' }).select('id'),
      (l) => `panneau ${l.source_ref} (${l.nom_lieu})`,
      erreurs,
      (fait) => progression?.(`panneaux ${d.adaptateur}`, fait, lignesPanneaux.length),
    );
    idsEcrits.set(source, new Set((rendus as { id: string }[]).map((r) => r.id)));
    panneauxEcrits += rendus.length;
  }

  // 4. Lignes : remplacées. Le DELETE est lu : un DELETE raté suivi de l'INSERT doublerait les lignes.
  const { error: eSuppression } = await sb.from('campagne_lignes').delete({ count: 'exact' }).eq('campagne_id', campagneId);
  if (eSuppression) echouer('suppression des anciennes lignes', eSuppression);
  const { data: lignesEcrites, error: eLignes } = await sb.from('campagne_lignes').insert(e.lignes.map((l) => {
    const d = e.emplacements.get(l.ordre);
    return {
      campagne_id: campagneId,
      media: l.media,
      ordre: l.ordre,
      regie: l.regie,
      reseau: l.reseau,
      territoire: l.territoire,
      nb_ecrans: l.nb_ecrans,
      format: l.format,
      nb_diffusions: l.nb_diffusions,
      date_debut: l.date_debut,
      date_fin: l.date_fin,
      duree_libelle: l.duree_libelle,
      rang_option: l.rang_option,
      plage_horaire: l.plage_horaire,
      montant_brut: l.montant_brut,
      montant_net: l.montant_net,
      frais: l.frais,
      honoraires: l.honoraires,
      total_ttc: l.total_ttc,
      contacts_15_plus: l.contacts_15_plus,
      contacts_18_24: l.contacts_18_24,
      data_source_id: sourceDeLigne.get(l.ordre) ?? null,
      details: {
        ...l.details,
        ...(d ? {
          adaptateur: d.adaptateur,
          nb_emplacements_listes: d.places.length + d.non_places.length,
          non_places: d.non_places.map((n) => ({ nom: n.nom, raison: n.raison })),
        } : {}),
      },
    };
  })).select('id, ordre');
  if (eLignes || !lignesEcrites) echouer('écriture des lignes', eLignes);
  const idDeLigne = new Map((lignesEcrites as { id: string; ordre: number }[]).map((l) => [l.ordre, l.id]));

  // 5. Liens ligne ↔ panneau : seulement vers les panneaux écrits sous la source privée de la ligne.
  const liens: { ligne_id: string; panneau_id: string; nb_ecrans: number | null; formats: string[] }[] = [];
  for (const [ordre, d] of e.emplacements) {
    const ligneId = idDeLigne.get(ordre);
    if (!ligneId || !sourceDeLigne.has(ordre)) continue;
    const source = sourcePanneaux(e.campagne.cle_import, d.adaptateur);
    const ecrits = idsEcrits.get(source) ?? new Set<string>();
    for (const p of d.places) {
      const panneauId = identitePanneau(source, p.source_ref);
      if (ecrits.has(panneauId)) liens.push({ ligne_id: ligneId, panneau_id: panneauId, nb_ecrans: p.nb_ecrans, formats: p.formats });
    }
  }
  const liensEcrits = await parLots(
    liens,
    (lot) => sb.from('campagne_ligne_panneaux').insert(lot).select('panneau_id'),
    (l) => `lien ${l.panneau_id}`,
    erreurs,
    (fait) => progression?.('liens', fait, liens.length),
  );

  // 6. Panneaux de la source sortis de la liste (lus à l'étape 0 : tout panneau apparu depuis vient de l'étape 3).
  let retires = 0;
  for (const [source, listes] of idsListes) {
    const orphelins = (presentsParSource.get(source) ?? []).map((p) => p.id).filter((id) => !listes.has(id));
    for (let i = 0; i < orphelins.length; i += LOT) {
      const { count, error } = await sb.from('panneaux_affichage').delete({ count: 'exact' }).in('id', orphelins.slice(i, i + LOT));
      if (error) erreurs.push(`retrait de panneaux sortis de la liste (${source}) : ${error.message}`);
      else retires += count ?? 0;
    }
  }

  return {
    campagne_id: campagneId,
    lignes: lignesEcrites.length,
    panneaux_ecrits: panneauxEcrits,
    liens: liensEcrits.length,
    panneaux_retires: retires,
    erreurs,
  };
}
