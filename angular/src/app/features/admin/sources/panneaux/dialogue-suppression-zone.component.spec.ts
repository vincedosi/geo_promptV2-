import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ZoneAdmin } from '../data/sources-admin.api';
import { DialogueSuppressionZoneComponent } from './dialogue-suppression-zone.component';
import { doublerDialog, espaces, texte } from '../../testing/dom';

const ZONE: ZoneAdmin = {
  id: 'z1', name: 'Cible composite (2 zones) — juil. 2026', description: null, org_id: 'o1', org_name: 'GENESIS (Global)',
  source_type: 'composite', source_metadata: {}, feature_count_iris: 9834, feature_count_cp: 1641, bbox: null,
  created_at: '2026-07-10T09:16:13.790Z', created_by: null,
};

describe('DialogueSuppressionZoneComponent — confirmation de suppression d’une zone perso (lot 6, T20)', () => {
  let f: ComponentFixture<DialogueSuppressionZoneComponent>;
  let el: HTMLElement;
  let confirmations: number;
  let annulations: number;

  beforeEach(async () => {
    doublerDialog();
    f = TestBed.createComponent(DialogueSuppressionZoneComponent);
    f.componentRef.setInput('zone', ZONE);
    confirmations = 0;
    annulations = 0;
    f.componentInstance.confirmer.subscribe(() => confirmations++);
    f.componentInstance.annuler.subscribe(() => annulations++);
    el = f.nativeElement as HTMLElement;
    await f.whenStable();
  });

  const dialogue = () => el.querySelector('dialog')!;
  const bouton = (n: string) => el.querySelector<HTMLButtonElement>(`[data-${n}]`)!;

  it('ouvert en modal à son premier rendu, textes de React (espace, source, IRIS · CP en fr-FR, avertissement)', () => {
    expect(dialogue().hasAttribute('open')).toBe(true);
    expect(texte(el.querySelector('[data-titre]'))).toBe('Supprimer "Cible composite (2 zones) — juil. 2026" ?');
    expect([...el.querySelectorAll('[data-details] > div')].map((d) => espaces(texte(d)))).toEqual([
      'Workspace : GENESIS (Global)', 'Source : composite', 'Features : 9 834 IRIS · 1 641 CP',
    ]);
    expect(texte(el.querySelector('[data-avertissement]'))).toBe(
      '⚠️ Action irréversible. Les users de ce workspace ne pourront plus utiliser cette zone dans leurs analyses. '
      + 'Les campagnes qui la référencent continueront de fonctionner (l\'agrégation est déjà calculée).',
    );
    expect([texte(bouton('annuler')), texte(bouton('confirmer'))]).toEqual(['Annuler', 'Supprimer definitivement']);
  });

  it('espace inconnu : « — » ; « Annuler » et Échap émettent `annuler`, « Supprimer definitivement » `confirmer`', async () => {
    f.componentRef.setInput('zone', { ...ZONE, org_name: null });
    await f.whenStable();
    expect(texte(el.querySelector('[data-details] > div'))).toBe('Workspace : —');
    bouton('annuler').click();
    const cancel = new Event('cancel', { cancelable: true });
    dialogue().dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    bouton('confirmer').click();
    expect([annulations, confirmations]).toEqual([2, 1]);
  });

  it('un clic sur le fond NE ferme PAS (le voile de React n’écoute rien)', () => {
    dialogue().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(annulations).toBe(0);
  });

  it('pendant la suppression : deux boutons désactivés, « Suppression... », Échap sans effet ; l’erreur s’affiche dans la boîte', async () => {
    f.componentRef.setInput('enCours', true);
    await f.whenStable();
    expect([bouton('annuler').disabled, bouton('confirmer').disabled]).toEqual([true, true]);
    expect(texte(bouton('confirmer'))).toBe('Suppression...');
    dialogue().dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(annulations).toBe(0);
    f.componentRef.setInput('enCours', false);
    f.componentRef.setInput('erreur', 'HTTP 500');
    await f.whenStable();
    const erreur = el.querySelector('[data-erreur-suppression]')!;
    expect(texte(erreur)).toBe('HTTP 500');
    expect(erreur.getAttribute('role')).toBe('alert');
  });
});
