/**
 * Import des périmètres PPRT depuis la Géoplateforme IGN.
 *
 * `POST /api/admin/import-pprt` — flux NDJSON avec progression, comme tout
 * traitement par lots du projet.
 *
 * ── UN SEUL APPEL SORTANT, ET C'EST VOULU ─────────────────────────────────
 *
 * Le WFS rend les **664 polygones en une requête** (5,6 Mo de GeoJSON, mesuré),
 * `numberMatched` est exact et `CQL_FILTER` est honoré. Découper par
 * département serait 101 appels pour la même donnée — et impossible : le champ
 * qui porterait le département est le nom de partition, dont 5 dépôts sur 69
 * sont RÉGIONAUX.
 *
 * L'écriture, elle, est découpée : une transaction **par partition** (le
 * document déposé au Géoportail de l'Urbanisme, 69 en tout). C'est l'unité de
 * remplacement naturelle — quand une DDT redépose son document, ses zones sont
 * remplacées en bloc — et `pprt_importer_partition` (sql/177) tient le DELETE
 * ciblé et l'INSERT dans la même transaction, donc la partition n'est jamais
 * vide en base, même une fraction de seconde.
 *
 * ── CE QUE LES COMPTEURS VEULENT DIRE ─────────────────────────────────────
 *
 * `ecrites` et non « insérées » : l'import REMPLACE une partition, donc une
 * zone déjà présente à l'identique est supprimée puis réécrite. Annoncer des
 * « nouveautés » serait faux — le même piège que sur l'import ICPE, où
 * `inserted`/`ignored` ne voulaient rien dire derrière un upsert qui met à jour.
 *
 * `ecartees` compte ce que la base a refusé (géométrie vidée par la
 * réparation, doublon exact) et `rejetees` ce que la normalisation a refusé
 * avant l'envoi (géométrie absente ou non surfacique, partition manquante).
 * Deux causes distinctes, deux compteurs distincts : les additionner masquerait
 * laquelle des deux se dégrade.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { fetchLectureAvecReprise } from '@/lib/http/lecture-avec-reprise';
import { normaliserZonePprt, SOURCE_PPRT } from '@/lib/import/pprt/normalisation';
import type { FeaturePm3, LignePprt } from '@/lib/import/pprt/normalisation';
import { rpcJson, toJson } from '@/lib/supabase/rpc-json';
import type { TableInsert } from '@/lib/supabase/tables';

export const dynamic = 'force-dynamic';

/** WFS de la Géoplateforme IGN. Seul domaine que cette route accepte d'appeler. */
const HOTE_AUTORISE = 'data.geopf.fr';
const BASE_WFS = 'https://data.geopf.fr/wfs/ows';

/**
 * Plafond de features demandées.
 *
 * 664 mesurées le 2026-09-17 ; 5 000 laisse la marge d'une croissance de la
 * couverture (415 procédures existent, 609 sont déjà décrites) sans jamais
 * ouvrir la porte à un téléchargement non borné. Si ce plafond était atteint,
 * le nombre reçu égalerait la limite et la réponse le dirait — un import
 * silencieusement tronqué est ce que ce projet a déjà payé cinq fois.
 */
const LIMITE_FEATURES = 5000;

/** Délai d'un appel au WFS. 5,6 Mo de GeoJSON demandent plus que les 20 s usuels. */
const DELAI_WFS_MS = 90_000;

const CorpsSchema = z
  .object({
    /** Permet de rejouer un seul document du GPU, sans retoucher les 68 autres. */
    partitions: z.array(z.string().min(1).max(120)).max(200).optional(),
  })
  .strict();

function urlWfs(): string {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'wfs_sup:assiette_sup_s',
    OUTPUTFORMAT: 'application/json',
    // `suptype='pm3'` EST le filtre PPRT. Sans lui, la couche rend les 138 558
    // assiettes de toutes les servitudes d'utilité publique.
    CQL_FILTER: "suptype='pm3'",
    COUNT: String(LIMITE_FEATURES),
  });
  return `${BASE_WFS}?${params.toString()}`;
}

/**
 * Les GÉNÉRATEURS PM3 — la seule couche qui porte `id_gaspar`.
 *
 * `ARCHITECTURE.md` a affirmé pendant un mois que ce flux n'avait « aucune clé
 * de jointure vers GASPAR ». La chaîne existe :
 * `assiette.idgen → generateur.idgen → id_gaspar`. Mesuré le 2026-09-18 :
 * 664 assiettes sur 664 se rattachent, 0 sans `id_gaspar`, 404 procédures
 * atteintes sur les 415 de GASPAR.
 *
 * `PROPERTYNAME` restreint la réponse aux trois champs utiles : sans lui le
 * serveur renvoie les géométries des 711 générateurs, soit plusieurs mégaoctets
 * pour une table de correspondance.
 */
