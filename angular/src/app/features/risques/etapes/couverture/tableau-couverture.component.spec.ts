import { TestBed } from '@angular/core/testing';
import type { Bandes } from '../../data/profil-risque.api';
import type { ResultatBandes } from '../../etat/donnees-risque.service';
import type { Dimension } from '../../logique/dimensions';
import { PROFIL_DEFAUT } from '../../logique/profil';
import { BANDES_REGIONS_REELLES } from '../../testing/couverture.fixture';
import { TableauCouvertureComponent } from './tableau-couverture.component';

/** Espaces insécables (`toLocaleString('fr-FR')` sépare les milliers par U+202F) et blancs ramenés à une espace. */
const n = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ').replace(/ +/g, ' ').trim();

/** Le texte d'un élément, nœud texte par nœud texte, séparés par une espace : la frontière de deux éléments compte. */
function mots(e: Element | null | undefined): string {
  if (!e) return '';
  const parcours = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  const morceaux: string[] = [];
  for (let t = parcours.nextNode(); t; t = parcours.nextNode()) morceaux.push(t.textContent ?? '');
  return n(morceaux.join(' '));
}

const PRET = (bandes: Bandes): ResultatBandes => ({ etat: 'pret', bandes, erreur: null, aConstruire: false });

interface Options {
  maille?: Dimension;
  descendable?: boolean;
  remontable?: boolean;
  actif?: string | null;
}

async function rendre(resultat: ResultatBandes, o: Options = {}) {
  const f = TestBed.createComponent(TableauCouvertureComponent);
  f.componentRef.setInput('resultat', resultat);
  f.componentRef.setInput('maille', o.maille ?? 'region');
  f.componentRef.setInput('profil', PROFIL_DEFAUT);
  f.componentRef.setInput('libelleCible', 'Population totale');
  f.componentRef.setInput('descendable', o.descendable ?? true);
  f.componentRef.setInput('remontable', o.remontable ?? false);
  f.componentRef.setInput('actif', o.actif ?? null);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  return { f, el, c: f.componentInstance };
}

const lignes = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
const cellules = (tr: HTMLTableRowElement) => Array.from(tr.querySelectorAll('td')).map((td) => mots(td));

