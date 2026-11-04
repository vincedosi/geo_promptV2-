import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { genererPlanCp, type CpZone } from '@/lib/zones/plan';

/**
 * L'extraction d'un jeu RISQUE lit `zone_set_cp` dans un ordre TOTAL — la clé primaire `(code_postal, cluster_id)`,
 * sql/225 — et non par `code_postal` seul (relecture du groupe A de l'optimisation Python, M7, 04/11).
 *
 * Pourquoi c'est un défaut et pas un détail : `genererPlanCp` replie les grappes d'un code postal en SOMMANT leurs
 * populations dans l'ordre reçu (le premier test le prouve sur des valeurs réelles de forme), et `lireTout` pagine par
 * `range` — un ordre partiel laisse deux pages se recouvrir. Le plan n'était donc pas reproductible d'un appel à
 * l'autre, et le mode `ombre` (T5) aurait vu des écarts TS ↔ Python qui ne venaient pas de Python.
 */
const ROUTE = join(process.cwd(), 'app/api/zones/jeux/[id]/extractions/route.ts');

/** Les colonnes de chaque `.order(...)` de la chaîne qui lit `zone_set_cp`, dans l'ordre d'écriture. */
function ordresDeLaLecture(source: string): string[] {
  const debut = source.indexOf(".from('zone_set_cp')");
  expect(debut).toBeGreaterThan(-1);
  const fin = source.indexOf('.range(', debut);
  expect(fin).toBeGreaterThan(debut);
  return [...source.slice(debut, fin).matchAll(/\.order\('([a-z_]+)'/g)].map((m) => m[1]);
}

describe('extraction risque — ordre de lecture de zone_set_cp', () => {
  it("l'ordre des grappes d'un même code postal change le plan (la raison du tri complet)", () => {
    // Trois grappes du même code postal ; seul leur ORDRE change. Valeurs choisies pour que la somme flottante dépende
    // de l'ordre (0,1 + 0,2 + 0,3 ≠ 0,3 + 0,2 + 0,1 en double), comme des populations pondérées non entières.
    const grappes: CpZone[] = [
      { code_postal: '13270', classe: 'haut:1', pop_en_zone: 0.1, pop_totale: 10, retenu: true },
      { code_postal: '13270', classe: 'haut:2', pop_en_zone: 0.2, pop_totale: 10, retenu: true },
      { code_postal: '13270', classe: 'bas:1', pop_en_zone: 0.3, pop_totale: 10, retenu: true },
      { code_postal: '13800', classe: 'haut:1', pop_en_zone: 0.6, pop_totale: 10, retenu: true },
    ];
    const jeu = { mode_plan: 'exclusif' as const, poids: {} };
    const a = genererPlanCp(grappes, jeu);
    const b = genererPlanCp([grappes[2], grappes[1], grappes[0], grappes[3]], jeu);
    expect(a.lignes.map((l) => l.part_plan)).not.toEqual(b.lignes.map((l) => l.part_plan));
  });

  it('la route ordonne par la clé primaire entière : code_postal PUIS cluster_id', () => {
    expect(ordresDeLaLecture(readFileSync(ROUTE, 'utf-8'))).toEqual(['code_postal', 'cluster_id']);
  });

  it('le détecteur voit un ordre partiel', () => {
    const partiel = ".from('zone_set_cp')\n  .select('x')\n  .eq('zone_set_id', id)\n  .order('code_postal')\n  .range(de, a)";
    expect(ordresDeLaLecture(partiel)).toEqual(['code_postal']);
  });
});
