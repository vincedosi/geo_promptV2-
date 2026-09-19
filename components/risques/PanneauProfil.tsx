'use client';

/**
 * Le panneau de réglage du profil de rayons — une ligne par niveau.
 *
 * ── CE QU'IL REMPLACE ─────────────────────────────────────────────────────
 *
 * Un champ de rayon UNIQUE, appliqué à tous les niveaux, qui relançait un
 * calcul de plusieurs secondes à chaque frappe. Deux défauts distincts :
 * l'attente, et l'impossibilité d'exprimer ce que le produit sert à faire —
 * du bidding DIFFÉRENCIÉ entre seuil haut et seuil bas.
 *
 * Ici chaque niveau porte ses propres anneaux, et rien ne part vers le serveur
 * tant que l'utilisateur n'a pas fini : le profil complet voyage en une fois.
 *
 * ── POURQUOI DES CHIPS ET PAS DES CHAMPS NUMÉRIQUES ──────────────────────
 *
 * Un anneau est une valeur parmi quelques-unes qu'on relit sans cesse
 * (500 m, 1, 2, 5 km). Des champs alignés obligeraient à lire quatre nombres
 * pour savoir combien d'anneaux existent ; des chips le montrent d'un coup
 * d'œil, et leur ordre EST l'ordre des bandes.
 */
import React, { useState } from 'react';
import { Lock, Unlock, X, Plus } from 'lucide-react';
import {
  anneauxDuNiveau, normaliserProfil, LIBELLE_NIVEAU, NIVEAUX,
  ANNEAUX_MAX, RAYON_MIN_M, RAYON_MAX_M, libelleRayon,
  type Niveau, type ProfilRayons,
} from '@/lib/risques/profil';
import { fInter, fMono } from '@/lib/design/polices';

/** Les paliers que les plans de prévention emploient couramment. */
const PRESETS = [500, 1000, 2000, 5000] as const;

interface Props {
  profil: ProfilRayons;
  onProfil: (p: ProfilRayons) => void;
  /** Population par classe, pour afficher ce que chaque anneau apporte. */
  parClasse?: Record<string, number>;
}

