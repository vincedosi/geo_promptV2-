/**
 * CARACTÉRISATION du moteur risque des jeux de zones (lot 5, T1).
 *
 * Ces tests ne disent pas ce que le moteur DEVRAIT faire : ils figent ce qu'il
 * FAIT, mesuré le 2026-10-24 sur la base locale, avant que le lot 5 touche à
 * `zone_sets`, `lib/zones/jeu.ts` et `lib/zones/plan.ts`. Si l'une de ces
 * valeurs bouge, le moteur risque a changé — et le lot 5 s'est engagé à ne pas
 * le toucher (aucune ligne de `appliquer_seuil_zone_set`,
 * `creer_zone_set_extraction`, `construire_zone_set*`).
 *
 * ── CE QU'ILS FIGENT ──────────────────────────────────────────────────────
 *
 * 1. Le SEUIL : `appliquer_seuil_zone_set` sur deux jeux enregistrés.
 * 2. Le PLAN : `genererPlanCp` (TS) sur les `zone_set_cp` du premier jeu au
 *    seuil 20, puis l'empreinte que `creer_zone_set_extraction` (sql/231)
 *    calculerait, recalculée ICI en TS — elle doit égaler celle de
 *    l'extraction v1 archivée en base. C'est la seule preuve que la chaîne
 *    seuil SQL → plan TS → empreinte SQL produit encore, octet pour octet, ce
 *    qui est parti au custom bidding le 2026-09-23.
 *
 * ── SANS RIEN ÉCRIRE ──────────────────────────────────────────────────────
 *
 * `appliquer_seuil_zone_set` ÉCRIT (`zone_set_cp.retenu`, chiffres de
 * `zone_sets`). Chaque appel vit donc dans une transaction ANNULÉE (`begin` …
 * `rollback`, psql du conteneur) : le seuil enregistré du jeu (35 au
 * 2026-10-24) n'est jamais déplacé.
 *
 * La reconstruction complète (`construire_zone_set`, 230 s à froid et 225 s à chaud mesurés le
 * 2026-10-24) n'est PAS ici : trop lente pour une suite, mesurée à part (rapport
 * de la tâche).
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { psql, psqlLignes } from './_psql';
import { creerClientTest } from './_client';
import { genererPlanCp, type CpZone } from '@/lib/zones/plan';
import { normaliserJeu } from '@/lib/zones/jeu';
import { lireGroupesCp } from '@/lib/zones/groupes';

/** « Seveso France — test phase 4 » : haut 1/2/5 km + bas 0,5/1 km, gravité seveso_haut. */
const JEU_PHASE_4 = '0b7ece33-4903-4a0b-a57a-f6c54e78a729';
/** « Seveso haut + bas — 5 km ». */
const JEU_5_KM = 'd9b81560-0a22-4b37-8215-d564f708d0e5';

/** Empreinte de l'extraction v1 du premier jeu (2026-09-23, seuil 20, pondéré). */
const EMPREINTE_V1 = '8ccfe4b87df01674ec82e4a35a0417fb';

interface Seuil {
  ok: boolean;
  n_cp_retenus: number;
  taux_utile: number;
  population_exposee: number;
}

/** Applique un seuil dans une transaction annulée et rend la réponse de la RPC. */
function seuilAnnule(jeu: string, seuil: number): Seuil {
  return JSON.parse(psql(`begin;
    select public.appliquer_seuil_zone_set('${jeu}', ${seuil});
    rollback;`)) as Seuil;
}

