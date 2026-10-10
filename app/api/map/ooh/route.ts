import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/auth';
import type { ZoneData } from '@/types/spatial';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';
import { sourcesVisiblesDeLaRequete, filtrerParSourcesVisibles } from '@/lib/auth/perimetre-donnees';
import { lireTout } from '@/lib/supabase/lire-tout';

export const dynamic = 'force-dynamic';

/**
 * Nombre maximal de panneaux lus (1 434 actifs le 2026-10-10). Borne I/O :
 * au-delà, la route échoue au lieu de tronquer. La relever reste possible —
 * c'est une lecture paginée, pas un `.limit()` que PostgREST ignorerait.
 */
const PLAFOND_PANNEAUX = 5000;

/** Filtre optionnel sur les regies. Absent ou vide = toutes. */
// bbox : [west, south, east, north] — lib/carte/filtre.ts (Tache 4, corrigee
// round 1). Optionnelle : useMapDirectActions ne l'envoie QUE si un filtre
// est actif (bboxDuFiltre(filtre)) — un premier essai l'envoyait toujours en
// repli sur BBOX_METRO, ce qui masquait l'outre-mer en permanence. Quand elle
// est presente, elle borne REELLEMENT la requete cote serveur (jamais un
// masque cote client) ; absente, la requete se comporte comme avant (aucune
// borne geographique).
const PanneauxSchema = z.object({
  regies: z.array(z.string()).optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const corps = await lireCorps(req, PanneauxSchema);
    if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });
    const { regies, bbox } = corps.valeur;

    const supabase = createAdminClient();
    const sources = await sourcesVisiblesDeLaRequete(req);

    // Lecture PAGINÉE : PostgREST plafonne toute requête de table à 1 000
    // lignes (`db-max-rows`), et l'ancien `.limit(5000)` rendait 1 000
    // panneaux sur 1 434 actifs, sans erreur (mesuré le 2026-10-10).
    // Borne I/O : PLAFOND_PANNEAUX ; au-delà, `lireTout` ÉCHOUE plutôt que de
    // rendre un début. `order('id')` départage `regie` : sans ordre stable,
    // deux pages pourraient se recouvrir.
    const construire = (de: number, a: number) => {
      let query = supabase
        .from('panneaux_affichage')
        .select('id, regie, type_panneau, adresse, ville, lat, lng, nb_faces, metadata')
        .eq('actif', true)
        .order('regie')
        .order('id');

      if (regies && regies.length > 0) {
        query = query.in('regie', regies);
      }

      if (bbox) {
        const [west, south, east, north] = bbox;
        query = query.gte('lng', west).lte('lng', east).gte('lat', south).lte('lat', north);
      }

      // `panneaux_affichage` porte la source de son import (sql/082) : un
      // inventaire de régie peut être au socle ou privé à un client.
      return filtrerParSourcesVisibles(query, sources, { referentiels: true }).range(de, a);
    };

    let data: unknown[];
    try {
      ({ lignes: data } = await lireTout(construire, PLAFOND_PANNEAUX));
    } catch (err) {
      console.error('[api/map/ooh] erreur:', err instanceof Error ? err.message : String(err));
      return NextResponse.json(
        { error: `Lecture des panneaux impossible (plus de ${PLAFOND_PANNEAUX} panneaux, ou base indisponible).` },
        { status: 500 },
      );
    }

    if (!data.length) {
      return NextResponse.json({ error: 'Aucun panneau trouvé' }, { status: 404 });
    }

    interface OohRow {
      id: string;
      regie?: string | null;
      type_panneau?: string | null;
      adresse?: string | null;
      ville?: string | null;
      lat: number | string;
      lng: number | string;
      nb_faces?: number | null;
      metadata?: Record<string, unknown> | null;
    }
    const pois = (data as OohRow[]).map((p) => ({
      id: p.id,
      nom: p.regie ? `${p.regie}${p.type_panneau ? ` — ${p.type_panneau}` : ''}` : 'Panneau OOH',
      lat: Number(p.lat),
      lng: Number(p.lng),
      categorie: 'panneaux',
      sous_categorie: p.type_panneau ?? undefined,
      adresse: p.adresse ?? undefined,
      ville: p.ville ?? undefined,
    }));

    // Centroïde
    const coordonnees = {
      lat: pois.reduce((s, p) => s + p.lat, 0) / pois.length,
      lng: pois.reduce((s, p) => s + p.lng, 0) / pois.length,
    };

    const categories: Record<string, number> = { panneaux: pois.length };

    const label = regies?.length
      ? `${regies.length} régie${regies.length > 1 ? 's' : ''} OOH`
      : 'Tous les panneaux OOH';

    const zoneData: ZoneData = {
      ville: label,
      region: null,
      departement: null,
      categorie_poi: 'panneaux',
      rayon_metres: null,
      rayon_poi_metres: null,
      coordonnees,
      pois,
      nb_pois: pois.length,
      categories,
    };

    logger.debug('api/map/ooh', `${pois.length} panneaux — régies: ${regies?.join(', ') ?? 'toutes'}`);
    return NextResponse.json(zoneData);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/map/ooh] ERREUR:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