export function PanneauProfil({ profil, onProfil, parClasse }: Props) {
  const [erreur, setErreur] = useState<string | null>(null);

  /**
   * Applique une modification et NORMALISE.
   *
   * Passer par `normaliserProfil` à chaque geste, et non seulement à l'envoi,
   * garantit que l'écran montre exactement l'objet qui servira au calcul : tri,
   * dédoublonnage et liaison appliqués. Sans cela, l'utilisateur verrait
   * « 2 km · 1 km » pendant que le serveur calcule « 1 km · 2 km ».
   */
  const appliquer = (brut: Partial<ProfilRayons>) => {
    try {
      onProfil(normaliserProfil({ ...profil, ...brut }));
      setErreur(null);
    } catch {
      // Le seul cas atteignable ici est le dépassement de quatre anneaux, les
      // bornes étant déjà filtrées à la saisie. Message explicite plutôt qu'un
      // geste sans effet, qui se lit comme un bouton cassé.
      setErreur(`Quatre anneaux au maximum par niveau.`);
    }
  };

  const retirer = (niveau: Niveau, r: number) =>
    appliquer({ [niveau]: anneauxDuNiveau(profil, niveau).filter((x) => x !== r) });

  const ajouter = (niveau: Niveau, r: number) => {
    const actuels = anneauxDuNiveau(profil, niveau);
    if (actuels.includes(r)) return;
    if (actuels.length >= ANNEAUX_MAX) {
      setErreur(`Quatre anneaux au maximum par niveau. Retirez-en un d’abord.`);
      return;
    }
    appliquer({ [niveau]: [...actuels, r] });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Bandeau titre="Anneaux par niveau" />

      {NIVEAUX.map((niveau) => {
        const anneaux = anneauxDuNiveau(profil, niveau);
        /*
         * « Autres régimes » est DÉSACTIVÉ avec sa raison écrite, jamais absent.
         * 97 825 sites contre 1 327 Seveso, pour un garde-fou de calcul à
         * 3 000 : l'étendre est un chantier, pas une case à cocher. Le masquer
         * laisserait croire à un oubli.
         */
        const inactif = niveau === 'autres';
        return (
          <div
            key={niveau}
            style={{
              opacity: inactif ? 0.45 : 1,
              display: 'flex', flexDirection: 'column', gap: 6,
              padding: '8px 10px',
              background: 'var(--bg-level-1)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                {LIBELLE_NIVEAU[niveau]}
              </span>
              {niveau === 'haut' && (
                <button
                  type="button"
                  onClick={() => appliquer({ lie: !profil.lie })}
                  title={profil.lie
                    ? 'Les niveaux partagent les mêmes anneaux. Cliquez pour leur en donner de propres.'
                    : 'Donner à tous les niveaux les anneaux du seuil haut, pour comparer à périmètre égal.'}
                  aria-pressed={profil.lie}
                  style={{
                    marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: 'none', border: 0, cursor: 'pointer', padding: 0,
                    fontFamily: fInter, fontSize: 11,
                    color: profil.lie ? 'var(--brand-teal)' : 'var(--text-tertiary)',
                  }}
                >
                  {profil.lie ? <Lock size={12} /> : <Unlock size={12} />}
                  {profil.lie ? 'liés' : 'lier'}
                </button>
              )}
            </div>

            {inactif ? (
              <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', margin: 0 }}>
                Non calculé : 97 825 sites relèvent des autres régimes, contre 1 327 Seveso.
                Le pré-calcul les exclut pour l’instant.
              </p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {anneaux.length === 0 && (
                    <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--warning)' }}>
                      Aucun anneau : ce niveau ne classe aucun habitant.
                    </span>
                  )}
                  {anneaux.map((r, i) => {
                    const pop = parClasse?.[`${niveau}:${i + 1}`];
                    return (
                      <span
                        key={r}
                        title={pop === undefined
                          ? undefined
                          : `Bande ${i + 1} : ${new Intl.NumberFormat('fr-FR').format(pop)} habitants`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          background: 'var(--bg-level-3)',
                          border: '0.5px solid var(--border-default)',
                          borderRadius: 4, padding: '2px 4px 2px 8px',
                          fontFamily: fMono, fontSize: 11, color: 'var(--text-primary)',
                        }}
                      >
                        {libelleRayon(r)}
                        <button
                          type="button"
                          onClick={() => retirer(niveau, r)}
                          aria-label={`Retirer l’anneau de ${libelleRayon(r)}`}
                          style={{
                            display: 'inline-flex', background: 'none', border: 0,
                            cursor: 'pointer', padding: 2, color: 'var(--text-tertiary)',
                          }}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {PRESETS.filter((r) => !anneaux.includes(r)).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => ajouter(niveau, r)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        background: 'transparent',
                        border: '0.5px dashed var(--border-default)',
                        borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
                        fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)',
                      }}
                    >
                      <Plus size={9} />
                      {libelleRayon(r)}
                    </button>
                  ))}
                  <SaisieRayon onAjouter={(r) => ajouter(niveau, r)} />
                </div>
              </>
            )}
          </div>
        );
      })}

      <label
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)',
        }}
      >
        <input
          type="checkbox"
          checked={profil.inclurePPRT}
          onChange={(e) => appliquer({ inclurePPRT: e.target.checked })}
        />
        Distinguer les périmètres PPRT
      </label>
      <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', margin: 0, lineHeight: 1.5 }}>
        {profil.inclurePPRT
          ? 'Un carreau couvert par une servitude publiée par l’État forme une classe à part, avant toute bande calculée — y compris au-delà du dernier anneau.'
          : 'Les servitudes publiées ne sont pas distinguées : chaque carreau prend la bande de sa distance. Les chiffres ne disent alors plus ce qui vient d’un arrêté et ce qui vient d’un rayon choisi.'}
      </p>

      {erreur && (
        <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--danger)', margin: 0 }}>{erreur}</p>
      )}
    </div>
  );
}

/** Saisie d'un rayon libre, en mètres. */
function SaisieRayon({ onAjouter }: { onAjouter: (r: number) => void }) {
  const [valeur, setValeur] = useState('');

  const valider = () => {
    const n = Number(valeur);
    // Les bornes sont vérifiées ICI comme elles le sont dans le schéma Zod : un
    // refus silencieux se lit comme un champ cassé.
    if (!Number.isInteger(n) || n < RAYON_MIN_M || n > RAYON_MAX_M) return;
    onAjouter(n);
    setValeur('');
  };

  return (
    <input
      type="number"
      value={valeur}
      onChange={(e) => setValeur(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); valider(); } }}
      onBlur={valider}
      min={RAYON_MIN_M}
      max={RAYON_MAX_M}
      step={100}
      placeholder="m"
      aria-label={`Ajouter un anneau, de ${RAYON_MIN_M} à ${RAYON_MAX_M} mètres`}
      style={{
        width: 58,
        background: 'var(--bg-level-2)',
        border: '0.5px solid var(--border-subtle)',
        borderRadius: 4, padding: '2px 6px',
        fontFamily: fMono, fontSize: 11, color: 'var(--text-primary)',
      }}
    />
  );
}

/** Bandeau de section du design system : fond élevé, pastille teal, titre. */
function Bandeau({ titre }: { titre: string }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--bg-level-2)',
        borderTop: '1px solid var(--border-subtle)',
        padding: '10px 14px', margin: '0 -10px',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
      <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
        {titre}
      </span>
    </div>
  );
}
