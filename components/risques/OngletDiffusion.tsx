'use client';

/**
 * L'onglet « Diffusion » : la pression publicitaire, confrontée à l'exposition.
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────
 *
 * « Cette campagne presse-t-elle plus, ou moins, les zones à risque que leur
 * poids démographique ne le justifierait ? » C'est la finalité déclarée du
 * module : un custom bidding différencié entre seuil haut et seuil bas.
 *
 * ── L'INDICE DE PRESSION ─────────────────────────────────────────────────
 *
 * Part des impressions rapportée à la part de population, ×100.
 *   100 → la classe reçoit exactement sa part démographique ;
 *   150 → elle en reçoit la moitié en plus ;
 *    60 → elle en reçoit 40 % de moins.
 *
 * Le repère à 100 est tracé sur les barres, et c'est ce qui rend l'écran
 * lisible sans calcul mental : l'œil voit l'écart, pas seulement la longueur.
 *
 * ── CE QUE L'ÉCRAN DOIT AVOUER ───────────────────────────────────────────
 *
 * Les impressions sont VENTILÉES, pas mesurées : une campagne est achetée au
 * code postal, le risque se mesure au carreau de 200 m. Le dire n'est pas une
 * précaution de style — c'est la différence entre un chiffre qu'on peut opposer
 * à un annonceur et un chiffre qu'on ne peut que regarder.
 */
import React from 'react';
import { Loader2, FlaskConical } from 'lucide-react';
import { formaterNombre } from '@/lib/format/nombre';
import { fInter, fMono } from '@/lib/design/polices';
import { Kpi } from '@/components/risques/Kpi';
import { COULEUR_NIVEAU_CSS } from '@/lib/carte/palette-zones-risque';
import { LIBELLE_NIVEAU, anneauxDuNiveau, libelleRayon, type Niveau, type ProfilRayons } from '@/lib/risques/profil';
import { useDiffusion, type ClasseDiffusion } from '@/components/risques/use-diffusion';
import type { Dimension } from '@/lib/risques/dimensions';

interface Props {
  campagne: string | null;
  profil: ProfilRayons;
  cible: string;
  libelleCible: string;
  maille: Dimension;
  parent: string | null;
}

/**
 * Le libellé lisible d'une classe, et son niveau.
 *
 * ⚠ Reconstruit à partir du PROFIL, jamais d'une table de libellés figée : les
 * classes changent à chaque anneau ajouté ou retiré, et une table statique
 * finirait par nommer « Bande 3 » une bande qui n'existe plus.
 */
function decrire(classe: string, profil: ProfilRayons): { niveau: Niveau | null; libelle: string } {
  if (classe === 'hors') {
    return { niveau: null, libelle: 'Hors des anneaux' };
  }
  const [niveau, bande] = classe.split(':') as [Niveau, string];
  const court = LIBELLE_NIVEAU[niveau]?.replace('Seveso seuil ', 'Seuil ') ?? niveau;
  if (bande === 'pprt') return { niveau, libelle: `${court} · périmètre PPRT` };

  const anneaux = anneauxDuNiveau(profil, niveau);
  const i = Number(bande) - 1;
  const debut = i === 0 ? '0' : libelleRayon(anneaux[i - 1]);
  const fin = anneaux[i] !== undefined ? libelleRayon(anneaux[i]) : '?';
  return { niveau, libelle: `${court} · ${debut} à ${fin}` };
}

