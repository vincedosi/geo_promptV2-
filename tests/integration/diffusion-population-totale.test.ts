/**
 * C24 (plan de corrections du découpage des zones, 2026-10-31) — la diffusion achetée reste en POPULATION TOTALE quand
 * la part est calculée sur une cible (sql/327).
 *
 * Ce que ce fichier prouve, contre la base locale, sans rien y écrire (lectures seules) :
 *   - cible autre que `ind` : chaque ligne chiffrée porte `pop_totale_ind`, la population totale de l'unité, au moins
 *     égale à `pop_totale` (la cible) ; les lignes à population inconnue (A4) ne la portent pas ;
 *   - cible `ind` : aucune ligne ne porte la clé (réponse inchangée).
 */
import { describe, expect, it } from 'vitest';
import { psql } from './_psql';

const LONG = 180_000;
/** « Cible composite (2 zones) », espace par défaut : la zone de `tests/unit/zones/fixtures/couverture-composite-cp.json`. */
const COMPOSITE = '919ca65d-665a-43f6-834e-ea9f2eb68c72';
const ORG = '00000000-0000-0000-0000-000000000001';

const controle = (cible: string) => psql(`
  with l as (select e from jsonb_array_elements(
               public.couverture_geometrie('${COMPOSITE}', '${ORG}', '${cible}', 'cp')->'lignes') e)
  select count(*) filter (where e->>'pop_totale' is not null) || '|' ||
         count(*) filter (where e ? 'pop_totale_ind') || '|' ||
         count(*) filter (where e->>'pop_totale' is null and e ? 'pop_totale_ind') || '|' ||
         count(*) filter (where (e->>'pop_totale_ind')::numeric < (e->>'pop_totale')::numeric) || '|' ||
         (coalesce(sum((e->>'pop_totale_ind')::numeric), 0) > coalesce(sum((e->>'pop_totale')::numeric), 0))::text
    from l;`);

describe('couverture_geometrie — pop_totale_ind, la diffusion en population totale (sql/327)', () => {
  it('cible 18-24 ans : chaque ligne chiffrée porte la population totale de son unité, jamais sous celle de la cible', () => {
    const [chiffrees, avecCle, inconnuesAvecCle, sousCible, plusGrande] = controle('ind_18_24').split('|');
    expect(Number(chiffrees)).toBeGreaterThan(0);
    expect(avecCle).toBe(chiffrees);
    expect(inconnuesAvecCle).toBe('0');
    expect(sousCible).toBe('0');
    expect(plusGrande).toBe('true');
  }, LONG);

  it('population totale : aucune ligne ne porte la clé', () => {
    expect(controle('ind').split('|')[1]).toBe('0');
  }, LONG);
});