function urlGenerateurs(): string {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: 'wfs_sup:generateur_sup_s',
    OUTPUTFORMAT: 'application/json',
    CQL_FILTER: "suptype='pm3'",
    PROPERTYNAME: 'idgen,id_gaspar,nomgen',
    COUNT: String(LIMITE_FEATURES),
  });
  return `${BASE_WFS}?${params.toString()}`;
}

/** Les procédures PPRT de GASPAR. 415 au total, 100 par page. */
function urlGaspar(page: number): string {
  return `https://www.georisques.gouv.fr/api/v1/gaspar/pprt?page=${page}&page_size=100`;
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const corps = await lireCorps(request, CorpsSchema, { corpsAbsentTolere: true });
  if (!corps.ok) {
    return NextResponse.json({ error: corps.message }, { status: 400 });
  }
  const partitionsVoulues = corps.valeur.partitions?.length
    ? new Set(corps.valeur.partitions)
    : null;

  // Le corps est lu AVANT d'ouvrir le flux : lire la requête dans
  // `ReadableStream.start()` la trouve déjà consommée (incident du 08/04).
  const supabase = createAdminClient();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let ferme = false;
      const emettre = (evenement: Record<string, unknown>) => {
        if (ferme) return;
        controller.enqueue(encoder.encode(JSON.stringify(evenement) + '\n'));
      };

      try {
        emettre({ etape: 'telechargement', message: 'Téléchargement du WFS PM3', pourcentage: 0 });

        const url = urlWfs();
        if (new URL(url).hostname !== HOTE_AUTORISE) {
          emettre({ etape: 'erreur', message: 'Hôte non autorisé' });
          return;
        }

        const reponse = await fetchLectureAvecReprise(url, {}, { delaiMs: DELAI_WFS_MS });
        if (!reponse.ok) {
          emettre({
            etape: 'erreur',
            message: `WFS Géoplateforme : HTTP ${reponse.status}`,
          });
          return;
        }

        const brut = (await reponse.json()) as {
          features?: FeaturePm3[];
          numberMatched?: number;
          numberReturned?: number;
        };
        const features = Array.isArray(brut.features) ? brut.features : [];

        // `numberMatched` est exact sur ce serveur — c'est justement ce qui le
        // distingue du WFS Géorisques, où il vaut toujours 500. On le relaie
        // plutôt que de le recalculer, et on signale l'écart s'il y en a un.
        const annonce = typeof brut.numberMatched === 'number' ? brut.numberMatched : null;
        emettre({
          etape: 'telechargement',
          message: `${features.length} polygone(s) reçu(s)`,
          recues: features.length,
          annoncees_par_la_source: annonce,
          pourcentage: 10,
        });

        if (features.length === 0) {
          emettre({ etape: 'erreur', message: 'Le WFS n’a rendu aucun polygone' });
          return;
        }
        if (features.length >= LIMITE_FEATURES) {
          // Égalité avec la limite = troncature possible. On le dit et on
          // s'arrête : écrire un référentiel amputé est pire que ne rien écrire.
          emettre({
            etape: 'erreur',
            message: `Réponse égale au plafond (${LIMITE_FEATURES}) : elle est probablement tronquée. Relever LIMITE_FEATURES avant de réimporter.`,
          });
          return;
        }
        if (annonce !== null && annonce !== features.length) {
          emettre({
            etape: 'avertissement',
            message: `La source annonce ${annonce} polygones et en rend ${features.length}`,
          });
        }

        // ── La table de correspondance vers GASPAR ───────────────────────
        //
        // UN appel de plus, et il n'est pas bloquant : si la couche des
        // générateurs est indisponible, les périmètres s'importent quand même
        // avec `id_gaspar` à NULL. Faire échouer un référentiel de servitudes
        // parce qu'une métadonnée manque serait disproportionné.
        emettre({ etape: 'generateurs', message: 'Correspondance vers GASPAR', pourcentage: 12 });

        const gasparParGenerateur = new Map<string, string>();
        try {
          const rep = await fetchLectureAvecReprise(urlGenerateurs(), {}, { delaiMs: DELAI_WFS_MS });
          if (rep.ok) {
            const jg = (await rep.json()) as {
              features?: Array<{ properties?: { idgen?: string | null; id_gaspar?: string | null } }>;
            };
            for (const g of jg.features ?? []) {
              const idgen = g.properties?.idgen?.trim();
              const gaspar = g.properties?.id_gaspar?.trim();
              if (idgen && gaspar) gasparParGenerateur.set(idgen, gaspar);
            }
          }
        } catch {
          // Volontairement avalé : voir le commentaire ci-dessus.
        }
        emettre({
          etape: 'generateurs',
          message: `${gasparParGenerateur.size} générateur(s) rattaché(s) à une procédure`,
          generateurs_rattaches: gasparParGenerateur.size,
          pourcentage: 14,
        });

        // ── Normalisation, puis regroupement par partition ────────────────
        emettre({ etape: 'normalisation', message: 'Classement par document source', pourcentage: 15 });

        const parPartition = new Map<string, LignePprt[]>();
        let rejetees = 0;

        for (const f of features) {
          const ligne = normaliserZonePprt(f);
          if (!ligne) {
            rejetees++;
            continue;
          }
          if (partitionsVoulues && !partitionsVoulues.has(ligne.partition)) continue;

          // La procédure dont relève cette assiette, via son générateur.
          // `null` quand la correspondance manque : c'est une métadonnée, pas
          // une condition d'existence du périmètre.
          ligne.id_gaspar = ligne.id_generateur
            ? gasparParGenerateur.get(ligne.id_generateur) ?? null
            : null;

          const lot = parPartition.get(ligne.partition);
          if (lot) lot.push(ligne);
          else parPartition.set(ligne.partition, [ligne]);
        }

        const partitions = [...parPartition.keys()].sort();
        emettre({
          etape: 'normalisation',
          message: `${partitions.length} document(s) source, ${rejetees} polygone(s) rejeté(s)`,
          partitions: partitions.length,
          rejetees,
          pourcentage: 20,
        });

        if (partitions.length === 0) {
          emettre({ etape: 'erreur', message: 'Aucune partition à importer' });
          return;
        }

        // ── Écriture, une transaction par partition ───────────────────────
        let traitees = 0;
        let ecrites = 0;
        let supprimees = 0;
        let ecartees = 0;
        const echecs: Array<{ partition: string; message: string }> = [];

        for (const partition of partitions) {
          const lignes = parPartition.get(partition)!;

          const { data, error } = await supabase.rpc('pprt_importer_partition', {
            p_partition: partition,
            p_lignes: toJson(lignes),
          });

          if (error) {
            // supabase-js ne lève pas, il rend `{ error }` : sans cette
            // lecture, une partition échouée passerait pour importée.
            echecs.push({ partition, message: error.message });
            emettre({ etape: 'echec_partition', partition, message: error.message });
          } else {
            const r = rpcJson<{
              recues?: number;
              supprimees?: number;
              inserees?: number;
              ecartees?: number;
              erreur?: string;
            }>(data);
            if (r?.erreur) {
              echecs.push({ partition, message: r.erreur });
              emettre({ etape: 'echec_partition', partition, message: r.erreur });
            } else {
              ecrites += r?.inserees ?? 0;
              supprimees += r?.supprimees ?? 0;
              ecartees += r?.ecartees ?? 0;
            }
          }

          traitees += lignes.length;
          emettre({
            etape: 'insertion',
            partition,
            traitees,
            total: features.length - rejetees,
            ecrites,
            // 20 % pour le téléchargement et la normalisation, 75 % pour
            // l'écriture, les 5 derniers pour la consolidation.
            pourcentage: 20 + Math.round((traitees / Math.max(1, features.length - rejetees)) * 75),
          });
        }

        // ── Consolidation géographique ────────────────────────────────────
        //
        // La RPC d'import situe déjà chaque zone, mais ce passage rattrape ce
        // qu'un import antérieur aurait laissé sans département — et il est le
        // seul endroit qui COMPTE ce qui reste non situé, chiffre à ne pas
        // découvrir sur la carte.
        emettre({ etape: 'consolidation', message: 'Rattachement administratif', pourcentage: 96 });

        const { data: consData, error: consErr } = await supabase.rpc('pprt_consolider_departement');
        const cons = consErr
          ? null
          : rpcJson<{ reparees?: number; sans_departement?: number }>(consData);
        if (consErr) {
          emettre({ etape: 'avertissement', message: `Consolidation : ${consErr.message}` });
        }

        // ── Les PROCÉDURES PPRT (GASPAR) ─────────────────────────────────
        //
        // 415 plans, pagination par 100. Non bloquant comme les générateurs :
        // ces lignes sont des métadonnées (nom officiel du plan, bassin de
        // risques, types de zones déclarés). Un référentiel de servitudes
        // valide ne doit pas être refusé parce qu'une API tierce est lente.
        //
        // ⚠ GASPAR N'EXPOSE NI `etat`, NI `date_approbation`, NI
        //   `date_abrogation` — vérifié champ par champ. Ne pas les chercher
        //   ici : ils ne sont pas omis, ils n'existent pas dans ce flux.
        emettre({ etape: 'procedures', message: 'Procédures PPRT (GASPAR)', pourcentage: 97 });

        let procedures = 0;
        try {
          // Typé par le générateur plutôt qu'en `Record<string, unknown>` :
          // c'est ce qui fait échouer `tsc` si une colonne change de nom,
          // au lieu de laisser l'upsert ignorer le champ en silence.
          const docs: Array<TableInsert<'pprt_documents'>> = [];
          for (let page = 1; page <= 6; page++) {
            const rep = await fetchLectureAvecReprise(urlGaspar(page), {}, { delaiMs: 30_000 });
            if (!rep.ok) break;
            const jd = (await rep.json()) as {
              content?: Array<Record<string, never>>;
              totalElements?: number;
            };
            const lot = jd.content ?? [];
            for (const c of lot) {
              const id = String(c.idGaspar ?? '').trim();
              if (!id) continue;
              const zr = (c.zonageReglementaire ?? {}) as Record<string, unknown>;
              const dp = (c.departementPilote ?? {}) as Record<string, unknown>;
              // Date au format français dd/mm/yyyy — convertie ici plutôt que
              // laissée au hasard du parseur de PostgreSQL, qui lirait 03/05
              // comme le 5 mars.
              const dm = String(c.dateModification ?? '');
              const m = dm.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
              docs.push({
                id_gaspar: id,
                nom: String(c.libPpr ?? id).trim(),
                bassin_risques: (String(c.libBassinRisques ?? '').trim() || null),
                modele: (String(c.modeleProcedure ?? '').trim() || null),
                code_departement_pilote: (String(dp.codeDepartementPilote ?? '').trim() || null),
                nom_departement_pilote: (String(dp.libelleDepartementPilote ?? '').trim() || null),
                en_revision: c.etatRevision === true,
                sup_existe: c.supExists === true,
                zonage_existe: zr.zoneRegExists === true,
                // `toJson` : frontière jsonb, la seule façon typée d'y écrire
                // un objet applicatif (convention du projet).
                types_zones: toJson(zr.listTypeReg ?? []),
                date_modification: m ? `${m[3]}-${m[2]}-${m[1]}` : null,
              });
            }
            if (docs.length >= (jd.totalElements ?? 0) || lot.length === 0) break;
          }

          // Lots de 50 : convention du projet pour toute écriture en base.
          for (let i = 0; i < docs.length; i += 50) {
            const { error } = await supabase
              .from('pprt_documents')
              .upsert(docs.slice(i, i + 50), { onConflict: 'id_gaspar' });
            // supabase-js ne lève pas : sans cette lecture, un échec d'écriture
            // passerait pour un succès et la table resterait vide.
            if (error) {
              emettre({ etape: 'avertissement', message: `Procédures : ${error.message}` });
              break;
            }
            procedures += docs.slice(i, i + 50).length;
          }
        } catch (e) {
          emettre({
            etape: 'avertissement',
            message: `Procédures GASPAR indisponibles : ${e instanceof Error ? e.message : 'erreur'}`,
          });
        }

        emettre({
          etape: 'procedures',
          message: `${procedures} procédure(s) PPRT enregistrée(s)`,
          procedures,
          pourcentage: 99,
        });

        emettre({
          etape: 'termine',
          pourcentage: 100,
          source: SOURCE_PPRT,
          procedures,
          recues: features.length,
          rejetees,
          partitions: partitions.length,
          supprimees,
          ecrites,
          ecartees,
          reparees: cons?.reparees ?? null,
          sans_departement: cons?.sans_departement ?? null,
          echecs,
          message:
            echecs.length === 0
              ? `${ecrites} périmètre(s) PPRT en base`
              : `${ecrites} périmètre(s) en base, ${echecs.length} document(s) en échec`,
        });
      } catch (e) {
        emettre({
          etape: 'erreur',
          message: e instanceof Error ? e.message : 'Échec inattendu de l’import',
        });
      } finally {
        // Un flux interrompu ne doit pas rester ouvert : même garde que
        // `activation/pousser`.
        ferme = true;
        try {
          controller.close();
        } catch {
          /* déjà fermé par l'annulation du client */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
