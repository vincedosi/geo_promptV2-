/**
 * Les deux choroplèthes « Environnement » par zone — fonctions PURES partagées par `IndicateursCiviquesService` et
 * `SanteService` : identifiants (ceux de React, inchangés), expressions MapLibre, contenus de popup.
 *
 * Les popups sont construites en DOM (`textContent`), jamais en HTML concaténé : rien d'une propriété d'entité n'est
 * interprété. Leurs couleurs sont des JETONS (`var()` dans le DOM, où il est résolu) ; seules les teintes de niveau,
 * déjà calculées par `CouleursService`, sont des valeurs.
 */
import { elementTexte } from '../../../carte/contenu-popup';
import type { Bbox } from '../../../carte/bbox';
import { formaterNombre } from '../../../core/format/nombre';
import {
  type MetaVariableCivique, SANTE_TRANSPARENT, VALEUR_CIVIQUE_PAR_DEFAUT,
} from '../logique/palettes-donnees-carte';
import { type EchelleSante, type JeuSante, METRIQUES_SANTE, libelleNiveau } from '../logique/sante';

// ── Indicateurs civiques (`CivicIndicatorsLayer.tsx:132-134`) ───────────────
export const SOURCE_CIVIQUE = 'civic-cps-source';
export const COUCHE_CIVIQUE_FOND = 'civic-cps-fill';
export const COUCHE_CIVIQUE_TRAIT = 'civic-cps-line';

// ── Santé environnementale (`CivicHealthMapLayer.tsx:34-36`) ────────────────
export const SOURCE_SANTE = 'civic-health-zones';
export const COUCHE_SANTE_FOND = 'civic-health-zones-fill';
export const COUCHE_SANTE_TRAIT = 'civic-health-zones-line';

/** `interpolate` linéaire sur `value`, 25 quand elle manque (`CivicIndicatorsLayer.tsx:223-228`). */
export function expressionCivique(meta: MetaVariableCivique): unknown[] {
  return ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', 'value']], VALEUR_CIVIQUE_PAR_DEFAUT], ...meta.stops.flat()];
}

/** Les teintes des sept niveaux d'un jeu, résolues : 0 = indisponible (trait), 1 à 6 = aplats. */
export type TeintesNiveaux = Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string>;

/** `match` sur `indice` ; sous le seuil ou sans donnée : transparent (`CivicHealthMapLayer.tsx:236-241`). */
export function expressionSante(c: TeintesNiveaux): unknown[] {
  return [
    'match', ['coalesce', ['get', 'indice'], -1],
    1, c[1], 2, c[2], 3, c[3], 4, c[4], 5, c[5], 6, c[6],
    SANTE_TRANSPARENT,
  ];
}

/** Une zone chargée, normalisée pour la peinture et la popup (`ZoneEntry`, `CivicHealthMapLayer.tsx:85-95`). */
export interface EntreeZone {
  nom: string;
  indice_global: number;
  metrics: Record<string, number>;
  concentrations?: Record<string, number>;
  alerte?: boolean;
  stale: boolean;
  nbCommunes?: number;
}

/**
 * Les zones, avec la propriété `indice` recalculée selon le seuil et la métrique (`applyPaint`,
 * `CivicHealthMapLayer.tsx:173-195`) : 0 n'est jamais peint (indisponible), et sous le seuil, rien.
 */
export function zonesPeintes(
  zones: GeoJSON.FeatureCollection, entrees: ReadonlyMap<string, EntreeZone>, seuil: number, metrique: string,
): GeoJSON.FeatureCollection {
  const plancher = Math.max(seuil, 1);
  return {
    type: 'FeatureCollection',
    features: zones.features.map((f) => {
      const code = String(f.properties?.['code'] ?? '');
      const e = entrees.get(code);
      const valeur = e ? (metrique === 'global' ? e.indice_global : e.metrics[metrique] ?? null) : null;
      return { ...f, properties: { ...f.properties, indice: valeur != null && valeur >= plancher ? valeur : null } };
    }),
  };
}

/** La carte visible est-elle ENTIÈREMENT dans la bbox déjà lue ? Alors relire n'apporterait rien. */
export function bboxContenue(interieure: Bbox, exterieure: Bbox | null): boolean {
  if (!exterieure) return false;
  return interieure[0] >= exterieure[0] && interieure[1] >= exterieure[1]
    && interieure[2] <= exterieure[2] && interieure[3] <= exterieure[3];
}

const INTER = "'Inter', system-ui, sans-serif";
const MONO = "'JetBrains Mono', monospace";

/** Ce que la popup d'un code postal civique affiche (`CivicIndicatorsLayer.tsx:263-321`). */
export interface DonneesPopupCivique {
  cp: string;
  dept: string;
  valeur: number;
  inscrits: number;
  commune: string;
  nbCommunes: number;
}

/**
 * La popup d'un code postal : code, département, commune principale (« + n autres »), valeur, qualificatif, inscrits.
 * Mêmes textes que React ; ses gris `#f0f0f0` / `#a0a0a0` / `#666` et son teal en dur deviennent des jetons.
 */
