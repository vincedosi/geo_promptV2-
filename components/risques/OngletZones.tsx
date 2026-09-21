'use client';

/**
 * L'onglet « Zones » : l'atelier qui transforme un profil de rayons en JEU DE
 * ZONES réutilisable.
 *
 * ── CE QU'IL REMPLACE, ET POURQUOI ────────────────────────────────────────
 *
 * Il prend la place de l'onglet « Diffusion », qui confrontait une campagne à
 * l'exposition. C'était le travail de Campagne > Suivi, fait à un deuxième
 * endroit : le module de risque produit désormais un OBJET, et la campagne le
 * reçoit comme plan.
 *
 * ── LE POINT DUR DU PRODUIT ───────────────────────────────────────────────
 *
 * Le DSP achète au CODE POSTAL, le risque se mesure au carreau de 200 m. Un
 * cercle d'un kilomètre est bien plus petit qu'un code postal : acheter le
 * code postal entier, c'est payer pour des habitants qu'on ne visait pas.
 *
 * Le bloc « Dilution » dit ce que cela coûte, en clair et en chiffres :
 * population VISÉE contre population ACHETÉE, et leur rapport. Mesuré sur le
 * profil par défaut — au seuil de 20 % : 1 113 codes postaux, 75,9 % d'utile ;
 * au seuil de 35 % : 939 codes postaux, 88,4 %. Le curseur ne décide pas d'un
 * réglage cosmétique, il décide de ce qu'on paie.
 *
 * ── POURQUOI CONSTRUIRE EST UN GESTE EXPLICITE ────────────────────────────
 *
 * 21,3 s. Un écran qui le déclencherait à chaque anneau déplacé passerait son
 * temps à calculer des profils que personne ne regarde. On règle dans l'onglet
 * « Rayons », on vient ici quand on a décidé.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Copy, Trash2, FolderOpen, Layers, Download } from 'lucide-react';
import { formaterNombre, formaterDecimal } from '@/lib/format/nombre';
import { fInter, fMono } from '@/lib/design/polices';
import { Kpi } from '@/components/risques/Kpi';
import { COULEUR_NIVEAU_CSS } from '@/lib/carte/palette-zones-risque';
import { libelleClasse, anneauxParNiveau } from '@/lib/risques/libelle-classe';
import { libelleRayon, type Niveau, type ProfilRayons } from '@/lib/risques/profil';
import {
  useJeuxZones, type ClasseJeu, type JeuResume,
} from '@/components/risques/use-jeux-zones';
import { usePiste } from '@/components/risques/ContexteChargement';
import {
  POIDS_MIN, POIDS_MAX, MODES_PLAN, type JeuDeZones,
} from '@/lib/zones/jeu';

interface Props {
  profil: ProfilRayons;
  onProfil: (p: ProfilRayons) => void;
  cible: string;
  libelleCible: string;
  gravites: string[];
  natures: string[];
  /** Code de département du fil d'Ariane, ou `null` pour la France entière. */
  territoire: string | null;
  /** Jeu ouvert, relayé à l'URL pour qu'un lien partagé rouvre le même. */
  jeuOuvert: string | null;
  onJeuOuvert: (id: string | null) => void;
  /**
   * Ferme l'overlay. La carte est DERRIÈRE : recadrer sans découvrir la carte
   * produirait un bouton dont l'effet est invisible, ce qui se lit comme un
   * bouton cassé.
   */
  onFermer: () => void;
}

/**
 * Trois grappes industrielles denses, pour VOIR ce qu'une vue France entière
 * ne montre jamais : des zones qui se superposent.
 *
 * ⚠ À l'échelle nationale, une zone de 2 km fait **moins d'un pixel** — c'est
 * le même constat qui a donné son plancher de zoom à la couche PPRT. Un
 * atelier qui n'ouvre que sur la France ne laisse jamais voir son objet.
 *
 * Densité mesurée le 2026-09-20, sites Seveso haut / bas dans chaque cadre :
 * Fos 41/14, Le Havre 22/12, vallée de la chimie 17/8.
 */
