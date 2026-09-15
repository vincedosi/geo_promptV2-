/**
 * POST /api/analyses/score — score composite multi-indicateurs par code postal
 * (Tâche 12, 2026-09-13).
 *
 * Agrège plusieurs indicateurs INSEE de poids et de sens différents en un seul
 * nombre 0-100 par CP, sur un périmètre BORNÉ. Calcul délégué à la RPC
 * `calculer_score_composite` (sql/146) ; sa spécification exécutable en
 * TypeScript est `lib/analyses/score.ts` (mêmes poids, même arrondi).
 *
 * ── Trois écarts assumés avec le plan, chacun pour une raison mesurée ──────
 *
 * 1. **Registre.** Le plan faisait lire les indicateurs dans
 *    `iris_indicator_registry`. C'est `cible_indicator_registry` qui fait foi
 *    ici : `materialize_indicator_cp_values` y cherche ses codes et **lève**
 *    sur un code absent ou inactif. Le catalogue est servi au client par
 *    `GET /api/cibles/indicators` (route existante) — jamais une liste en dur.
 *
 * 2. **`indicator_cp_values` est matérialisée à la demande, pas peuplée.** Au
 *    2026-09-13 elle ne contient QUE `rev_median` (1 952 CP) et
 *    `abstention_pres_2022` (6 186 CP). Sans matérialisation préalable, la RPC
 *    aurait rendu du vide **en silence** pour tout autre indicateur — un score
 *    absent se serait lu comme « pas de données ici », pas comme « je n'ai
 *    jamais calculé cet indicateur ». Matérialisation paresseuse déléguée à
 *    `lib/analyses/indicateurs.ts` (partagée avec la corrélation), et
 *    STRICTEMENT SÉQUENTIELLE ici : chaque appel agrège `iris` ⋈
 *    `postal_code_commune`, et les lancer en parallèle est exactement le
 *    patron d'I/O des incidents du 28/03 et du 08/04 (CLAUDE.md).
 *
 *    Le journal `indicator_cp_materializations` (sql/148) est ce qui empêche
 *    un indicateur à source VIDE de se rematérialiser à chaque lancement —
 *    voir l'en-tête de `lib/analyses/indicateurs.ts` pour la mesure.
 *
 * 3. **Le périmètre.** Le plan exigeait une liste de CP sans dire d'où elle
 *    vient : un `FiltreActif` porte un code de région/département/commune/CP
 *    ou un uuid de zone, jamais une liste de codes postaux — et une bbox
 *    résolue SEULEMENT pour une zone enregistrée. Passer par
 *    `bboxDuFiltre` aurait donc replié sur `BBOX_METRO` pour tout filtre
 *    régional ou départemental, soit les 6 187 CP de France, aussitôt refusés
 *    comme « trop larges » : le score n'aurait marché nulle part.
 *    Cette route accepte les trois formes, par ordre de précision :
 *    `codes_postaux` explicites, un `perimetre` de filtre résolu par
 *    `codes_postaux_du_perimetre_jsonb` (sql/168, jumelle `RETURNS jsonb` de
 *    `codes_postaux_du_perimetre`, sql/146/167), ou une `bbox` résolue par
 *    `codes_postaux_dans_bbox` (sql/144, index GIST — `centroid_lat`/
 *    `centroid_lon` sont NULL sur les 6 187 lignes, un filtre direct dessus
 *    rendrait toujours vide).
 *
 * 4. **`'france'` (2026-09-15, spec-filtre-france.md).** `PerimetreSchema`
 *    accepte ce type au même titre que les autres. `codes_postaux_du_perimetre`
 *    (`RETURNS TABLE`) rend bien les 6 187 CP en SQL direct, mais PostgREST
 *    tronque à 5 000 lignes TOUTE RPC `RETURNS TABLE` — mesuré ici en testant
 *    le parcours réel (navigateur) : la première version de ce périmètre
 *    affichait « 1 462 codes postaux scorés sur 5 000 », pas 6 187, sans
 *    erreur. Même piège déjà documenté pour `correlation_campagne_indicateur`
 *    (sql/154). Corrigé par la jumelle `codes_postaux_du_perimetre_jsonb`
 *    (sql/168, `RETURNS jsonb`, jamais tronquée) — seule cette route l'appelle.
 *
 * 5. **La MÊME troncature, une étape plus loin (2026-09-15, sql/170).**
 *    `codes_postaux_du_perimetre_jsonb` avait réglé la RÉSOLUTION du
 *    périmètre ; `calculer_score_composite` (sql/146), qui CALCULE, était
 *    resté `RETURNS TABLE` et rend une ligne par code postal — mesuré à
 *    6 186 lignes sur les 6 187 CP du référentiel, donc tronqué à 5 000 par
 *    PostgREST sans erreur, 1 186 codes postaux non coloriés sur la carte et
 *    un `n_scores: 5000` figé dans `analyses.resultat`. La recette ne l'avait
 *    pas vu parce qu'elle avait été jouée avec `rev_median` SEUL (1 952 CP de
 *    couverture), sous le seuil. Corrigé par la jumelle
 *    `calculer_score_composite_jsonb` (sql/170), que cette route appelle ;
 *    la forme TABLE en devient une enveloppe mince (même patron que sql/169),
 *    et `/api/custom-geo/source/score` (plafond 1 500 CP) la garde sans
 *    changement.
 *
 * Mesure (`EXPLAIN ANALYZE`, périmètre de 500 CP, 2 indicateurs) :
 * 23,5 ms, 632 blocs en cache, 13 lus. Périmètre France (6 187 CP, 2
 * indicateurs) : 159 ms, `shared hit=2795 read=80` (640 Ko).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkZoneAccess } from '@/lib/campaigns/access';
import { lireCorps } from '@/lib/api/valider-corps';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { assurerIndicateurCp } from '@/lib/analyses/indicateurs';
import { toJson, rpcJson } from '@/lib/supabase/rpc-json';
import type { TableInsert } from '@/lib/supabase/tables';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Plafond de codes postaux d'un périmètre.
 *
 * **Relevé de 3 000 à 7 000 le 2026-09-15, sur mesure.** L'ancienne valeur
 * refusait la France entière au motif que « ce n'est plus un périmètre » —
 * un choix de conception, pas une contrainte technique. Or le référentiel
 * compte 6 187 codes postaux, et le calcul national a été chronométré :
 *
 *   EXPLAIN (ANALYZE, BUFFERS) sur les 6 187 CP, 2 indicateurs
 *   → 159 ms · shared hit=2795 read=80, soit 640 Ko lus
 *
 * Un sixième de seconde et moins d'un mégaoctet : rien qui justifie de
 * fermer le cas d'usage le plus naturel de l'outil. Le plafond reste, au-dessus
 * du référentiel complet, pour refuser une liste absurde envoyée par un client
 * — pas pour interdire la France.
 *
 * ⚠️ Ce qui coûte vraiment n'est PAS ce plafond, c'est la matérialisation
 * paresseuse : un indicateur jamais calculé déclenche un balayage complet
 * d'`iris` (~220 Mo, ~1,4 s) dans `assurerIndicateurCp`, une fois pour toutes.
 * Six indicateurs neufs sur un même lancement, c'est ~8 s — d'où `maxDuration`.
 */