export function contenuPopupCivique(d: DonneesPopupCivique, meta: MetaVariableCivique, doc: Document): HTMLElement {
  const racine = doc.createElement('div');
  racine.setAttribute('data-popup-civique', '');
  Object.assign(racine.style, { fontFamily: INTER, lineHeight: '1.5', padding: '4px 2px' });

  const tete = doc.createElement('div');
  Object.assign(tete.style, { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' });
  tete.append(
    elementTexte(doc, 'span', { fontFamily: MONO, fontSize: '11px', color: 'var(--text-secondary)' }, d.cp),
    elementTexte(doc, 'span', { fontFamily: MONO, fontSize: '9px', color: 'var(--text-tertiary)' }, `DÉPT ${d.dept}`),
  );
  racine.append(tete);

  if (d.commune) {
    const commune = elementTexte(doc, 'div', { fontFamily: INTER, fontSize: '12px', color: 'var(--text-primary)', marginBottom: '2px' }, d.commune);
    commune.setAttribute('data-commune', '');
    if (d.nbCommunes > 1) {
      const autres = d.nbCommunes - 1;
      commune.append(' ', elementTexte(doc, 'span', {
        color: 'var(--text-secondary)', fontSize: '10px',
      }, `+ ${autres} autre${d.nbCommunes > 2 ? 's' : ''}`));
    }
    racine.append(commune);
  }

  const cadre = doc.createElement('div');
  Object.assign(cadre.style, {
    background: 'color-mix(in srgb, var(--brand-teal) 8%, transparent)',
    border: '0.5px solid var(--brand-teal-30)', borderRadius: '4px', padding: '8px 10px', marginTop: '6px',
  });
  const valeur = elementTexte(doc, 'div', {
    fontFamily: MONO, fontSize: '18px', color: 'var(--brand-teal)', fontWeight: '500',
  }, `${d.valeur.toFixed(1)}${meta.unit}`);
  valeur.setAttribute('data-valeur', '');
  cadre.append(
    elementTexte(doc, 'div', {
      fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px',
    }, meta.label),
    valeur,
    elementTexte(doc, 'div', { fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }, meta.qualifier(d.valeur)),
  );
  racine.append(cadre);

  const pied = doc.createElement('div');
  Object.assign(pied.style, {
    fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px', display: 'flex', justifyContent: 'space-between',
  });
  pied.append(
    elementTexte(doc, 'span', {}, 'Inscrits sur les listes'),
    elementTexte(doc, 'span', { fontFamily: MONO, color: 'var(--text-primary)' }, formaterNombre(d.inscrits)),
  );
  racine.append(pied);
  return racine;
}

/** La popup d'une zone santé : indice global, alerte, détail par espèce / polluant, mention ODbL. */
export function contenuPopupSante(
  args: {
    jeu: JeuSante; echelle: EchelleSante; code: string; nom: string | null; entree: EntreeZone | undefined;
    teintes: TeintesNiveaux;
  },
  doc: Document,
): HTMLElement {
  const { jeu, echelle, code, entree, teintes } = args;
  const teinte = (n: number) => teintes[n as keyof TeintesNiveaux] ?? teintes[0];
  const racine = doc.createElement('div');
  racine.setAttribute('data-popup-sante', '');
  Object.assign(racine.style, { fontFamily: INTER, lineHeight: '1.5', padding: '4px 2px' });
  racine.append(elementTexte(doc, 'div', {
    fontSize: '12px', color: 'var(--text-primary)', fontWeight: '500', marginBottom: '4px',
  }, `${args.nom ?? code} (${code})`));

  if (entree) {
    const ligne = doc.createElement('div');
    Object.assign(ligne.style, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' });
    const pastille = doc.createElement('span');
    Object.assign(pastille.style, {
      width: '12px', height: '12px', borderRadius: '50%', background: teinte(entree.indice_global), display: 'inline-block',
    });
    const titre = jeu === 'pollen' ? 'Indice pollen' : 'Indice ATMO';
    ligne.append(pastille, elementTexte(doc, 'span', { fontSize: '12px', color: 'var(--text-primary)' }, `${titre} ${entree.indice_global}/6 — ${libelleNiveau(jeu, entree.indice_global)}${entree.stale ? ' (donnée de la veille)' : ''}`));
    ligne.setAttribute('data-indice', '');
    racine.append(ligne);
  }

  if (entree?.alerte) {
    const alerte = elementTexte(doc, 'div', {
      display: 'inline-block', marginBottom: '6px', padding: '2px 8px', borderRadius: '4px', fontSize: '10px',
      background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
      border: '0.5px solid color-mix(in srgb, var(--danger) 20%, transparent)', color: 'var(--danger)',
    }, '⚠ Alerte pollen Atmo France');
    alerte.setAttribute('data-alerte', '');
    racine.append(alerte);
  }

  if (entree) {
    for (const [cle, libelle] of METRIQUES_SANTE[jeu]) {
      const niveau = entree.metrics[cle] ?? 0;
      const conc = entree.concentrations?.[cle];
      const ligne = doc.createElement('div');
      ligne.setAttribute('data-metrique', cle);
      Object.assign(ligne.style, {
        display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '11px', color: 'var(--text-secondary)',
      });
      const valeur = elementTexte(doc, 'span', { fontFamily: MONO, color: teinte(niveau) }, `${niveau} — ${libelleNiveau(jeu, niveau)}`);
      if (conc && conc > 0) {
        valeur.append(elementTexte(doc, 'span', {
          color: 'var(--text-tertiary)',
        }, ` · ${conc < 10 ? conc.toFixed(1) : Math.round(conc)} grains/m³`));
      }
      ligne.append(elementTexte(doc, 'span', {}, libelle), valeur);
      racine.append(ligne);
    }
  } else {
    racine.append(elementTexte(doc, 'div', { fontSize: '11px', color: 'var(--text-tertiary)' }, 'Donnée indisponible'));
  }

  const note = echelle === 'cp'
    ? `max des ${entree?.nbCommunes ?? '?'} commune(s) du code postal`
    : 'échantillon : 1 commune par département';
  racine.append(elementTexte(doc, 'div', {
    fontSize: '9px', color: 'var(--text-tertiary)', marginTop: '8px',
  }, `Source : Atmo France et les AASQA (ODbL) — ${note}`));
  return racine;
}