export function OngletDiffusion({
  campagne, profil, cible, libelleCible, maille, parent,
}: Props) {
  const { etat, diffusion, erreur, sansDonnees } = useDiffusion(
    campagne, profil, cible, maille, parent,
  );

  if (!campagne) {
    return (
      <div style={{ padding: '24px 20px', maxWidth: 640 }}>
        <p style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Aucune campagne sélectionnée.
        </p>
        <p style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
          Cet onglet confronte la pression publicitaire d’une campagne à l’exposition au
          risque industriel. Ouvrez le module depuis une campagne, ou ajoutez
          <code style={{ fontFamily: fMono, margin: '0 4px' }}>&amp;campagne=…</code>
          à l’adresse.
        </p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', minWidth: 0 }}>
      {diffusion?.est_demo && (
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14,
            background: 'rgba(247,183,49,0.1)',
            border: '0.5px solid rgba(247,183,49,0.2)',
            borderRadius: 4, padding: '3px 9px',
            fontFamily: fInter, fontSize: 11, color: 'var(--warning)',
          }}
        >
          <FlaskConical size={12} />
          Données de démonstration
        </div>
      )}

      {etat === 'chargement' && !diffusion && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)',
        }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Ventilation des impressions…
        </div>
      )}

      {etat === 'echec' && (
        <div
          style={{
            padding: '10px 12px', marginBottom: 14, maxWidth: 640,
            background: sansDonnees ? 'rgba(247,183,49,0.1)' : 'rgba(255,87,87,0.1)',
            border: `0.5px solid ${sansDonnees ? 'rgba(247,183,49,0.2)' : 'rgba(255,87,87,0.2)'}`,
            borderRadius: 6,
          }}
        >
          <p style={{
            fontFamily: fInter, fontSize: 12, margin: 0, lineHeight: 1.5,
            color: sansDonnees ? 'var(--warning)' : 'var(--danger)',
          }}>
            {erreur}
          </p>
        </div>
      )}

      {diffusion && (
        <>
          <div style={{ display: 'flex', gap: 28, marginBottom: 18, flexWrap: 'wrap' }}>
            <Kpi
              valeur={formaterNombre(diffusion.impressions_en_zone)}
              libelle="impressions en zone"
              note={`sur ${formaterNombre(diffusion.impressions_totales)} au total`}
            />
            <Kpi
              valeur={`${Math.round(
                (diffusion.impressions_en_zone / Math.max(diffusion.impressions_totales, 1)) * 100,
              )} %`}
              libelle="part des impressions"
              note="en zone de risque"
            />
            <Kpi
              valeur={formaterNombre(diffusion.population_touchee)}
              libelle={`${libelleCible.toLowerCase()} touchés`}
              note="population des codes postaux diffusés"
            />
          </div>

          <BarresParClasse classes={diffusion.classes} profil={profil} />

          <p style={{
            fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
            margin: '18px 0 0', lineHeight: 1.6, maxWidth: 680,
          }}>
            <strong style={{ color: 'var(--text-secondary)' }}>Comment lire.</strong>{' '}
            L’indice rapporte la part des impressions à la part de population, ×100.
            Un indice de 100 signifie que la classe reçoit exactement son poids démographique.
          </p>
          <p style={{
            fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
            margin: '8px 0 0', lineHeight: 1.6, maxWidth: 680,
          }}>
            <strong style={{ color: 'var(--text-secondary)' }}>Ce que ces chiffres ne sont pas.</strong>{' '}
            Les impressions sont <em>ventilées</em>, pas mesurées : une campagne s’achète au code
            postal, le risque se mesure au carreau de 200 m. La ventilation suppose la pression
            uniforme à l’intérieur d’un code postal — fausse au détail, raisonnable en agrégat.
            Le dénominateur est la population <em>totale</em> du code postal, jamais sa seule part
            exposée.
          </p>

          <EmplacementBidding classes={diffusion.classes} profil={profil} />
        </>
      )}
    </div>
  );
}

