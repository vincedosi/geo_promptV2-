/**
 * POST /api/custom-geo/source/codes-postaux — une zone à partir d'une liste de
 * codes postaux (Tâche 16, 2026-09-13).
 *
 * Accepte les deux formes d'un même geste : une liste **collée** (JSON) ou un
 * fichier **déposé** (multipart). Le client sauvegarde ensuite via
 * `/api/custom-geo/save` (`source_type: 'codes_postaux'`).
 *
 * **Les codes inconnus repartent séparément, et ce n'est pas décoratif.** Un
 * import qui avale 500 codes, en résout 460 et n'en dit rien produit une zone
 * plus petite que commandée — et personne ne s'en aperçoit avant la facture.
 * La route rend donc `codes_inconnus` à côté de la géométrie, et l'UI les
 * affiche AVANT la création.
 *
 * **Le fichier se lit par `lireFormulaire()` + `fichierDeFormulaire()`**,
 * jamais par `formData.get('file') as File` — ce cast ment sur une valeur
 * texte, et c'est la règle de `lib/api/valider-corps.ts` (CLAUDE.md).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { lireCorps, lireFormulaire, fichierDeFormulaire } from '@/lib/api/valider-corps';
import { parserCodesPostaux } from '@/lib/custom-geo/parse-cp';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Plafond par appel. Au-delà, l'union des polygones devient trop lourde à
 * rendre et à pousser vers un DSP — et le référentiel entier n'en compte que
 * 6 187, donc 2 000 est déjà un tiers de la France.
 */
const MAX_CP = 2000;

/** Un fichier de codes postaux ne pèse pas 5 Mo. 2 Mo couvrent ~300 000 codes. */
const MAX_OCTETS_FICHIER = 2 * 1024 * 1024;

/**
 * Quota, ajoute apres relecture (2026-09-13). Mesure du cout unitaire :
 * `get_admin_filter_geometry` sur 2 000 codes postaux lit 540 blocs DISQUE
 * par appel, `zone_dessin` sur un trace de 5 000 sommets prend 1,5 s, et
 * `zone_rayon` a 100 km 355 ms. Sans plafond, une boucle sur l'une de ces
 * routes est une porte ouverte sur le budget I/O Nano — la famille exacte
 * de l'incident du 28/03. Compteur PARTAGE en base (`consommer_quota`,
 * sql/135), jamais une Map locale qui ne limiterait rien sur Vercel.
 */
const limiteur = createRateLimiter({ max: 20, window: '60 s', prefix: 'geo:rl:zone-codes-postaux' });

const CorpsSchema = z.object({
  /** Liste collée, telle quelle : le parseur s'occupe des séparateurs. */
  saisie: z.string().min(1).max(500_000),
});

