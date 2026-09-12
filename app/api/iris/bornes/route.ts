/**
 * GET /api/iris/bornes
 *
 * Bornes nationales de l'échelle de couleurs IRIS, toutes colonnes à la fois.
 *
 * ── Pourquoi une route, et pas une table TypeScript ─────────────────────────
 *
 * Les carreaux ont `lib/carreaux/bornes.ts`, une table statique mesurée une
 * fois : leurs colonnes Filosofi sont figées. Les colonnes d'`iris` sont
 * **dynamiques** (règle `CLAUDE.md`) — une table statique y serait fausse dès
 * le prochain indicateur importé, et fausse en silence. Les bornes vivent donc
 * en base (`iris_bornes_echelle`, sql/140) et se reconstruisent avec les
 * données.
 *
 * ── Pourquoi tout d'un coup ─────────────────────────────────────────────────
 *
 * 37 lignes, ~4 kB. Un aller-retour au premier affichage de la couche, puis
 * plus rien quand l'utilisateur change d'indicateur. La route qu'elle remplace
 * (`/api/iris/stats`) faisait un `percentile_cont` sur les 49 448 IRIS **par
 * colonne consultée** : un balayage complet de la table à chaque nouvel
 * indicateur, ce que le budget I/O Nano ne peut pas absorber indéfiniment.
 *
 * La table est une lecture pure et ne contient aucune donnée par organisation :
 * le cache CDN est donc partagé entre tous les utilisateurs.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import type { BornesIris, CatalogueBornesIris } from '@/lib/iris/echelle';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await createAdminClient()
    .from('iris_bornes_echelle')
    .select('colonne, classe, log_min, log_max, val_min, val_max');

  if (error) {
    console.error('[iris/bornes] erreur:', error.message);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }

  const catalogue: CatalogueBornesIris = {};
  for (const ligne of (data ?? []) as BornesIris[]) {
    catalogue[ligne.colonne] = ligne;
  }

  return NextResponse.json(catalogue, {
    // Les bornes ne bougent qu'à un réimport IRIS — plusieurs mois en pratique.
    // `stale-while-revalidate` évite qu'une expiration coûte une attente.
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' },
  });
}
