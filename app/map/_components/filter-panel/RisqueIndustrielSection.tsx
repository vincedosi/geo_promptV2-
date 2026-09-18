/**
 * Section « Zones à risque industriel » du panneau Calques.
 *
 * ── CE QUE CETTE SECTION DOIT FAIRE COMPRENDRE, ET DANS QUEL ORDRE ────────
 *
 * Elle superpose deux objets de nature opposée : les **périmètres PPRT**,
 * servitudes publiées par l'État et opposables en urbanisme, et une **zone
 * calculée** — un cercle dont MAGELIAN choisit le rayon. Un média planner qui
 * les confond met dans une recommandation client un chiffre d'habitants
 * exposés issu d'un rayon que nous avons inventé.
 *
 * La section répond donc à trois questions, dans cet ordre :
 *
 *   1. **Ce que je vois** — combien de sites, et combien ont un périmètre réel
 *   2. **Ce qui fait foi** — le périmètre PPRT
 *   3. **Ce que j'ajoute moi-même** — la zone calculée
 *
 * ── L'ORDRE EST UNE DÉCISION, PAS UNE MISE EN PAGE ────────────────────────
 *
 * Jusqu'au 2026-09-18, l'ordre était l'inverse : sept contrôles à plat, tous
 * du même poids visuel, avec notre cercle inventé en tête et la servitude
 * opposable enterrée sous six réglages. La hiérarchie visuelle affirmait le
 * contraire de la hiérarchie juridique.
 *
 * ── LE TRAIT EST LE TITRE ─────────────────────────────────────────────────
 *
 * Chaque carte porte son propre tracé dans son en-tête : trait plein pour le
 * réglementaire, tireté pour le calculé (`lib/carte/nature-zone.ts`). La
 * légende n'est donc plus une note en bas de panneau ni un encart flottant à
 * l'autre bout de l'écran : elle est là où l'on choisit. C'est ce qui rend la
 * confusion difficile plutôt que simplement déconseillée.
 *
 * Les motifs ne sont PAS retapés ici : ils viennent de `LARGEUR_TRAIT_PPRT` et
 * `TIRETE_ZONE_CALCULEE`, les mêmes constantes que MapLibre reçoit. Une
 * légende qui montre un trait que la carte ne dessine pas est pire qu'une
 * absence de légende.
 *
 * ── CE QUI DESCEND DANS LES REPLIS ───────────────────────────────────────
 *
 * Niveau réglementaire, type de risque, halo, sites à l'arrêt : ce sont des
 * RÉGLAGES, pas la lecture principale. Ils gardent tous leur comportement,
 * seule leur place change — la règle « pas de modification non demandée » du
 * projet vaut aussi pour une refonte visuelle.
 */
import React from 'react';
import { FilterSectionHeader } from './FilterSectionHeader';
import { MultiDropdown } from './MultiDropdown';
import { C, fInter, fMono } from './tokens';
import { labelStyle } from './styles';
import { ORDRE_TYPES, LIBELLE_TYPE, COULEURS_CSS } from '@/lib/carte/palette-risques';
import { COULEURS_PPRT_CSS, LARGEUR_TRAIT_PPRT, LIBELLE_TYPE_ZONE_PPRT } from '@/lib/carte/palette-pprt';
import { TIRETE_ZONE_CALCULEE } from '@/lib/carte/nature-zone';
import { formaterNombre } from '@/lib/format/nombre';
import { PPRT_ZOOM_PLANCHER } from '@/lib/version';
import type { EtatCouchePprt } from '../PprtLayer';

/**
 * Niveaux réglementaires, du plus grave au moins.
 *
 * NON exportée : rien d'autre ne la nomme, et `knip` comptait l'export comme
 * mort (cliquet de tests/unit/docs/catalogue-code.test.ts).
 */
const NIVEAUX_RISQUE = [
  { id: 'seveso_haut', label: 'Seveso seuil haut' },
  { id: 'seveso_bas', label: 'Seveso seuil bas' },
  { id: 'ied', label: 'Directive IED' },
  { id: 'autorisation', label: 'Autorisation' },
  { id: 'enregistrement', label: 'Enregistrement' },
  { id: 'autre', label: 'Régime déclaratif ou non précisé' },
] as const;

