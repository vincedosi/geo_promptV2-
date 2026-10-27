/**
 * sql/287 — `codes_postaux_du_perimetre_jsonb('france', 'metro')` exclut l'outre-mer (retours du 26/10, relecture 2,
 * I-2). Avant : la branche `france` ignorait `p_code` et rendait les 6 187 CP, DROM compris ; le score composite lancé
 * sur la pastille « France Metro » colorait la Réunion et la Guadeloupe sous le nom « France métropolitaine ».
 *
 * Lecture directe par psql dans le conteneur (comme perimetres-sans-interstices.test.ts) : la RPC rend un scalaire
 * jsonb, que PostgREST ne tronque pas.
 */
import { describe, expect, it } from 'vitest';
import { sql } from './_psql';

const compter = (code: string, filtre = 'true') => Number(sql(`
  select count(*) from jsonb_array_elements_text(public.codes_postaux_du_perimetre_jsonb('france', '${code}')) cp
   where ${filtre};`)[0]);

describe('sql/287 — la métropole dans codes_postaux_du_perimetre_jsonb', () => {
  it('« metro » : tous les CP sauf ceux des départements 97x / 98x', () => {
    const [attendu] = sql(`select count(*) from public.ref_codes_postaux
                            where code_dept not like '97%' and code_dept not like '98%';`);
    expect(compter('metro')).toBe(Number(attendu));
    expect(compter('metro', "cp like '97%' or cp like '98%'")).toBe(0);
    // La Corse reste dedans.
    expect(compter('metro', "cp like '20%'")).toBeGreaterThan(0);
  });

  it('la casse du code ne compte pas (« METRO », écriture des recettes)', () => {
    expect(compter('METRO')).toBe(compter('metro'));
  });

  it('les autres codes de la France gardent la France entière, outre-mer compris', () => {
    const [total] = sql('select count(*) from public.ref_codes_postaux;');
    for (const code of ['france', 'FR', 'ignore']) expect(compter(code), code).toBe(Number(total));
    expect(compter('france', "cp like '97%'")).toBeGreaterThan(0);
  });

  it('l’enveloppe RETURNS TABLE suit (sql/169) : même compte en métropole', () => {
    const [n] = sql("select count(*) from public.codes_postaux_du_perimetre('france', 'metro');");
    expect(Number(n)).toBe(compter('metro'));
  });
});
