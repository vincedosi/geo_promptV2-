/**
 * MAGELIAN — API admin `POST /api/admin/import-georisques`
 *
 * Importe les installations classées (ICPE) de l'API Géorisques dans
 * `poi_france`, catégorie `risque_industriel`.
 *
 * Spec : docs/superpowers/specs/2026-09-17-georisques-icpe-design.md
 * Plan : docs/superpowers/plans/2026-09-17-georisques-icpe.md
 *
 * ── Ce que la source impose, mesuré le 2026-09-17 ──────────────────────────
 *
 *  - `page_size` plafonne à 1 000 : à 2 000 l'API rend ZÉRO ligne, sans erreur.
 *    D'où `PAGE_SIZE_MAX`, et la borne appliquée au paramètre d'entrée.
 *  - 138 423 installations en France, soit 139 appels sortants à 1 000.
 *  - Le filtre `statut_seveso` de l'API **est ignoré** : il rend les 138 423
 *    lignes quelle que soit la valeur passée. On n'essaie donc PAS de demander
 *    un sous-ensemble par gravité — on ingère et on classe en base.
 *  - `total_pages` est rendu par l'API et sert la progression ; mais il vaut le
 *    nombre de PAGES, pas de lignes, d'où le total en lignes tiré de `results`.
 *  - **L'API renvoie le MÊME site plusieurs fois.** Mesuré sur l'import national
 *    du 2026-09-17 : 104 752 lignes exploitables reçues pour **94 652 `codeAIOT`
 *    distincts**, soit **10 100 doublons (9,6 %)** — la pagination n'est pas
 *    stable d'une page à l'autre. L'identifiant déterministe les absorbe sans
 *    rien signaler ; c'est précisément ce pour quoi il existe. Conséquence pour
 *    la lecture des compteurs : `ecrites` compte des ÉCRITURES, pas des sites.
 *    Le nombre de sites est `count(distinct metadata->>'code_aiot')`.
 *
 * ── Pourquoi le découpage par département par défaut ──────────────────────
 *
 * Un import national en une seule pagination tient 139 appels sur une seule
 * requête HTTP entrante. Le découpage par département donne des lots courts,
 * repris indépendamment, et une progression qui veut dire quelque chose. C'est
 * aussi ce qui rend l'import d'un seul département possible — le geste de
 * vérification avant d'engager la France entière.
 *
 * ── Garde-fous du projet appliqués ici ────────────────────────────────────
 *
 *  - Corps lu par `lireCorps()` : jamais `await request.json()` nu, qui répond
 *    500 sur un corps illisible.
 *  - Appel sortant par `fetchLectureAvecReprise()` : une lecture est idempotente,
 *    la reprise est donc légitime — importer ce module EST la déclaration
 *    d'idempotence (cf. lib/http/).
 *  - `DOMAINES_AUTORISES` borne l'hôte appelé : garde-fou SSRF, sur le motif de
 *    `import-datagouv`, dont la liste est locale et ne doit pas s'élargir.
 *  - Écritures par lots de 50 (`TAILLE_LOT`), une seule requête par lot.
 *  - `upsert({ onConflict: 'id' })` MET À JOUR les lignes existantes, sans
 *    `ignoreDuplicates` : Géorisques est un référentiel vivant, un site qui
 *    passe Seveso doit se rafraîchir au réimport. Conséquence à ne pas
 *    travestir : `.select('id')` rend alors TOUTES les lignes du lot, pas
 *    seulement les nouvelles. Le compteur s'appelle donc `ecrites`. La preuve
 *    d'idempotence n'est pas dans ce compteur mais dans le nombre de lignes en
 *    base, qui ne bouge pas d'un import au suivant.
 *  - Flux NDJSON avec étapes nommées, pourcentage et compteurs : jamais de
 *    traitement DB silencieux.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { fetchLectureAvecReprise } from '@/lib/http/lecture-avec-reprise';
import { normaliserSiteIcpe, estInstallationClassee, SOURCE_ICPE } from '@/lib/import/georisques/classement';
import type { SiteIcpeBrut, LignePoiIcpe } from '@/lib/import/georisques/classement';

export const dynamic = 'force-dynamic';

/** Mesuré : 2 000 rend 0 ligne. Ne pas relever sans re-mesurer. */
const PAGE_SIZE_MAX = 1000;
/** Règle CLAUDE.md : lots de 50 maximum, une seule requête par lot. */
const TAILLE_LOT = 50;
/** Garde-fou SSRF. Liste locale à cette route, volontairement d'un seul hôte. */
const DOMAINES_AUTORISES = ['georisques.gouv.fr'];
const BASE_API = 'https://www.georisques.gouv.fr/api/v1/installations_classees';

/**
 * Les 101 départements français, DROM compris. Écrits ici et non lus en base :
 * c'est le découpage de l'API Géorisques (paramètre `departement`), pas un
 * référentiel métier — `ref_departements` en compte 104 avec les collectivités
 * que l'API ne sert pas.
 */
const DEPARTEMENTS = [
  '01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19',
  '2A','2B','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37',
  '38','39','40','41','42','43','44','45','46','47','48','49','50','51','52','53','54','55','56',
  '57','58','59','60','61','62','63','64','65','66','67','68','69','70','71','72','73','74','75',
  '76','77','78','79','80','81','82','83','84','85','86','87','88','89','90','91','92','93','94',
  '95','971','972','973','974','976',
];