/** Rayons proposés pour la zone calculée. 0 = aucune zone. */
const RAYONS = [0, 300, 500, 1000, 2000, 5000] as const;

/**
 * Les trois familles de `pprt_perimetres.type_zone`, dans l'ordre de leur
 * effectif mesuré (639 / 18 / 7 sur les 664 zones).
 */
const TYPES_ZONE_PPRT = ['enveloppe', 'perimetre_reglemente', 'indetermine'] as const;

export interface RisqueIndustrielSectionProps {
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;

  actif: boolean;
  setActif: (v: boolean) => void;

  /** Niveaux réglementaires retenus. */
  niveaux: string[];
  setNiveaux: (v: string[]) => void;

  /** Types de risque retenus (vide = tous). */
  typesRisque: string[];
  setTypesRisque: (v: string[]) => void;

  inclureInactifs: boolean;
  setInclureInactifs: (v: boolean) => void;

  rayonM: number;
  setRayonM: (v: number) => void;

  afficherHalo: boolean;
  setAfficherHalo: (v: boolean) => void;

  /**
   * Compte remonté par la couche. `avecPprt` est ce qui permet d'afficher la
   * part de la vue qui repose sur une donnée de l'État — il vient de la base
   * (sql/179) et n'est jamais recalculé ici.
   */
  compte: { rendus: number; total: number; avecPprt: number } | null;

  /** Couche « Périmètre PPRT » — servitudes PM3, distincte du rayon calculé. */
  pprtActif: boolean;
  setPprtActif: (v: boolean) => void;
  pprtTypes: string[];
  setPprtTypes: (v: string[]) => void;
  pprtEtat: EtatCouchePprt | null;
}

/* ─────────────────────────────────────────────────────────────────────────
   Briques de présentation. Locales : elles n'ont de sens que pour cette
   section, et les exporter les ferait compter comme mortes par `knip`.
   ───────────────────────────────────────────────────────────────────────── */

/** Aperçu du tracé, tel que MapLibre le dessine réellement. */
function Trace({ tirete }: { tirete: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 20,
        height: 0,
        flexShrink: 0,
        borderTop: tirete
          ? `1px dashed ${C.textSec}`
          : `${LARGEUR_TRAIT_PPRT}px solid ${COULEURS_PPRT_CSS.contour}`,
      }}
    />
  );
}

/**
 * Carte d'une zone : le tracé, le nom, ce qu'elle vaut, son interrupteur.
 *
 * L'interrupteur est une CASE À COCHER et non un bouton stylé : elle reste
 * annonçable par un lecteur d'écran et atteignable au clavier sans qu'on ait
 * à rebâtir le rôle à la main.
 */
function CarteZone({
  tirete,
  titre,
  sousTitre,
  actif,
  onToggle,
  enfants,
}: {
  tirete: boolean;
  titre: string;
  sousTitre: string;
  actif: boolean;
  onToggle: (v: boolean) => void;
  enfants?: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: `0.5px solid ${actif ? 'var(--brand-teal-30)' : C.border}`,
        borderRadius: 8,
        background: actif ? 'var(--brand-teal-10)' : 'transparent',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 200ms var(--ease-out), background-color 200ms var(--ease-out)',
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <Trace tirete={tirete} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: C.text }}>
            {titre}
          </span>
          <span style={{ fontFamily: fInter, fontSize: 10, color: C.textDim, lineHeight: 1.35 }}>
            {sousTitre}
          </span>
        </span>
        <input
          type="checkbox"
          checked={actif}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer', flexShrink: 0 }}
        />
      </label>
      {actif && enfants}
    </div>
  );
}