/** Les barres d'indice, avec le repère à 100. */
function BarresParClasse({ classes, profil }: { classes: ClasseDiffusion[]; profil: ProfilRayons }) {
  const avecIndice = classes.filter((c) => c.indice !== null);
  if (avecIndice.length === 0) {
    return (
      <p style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}>
        Aucune classe n’a de population : l’indice de pression est incalculable.
      </p>
    );
  }

  // L'échelle va jusqu'au plus grand indice, avec un plancher à 200 pour que le
  // repère de 100 ne se colle pas au bord droit quand tout est sous-pressé.
  const max = Math.max(200, ...avecIndice.map((c) => c.indice ?? 0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 760 }}>
      {classes.map((c) => {
        const { niveau, libelle } = decrire(c.classe, profil);
        const couleur = niveau ? COULEUR_NIVEAU_CSS[niveau] : 'var(--donnee-absente)';
        const largeur = c.indice === null ? 0 : Math.min((c.indice / max) * 100, 100);
        return (
          <div key={c.classe} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 190, flexShrink: 0, fontFamily: fInter, fontSize: 11,
              color: 'var(--text-secondary)',
            }}>
              {libelle}
            </span>
            <div style={{ flex: 1, position: 'relative', height: 18 }}>
              <div style={{
                position: 'absolute', inset: 0,
                background: 'var(--bg-level-2)', borderRadius: 3,
              }} />
              <div style={{
                position: 'absolute', top: 0, bottom: 0, left: 0,
                width: `${largeur}%`, background: couleur, opacity: 0.75, borderRadius: 3,
              }} />
              {/* Le repère de parité. Sans lui, l'œil compare des longueurs
                  entre elles au lieu de les comparer à la référence. */}
              <div
                title="Indice 100 : la classe reçoit exactement sa part de population."
                style={{
                  position: 'absolute', top: -2, bottom: -2,
                  left: `${(100 / max) * 100}%`,
                  borderLeft: '1px dashed var(--text-tertiary)',
                }}
              />
            </div>
            <span style={{
              width: 52, flexShrink: 0, textAlign: 'right',
              fontFamily: fMono, fontSize: 11,
              color: c.indice === null ? 'var(--text-tertiary)' : 'var(--text-primary)',
            }}>
              {c.indice === null ? '—' : c.indice}
            </span>
            <span style={{
              width: 90, flexShrink: 0, textAlign: 'right',
              fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)',
            }}>
              {formaterNombre(c.impressions)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * L'emplacement réservé au custom bidding — EN LECTURE SEULE.
 *
 * ⚠ Aucune logique d'enchère ici, et c'est explicite dans le brief. Le
 * multiplicateur affiché est la traduction directe de l'indice : viser 100
 * partout revient à multiplier par `100 / indice`. Le montrer prépare le
 * terrain sans prétendre décider — et évite qu'un lecteur pressé croie que
 * l'écran pilote déjà quelque chose.
 */
function EmplacementBidding({ classes, profil }: { classes: ClasseDiffusion[]; profil: ProfilRayons }) {
  const utiles = classes.filter((c) => c.classe !== 'hors' && c.indice !== null && c.indice > 0);
  if (utiles.length === 0) return null;

  return (
    <div style={{
      marginTop: 24, paddingTop: 16, borderTop: '0.5px solid var(--border-subtle)', maxWidth: 680,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
          Custom bidding
        </span>
        <span style={{
          fontFamily: fInter, fontSize: 10, color: 'var(--text-tertiary)',
          border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '1px 6px',
        }}>
          lecture seule
        </span>
      </div>
      <p style={{
        fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
        margin: '0 0 10px', lineHeight: 1.6,
      }}>
        Le multiplicateur qui ramènerait chaque classe à la parité démographique.
        Rien n’est poussé vers un DSP depuis cet écran.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {utiles.map((c) => {
          const { libelle } = decrire(c.classe, profil);
          const mult = 100 / (c.indice as number);
          return (
            <div key={c.classe} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{
                width: 190, flexShrink: 0, fontFamily: fInter, fontSize: 11,
                color: 'var(--text-secondary)',
              }}>
                {libelle}
              </span>
              <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-primary)' }}>
                ×{mult.toFixed(2).replace('.', ',')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