const ZOOMS_REFERENCE: Array<{
  nom: string;
  aide: string;
  bbox: [number, number, number, number];
}> = [
  {
    nom: 'Vallée de la chimie',
    aide: 'Lyon sud — 17 sites de seuil haut',
    bbox: [4.75, 45.6, 5.05, 45.75],
  },
  {
    nom: 'Estuaire de la Seine',
    aide: 'Le Havre — 22 sites de seuil haut',
    bbox: [0.05, 49.4, 0.55, 49.55],
  },
  {
    nom: 'Étang de Berre',
    aide: 'Fos-sur-Mer — 41 sites de seuil haut',
    bbox: [4.75, 43.35, 5.3, 43.6],
  },
];

/**
 * Les rayons que le comparateur propose.
 *
 * Quatre valeurs rondes qui couvrent l'éventail réel des périmètres PPRT —
 * mesuré sur les 664 périmètres : rayon équivalent médian 286 m, moyenne
 * 532 m, troisième quartile 654 m, maximum 12,3 km. 500 m encadre la médiane,
 * 5 km la longue traîne.
 */
const RAYONS_CANDIDATS = [500, 1000, 2000, 5000] as const;

/** Le libellé du mode de plan, et ce qu'il engage. */
const LIBELLE_MODE: Record<(typeof MODES_PLAN)[number], { titre: string; aide: string }> = {
  pondere: {
    titre: 'Pondéré',
    aide: 'Toute la France reçoit du budget, les zones en reçoivent davantage. '
      + 'Le hors-zone garde un poids de 1.',
  },
  exclusif: {
    titre: 'Exclusif',
    aide: 'Zéro impression hors des zones retenues. La campagne ne diffuse que '
      + 'sur les codes postaux du jeu.',
  },
};

/** La teinte d'une classe, d'après son niveau. */
function couleurDeClasse(classe: string): string {
  if (classe === 'hors') return 'var(--donnee-absente)';
  const niveau = classe.split(':')[0] as Niveau;
  return COULEUR_NIVEAU_CSS[niveau] ?? 'var(--donnee-absente)';
}