const FormulaireSchema = z.object({});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  // ── La saisie, collée ou déposée ──────────────────────────────────────
  const typeContenu = request.headers.get('content-type') ?? '';
  let saisie: string;

  if (typeContenu.includes('multipart/form-data')) {
    const formulaire = await lireFormulaire(request, FormulaireSchema);
    if (!formulaire.ok) return NextResponse.json({ error: formulaire.message }, { status: 400 });

    const fichier = fichierDeFormulaire(formulaire.formulaire, 'file');
    if (!fichier) {
      return NextResponse.json({ error: 'Aucun fichier reçu.' }, { status: 400 });
    }
    if (fichier.size > MAX_OCTETS_FICHIER) {
      return NextResponse.json(
        { error: `Fichier trop volumineux (${Math.round(fichier.size / 1024)} ko pour un maximum de ${MAX_OCTETS_FICHIER / 1024} ko).` },
        { status: 400 },
      );
    }
    saisie = await fichier.text();
  } else {
    const corps = await lireCorps(request, CorpsSchema);
    if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
    saisie = corps.valeur.saisie;
  }

  // ── Le parseur : codes valides d'un côté, rejets de l'autre ───────────
  const { codes, rejetes, nRejetes } = parserCodesPostaux(saisie);

  if (!codes.length) {
    return NextResponse.json(
      { error: 'Aucun code postal valide dans la saisie.', rejetes, n_rejetes: nRejetes },
      { status: 400 },
    );
  }
  if (codes.length > MAX_CP) {
    return NextResponse.json(
      { error: `${codes.length} codes postaux pour un maximum de ${MAX_CP} par import.`, n_codes: codes.length },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // ── Quels codes le référentiel connaît-il ? ───────────────────────────
  // Demandé AVANT la géométrie : un code absent de `ref_codes_postaux` ne
  // contribuera rien à l'union, et l'utilisateur doit savoir lesquels — c'est
  // souvent une coquille (un CP étranger, un Cedex, un code périmé).
  //
  // Découpé en lots de 500, et ce n'est pas de la prudence : `postgrest-js`
  // encode chaque virgule d'un `.in()` en `%2C`, soit 8 caractères par code
  // postal. À 2 000 codes, l'URL fait **16 104 caractères** (mesuré) pour une
  // limite Kong/nginx usuelle de 16 384 — il restait 1,7 % de marge. Au-delà,
  // l'échec est MUET : la route répondrait « Erreur base de données » sans que
  // rien ne désigne la vraie cause. `postgrest-js` nomme lui-même cette limite
  // dans son code de gestion d'erreur, avec le conseil de passer par une RPC.
  //
  // Séquentiel et non `Promise.all` : quatre lots simultanés sur un index
  // suffisent à peser, et le plafond de 3 requêtes Supabase parallèles est une
  // règle du projet.
  const TAILLE_LOT = 500;
  const ensembleConnus = new Set<string>();
  for (let i = 0; i < codes.length; i += TAILLE_LOT) {
    const lot = codes.slice(i, i + TAILLE_LOT);
    const { data: connus, error: erreurConnus } = await supabase
      .from('ref_codes_postaux')
      .select('code_postal')
      .in('code_postal', lot);
    if (erreurConnus) {
      console.error('[source/codes-postaux] referentiel:', erreurConnus.message);
      return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
    }
    for (const r of connus ?? []) ensembleConnus.add(r.code_postal);
  }
  const codesRetenus = codes.filter((c) => ensembleConnus.has(c));
  const codesInconnus = codes.filter((c) => !ensembleConnus.has(c));

  if (!codesRetenus.length) {
    return NextResponse.json(
      { error: 'Aucun de ces codes postaux n’existe au référentiel.', codes_inconnus: codesInconnus.slice(0, 50) },
      { status: 400 },
    );
  }

  // Même RPC que `source/indicator-threshold` et la source météo pour le
  // palier CP (signature : p_scale, p_codes).
  const { data: geoRaw, error: erreurGeo } = await supabase.rpc('get_admin_filter_geometry', {
    p_scale: 'cp', p_codes: codesRetenus,
  });
  if (erreurGeo) {
    console.error('[source/codes-postaux] geometrie:', erreurGeo.message);
    return NextResponse.json({ error: 'geometry_failed' }, { status: 400 });
  }
  const parsedGeo = (typeof geoRaw === 'string' ? JSON.parse(geoRaw) : geoRaw) as { geometry?: unknown };
  const geometry = parsedGeo?.geometry ?? null;
  if (!geometry) {
    console.error('[source/codes-postaux] geometrie vide dans la reponse RPC');
    return NextResponse.json({ error: 'geometry_failed' }, { status: 400 });
  }

  return NextResponse.json({
    geometry,
    codes: codesRetenus,
    n_codes: codesRetenus.length,
    // Les deux familles de perte sont distinguées : un jeton qui n'est pas un
    // code postal (coquille de saisie) et un code postal qui n'existe pas au
    // référentiel (Cedex, code périmé, CP étranger).
    codes_inconnus: codesInconnus.slice(0, 50),
    n_inconnus: codesInconnus.length,
    rejetes,
    n_rejetes: nRejetes,
    scale: 'cp',
  });
}