const MAX_CP = 7000;

/** Au-delà, le score ne se lit plus : six curseurs de poids sont déjà beaucoup. */
const MAX_INDICATEURS = 6;

/**
 * Une matérialisation manquante coûte une agrégation complète d'`iris` : le
 * quota protège le budget I/O Nano contre un utilisateur qui ferait défiler les
 * indicateurs. Compteur PARTAGÉ en base (`consommer_quota`, sql/135) — jamais
 * une Map locale, qui ne limiterait rien sur Vercel (CLAUDE.md).
 */
const limiteur = createRateLimiter({ max: 12, window: '60 s', prefix: 'geo:rl:analyse-score' });

/** Une ligne de `calculer_score_composite_jsonb` (sql/170). */
interface LigneScore {
  postal_code: string;
  score: number;
  n_indicateurs: number;
}

const IndicateurSchema = z.object({
  code: z.string().min(1).max(100),
  poids: z.number().positive().finite(),
  sens: z.enum(['croissant', 'decroissant']),
});

/**
 * Miroir de `FiltreActif` (lib/carte/filtre.ts) — le périmètre tel que la
 * carte le pose. `'france'` ajouté le 2026-09-15 (spec-filtre-france.md) :
 * seul type qui n'a PAS besoin de `checkZoneAccess` (pas une zone) et dont
 * `code` est ignoré côté RPC (`codes_postaux_du_perimetre_jsonb`, sql/168).
 */
const PerimetreSchema = z.object({
  type: z.enum(['region', 'departement', 'commune', 'cp', 'zone', 'france']),
  code: z.string().min(1).max(64),
});