export function OngletZones({
  profil, onProfil, cible, libelleCible, gravites, natures, territoire,
  jeuOuvert, onJeuOuvert, onFermer,
}: Props) {
  const atelier = useJeuxZones();
  const [nom, setNom] = useState('');
  const [description, setDescription] = useState('');
  const [enCoursId, setEnCoursId] = useState<string | null>(null);

  const anneauxPar = useMemo(() => anneauxParNiveau(profil), [profil]);

  /** Le jeu, sous la forme que l'API attend. */
  const jeuCourant = useMemo((): JeuDeZones => ({
    profil,
    cible,
    gravites,
    natures,
    modes: ['buffer', 'pprt'],
    territoire,
    mode_plan: (atelier.detail?.jeu.mode_plan as 'pondere' | 'exclusif') ?? 'pondere',
    seuil_couverture_cp: atelier.detail?.jeu.seuil_couverture_cp ?? 20,
    poids: atelier.detail?.jeu.poids ?? {},
  }), [profil, cible, gravites, natures, territoire, atelier.detail]);

  const construire = useCallback(() => {
    void atelier.construire(jeuCourant);
  }, [atelier, jeuCourant]);

  const ouvrir = useCallback((id: string) => {
    onJeuOuvert(id);
    void atelier.ouvrir(id);
  }, [atelier, onJeuOuvert]);

  /*
   * Un jeu nommé dans l'URL s'ouvre TOUT SEUL.
   *
   * C'est ce qui rend le lien partageable, et ce qui fait fonctionner l'entrée
   * « Jeux de zones à risque » du rail : elle pose l'identifiant dans l'adresse
   * et monte l'overlay. Sans cet effet, l'atelier s'ouvrait sur son état vide
   * alors que l'adresse désignait un jeu précis — un lien qui mène au bon
   * écran et n'y montre rien.
   *
   * ⚠ La garde est le JEU DÉJÀ CHARGÉ, pas un drapeau « première fois » : sans
   * elle, chaque réponse relancerait le chargement, indéfiniment.
   */
  useEffect(() => {
    if (!jeuOuvert || atelier.detail?.jeu.id === jeuOuvert) return;
    if (atelier.etat === 'chargement') return;
    void atelier.ouvrir(jeuOuvert);
    // `atelier` est reconstruit à chaque rendu : le mettre en dépendance
    // relancerait la lecture en boucle. Seuls l'identifiant demandé, celui
    // déjà chargé et l'état comptent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jeuOuvert, atelier.detail?.jeu.id, atelier.etat]);

  const detail = atelier.detail;
  const jeu = detail?.jeu;

  /*
   * Les deux populations du taux d'utile, recalculées à l'affichage depuis les
   * classes plutôt que lues dans l'en-tête : les trois chiffres viennent alors
   * du MÊME instantané. L'en-tête est écrit par une autre requête, et pendant
   * les quelques dizaines de millisecondes qui les séparent l'écran
   * afficherait un total qui ne serait pas la somme de ses lignes.
   */
  const visee = useMemo(
    () => (detail?.classes ?? []).reduce((t, c) => t + c.population_en_zone, 0),
    [detail],
  );
  const achetee = useMemo(
    () => (detail?.classes ?? []).reduce((t, c) => t + c.population_achetee, 0),
    [detail],
  );
  const retenus = useMemo(
    () => (detail?.classes ?? []).reduce((t, c) => t + c.n_cp_retenus, 0),
    [detail],
  );
  const tauxUtile = achetee > 0 ? (100 * visee) / achetee : null;

  /*
   * La construction d'un jeu de zones : **21,3 s** mesurées pour 7 classes et
   * 1 942 codes postaux sur la France. C'est le plus long geste du module, et
   * le seul dont l'attente était signalée uniquement dans ce panneau — invisible
   * dès qu'on regardait la carte.
   */
  usePiste('jeu-de-zones', 'Construction du jeu de zones…', atelier.etat === 'chargement');

  return (
    /*
     * ── CE COMPOSANT N'EST PLUS QU'UN PANNEAU ──────────────────────────
     *
     * Il portait sa propre carte à gauche et ses réglages à droite. La carte
     * a été remontée au niveau de l'overlay le 2026-09-21 : elle est commune
     * aux quatre étapes, et une seule instance MapLibre vit désormais pour
     * tout l'écran (`CarteRisque`, ex-`CarteZones`). Ce qui reste ici est la
     * COMMANDE de l'étape ④, et le panneau est à gauche de cette carte.
     */
    <>
      <div
        style={{
          overflowY: 'auto', padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 18,
        }}
      >
        {/*
          ⚠ Ce conseil vivait SUR la carte. Il y serait désormais affiché aux
          quatre étapes, dont trois où l'on ne construit aucun jeu — et le
          bouton qui l'exécute est juste dessous.
        */}
        {atelier.etat !== 'pret' && (
          <p style={{ margin: 0, fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
            Les zones affichées sur la carte sont celles du profil courant.
            Construisez le jeu pour en tirer des codes postaux.
          </p>
        )}

        <Comparateur profil={profil} onProfil={onProfil} />

        <Section titre="Le jeu de zones">
          {atelier.etat === 'vide' && <EtatAtelierVide onConstruire={construire} />}

          {atelier.etat === 'chargement' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 2px' }}>
              <Loader2 size={15} className="animate-spin" style={{ color: 'var(--brand-teal)' }} />
              <span style={{ fontFamily: fInter, fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Construction des zones et rattachement aux codes postaux.
                Compter une vingtaine de secondes sur la France entière.
              </span>
            </div>
          )}

          {atelier.etat === 'echec' && (
            <Alerte>{atelier.erreur ?? 'La construction du jeu de zones a échoué.'}</Alerte>
          )}

          {atelier.etat === 'pret' && jeu && detail && (
            <>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14 }}>
                <Kpi
                  valeur={formaterNombre(Math.round(visee))}
                  libelle="Population visée"
                  note="habitants en zone"
                  taille={22}
                />
                <Kpi
                  valeur={tauxUtile === null ? '—' : `${formaterDecimal(tauxUtile)} %`}
                  libelle="Taux d’utile"
                  note="visée / achetée"
                  accent
                  taille={22}
                />
                <Kpi
                  valeur={formaterNombre(retenus)}
                  libelle="Codes postaux"
                  note={`sur ${formaterNombre(detail.classes.reduce((t, c) => t + c.n_cp, 0))} touchés`}
                  taille={22}
                />
              </div>

              <Dilution
                seuil={Number(jeu.seuil_couverture_cp)}
                onSeuil={(v) => void atelier.regler({ seuil_couverture_cp: v })}
                visee={visee}
                achetee={achetee}
              />

              <TableauClasses
                classes={detail.classes}
                poids={jeu.poids ?? {}}
                anneauxPar={anneauxPar}
                onPoids={(classe, valeur) => void atelier.regler({
                  poids: { ...(jeu.poids ?? {}), [classe]: valeur },
                })}
              />

              <ModePlan
                mode={(jeu.mode_plan as 'pondere' | 'exclusif') ?? 'pondere'}
                onMode={(m) => void atelier.regler({ mode_plan: m })}
              />

              <Actions
                brouillon={jeu.brouillon}
                nom={jeu.brouillon ? nom : jeu.nom}
                description={jeu.brouillon ? description : (jeu.description ?? '')}
                onNom={setNom}
                onDescription={setDescription}
                onEnregistrer={async () => {
                  const ok = await atelier.regler({
                    nom: jeu.brouillon ? nom : undefined,
                    description: jeu.brouillon ? (description || null) : undefined,
                    enregistrer: true,
                  });
                  if (ok) { setNom(''); setDescription(''); }
                }}
                onDupliquer={construire}
                idPourExport={jeu.brouillon ? null : jeu.id}
                erreur={atelier.erreur}
              />
            </>
          )}
        </Section>

        <Section titre="Jeux enregistrés">
          <Bibliotheque
            jeux={atelier.bibliotheque}
            etat={atelier.etatBibliotheque}
            ouvert={jeuOuvert}
            enCoursId={enCoursId}
            onOuvrir={ouvrir}
            onSupprimer={async (id) => {
              setEnCoursId(id);
              await atelier.supprimer(id);
              setEnCoursId(null);
              if (jeuOuvert === id) onJeuOuvert(null);
            }}
          />
        </Section>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Le comparateur de rayons
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Quatre rayons candidats, à adopter d'un clic.
 *
 * ⚠ Il ne LANCE aucun calcul. Comparer quatre rayons par la population qu'ils
 * exposent demanderait quatre constructions de 21 s, soit une minute et demie
 * pour un écran de choix. Les chiffres d'exposition vivent dans l'onglet
 * « Rayons », qui les calcule déjà anneau par anneau ; ici on choisit un point
 * de départ, on ne mesure pas.
 */
function Comparateur({ profil, onProfil }: {
  profil: ProfilRayons;
  onProfil: (p: ProfilRayons) => void;
}) {
  const actuel = profil.haut;
  return (
    <Section titre="Partir d’un rayon">
      {/*
        Quatre pastilles et non quatre cartes : la CARTE montre désormais ce
        que chaque rayon recouvre, et répéter l'information en vignettes
        prenait la moitié de l'écran pour dire moins bien.
      */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {RAYONS_CANDIDATS.map((r) => {
          const actif = actuel.length === 1 && actuel[0] === r;
          return (
            <button
              key={r}
              type="button"
              onClick={() => onProfil({ ...profil, haut: [r], bas: [r] })}
              aria-pressed={actif}
              style={{
                padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                fontFamily: fMono, fontSize: 12,
                background: actif ? 'var(--brand-teal-10)' : 'transparent',
                border: `0.5px solid ${actif ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
                color: actif ? 'var(--brand-teal)' : 'var(--text-secondary)',
              }}
            >
              {libelleRayon(r)}
            </button>
          );
        })}
      </div>
      <p style={{ margin: '8px 0 0', fontFamily: fInter, fontSize: 10.5, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
        Remplace le profil par un anneau unique, sur les deux seuils. Les
        anneaux multiples se règlent dans le tiroir de la barre, qui chiffre ce
        que chacun ajoute.
      </p>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   La dilution au code postal
   ══════════════════════════════════════════════════════════════════════════ */

function Dilution({ seuil, onSeuil, visee, achetee }: {
  seuil: number;
  onSeuil: (s: number) => void;
  visee: number;
  achetee: number;
}) {
  const [local, setLocal] = useState(seuil);
  // Le curseur suit le doigt, la base ne bouge qu'au relâchement : rejouer le
  // seuil coûte 22 ms en base mais une requête par pixel parcouru n'apprend
  // rien de plus que la dernière.
  React.useEffect(() => { setLocal(seuil); }, [seuil]);

  const gaspille = Math.max(0, achetee - visee);
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 8,
        background: 'var(--bg-level-2)',
        border: '0.5px solid var(--border-subtle)',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          Dilution au code postal
        </span>
        <span style={{ fontFamily: fMono, fontSize: 12, color: 'var(--brand-teal)' }}>
          seuil {local} %
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={60}
        step={5}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => onSeuil(local)}
        onTouchEnd={() => onSeuil(local)}
        onKeyUp={() => onSeuil(local)}
        aria-label="Part minimale de la population du code postal en zone"
        style={{ width: '100%', accentColor: 'var(--brand-teal)' }}
      />
      <p style={{ margin: '8px 0 0', fontFamily: fInter, fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Un code postal n’est retenu que si au moins <strong>{local} %</strong> de sa
        population vit en zone. En deçà, on achète surtout des habitants hors cible ;
        au-delà, le plan se vide des campagnes, où un site isolé ne couvre jamais une
        telle part de son code postal.
      </p>
      {achetee > 0 && (
        <p style={{ margin: '6px 0 0', fontFamily: fInter, fontSize: 11.5, color: 'var(--text-secondary)' }}>
          À ce réglage, la campagne achèterait{' '}
          <span style={{ fontFamily: fMono, color: 'var(--text-primary)' }}>
            {formaterNombre(Math.round(gaspille))}
          </span>{' '}
          habitants situés hors des zones, soit{' '}
          <span style={{ fontFamily: fMono, color: 'var(--text-primary)' }}>
            {formaterDecimal((100 * gaspille) / achetee)} %
          </span>{' '}
          de ce qu’elle paie.
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Les classes et leurs poids
   ══════════════════════════════════════════════════════════════════════════ */

function TableauClasses({ classes, poids, anneauxPar, onPoids }: {
  classes: ClasseJeu[];
  poids: Record<string, number>;
  anneauxPar: Record<Niveau, number[]>;
  onPoids: (classe: string, valeur: number) => void;
}) {
  if (classes.length === 0) {
    return <Alerte>Ce jeu ne retient aucune classe. Élargissez les anneaux ou le territoire.</Alerte>;
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fInter, fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
            <th style={thStyle('left')}>Classe</th>
            <th style={thStyle()}>Population en zone</th>
            <th style={thStyle()}>Codes postaux retenus</th>
            <th style={thStyle()} title="Multiplicateur d’enchère appliqué au plan">
              Poids
            </th>
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => (
            <tr key={c.classe} style={{ borderBottom: '0.5px solid var(--border-subtle)' }}>
              <td style={{ padding: '7px 8px' }}>
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                    background: couleurDeClasse(c.classe), marginRight: 8,
                  }}
                />
                {libelleClasse(c.classe, anneauxPar)}
              </td>
              <td style={tdStyle}>{formaterNombre(Math.round(c.population_en_zone))}</td>
              <td style={tdStyle}>
                {formaterNombre(c.n_cp_retenus)}
                <span style={{ color: 'var(--text-tertiary)' }}> / {formaterNombre(c.n_cp)}</span>
              </td>
              <td style={{ ...tdStyle, width: 90 }}>
                <input
                  type="number"
                  min={POIDS_MIN}
                  max={POIDS_MAX}
                  step={0.1}
                  defaultValue={poids[c.classe] ?? 1}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= POIDS_MIN && v <= POIDS_MAX) onPoids(c.classe, v);
                  }}
                  aria-label={`Poids de ${libelleClasse(c.classe, anneauxPar)}`}
                  style={{
                    width: 64, textAlign: 'right', padding: '4px 6px', borderRadius: 4,
                    fontFamily: fMono, fontSize: 12,
                    background: 'var(--bg-level-2)',
                    border: '0.5px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: '8px 0 0', fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>
        Le poids est un multiplicateur d’enchère, de {POIDS_MIN} à {POIDS_MAX}. Il ne
        change ni la géométrie ni les codes postaux retenus : il décide de la part de
        budget que chaque classe reçoit.
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Mode de plan, actions, bibliothèque
   ══════════════════════════════════════════════════════════════════════════ */

function ModePlan({ mode, onMode }: {
  mode: 'pondere' | 'exclusif';
  onMode: (m: 'pondere' | 'exclusif') => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
      {MODES_PLAN.map((m) => {
        const actif = m === mode;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onMode(m)}
            aria-pressed={actif}
            style={{
              flex: '1 1 240px', textAlign: 'left', padding: '10px 12px', borderRadius: 8,
              cursor: 'pointer', fontFamily: fInter,
              background: actif ? 'var(--brand-teal-10)' : 'transparent',
              border: `0.5px solid ${actif ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 3 }}>
              {LIBELLE_MODE[m].titre}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {LIBELLE_MODE[m].aide}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Actions({
  brouillon, nom, description, onNom, onDescription, onEnregistrer, onDupliquer,
  idPourExport, erreur,
}: {
  brouillon: boolean;
  nom: string;
  description: string;
  onNom: (v: string) => void;
  onDescription: (v: string) => void;
  onEnregistrer: () => void;
  onDupliquer: () => void;
  /** `null` tant que le jeu est un brouillon : on n'exporte pas un sans-nom. */
  idPourExport: string | null;
  erreur: string | null;
}) {
  const [enCours, setEnCours] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {brouillon && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            value={nom}
            onChange={(e) => onNom(e.target.value)}
            placeholder="Nom du jeu de zones"
            aria-label="Nom du jeu de zones"
            style={{ ...styleSaisie, flex: '1 1 220px' }}
          />
          <input
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            placeholder="À quoi sert ce jeu (facultatif)"
            aria-label="Description du jeu de zones"
            style={{ ...styleSaisie, flex: '2 1 280px' }}
          />
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {brouillon && (
          <button
            type="button"
            disabled={!nom.trim() || enCours}
            onClick={async () => { setEnCours(true); await onEnregistrer(); setEnCours(false); }}
            style={{
              ...styleBoutonTeal,
              opacity: !nom.trim() || enCours ? 0.5 : 1,
              cursor: !nom.trim() || enCours ? 'not-allowed' : 'pointer',
            }}
          >
            {enCours ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Enregistrer le jeu
          </button>
        )}
        <button type="button" onClick={onDupliquer} style={styleBoutonNeutre}>
          <Copy size={13} />
          {brouillon ? 'Reconstruire' : 'Dupliquer depuis le profil courant'}
        </button>
        {idPourExport && (
          /* Un lien et non un `fetch` : le navigateur gère le téléchargement,
             son nom de fichier et sa reprise. Un `fetch` obligerait à monter
             le classeur entier en mémoire avant de le re-télécharger. */
          <a
            href={`/api/zones/jeux/${idPourExport}/export`}
            style={{ ...styleBoutonNeutre, textDecoration: 'none' }}
          >
            <Download size={13} />
            Exporter (Excel)
          </a>
        )}
      </div>
      {erreur && <Alerte>{erreur}</Alerte>}
    </div>
  );
}

function Bibliotheque({ jeux, etat, ouvert, enCoursId, onOuvrir, onSupprimer }: {
  jeux: JeuResume[];
  etat: 'vide' | 'chargement' | 'echec' | 'pret';
  ouvert: string | null;
  enCoursId: string | null;
  onOuvrir: (id: string) => void;
  onSupprimer: (id: string) => void;
}) {
  if (etat === 'chargement') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 2px' }}>
        <Loader2 size={13} className="animate-spin" style={{ color: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}>
          Lecture de la bibliothèque…
        </span>
      </div>
    );
  }
  if (etat === 'echec') return <Alerte>La bibliothèque des jeux de zones est indisponible.</Alerte>;
  if (jeux.length === 0) {
    return (
      <p style={{ margin: 0, fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}>
        Aucun jeu enregistré. Construisez-en un ci-dessus, donnez-lui un nom, et il
        apparaîtra ici — prêt à devenir le plan d’une campagne.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {jeux.map((j) => (
        <li
          key={j.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
            borderRadius: 8,
            background: ouvert === j.id ? 'var(--brand-teal-10)' : 'var(--bg-level-2)',
            border: `0.5px solid ${ouvert === j.id ? 'var(--brand-teal)' : 'var(--border-subtle)'}`,
          }}
        >
          <Layers size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)' }}>
              {j.nom}
              <span style={{ fontFamily: fMono, fontSize: 10.5, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                v{j.version}
              </span>
            </div>
            <div style={{ fontFamily: fMono, fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {j.n_cp_retenus === null ? '—' : formaterNombre(j.n_cp_retenus)} codes postaux
              {j.taux_utile !== null && ` · ${formaterDecimal(Number(j.taux_utile))} % d’utile`}
              {` · seuil ${Number(j.seuil_couverture_cp)} %`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOuvrir(j.id)}
            title="Ouvrir ce jeu dans l’atelier"
            style={styleBoutonIcone}
          >
            <FolderOpen size={13} />
          </button>
          <button
            type="button"
            onClick={() => onSupprimer(j.id)}
            disabled={enCoursId === j.id}
            title="Supprimer ce jeu"
            style={{ ...styleBoutonIcone, color: 'var(--danger)' }}
          >
            {enCoursId === j.id
              ? <Loader2 size={13} className="animate-spin" />
              : <Trash2 size={13} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Petits éléments
   ══════════════════════════════════════════════════════════════════════════ */

function EtatAtelierVide({ onConstruire }: { onConstruire: () => void }) {
  return (
    <div style={{ padding: '6px 2px' }}>
      <p style={{ margin: '0 0 12px', fontFamily: fInter, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 620 }}>
        Un jeu de zones fige le profil de rayons courant en objet réutilisable : ses
        classes, leurs poids, et les codes postaux qu’elles retiennent. C’est ce qu’une
        campagne reçoit comme plan géographique.
      </p>
      <button type="button" onClick={onConstruire} style={styleBoutonTeal}>
        <Layers size={13} />
        Construire les zones du profil courant
      </button>
      <p style={{ margin: '10px 0 0', fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>
        Une vingtaine de secondes sur la France entière. Le résultat est mémorisé :
        revenir au même profil ne relance aucun calcul.
      </p>
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', marginBottom: 12,
          background: 'var(--bg-level-2)',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <h3 style={{ margin: 0, fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          {titre}
        </h3>
      </div>
      <div style={{ padding: '0 2px' }}>{children}</div>
    </section>
  );
}

function Alerte({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      style={{
        margin: 0, padding: '8px 12px', borderRadius: 6,
        fontFamily: fInter, fontSize: 12, lineHeight: 1.5,
        background: 'rgba(255,87,87,0.1)',
        border: '0.5px solid rgba(255,87,87,0.2)',
        color: 'var(--danger)',
      }}
    >
      {children}
    </p>
  );
}

const thStyle = (align: 'left' | 'right' = 'right'): React.CSSProperties => ({
  padding: '6px 8px', textAlign: align, fontWeight: 400, fontSize: 11,
  color: 'var(--text-tertiary)',
});

const tdStyle: React.CSSProperties = {
  padding: '7px 8px', textAlign: 'right', fontFamily: fMono, fontSize: 12,
  color: 'var(--text-secondary)',
};

const styleSaisie: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6, fontFamily: fInter, fontSize: 13,
  background: 'var(--bg-level-2)',
  border: '0.5px solid var(--border-subtle)',
  color: 'var(--text-primary)',
};

const styleBoutonTeal: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
  fontFamily: fInter, fontSize: 12, fontWeight: 500,
  background: 'transparent',
  border: '0.5px solid var(--brand-teal)',
  color: 'var(--brand-teal)',
};

const styleBoutonNeutre: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
  fontFamily: fInter, fontSize: 12,
  background: 'transparent',
  border: '0.5px solid var(--border-default)',
  color: 'var(--text-secondary)',
};

const styleBoutonIcone: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, borderRadius: 6, cursor: 'pointer', flexShrink: 0,
  background: 'transparent',
  border: '0.5px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
};