describe('mg-tableau-couverture', () => {
  it('réponse RÉELLE à la maille région : KPI, 15 lignes dans l’ordre du serveur, part et densité', async () => {
    const { el } = await rendre(PRET(BANDES_REGIONS_REELLES));
    const kpis = Array.from(el.querySelectorAll('mg-kpi')).map((k) => mots(k));
    expect(kpis).toEqual([
      '14 103 578 population totale les lignes se répartissent ce total, à l\'arrondi près',
      '15 régions exposés unités portant au moins un habitant exposé',
      '215 646 carreaux retenus un carreau de 200 m, une seule classe',
    ]);
    expect(el.querySelector('mg-kpi [data-role="valeur"]')?.classList).toContain('text-teal');

    const tr = lignes(el);
    expect(tr).toHaveLength(15);
    // Île-de-France : 3 076 627 / 11 834 764 = 26,0 % ; 3 076 627 / 12 060,67 km² = 255 /km².
    expect(cellules(tr[0])).toEqual(['11 Île-de-France', '3 076 627', '26 %', '255']);
    // Auvergne-Rhône-Alpes : 29,0 % arrondi au dixième rend 29 — `formaterNombre`, comme React.
    expect(cellules(tr[1])).toEqual(['84 Auvergne-Rhône-Alpes', '2 230 730', '29 %', '31']);
    expect(cellules(tr[2])).toEqual(['32 Hauts-de-France', '2 022 160', '35,4 %', '63']);
    expect(cellules(tr[14])).toEqual(['04 La Réunion', '37 139', '4,2 %', '15']);
    expect(tr.map((t) => t.getAttribute('data-unite'))).toEqual(
      ['11', '84', '32', '76', '44', '28', '75', '93', '24', '53', '27', '52', '02', '94', '04'],
    );
  });

  it('en-têtes : maille, cible, Part et Densité expliquées en info-bulle', async () => {
    const { el } = await rendre(PRET(BANDES_REGIONS_REELLES));
    const th = Array.from(el.querySelectorAll('th'));
    expect(th.map((t) => mots(t))).toEqual(['Région', 'Population totale', 'Part', 'Densité']);
    expect(th[2].getAttribute('title')).toBe('Part de la population de l’unité qui vit dans une zone du profil.');
    expect(th[3].getAttribute('title')).toBe('Habitants exposés par kilomètre carré de l’unité.');
    expect(th[0].getAttribute('title')).toBeNull();
  });

  it('les classes, de la plus peuplée à la moins peuplée, libellées depuis le profil', async () => {
    const { el } = await rendre(PRET(BANDES_REGIONS_REELLES));
    const chips = Array.from(el.querySelectorAll('[data-role="classes"] > span')).map((s) => mots(s));
    expect(chips).toEqual([
      'Seveso seuil haut — 2 km à 5 km 10 482 317',
      'Seveso seuil haut — 1 km à 2 km 2 337 495',
      'Seveso seuil haut — 0 à 1 km 526 874',
      'Seveso seuil bas — 500 m à 1 km 410 641',
      'Seveso seuil haut — périmètre PPRT 239 131',
      'Seveso seuil bas — 0 à 500 m 106 419',
      'Seveso seuil bas — périmètre PPRT 701',
    ]);
  });

  it('« — » et jamais 0 quand le dénominateur manque', async () => {
    const b = structuredClone(BANDES_REGIONS_REELLES);
    b.unites[0] = { ...b.unites[0], pop_totale: null, surface_km2: 0 };
    b.unites[1] = { ...b.unites[1], nom: null };
    const { el } = await rendre(PRET(b));
    expect(cellules(lignes(el)[0])).toEqual(['11 Île-de-France', '3 076 627', '—', '—']);
    // Un code inconnu du référentiel garde sa ligne, sous son code seul.
    expect(cellules(lignes(el)[1])[0]).toBe('84');
    expect(lignes(el)[1].getAttribute('title')).toBe('Cadrer la carte sur 84');
  });

  it('note de lecture : hors zone, et la phrase du code postal à cette maille seulement', async () => {
    const { el, f } = await rendre(PRET(BANDES_REGIONS_REELLES));
    const note = () => mots(el.querySelector('[data-role="note"]'));
    expect(note()).toBe(
      'Un carreau INSEE de 200 m appartient à une seule unité et à une seule classe : la somme de la colonne population '
      + 'égale le total, à n’importe quelle maille. 26 980 106 habitants vivent à moins de 10 km d’un site sans être '
      + 'retenus par les anneaux de ce profil — ce n’est pas la population non exposée de France.',
    );
    f.componentRef.setInput('maille', 'code_postal');
    await f.whenStable();
    expect(note()).toMatch(/de France\. Ni part ni densité à cette maille : le seul référentiel de population par code postal surcompte de 10,5 %\.$/);
    expect(el.querySelectorAll('th')[2].getAttribute('title')).toBe(
      'Indisponible au code postal : le seul référentiel de population à cette maille surcompte de 10,5 %.',
    );
    expect(mots(el.querySelectorAll('th')[0])).toBe('Code postal');
    expect(mots(el.querySelectorAll('mg-kpi')[1])).toContain('code postals exposés');
  });

  it('trois gestes distincts : clic = sélection, flèche droite = descendre, flèche gauche = remonter', async () => {
    const { el, c } = await rendre(PRET(BANDES_REGIONS_REELLES), { remontable: true });
    const evts: string[] = [];
    c.selection.subscribe((x) => evts.push(`selection:${x}`));
    c.descendre.subscribe((x) => evts.push(`descendre:${x.code}:${x.nom}`));
    c.remonter.subscribe(() => evts.push('remonter'));
    const tr = lignes(el)[7];
    tr.click();
    (tr.querySelector('[data-role="descendre"]') as HTMLButtonElement).click();
    (tr.querySelector('[data-role="remonter"]') as HTMLButtonElement).click();
    // Les flèches ne SÉLECTIONNENT pas : leur clic ne remonte pas jusqu'à la ligne.
    expect(evts).toEqual(['selection:93', "descendre:93:Provence-Alpes-Côte d'Azur", 'remonter']);
  });

  it('flèches : de VRAIS boutons, donc au clavier ; désactivées aux extrémités mais VISIBLES', async () => {
    const { el } = await rendre(PRET(BANDES_REGIONS_REELLES), { remontable: false, descendable: true });
    const tr = lignes(el)[7];
    const haut = tr.querySelector('[data-role="remonter"]') as HTMLButtonElement;
    const bas = tr.querySelector('[data-role="descendre"]') as HTMLButtonElement;
    expect(haut.tagName).toBe('BUTTON');
    expect(haut.disabled).toBe(true);
    expect(haut.getAttribute('aria-label')).toBe('Déjà au niveau le plus large');
    expect(haut.getAttribute('title')).toBeNull();
    expect(haut.classList).toContain('text-[var(--border-default)]');
    expect(bas.disabled).toBe(false);
    // Le nom tel que le référentiel l'écrit — apostrophe droite comprise.
    expect(bas.getAttribute('aria-label')).toBe("Descendre dans Provence-Alpes-Côte d'Azur");
    expect(bas.getAttribute('title')).toBe("Descendre dans Provence-Alpes-Côte d'Azur");
    expect(bas.classList).toContain('text-secondary');
    expect(bas.querySelector('mg-icone')).not.toBeNull();
  });

  it('dernier niveau (commune) : la flèche droite est grisée et le dit', async () => {
    const { el } = await rendre(PRET(BANDES_REGIONS_REELLES), { maille: 'commune', descendable: false, remontable: true });
    const bas = lignes(el)[0].querySelector('[data-role="descendre"]') as HTMLButtonElement;
    expect(bas.disabled).toBe(true);
    expect(bas.getAttribute('aria-label')).toBe('Dernier niveau — pas de découpage plus fin');
    const haut = lignes(el)[0].querySelector('[data-role="remonter"]') as HTMLButtonElement;
    expect(haut.disabled).toBe(false);
    expect(haut.getAttribute('aria-label')).toBe('Remonter d’un niveau');
  });

  it('survol relayé ; la ligne ACTIVE est surlignée', async () => {
    const { el, c, f } = await rendre(PRET(BANDES_REGIONS_REELLES));
    const survols: (string | null)[] = [];
    c.survol.subscribe((x) => survols.push(x));
    const tr = lignes(el)[2];
    tr.dispatchEvent(new MouseEvent('mouseenter'));
    tr.dispatchEvent(new MouseEvent('mouseleave'));
    expect(survols).toEqual(['32', null]);
    f.componentRef.setInput('actif', '32');
    await f.whenStable();
    expect(lignes(el)[2].classList).toContain('bg-teal-10');
    expect(lignes(el)[1].classList).not.toContain('bg-teal-10');
  });

  it('chargement sans donnée : « Calcul en cours… » ; avec donnée, les lignes restent', async () => {
    const { el, f } = await rendre({ etat: 'chargement', bandes: null, erreur: null, aConstruire: false });
    expect(mots(el.querySelector('[data-role="chargement"]'))).toBe('Calcul en cours…');
    expect(el.querySelector('table')).toBeNull();
    f.componentRef.setInput('resultat', { etat: 'chargement', bandes: BANDES_REGIONS_REELLES, erreur: null, aConstruire: false });
    await f.whenStable();
    expect(lignes(el)).toHaveLength(15);
  });

  it('échec : le message, et la commande de construction SEULEMENT pour un pré-calcul absent', async () => {
    const { el, f } = await rendre({ etat: 'echec', bandes: null, erreur: 'Rien à classer.', aConstruire: false });
    expect(mots(el.querySelector('[data-role="echec"]'))).toBe('Rien à classer.');
    f.componentRef.setInput('resultat', { etat: 'echec', bandes: null, erreur: null, aConstruire: true });
    await f.whenStable();
    expect(mots(el.querySelector('[data-role="echec"]')))
      .toBe('Calcul indisponible. node scripts/construire_carreau_risque.mjs');
  });

  it('liste vide et liste tronquée', async () => {
    const vide = { ...BANDES_REGIONS_REELLES, unites: [] };
    const { el, f } = await rendre(PRET(vide));
    expect(mots(el.querySelector('[data-role="vide"]'))).toBe('Aucune population exposée pour ces filtres.');
    f.componentRef.setInput('resultat', PRET({ ...BANDES_REGIONS_REELLES, tronquee: true, n_unites: 1234 }));
    await f.whenStable();
    expect(mots(el.querySelector('[data-role="tronquee"]'))).toBe(
      'Liste tronquée : 1 234 unités exposées, les plus peuplées seulement sont affichées. Le total ci-dessus les compte toutes.',
    );
  });
});
