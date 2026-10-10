import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IrisService } from '../../couches/iris.service';
import { SanteService } from '../../couches/sante.service';
import type { EchelleSante, JeuSante } from '../../data/civique.api';
import { SectionSanteComponent } from './section-sante.component';
import { SelectionsCalquesService } from './selections-calques.service';

function monter() {
  const etat = {
    jeu: signal<JeuSante | null>(null),
    echelle: signal<EchelleSante>('departement'),
    metrique: signal('global'),
    seuil: signal(0),
    progression: signal<{ done: number; total: number } | null>(null),
    chargement: signal(false),
    erreur: signal<string | null>(null),
    statutCp: signal<'ok' | 'no_data' | null>(null),
    dateCp: signal<string | null>(null),
    ingestion: signal<{ running: boolean; message: string | null; error: string | null }>({ running: false, message: null, error: null }),
  };
  const gestes: string[] = [];
  const sante = {
    ...etat,
    choisirJeu: (j: JeuSante | null) => { gestes.push(`jeu:${j}`); etat.jeu.set(j); },
    choisirEchelle: (e: EchelleSante) => { gestes.push(`echelle:${e}`); etat.echelle.set(e); },
    ingerer: () => gestes.push('ingerer'),
  };
  const detail = signal<{ code_commune: string | null; nom_commune?: string | null } | null>(null);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(), SelectionsCalquesService,
      { provide: SanteService, useValue: sante },
      { provide: IrisService, useValue: { detail } },
    ],
  });
  const fixture = TestBed.createComponent(SectionSanteComponent);
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  return { el, rendre, selections: TestBed.inject(SelectionsCalquesService), etat, gestes, detail };
}

const ouvrir = async (m: ReturnType<typeof monter>) => {
  m.selections.basculerSection('civicHealth');
  await m.rendre();
};
const boutons = (el: HTMLElement) => [...el.querySelectorAll('button')].map((b) => b.textContent!.trim());

