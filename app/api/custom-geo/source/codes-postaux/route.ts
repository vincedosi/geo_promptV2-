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

const CorpsSchema = z.object({
  /** Liste collée, telle quelle : le parseur s'occupe des séparateurs. */
  saisie: z.string().min(1).max(500_000),
});

const FormulaireSchema = z.object({});

export async function POST(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

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
  const { data: connus, error: erreurConnus } = await supabase
    .from('ref_codes_postaux')
    .select('code_postal')
    .in('code_postal', codes);
  if (erreurConnus) {
    console.error('[source/codes-postaux] referentiel:', erreurConnus.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  const ensembleConnus = new Set((connus ?? []).map((r) => r.code_postal));
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