const CorpsSchema = z.object({
  indicateurs: z.array(IndicateurSchema).min(1).max(MAX_INDICATEURS),
  /** Périmètre : l'une des trois formes, jamais aucune (voir le raffinement plus bas). */
  codes_postaux: z.array(z.string().min(2).max(10)).min(1).max(MAX_CP).optional(),
  perimetre: PerimetreSchema.optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  /** Enregistre le lancement dans `analyses` (Tâche 11) — défaut : oui. */
  enregistrer: z.boolean().optional(),
  nom: z.string().min(1).max(200).optional(),
}).refine(
  (c) => Boolean(c.codes_postaux?.length) || Boolean(c.perimetre) || Boolean(c.bbox),
  { message: 'Périmètre obligatoire : fournissez `codes_postaux`, `perimetre` ou `bbox`.' },
);

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée à ce compte.' }, { status: 400 });

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const corps = await lireCorps(request, CorpsSchema);
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
  const { indicateurs, perimetre, bbox, enregistrer, nom } = corps.valeur;

  const codes = indicateurs.map((i) => i.code);
  if (new Set(codes).size !== codes.length) {
    return NextResponse.json({ error: 'Un même indicateur est demandé plusieurs fois.' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // ── 1. Le périmètre, borné ────────────────────────────────────────────
  let codesPostaux = corps.valeur.codes_postaux ?? [];
  if (!codesPostaux.length && perimetre) {
    // Une zone appartient à une organisation : `codes_postaux_du_perimetre`
    // joint `custom_geo_zones` sur l'uuid SANS filtre d'org (c'est une
    // fonction de référentiel, elle n'a pas à connaître l'appelant). Sans ce
    // contrôle, un utilisateur de l'org A qui devine l'uuid d'une zone de
    // l'org B obtenait la liste complète de ses codes postaux — la garde
    // standard du projet, appliquée partout ailleurs (cf.
    // `app/api/custom-geo/[id]/route.ts`), manquait ici.
    if (perimetre.type === 'zone') {
      const acces = await checkZoneAccess(supabase, profile, perimetre.code);
      if (acces !== 'ok') {
        return NextResponse.json({ error: 'Zone introuvable.' }, { status: 404 });
      }
    }
    // `_jsonb` et non `codes_postaux_du_perimetre` (RETURNS TABLE, sql/146/167) :
    // PostgREST tronque À 5 000 LIGNES même une RPC RETURNS TABLE — mesuré ici
    // (2026-09-15) sur le périmètre `'france'`, 6 187 CP réels rendus comme
    // 5 000 sans erreur, comme documenté pour `correlation_campagne_indicateur`
    // (sql/154). `codes_postaux_du_perimetre_jsonb` (sql/168) est la jumelle
    // `RETURNS jsonb`, jamais tronquée par PostgREST.
    const { data, error } = await supabase.rpc('codes_postaux_du_perimetre_jsonb', {
      p_type: perimetre.type, p_code: perimetre.code,
    });
    if (error) {
      console.error('[POST /api/analyses/score] périmètre:', error.message);
      return NextResponse.json({ error: 'Résolution du périmètre impossible.' }, { status: 500 });
    }
    codesPostaux = rpcJson<string[]>(data) ?? [];
  }
  if (!codesPostaux.length && bbox) {
    const [ouest, sud, est, nord] = bbox;
    const { data, error } = await supabase.rpc('codes_postaux_dans_bbox', {
      p_ouest: ouest, p_sud: sud, p_est: est, p_nord: nord,
    });
    if (error) {
      console.error('[POST /api/analyses/score] bbox:', error.message);
      return NextResponse.json({ error: 'Résolution du périmètre impossible.' }, { status: 500 });
    }
    codesPostaux = (data ?? []).map((l) => l.code_postal);
  }
  if (!codesPostaux.length) {
    return NextResponse.json({ error: 'Périmètre vide : aucun code postal à scorer.' }, { status: 400 });
  }
  if (codesPostaux.length > MAX_CP) {
    return NextResponse.json(
      { error: `Périmètre trop large : ${codesPostaux.length} codes postaux pour un maximum de ${MAX_CP}. Resserrez le filtre.` },
      { status: 400 },
    );
  }

  // ── 2. Les indicateurs existent-ils au registre ? ─────────────────────
  // Un code inconnu ferait LEVER la matérialisation ; on répond mieux que 500.
  const { data: registre, error: erreurRegistre } = await supabase
    .from('cible_indicator_registry')
    .select('indicator_code, label, unit')
    .in('indicator_code', codes)
    .eq('active', true);
  if (erreurRegistre) {
    console.error('[POST /api/analyses/score] registre:', erreurRegistre.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  const connus = new Set((registre ?? []).map((r) => r.indicator_code));
  const inconnus = codes.filter((c) => !connus.has(c));
  if (inconnus.length) {
    return NextResponse.json(
      { error: `Indicateur inconnu ou inactif : ${inconnus.join(', ')}.` },
      { status: 400 },
    );
  }

  // ── 3. Matérialisation paresseuse, SÉQUENTIELLE (voir en-tête, point 2) ─
  // Logique partagée avec /api/analyses/correlation : lib/analyses/indicateurs.ts.
  // Séquentielle et jamais en parallèle — chaque matérialisation agrège
  // `iris` ⋈ `postal_code_commune`.
  const calculeLe: Record<string, string | null> = {};
  for (const code of codes) {
    const etat = await assurerIndicateurCp(supabase, code);
    if (!etat.ok) {
      console.error('[POST /api/analyses/score] indicateur:', code, etat.raison, etat.message);
      return NextResponse.json(
        { error: etat.message, raison: etat.raison },
        { status: etat.raison === 'inconnu' ? 400 : etat.raison === 'sans_donnees' ? 422 : 500 },
      );
    }
    calculeLe[code] = etat.calculeLe;
  }

  // ── 4. Le score ───────────────────────────────────────────────────────
  // `_jsonb` et non `calculer_score_composite` (RETURNS TABLE, sql/146) : la
  // RPC rend UNE LIGNE PAR CODE POSTAL et PostgREST tronque à 5 000 lignes
  // même une RPC RETURNS TABLE. Mesuré le 2026-09-15 : 6 186 lignes pour les
  // 6 187 CP du référentiel, donc 1 186 codes postaux perdus SANS ERREUR sur
  // le périmètre national — la choroplèthe les laissait non coloriés et
  // `analyses.resultat` figeait `n_scores: 5000`. Même piège que le point 4
  // de l'en-tête, une étape plus loin dans la chaîne : sql/168 avait corrigé
  // la fonction qui RÉSOUT le périmètre, sql/170 corrige celle qui le CALCULE.
  const { data: donneesScore, error: erreurScore } = await supabase.rpc('calculer_score_composite_jsonb', {
    p_indicateurs: codes,
    p_poids: indicateurs.map((i) => i.poids),
    p_sens: indicateurs.map((i) => i.sens),
    p_codes_postaux: codesPostaux,
  });
  if (erreurScore) {
    console.error('[POST /api/analyses/score] score:', erreurScore.message);
    return NextResponse.json({ error: 'Calcul du score impossible.' }, { status: 500 });
  }

  const lignes = rpcJson<LigneScore[]>(donneesScore) ?? [];
  const scores = lignes.map((l) => ({
    code: l.postal_code,
    score: Number(l.score),
    n_indicateurs: l.n_indicateurs,
  }));

  // Un score porté par un seul indicateur sur trois n'est pas comparable à un
  // score complet : la couverture remonte au client, qui l'affiche.
  const complets = scores.filter((s) => s.n_indicateurs === codes.length).length;

  const metaIndicateurs = indicateurs.map((i) => {
    const meta = (registre ?? []).find((r) => r.indicator_code === i.code);
    return {
      code: i.code,
      label: meta?.label ?? i.code,
      unit: meta?.unit ?? null,
      poids: i.poids,
      sens: i.sens,
      calcule_le: calculeLe[i.code] ?? null,
    };
  });

  // ── 5. Le lancement devient une analyse enregistrée (Tâche 11) ─────────
  let analyseId: string | null = null;
  if (enregistrer !== false) {
    const parametres = {
      indicateurs: indicateurs.map((i) => ({ code: i.code, poids: i.poids, sens: i.sens })),
    };
    const ligne: TableInsert<'analyses'> = {
      org_id: orgId,
      created_by: profile.id,
      type: 'score',
      nom: nom ?? `Score composite — ${metaIndicateurs.map((m) => m.label).join(' × ')}`,
      parametres: toJson(parametres),
      maillage: 'cp',
      // La LISTE de CP est ce qui est rejoué, pas la bbox ni le filtre : un
      // périmètre re-résolu plus tard ne rendrait pas forcément les mêmes
      // codes (le référentiel bouge d'un import à l'autre), et un rejeu qui
      // change de périmètre en silence ne rejoue rien. Le filtre d'origine est
      // gardé à côté, pour que le périmètre reste LISIBLE (« Bouches-du-Rhône »
      // plutôt que 127 codes postaux).
      perimetre: toJson({ codes_postaux: codesPostaux, filtre: perimetre ?? null, bbox: bbox ?? null }),
      resultat: toJson({
        n_codes_postaux: codesPostaux.length,
        n_scores: scores.length,
        n_complets: complets,
      }),
      statut: 'termine',
    };
    const { data: analyse, error: erreurAnalyse } = await supabase
      .from('analyses').insert(ligne).select('id').single();
    // Un échec d'enregistrement ne doit pas faire perdre un calcul déjà payé
    // en I/O : on rend le score, en le disant.
    if (erreurAnalyse) console.error('[POST /api/analyses/score] enregistrement:', erreurAnalyse.message);
    else analyseId = analyse.id;
  }

  return NextResponse.json(
    {
      scores,
      indicateurs: metaIndicateurs,
      perimetre: { n_codes_postaux: codesPostaux.length, n_scores: scores.length, n_complets: complets },
      analyse_id: analyseId,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