/** Repli secondaire : un réglage qu'on ouvre quand on en a besoin. */
function Repli({
  titre,
  indice,
  children,
}: {
  titre: string;
  indice?: string;
  children: React.ReactNode;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          padding: '4px 0',
          cursor: 'pointer',
          fontFamily: fInter,
          fontSize: 11,
          color: C.textSec,
          textAlign: 'left',
        }}
      >
        <span aria-hidden style={{ color: C.textDim, width: 8 }}>{ouvert ? '−' : '+'}</span>
        <span style={{ flex: 1 }}>{titre}</span>
        {indice && <span style={{ fontFamily: fMono, fontSize: 10, color: C.textDim }}>{indice}</span>}
      </button>
      {ouvert && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 0 4px 14px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function RisqueIndustrielSection({
  filterSearch,
  sectionsOpen,
  toggleSection,
  actif,
  setActif,
  niveaux,
  setNiveaux,
  typesRisque,
  setTypesRisque,
  inclureInactifs,
  setInclureInactifs,
  rayonM,
  setRayonM,
  afficherHalo,
  setAfficherHalo,
  compte,
  pprtActif,
  setPprtActif,
  pprtTypes,
  setPprtTypes,
  pprtEtat,
}: RisqueIndustrielSectionProps) {
  const ouvert = sectionsOpen.risqueIndustriel !== false;

  // Part des sites visibles qui reposent sur une donnée de l'État. C'est la
  // réponse à « est-ce que je peux me fier à cette carte ? », et elle doit
  // arriver AVANT qu'on ait cliqué quoi que ce soit.
  const partPprt =
    compte && compte.rendus > 0 ? Math.round((compte.avecPprt / compte.rendus) * 100) : null;

  return (
    <div style={{ paddingBottom: 4 }}>
      <FilterSectionHeader
        label="Zones à risque industriel"
        sectionKey="risqueIndustriel"
        open={ouvert}
        onToggle={() => toggleSection('risqueIndustriel')}
        count={actif ? niveaux.length : 0}
        searchTerm={filterSearch}
      />

      {ouvert && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 14px 12px' }}>
          {/* ── 1. Ce que je vois ──────────────────────────────────────── */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={actif}
              onChange={(e) => setActif(e.target.checked)}
              style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
            />
            <span style={{ fontFamily: fInter, fontSize: 12, color: C.text }}>
              Afficher les sites classés
            </span>
          </label>

          {actif && compte && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ fontFamily: fMono, fontSize: 11, color: C.text }}>
                {formaterNombre(compte.rendus)} site{compte.rendus > 1 ? 's' : ''} dans la vue
                {compte.rendus !== compte.total && (
                  <span style={{ color: C.textDim }}> sur {formaterNombre(compte.total)}</span>
                )}
              </div>
              {partPprt !== null && (
                <>
                  <div style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>
                    {formaterNombre(compte.avecPprt)} avec un périmètre réglementaire
                  </div>
                  {/* La barre rend la proportion lisible sans lire le chiffre.
                      `--donnee-absente` pour le reste : ce n'est pas « peu »,
                      c'est « pas de donnée de l'État ». */}
                  <div
                    role="img"
                    aria-label={`${partPprt} % des sites de la vue ont un périmètre réglementaire`}
                    style={{
                      display: 'flex',
                      height: 4,
                      borderRadius: 2,
                      overflow: 'hidden',
                      background: 'var(--donnee-absente)',
                    }}
                  >
                    <span style={{ width: `${partPprt}%`, background: 'var(--brand-teal)' }} />
                  </div>
                  <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim }}>
                    {partPprt} % couverts par un PPRT
                  </div>
                </>
              )}
              {compte.rendus !== compte.total && (
                <div style={{ fontFamily: fInter, fontSize: 10, color: C.textDim, lineHeight: 1.4 }}>
                  Liste tronquée — les sites les moins graves sont coupés en
                  premier, jamais un Seveso. Zoomez pour les voir tous.
                </div>
              )}
            </div>
          )}

          {/* ── 2. Ce qui fait foi ─────────────────────────────────────────
              HORS du bloc `actif` à dessein : c'est une couche INDÉPENDANTE.
              On doit pouvoir afficher les périmètres réglementaires sans
              afficher les 99 152 points, et l'inverse. */}
          <CarteZone
            tirete={false}
            titre="Périmètre PPRT"
            sousTitre="Publié par l’État · opposable en urbanisme"
            actif={pprtActif}
            onToggle={setPprtActif}
            enfants={
              <>
                {/* L'indice qui évite une case cochée sans effet : sous ce
                    zoom, une zone de 2 km fait moins d'un pixel et la couche
                    ne demande RIEN. */}
                {pprtEtat?.sousLePlancher && (
                  <div
                    style={{
                      fontFamily: fInter,
                      fontSize: 10,
                      color: 'var(--warning)',
                      lineHeight: 1.4,
                    }}
                  >
                    Zoomez au niveau {PPRT_ZOOM_PLANCHER} pour voir les périmètres —
                    plus loin, une zone mesure moins d&apos;un pixel.
                  </div>
                )}

                <div style={{ fontFamily: fMono, fontSize: 10, color: C.textDim }}>
                  {pprtEtat && !pprtEtat.sousLePlancher
                    ? pprtEtat.rendus === pprtEtat.total
                      ? `${formaterNombre(pprtEtat.rendus)} périmètre${pprtEtat.rendus > 1 ? 's' : ''} dans la vue`
                      : `${formaterNombre(pprtEtat.rendus)} affichés sur ${formaterNombre(pprtEtat.total)} — les plus petits sont coupés`
                    : '664 périmètres · 87 départements sur 88'}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>Nature du périmètre</span>
                  <MultiDropdown
                    label="Toutes les natures"
                    items={TYPES_ZONE_PPRT.map((t) => ({
                      id: t,
                      label: LIBELLE_TYPE_ZONE_PPRT[t],
                    }))}
                    selected={pprtTypes}
                    onChange={setPprtTypes}
                  />
                </div>
              </>
            }
          />

          {/* ── 3. Ce que j'ajoute moi-même ────────────────────────────────
              Appelée « Zone de danger » jusqu'au 2026-09-18. Le mot affirmait
              une autorité que ce cercle n'a pas : il vaut ce que vaut le rayon
              choisi ici, et rien de plus. */}
          {actif && (
            <CarteZone
              tirete
              titre="Zone calculée"
              sousTitre="Rayon choisi ci-dessous · aucune valeur réglementaire"
              actif={rayonM > 0}
              onToggle={(v) => setRayonM(v ? 500 : 0)}
              enfants={
                <>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {RAYONS.filter((r) => r > 0).map((r) => (
                      <button
                        key={r}
                        onClick={() => setRayonM(r)}
                        aria-pressed={rayonM === r}
                        style={{
                          background: rayonM === r ? 'var(--brand-teal-10)' : 'transparent',
                          border: `0.5px solid ${rayonM === r ? 'var(--brand-teal)' : C.border}`,
                          color: rayonM === r ? 'var(--brand-teal)' : C.textSec,
                          borderRadius: 6,
                          padding: '4px 8px',
                          fontFamily: fMono,
                          fontSize: 10,
                          cursor: 'pointer',
                          transition:
                            'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out)',
                        }}
                      >
                        {r < 1000 ? `${r} m` : `${r / 1000} km`}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontFamily: fInter, fontSize: 10, color: C.textDim, lineHeight: 1.4 }}>
                    Calculé en mètres réels autour du point, dessiné en tireté
                    ({TIRETE_ZONE_CALCULEE.join('/')}). Ce n&apos;est pas le
                    périmètre réglementaire d&apos;un PPRT.
                  </div>
                </>
              }
            />
          )}

          {/* ── Réglages ────────────────────────────────────────────────── */}
          {actif && (
            <div style={{ borderTop: `0.5px solid ${C.border}`, paddingTop: 6 }}>
              <Repli
                titre="Filtrer les sites"
                indice={`${niveaux.length}/${NIVEAUX_RISQUE.length}`}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>Niveau réglementaire</span>
                  <MultiDropdown
                    label="Aucun niveau"
                    items={NIVEAUX_RISQUE.map((n) => ({ id: n.id, label: n.label }))}
                    selected={niveaux}
                    onChange={setNiveaux}
                  />
                  <span style={{ fontFamily: fInter, fontSize: 10, color: C.textDim }}>
                    1 327 sites Seveso en France sur 99 152 installations classées.
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>Type de risque</span>
                  <MultiDropdown
                    label="Tous les types"
                    items={ORDRE_TYPES.map((t) => ({ id: t, label: LIBELLE_TYPE[t] }))}
                    selected={typesRisque}
                    onChange={setTypesRisque}
                  />
                  {/* Les pastilles disent ce qui est retenu SANS ouvrir le
                      menu — et la couleur est celle que la carte peint. */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', marginTop: 2 }}>
                    {ORDRE_TYPES.map((t) => {
                      const retenu = typesRisque.length === 0 || typesRisque.includes(t);
                      return (
                        <span
                          key={t}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: retenu ? 1 : 0.35 }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: COULEURS_CSS[t],
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontFamily: fInter, fontSize: 10, color: C.textSec }}>
                            {LIBELLE_TYPE[t]}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={inclureInactifs}
                    onChange={(e) => setInclureInactifs(e.target.checked)}
                    style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
                  />
                  <span style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>
                    Inclure les sites à l&apos;arrêt
                  </span>
                </label>
              </Repli>

              <Repli titre="Affichage">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={afficherHalo}
                    onChange={(e) => setAfficherHalo(e.target.checked)}
                    style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
                  />
                  <span style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>
                    Halo autour des points
                  </span>
                </label>
                <span style={{ fontFamily: fInter, fontSize: 10, color: C.textDim, lineHeight: 1.4 }}>
                  Aide de lecture à faible zoom, où une zone de 500 m ferait
                  moins d&apos;un pixel. Ce n&apos;est pas une mesure.
                </span>
              </Repli>
            </div>
          )}

          <ProvenanceDesZones />
        </div>
      )}
    </div>
  );
}