describe('SectionSanteComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('repliée par défaut ; ouverte sans IRIS : l’invite de React et les deux couches nationales', async () => {
    const m = monter();
    await m.rendre();
    expect(m.el.textContent).toContain('Santé environnementale');
    expect(m.el.querySelector('[data-couches-sante]')).toBeNull();
    await ouvrir(m);
    expect(m.el.textContent).toContain('Cliquez sur un IRIS pour voir l\'air et les pollens du jour.');
    expect(m.el.textContent).toContain('Couche nationale');
    expect(boutons(m.el)).toEqual(expect.arrayContaining(['🌾 Allergènes', '🌬️ Qualité de l’air']));
    expect(m.el.textContent).not.toContain('Échelle');
  });

  it('re-cliquer la couche active la masque ; le titre le dit', async () => {
    const m = monter();
    await ouvrir(m);
    const pollen = m.el.querySelector('[data-jeu="pollen"]') as HTMLButtonElement;
    expect(pollen.title).toBe('Afficher la couche');
    pollen.click();
    await m.rendre();
    expect(pollen.title).toBe('Masquer la couche');
    expect(m.el.querySelector('[data-compte]')!.textContent!.trim()).toBe('1');
    pollen.click();
    expect(m.gestes).toEqual(['jeu:pollen', 'jeu:null']);
  });

  it('pollen : échelle, allergènes, seuils « modéré », source au département ; air : polluants et « dégradé »', async () => {
    const m = monter();
    m.etat.jeu.set('pollen');
    await ouvrir(m);
    expect(m.el.textContent).toContain('Échelle');
    expect(m.el.textContent).toContain('Allergène');
    const metriques = [...m.el.querySelectorAll('[data-metrique] option')].map((o) => o.textContent!.trim());
    expect(metriques).toEqual(['Indice global', 'Ambroisie', 'Armoise', 'Aulne', 'Bouleau', 'Graminées', 'Olivier']);
    const seuils = [...m.el.querySelectorAll('[data-seuil] option')].map((o) => o.textContent!.trim());
    expect(seuils).toEqual(['Tous les niveaux', '≥ modéré', '≥ élevé', '≥ très élevé']);
    expect(m.el.textContent).toContain('Source : Atmo France et les AASQA (ODbL) — 1 commune par département · clic sur une zone pour le détail par espèce');
    m.etat.jeu.set('atmo');
    await m.rendre();
    expect(m.el.textContent).toContain('Polluant');
    expect([...m.el.querySelectorAll('[data-metrique] option')].map((o) => o.textContent!.trim())).toEqual([
      'Indice global', 'Dioxyde d\'azote (NO₂)', 'Ozone (O₃)', 'Particules PM10', 'Particules fines PM2.5', 'Dioxyde de soufre (SO₂)',
    ]);
    expect([...m.el.querySelectorAll('[data-seuil] option')].map((o) => o.textContent!.trim())).toEqual([
      'Tous les niveaux', '≥ dégradé', '≥ mauvais', '≥ très mauvais',
    ]);
    expect(m.el.textContent).toContain('par polluant');
  });

  it('progression du flux départemental : « Chargement… n/t départements », puis plus rien à la fin', async () => {
    const m = monter();
    m.etat.jeu.set('pollen');
    m.etat.chargement.set(true);
    m.etat.progression.set({ done: 2, total: 3 });
    await ouvrir(m);
    expect(m.el.querySelector('[data-chargement-sante]')!.textContent!.trim()).toBe('Chargement… 2/3 départements');
    m.etat.progression.set({ done: 3, total: 3 });
    m.etat.chargement.set(false);
    await m.rendre();
    expect(m.el.querySelector('[data-chargement-sante]')).toBeNull();
  });

  it('code postal, donnée du 2026-09-17 vue le 2026-10-10 : le message DATÉ de React, le bouton d’ingestion, la date en source', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T15:00:00Z'));
    const m = monter();
    m.etat.jeu.set('pollen');
    m.etat.echelle.set('cp');
    m.etat.statutCp.set('ok');
    m.etat.dateCp.set('2026-09-17');
    await ouvrir(m);
    const alerte = m.el.querySelector('[data-perime]')!;
    expect(alerte.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Données vieilles de 23 jours (du 2026-09-17) — l\'ingestion quotidienne ne tourne plus. Les niveaux affichés ne sont pas ceux d\'aujourd\'hui. Rafraîchir maintenant (admin)',
    );
    expect(m.el.textContent).toContain('max des communes par code postal · données du 2026-09-17');
    (alerte.querySelector('button') as HTMLButtonElement).click();
    expect(m.gestes).toEqual(['ingerer']);
  });

  it('code postal sans donnée (no_data) : « Aucune donnée nationale » et « Lancer l’ingestion (admin) »', async () => {
    const m = monter();
    m.etat.jeu.set('atmo');
    m.etat.echelle.set('cp');
    m.etat.statutCp.set('no_data');
    await ouvrir(m);
    const bloc = m.el.querySelector('[data-sans-donnee]')!;
    expect(bloc.textContent).toContain('Aucune donnée nationale — l\'ingestion quotidienne n\'a pas encore tourné.');
    expect(bloc.querySelector('button')!.textContent!.trim()).toBe('Lancer l’ingestion (admin)');
  });

  it('bouton d’ingestion : JAMAIS au département, ni au code postal avec une donnée fraîche (condition de React)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-18T10:00:00Z'));
    const m = monter();
    m.etat.jeu.set('pollen');
    m.etat.statutCp.set('no_data');
    await ouvrir(m);
    expect(boutons(m.el).some((b) => b.includes('ingestion') || b.includes('Rafraîchir'))).toBe(false);
    m.etat.echelle.set('cp');
    m.etat.statutCp.set('ok');
    m.etat.dateCp.set('2026-09-17');
    await m.rendre();
    expect(boutons(m.el).some((b) => b.includes('ingestion') || b.includes('Rafraîchir'))).toBe(false);
  });

  it('ingestion en cours : bouton désactivé, « Ingestion en cours… », message en police mono ; erreur en rouge', async () => {
    const m = monter();
    m.etat.jeu.set('pollen');
    m.etat.echelle.set('cp');
    m.etat.statutCp.set('no_data');
    m.etat.ingestion.set({ running: true, message: 'Pollen : 3/10', error: null });
    await ouvrir(m);
    const bouton = m.el.querySelector('[data-sans-donnee] button') as HTMLButtonElement;
    expect(bouton.disabled).toBe(true);
    expect(bouton.textContent!.trim()).toBe('Ingestion en cours…');
    expect(m.el.querySelector('[data-ingestion]')!.textContent!.trim()).toBe('Pollen : 3/10');
    m.etat.ingestion.set({ running: false, message: null, error: 'Réservé aux administrateurs.' });
    await m.rendre();
    expect(m.el.querySelector('[data-ingestion]')!.classList).toContain('text-danger');
  });

  it('un échec de lecture est DIT dans la section (revue 1)', async () => {
    const m = monter();
    m.etat.jeu.set('pollen');
    m.etat.erreur.set('Erreur 500');
    await ouvrir(m);
    expect(m.el.querySelector('[data-erreur-sante]')!.textContent!.trim()).toBe('Erreur 500');
  });

  it('un IRIS sélectionné : compté dans l’en-tête', async () => {
    const m = monter();
    m.detail.set({ code_commune: '13055', nom_commune: 'Marseille' });
    await m.rendre();
    expect(m.el.querySelector('[data-compte]')!.textContent!.trim()).toBe('1');
  });
});