describe('moteur risque des jeux de zones — caractérisation (mesurée le 2026-10-24)', () => {
  beforeAll(() => {
    // Un jeu absent n'est pas un test à sauter : c'est une base qui n'est plus
    // celle du filet. On le dit et on renvoie à la restauration, plutôt que de
    // laisser un `skip` muet faire croire le moteur couvert.
    const presents = psqlLignes(`select id from public.zone_sets
      where id in ('${JEU_PHASE_4}', '${JEU_5_KM}');`);
    for (const id of [JEU_PHASE_4, JEU_5_KM]) {
      if (!presents.includes(id)) {
        throw new Error(
          `Jeu de zones ${id} absent de la base locale : la caractérisation du moteur risque `
          + 'ne peut pas tourner. Restaurer le dump local (scripts/local/03-restore-local.sh, '
          + '§ « Environnement de développement local » d’ARCHITECTURE.md).',
        );
      }
    }
  });

  it('« Seveso France — test phase 4 » au seuil 20 : 1 102 CP, 73,1 %, 13 430 921 exposés', () => {
    const r = seuilAnnule(JEU_PHASE_4, 20);
    expect(r.ok).toBe(true);
    expect(r.n_cp_retenus).toBe(1102);
    expect(r.taux_utile).toBe(73.1);
    expect(r.population_exposee).toBe(13430921);
  }, 60_000);

  it('le même jeu au seuil 35 : 931 CP, 79,8 %, 12 793 361 exposés', () => {
    const r = seuilAnnule(JEU_PHASE_4, 35);
    expect(r.ok).toBe(true);
    expect(r.n_cp_retenus).toBe(931);
    expect(r.taux_utile).toBe(79.8);
    expect(r.population_exposee).toBe(12793361);
  }, 60_000);

  it('« Seveso haut + bas — 5 km » au seuil 20 : 1 687 CP, 80,0 %', () => {
    const r = seuilAnnule(JEU_5_KM, 20);
    expect(r.ok).toBe(true);
    expect(r.n_cp_retenus).toBe(1687);
    expect(r.taux_utile).toBe(80.0);
  }, 60_000);

  it('le plan au seuil 20 redonne l’empreinte de l’extraction v1 et 60,6 % du plan en zone', async () => {
    // L'empreinte archivée est lue en base, pas seulement recopiée : si la v1
    // disparaissait (base restaurée d'un autre dump), le test le dirait.
    expect(psql(`select empreinte from public.zone_set_extractions
      where zone_set_id = '${JEU_PHASE_4}' and version = 1;`)).toBe(EMPREINTE_V1);

    // Les lignes du jeu APRÈS le seuil 20, lues dans la même transaction
    // annulée que le seuil, plus le jeu lui-même (poids, mode, seuil texte).
    const brut = JSON.parse(psql(`begin;
      select public.appliquer_seuil_zone_set('${JEU_PHASE_4}', 20);
      select json_build_object(
        'jeu', (select to_json(z) from public.zone_sets z where z.id = '${JEU_PHASE_4}'),
        'seuil_texte', (select seuil_couverture_cp::text from public.zone_sets where id = '${JEU_PHASE_4}'),
        'cps', (select json_agg(json_build_object(
                  'code_postal', code_postal, 'classe', classe,
                  'pop_en_zone', pop_en_zone, 'pop_totale', pop_totale, 'retenu', retenu)
                  order by code_postal, cluster_id)
                from public.zone_set_cp where zone_set_id = '${JEU_PHASE_4}'));
      rollback;`)) as {
      jeu: Record<string, unknown>;
      seuil_texte: string;
      cps: { code_postal: string; classe: string; pop_en_zone: number | null; pop_totale: number | null; retenu: boolean }[];
    };

    // Même construction que la route d'extraction (`app/api/zones/jeux/[id]/extractions`).
    const jeu = normaliserJeu({ ...brut.jeu, seuil_couverture_cp: Number(brut.jeu.seuil_couverture_cp) });
    const cps: CpZone[] = brut.cps.map((r) => ({
      code_postal: r.code_postal,
      classe: r.classe,
      pop_en_zone: Number(r.pop_en_zone ?? 0),
      pop_totale: Number(r.pop_totale ?? 0),
      retenu: r.retenu,
    }));
    const plan = genererPlanCp(cps, jeu, await lireGroupesCp(creerClientTest()));

    expect(plan.n_retenus).toBe(1102);
    expect(plan.taux_utile).toBe(73.1);
    expect(plan.part_plan_en_zone).toBe(60.6);

    /*
     * La règle de sql/231, recopiée : md5 de
     *   seuil_couverture_cp::text || '|' || mode_plan || '|' ||
     *   string_agg(code_postal || ':' || round(multiplicateur, 3)::text, ',' order by code_postal)
     * `round(…, 3)::text` d'un numeric rend toujours trois décimales (« 1.500 »,
     * « 0.000 ») : c'est `toFixed(3)`. Les codes postaux sont des chiffres, que
     * le tri par défaut ordonne comme la collation de la base.
     */
    const lignes = [...plan.lignes]
      .sort((a, b) => (a.code_postal < b.code_postal ? -1 : a.code_postal > b.code_postal ? 1 : 0))
      .map((l) => `${l.code_postal}:${l.multiplicateur.toFixed(3)}`)
      .join(',');
    const empreinte = createHash('md5')
      .update(`${brut.seuil_texte}|${jeu.mode_plan}|${lignes}`)
      .digest('hex');
    expect(empreinte).toBe(EMPREINTE_V1);
  }, 60_000);
});
