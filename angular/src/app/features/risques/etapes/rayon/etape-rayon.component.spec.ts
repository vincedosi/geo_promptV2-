import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Bandes } from '../../data/profil-risque.api';
import type { ResultatBandes } from '../../etat/donnees-risque.service';
import { PROFIL_DEFAUT, type ProfilRayons } from '../../logique/profil';
import { EtapeRayonComponent } from './etape-rayon.component';

/** `population_par_classe` MESURÉE, profil par défaut (2026-10-04). */
const BANDES_MESUREES = {
  total: 14103578, hors_zone: 26980106, n_carreaux: 215646,
  par_classe: {
    'bas:1': 106419, 'bas:2': 410641, 'haut:1': 526874, 'haut:2': 2337495, 'haut:3': 10482317,
    'bas:pprt': 701, 'haut:pprt': 239131,
  },
} as unknown as Bandes;

const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').replace(/ +/g, ' ').trim();

/** Un hôte qui remplit l'emplacement `[emplacement-courbe]`, comme T10. */
@Component({
  selector: 'mg-hote-etape-rayon',
  imports: [EtapeRayonComponent],
  template: `
    <mg-etape-rayon [profil]="profil()" [resultat]="resultat()" libelleCible="Population totale"
                    [nomPerimetre]="nomPerimetre()">
      <p emplacement-courbe data-role="courbe-projetee">courbe</p>
    </mg-etape-rayon>`,
})
class Hote {
  readonly profil = input<ProfilRayons>(PROFIL_DEFAUT);
  readonly resultat = input.required<ResultatBandes>();
  readonly nomPerimetre = input('France entière');
}

async function rendre(resultat: ResultatBandes, profil: ProfilRayons = PROFIL_DEFAUT, nomPerimetre = 'France entière') {
  const f = TestBed.createComponent(Hote);
  f.componentRef.setInput('resultat', resultat);
  f.componentRef.setInput('profil', profil);
  f.componentRef.setInput('nomPerimetre', nomPerimetre);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('EtapeRayonComponent', () => {
  it('la réponse mesurée : quatre KPI — total, par niveau, carreaux — et le tableau', async () => {
    const el = await rendre({ etat: 'pret', bandes: BANDES_MESUREES, erreur: null, aConstruire: false });
    const kpis = [...el.querySelectorAll('mg-kpi')].map((k) => ({
      valeur: n(k.querySelector('[data-role="valeur"]')?.textContent),
      libelle: k.querySelector('[data-role="libelle"]')?.textContent?.trim(),
      note: n(k.querySelectorAll('span')[2]?.textContent),
    }));
    expect(kpis).toEqual([
      { valeur: '14 103 578', libelle: 'population totale', note: 'la somme des bandes égale ce total' },
      { valeur: '13 585 817', libelle: 'seveso seuil haut', note: 'prioritaire : un carreau proche des deux niveaux compte ici' },
      { valeur: '517 761', libelle: 'seveso seuil bas', note: 'hors des anneaux du seuil haut' },
      { valeur: '215 646', libelle: 'carreaux classés', note: 'France entière, carroyage INSEE 200 m' },
    ]);
    expect(el.querySelector('mg-tableau-bandes')).not.toBeNull();
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain(
      'Chaque carreau reçoit une seule classe : le seuil haut l’emporte sur le seuil bas, et le périmètre PPRT sur la bande calculée.',
    );
    // L'emplacement de la courbe (T10) est projeté, sous sa note de lecture.
    const projetee = el.querySelector('[data-role="courbe-projetee"]');
    expect(projetee).not.toBeNull();
    expect(projetee!.closest('[data-role="bloc-courbe"]')?.textContent?.replace(/\s+/g, ' '))
      .toContain('La courbe ci-dessous répond à une autre question : où placer un anneau.');
  });

  it('un seuil décoché : son KPI disparaît (aucun anneau dans le profil calculé)', async () => {
    const el = await rendre(
      { etat: 'pret', bandes: BANDES_MESUREES, erreur: null, aConstruire: false },
      { ...PROFIL_DEFAUT, bas: [] },
    );
    const libelles = [...el.querySelectorAll('mg-kpi [data-role="libelle"]')].map((x) => x.textContent?.trim());
    expect(libelles).toEqual(['population totale', 'seveso seuil haut', 'carreaux classés']);
  });

  it('premier calcul en cours : « Classement des carreaux… », aucun chiffre', async () => {
    const el = await rendre({ etat: 'chargement', bandes: null, erreur: null, aConstruire: false });
    expect(el.textContent).toContain('Classement des carreaux…');
    expect(el.querySelector('mg-kpi')).toBeNull();
    expect(el.querySelector('mg-tableau-bandes')).toBeNull();
  });

  it('recalcul : les chiffres précédents restent affichés (ils s’estompent ailleurs), pas de message', async () => {
    const el = await rendre({ etat: 'chargement', bandes: BANDES_MESUREES, erreur: null, aConstruire: false });
    expect(el.textContent).not.toContain('Classement des carreaux…');
    expect(el.querySelectorAll('mg-kpi')).toHaveLength(4);
  });

  it('409 pré-calcul absent : encadré d’avertissement, le message du serveur et la commande en mono', async () => {
    const msg = 'Les distances n’ont pas encore été construites.';
    const el = await rendre({ etat: 'echec', bandes: null, erreur: msg, aConstruire: true });
    const cadre = el.querySelector<HTMLElement>('[data-role="echec"]')!;
    expect(cadre.classList).toContain('border-[color-mix(in_srgb,var(--warning)_20%,transparent)]');
    expect(cadre.querySelector('p')!.classList).toContain('text-warning');
    expect(cadre.textContent).toContain(msg);
    const code = cadre.querySelector('code')!;
    expect(code.textContent).toBe('node scripts/construire_carreau_risque.mjs');
    expect(code.classList).toContain('font-mono');
    expect(el.querySelector('mg-kpi')).toBeNull();
  });

  it('autre échec : encadré de danger, sans commande', async () => {
    const el = await rendre({ etat: 'echec', bandes: null, erreur: 'Le calcul des bandes n’a pas répondu.', aConstruire: false });
    const cadre = el.querySelector<HTMLElement>('[data-role="echec"]')!;
    expect(cadre.querySelector('p')!.classList).toContain('text-danger');
    expect(cadre.querySelector('code')).toBeNull();
  });
});