/**
 * « D'où viennent ces zones ? » — le repli qui répond une fois pour toutes.
 *
 * Il vit ICI, dans le panneau, et pas sur une page d'aide séparée : c'est au
 * moment où l'on coche la couche que la question se pose, et la règle du
 * projet est que tout passe par /map et ses overlays. Une page qu'il faut
 * aller chercher n'est jamais lue par la personne qui en a besoin.
 *
 * Les chiffres sont ceux MESURÉS le 2026-09-18 sur la base complète, pas des
 * ordres de grandeur. Ils datent, et c'est pour ça que la date est écrite :
 * un taux de couverture sans date ne veut rien dire.
 */
function ProvenanceDesZones() {
  const [ouvert, setOuvert] = React.useState(false);

  const para: React.CSSProperties = {
    fontFamily: fInter,
    fontSize: 10,
    color: C.textDim,
    lineHeight: 1.5,
    margin: '0 0 6px',
  };
  const fort: React.CSSProperties = { color: C.textSec, fontWeight: 500 };

  return (
    <div style={{ marginTop: 2, borderTop: `0.5px solid ${C.border}`, paddingTop: 8 }}>
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: fInter,
          fontSize: 11,
          color: 'var(--brand-teal)',
          textAlign: 'left',
        }}
      >
        {ouvert ? '− ' : '+ '}D&apos;où viennent ces zones ?
      </button>

      {ouvert && (
        <div style={{ marginTop: 6 }}>
          <p style={para}>
            <strong style={fort}>L&apos;État ne publie pas de « rayon de risque » par site.</strong>{' '}
            Il produit une cascade : les zones d&apos;effets de l&apos;étude de
            dangers (seuils SEI, SEL, SELS), puis l&apos;aléa du PPRT en sept
            niveaux, puis le zonage réglementaire (rouge, bleu, gris), puis
            l&apos;enveloppe du périmètre.
          </p>
          <p style={para}>
            <strong style={fort}>Seule la dernière est exploitable nationalement.</strong>{' '}
            Les zones d&apos;effets ne sortent d&apos;aucune API. Le zonage
            rouge/bleu n&apos;existe qu&apos;en image (WMS Géorisques) ou
            éparpillé, un jeu par DDT. L&apos;enveloppe, elle, est un flux
            unique : 664 périmètres de servitude PM3, Géoplateforme IGN.
          </p>
          <p style={para}>
            <strong style={fort}>Le PPRT ne concerne que le seuil haut.</strong>{' '}
            Mesuré le 18/09/2026 : 79 % des 717 sites Seveso seuil haut ont un
            périmètre, contre 20 % des 610 sites seuil bas — qui n&apos;y sont
            pas soumis. 137 sites seuil haut n&apos;en ont aucun de publié :
            c&apos;est un vrai manque, pas une règle.
          </p>
          <p style={{ ...para, margin: 0 }}>
            <strong style={fort}>Comment les distinguer à l&apos;écran :</strong>{' '}
            trait plein = périmètre publié par l&apos;État, opposable. Trait
            tireté = zone que MAGELIAN calcule à partir du rayon choisi
            ci-dessus, sans valeur réglementaire.
          </p>
        </div>
      )}
    </div>
  );
}