const CorpsSchema = z
  .object({
    /** Départements à importer. Absent ou vide → la France entière. */
    departements: z.array(z.string().min(1).max(3)).max(110).optional(),
    page_size: z.number().int().min(1).max(PAGE_SIZE_MAX).optional(),
  })
  .passthrough();

interface ReponseIcpe {
  results?: number;
  page?: number;
  total_pages?: number;
  data?: SiteIcpeBrut[];
}

function urlAutorisee(brut: string): boolean {
  let url: URL;
  try {
    url = new URL(brut);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return DOMAINES_AUTORISES.some(
    (d) => url.hostname === d || url.hostname.endsWith('.' + d),
  );
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const corps = await lireCorps(request, CorpsSchema, { corpsAbsentTolere: true });
  if (!corps.ok) {
    return NextResponse.json({ error: corps.message }, { status: 400 });
  }

  const pageSize = corps.valeur.page_size ?? PAGE_SIZE_MAX;
  const departements =
    corps.valeur.departements && corps.valeur.departements.length > 0
      ? corps.valeur.departements
      : DEPARTEMENTS;

  const supabase = createAdminClient();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let ferme = false;
      const emettre = (evenement: Record<string, unknown>) => {
        if (ferme) return;
        controller.enqueue(encoder.encode(JSON.stringify(evenement) + '\n'));
      };

      let traitees = 0;
      let ecrites = 0;
      let ecartes = 0;
      let horsPerimetre = 0;
      let total = 0;
      const erreurs: string[] = [];

      try {
        emettre({
          etape: 'demarrage',
          message: `Import ICPE Géorisques — ${departements.length} département(s)`,
          departements: departements.length,
        });

        for (const [indexDept, dept] of departements.entries()) {
          let page = 1;
          let pagesDept = 1;

          do {
            const url = `${BASE_API}?page_size=${pageSize}&page=${page}&departement=${encodeURIComponent(dept)}`;
            if (!urlAutorisee(url)) {
              erreurs.push(`URL refusée par le garde-fou SSRF : ${url}`);
              break;
            }

            let charge: ReponseIcpe;
            try {
              const reponse = await fetchLectureAvecReprise(
                url,
                { headers: { Accept: 'application/json' } },
                { delaiMs: 45_000, tentatives: 3 },
              );
              if (!reponse.ok) {
                erreurs.push(`Département ${dept}, page ${page} : HTTP ${reponse.status}`);
                break;
              }
              charge = (await reponse.json()) as ReponseIcpe;
            } catch (e) {
              erreurs.push(
                `Département ${dept}, page ${page} : ${e instanceof Error ? e.message : 'échec de lecture'}`,
              );
              break;
            }

            pagesDept = charge.total_pages ?? 1;
            if (page === 1) total += charge.results ?? 0;

            const lignes: LignePoiIcpe[] = [];
            for (const site of charge.data ?? []) {
              // « Non ICPE » : present sous le meme endpoint, mais ce n'est PAS
              // une installation classee — 451 sites sur 1 985 au premier
              // import reel du departement 13, aucun ne portant de rubrique.
              // Compte a part, jamais jete en silence.
              if (!estInstallationClassee(site)) {
                horsPerimetre += 1;
                continue;
              }
              const ligne = normaliserSiteIcpe(site);
              if (ligne) lignes.push(ligne);
              else ecartes += 1;
            }

            // Écriture par lots de 50, une seule requête par lot.
            for (let i = 0; i < lignes.length; i += TAILLE_LOT) {
              const lot = lignes.slice(i, i + TAILLE_LOT);
              const { data, error } = await supabase
                .from('poi_france')
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- geom est posée par le trigger auto_set_geom
                .upsert(lot as any, { onConflict: 'id' })
                .select('id');

              if (error) {
                erreurs.push(`Département ${dept}, lot ${i / TAILLE_LOT + 1} : ${error.message}`);
                continue;
              }
              // ⚠ `.select('id')` ne distingue « insere » de « deja present »
              // QU'AVEC `ignoreDuplicates: true` (ON CONFLICT DO NOTHING, qui
              // ne rend que les lignes ecrites). Ici l'upsert MET A JOUR — et
              // c'est voulu : Georisques est un referentiel vivant, un site qui
              // passe Seveso doit se rafraichir. Le select rend donc toutes les
              // lignes du lot, et ce compteur dit « ecrites », pas « inserees ».
              // La preuve d'idempotence est ailleurs : le nombre de lignes en
              // base ne bouge pas d'un import au suivant (verifie).
              ecrites += data?.length ?? 0;
              traitees += lot.length;
            }

            emettre({
              etape: 'insertion',
              departement: dept,
              page,
              pages_departement: pagesDept,
              pourcentage: Math.round(((indexDept + page / Math.max(pagesDept, 1)) / departements.length) * 100),
              traitees,
              total,
              ecrites,
              ecartes,
              hors_perimetre: horsPerimetre,
            });

            page += 1;
          } while (page <= pagesDept);
        }

        emettre({
          etape: 'termine',
          pourcentage: 100,
          traitees,
          total,
          ecrites,
          ecartes,
          hors_perimetre: horsPerimetre,
          erreurs: erreurs.slice(0, 20),
          nb_erreurs: erreurs.length,
          source: SOURCE_ICPE,
        });
      } catch (e) {
        emettre({
          etape: 'echec',
          message: e instanceof Error ? e.message : 'Erreur inattendue',
          traitees,
          ecrites,
          ecartes,
          hors_perimetre: horsPerimetre,
        });
      } finally {
        ferme = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
    },
  });
}
