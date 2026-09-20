/**
 * `sourceDuPlan` — d'où vient le plan d'une campagne.
 *
 * ── CE QUE CES TESTS VERROUILLENT ─────────────────────────────────────────
 *
 * Le défaut corrigé le 2026-09-20 : faute de `variable_code`, le Suivi
 * repliait sur `abstention_pres_2022` et titrait la vignette du milieu « la
 * variable qui a servi à bâtir le plan » — en nommant une variable que
 * personne n'avait choisie, sur une campagne dont le plan venait d'anneaux
 * autour de sites classés.
 *
 * Le repli n'était pas une faute de frappe : c'était une valeur plausible
 * posée là où il fallait avouer ne pas savoir. Ces tests exigent donc
 * `'aucun'` sur tout ce qui n'est pas explicitement l'une des deux sources.
 */
import { describe, it, expect } from 'vitest';
import { sourceDuPlan, libellesVignettePlan } from '@/lib/campagne/source-plan';

describe('sourceDuPlan', () => {
  it('reconnaît un plan bâti sur un jeu de zones', () => {
    const s = sourceDuPlan({
      mode: 'zone_set',
      zone_set_id: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
      zone_set_nom: 'Seveso France',
      zone_set_version: 3,
      mode_plan: 'exclusif',
      seuil_couverture_cp: 35,
      taux_utile: 88.4,
      part_plan_en_zone: 100,
    });
    expect(s).toEqual({
      type: 'jeu_zones',
      zoneSetId: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
      nom: 'Seveso France',
      version: 3,
      modePlan: 'exclusif',
      seuilCouvertureCp: 35,
      tauxUtile: 88.4,
      partPlanEnZone: 100,
    });
  });

  it('reconnaît un plan bâti sur un indicateur', () => {
    expect(sourceDuPlan({ mode: 'by_insee_variable', variable_code: 'rev_median' }))
      .toEqual({ type: 'indicateur', code: 'rev_median' });
  });

  it('rend « aucun » plutôt qu un repli plausible', () => {
    // LE test de ce fichier. Chacun de ces corps a existé en base.
    expect(sourceDuPlan(null).type).toBe('aucun');
    expect(sourceDuPlan(undefined).type).toBe('aucun');
    expect(sourceDuPlan({}).type).toBe('aucun');
    expect(sourceDuPlan({ mode: 'uniform', value: 1 }).type).toBe('aucun');
    expect(sourceDuPlan('pas un objet').type).toBe('aucun');
    // Un `variable_code` vide n'est pas un indicateur choisi.
    expect(sourceDuPlan({ variable_code: '' }).type).toBe('aucun');
  });

  it('un jeu sans identifiant n est pas un jeu', () => {
    // Le nom seul ne suffit pas : sans identifiant, rien n'est interrogeable.
    expect(sourceDuPlan({ mode: 'zone_set', zone_set_nom: 'Seveso' }).type).toBe('aucun');
  });

  it('un mode « zone_set » mal renseigné ne fabrique aucune valeur', () => {
    const s = sourceDuPlan({ mode: 'zone_set', zone_set_id: 'x', zone_set_version: 'trois' });
    expect(s.type).toBe('jeu_zones');
    if (s.type !== 'jeu_zones') return;
    // Un nom absent reste vide — jamais inventé.
    expect(s.nom).toBe('');
    // Une version illisible retombe sur 1, jamais sur `NaN` : un `NaN` dans
    // l'interface fait douter des chiffres justes affichés à côté.
    expect(s.version).toBe(1);
    expect(s.tauxUtile).toBeNull();
    // Un mode de plan inconnu vaut « pondéré » : c'est le mode PERMISSIF.
    // Retomber sur « exclusif » couperait la diffusion sur une valeur qu'on
    // n'a pas su lire.
    expect(s.modePlan).toBe('pondere');
  });
});

describe('libellesVignettePlan', () => {
  it('nomme le jeu de zones, et annonce la part du plan', () => {
    const l = libellesVignettePlan({
      type: 'jeu_zones', zoneSetId: 'x', nom: 'Seveso France', version: 1,
      modePlan: 'pondere', seuilCouvertureCp: 20, tauxUtile: 75.9, partPlanEnZone: 60,
    });
    expect(l.titre).toBe('Seveso France');
    // ⚠ Le sous-titre ne doit PAS parler de « variable » : c'est la phrase
    // même qui mentait avant ce correctif.
    expect(l.sousTitre).not.toMatch(/variable/i);
    expect(l.sousTitre).toMatch(/plan/i);
  });

  it('retombe sur « Jeu de zones » quand le nom manque', () => {
    const l = libellesVignettePlan({
      type: 'jeu_zones', zoneSetId: 'x', nom: '', version: 1,
      modePlan: 'pondere', seuilCouvertureCp: null, tauxUtile: null, partPlanEnZone: null,
    });
    expect(l.titre).toBe('Jeu de zones');
  });

  it('garde le libellé de l indicateur quand le plan vient d une variable', () => {
    const l = libellesVignettePlan({ type: 'indicateur', code: 'rev_median' }, 'Revenu médian');
    expect(l.titre).toBe('Revenu médian');
    expect(l.sousTitre).toMatch(/variable/i);
  });

  it('affiche le code brut plutôt qu un libellé inventé', () => {
    expect(libellesVignettePlan({ type: 'indicateur', code: 'rev_median' }).titre)
      .toBe('rev_median');
  });

  it('dit qu il n y a pas de plan, plutôt que d en nommer un', () => {
    const l = libellesVignettePlan({ type: 'aucun' });
    expect(l.titre).toBe('Plan');
    expect(l.sousTitre).toMatch(/pas de plan/i);
  });
});
