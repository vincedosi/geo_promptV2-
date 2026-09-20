'use client';

/**
 * D'où vient le plan géographique d'une campagne.
 *
 * ── DEUX SOURCES, ET ELLES S'EXCLUENT ─────────────────────────────────────
 *
 * Un INDICATEUR INSEE — la campagne enchérit d'autant plus que l'indicateur
 * est élevé, code postal par code postal. C'est le chemin historique.
 *
 * Un JEU DE ZONES — le plan vient de l'atelier « Population à risque
 * industriel » : des anneaux autour des sites classés, une classe par carreau,
 * un poids par classe.
 *
 * Elles s'excluent parce qu'une campagne n'a qu'un plan :
 * `refresh_campaign_rollups` ne lit qu'UNE stratégie, la plus récente. Offrir
 * les deux à la fois laisserait croire à un croisement qui n'existe pas.
 *
 * ── LA VERSION EST FIGÉE AU RATTACHEMENT ──────────────────────────────────
 *
 * Le jeu retenu porte son numéro de version. Un jeu modifié plus tard crée une
 * NOUVELLE version et ne change pas le plan d'une campagne en vol — même règle
 * que `strategie_versions` pour les stratégies publiées.
 */
import { useEffect, useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { formaterNombre, formaterDecimal } from '@/lib/format/nombre';
import { B, C, FieldBlock, fInter, fMono } from './ui';

interface JeuResume {
  id: string;
  nom: string;
  version: number;
  n_cp_retenus: number | null;
  taux_utile: number | null;
  mode_plan: string;
  seuil_couverture_cp: number;
}

interface Props {
  choisi: { id: string; nom: string; version: number } | null;
  onChoisir: (j: { id: string; nom: string; version: number } | null) => void;
}

export function SourcePlan({ choisi, onChoisir }: Props) {
  const [jeux, setJeux] = useState<JeuResume[] | null>(null);
  const [echec, setEchec] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const rep = await adminFetch('/api/zones/jeux', { cache: 'no-store' });
        if (!rep.ok) throw new Error(String(rep.status));
        const j = await rep.json();
        if (!annule) setJeux(Array.isArray(j.jeux) ? j.jeux : []);
      } catch {
        // Un échec ici ne doit PAS bloquer le wizard : le plan par indicateur
        // reste disponible, et c'est lui le chemin par défaut.
        if (!annule) { setJeux([]); setEchec(true); }
      }
    })();
    return () => { annule = true; };
  }, []);

  const retenu = choisi ? jeux?.find((j) => j.id === choisi.id) ?? null : null;

  return (
    <FieldBlock label="Source du plan géographique">
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <Choix
          actif={choisi === null}
          titre="Indicateur INSEE"
          aide="L’enchère suit un indicateur, code postal par code postal."
          onClick={() => onChoisir(null)}
        />
        <Choix
          actif={choisi !== null}
          titre="Jeu de zones"
          aide="Le plan vient de l’atelier Population à risque industriel."
          onClick={() => {
            // Le premier jeu de la liste est le plus récent : le préselectionner
            // évite un état « mode choisi, rien de choisi » où le bouton
            // Continuer serait actif sans plan derrière.
            const premier = jeux?.[0];
            if (premier) {
              onChoisir({ id: premier.id, nom: premier.nom, version: premier.version });
            }
          }}
          desactive={!jeux || jeux.length === 0}
        />
      </div>

      {jeux === null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: fInter, fontSize: 12, color: C.textSec }}>
          <Loader2 size={13} className="animate-spin" />
          Lecture des jeux de zones…
        </div>
      )}

      {jeux !== null && jeux.length === 0 && (
        <p style={{ margin: 0, fontFamily: fInter, fontSize: 11.5, color: C.textSec, lineHeight: 1.6 }}>
          {echec
            ? 'La liste des jeux de zones est indisponible. Le plan par indicateur reste utilisable.'
            : 'Aucun jeu de zones enregistré. Ils se fabriquent dans Calques → Zones à risque '
              + 'industriel → Analyser la population à risque → onglet Zones.'}
        </p>
      )}

      {choisi !== null && jeux !== null && jeux.length > 0 && (
        <>
          <select
            value={choisi.id}
            onChange={(e) => {
              const j = jeux.find((x) => x.id === e.target.value);
              if (j) onChoisir({ id: j.id, nom: j.nom, version: j.version });
            }}
            aria-label="Jeu de zones servant de plan"
            style={{
              width: '100%', background: C.elevated, border: `0.5px solid ${C.border}`,
              borderRadius: 6, padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: C.text,
            }}
          >
            {jeux.map((j) => (
              <option key={j.id} value={j.id}>{j.nom} — version {j.version}</option>
            ))}
          </select>

          {retenu && (
            <div
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 10,
                padding: '10px 12px', borderRadius: 8,
                background: C.elevated, border: `0.5px solid ${C.border}`,
              }}
            >
              <Layers size={14} style={{ color: C.textSec, flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontFamily: fInter, fontSize: 11.5, color: C.textSec, lineHeight: 1.65 }}>
                <span style={{ fontFamily: fMono, color: C.text }}>
                  {retenu.n_cp_retenus === null ? '—' : formaterNombre(retenu.n_cp_retenus)}
                </span>{' '}
                codes postaux retenus, seuil de couverture{' '}
                <span style={{ fontFamily: fMono, color: C.text }}>
                  {Number(retenu.seuil_couverture_cp)} %
                </span>
                {retenu.taux_utile !== null && (
                  <>
                    , taux d’utile{' '}
                    <span style={{ fontFamily: fMono, color: C.text }}>
                      {formaterDecimal(Number(retenu.taux_utile))} %
                    </span>
                  </>
                )}
                .
                <br />
                Mode <B>{retenu.mode_plan === 'exclusif' ? 'exclusif' : 'pondéré'}</B> :{' '}
                {retenu.mode_plan === 'exclusif'
                  ? 'zéro impression hors des codes postaux retenus.'
                  : 'toute la France reçoit du budget, les zones en reçoivent davantage.'}
                <br />
                La <B>version {retenu.version}</B> est figée au lancement : modifier ce jeu
                ensuite créera une nouvelle version et ne touchera pas cette campagne.
              </div>
            </div>
          )}
        </>
      )}
    </FieldBlock>
  );
}

function Choix({ actif, titre, aide, onClick, desactive }: {
  actif: boolean;
  titre: string;
  aide: string;
  onClick: () => void;
  desactive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desactive}
      aria-pressed={actif}
      style={{
        flex: '1 1 220px', textAlign: 'left', padding: '9px 12px', borderRadius: 8,
        cursor: desactive ? 'not-allowed' : 'pointer',
        opacity: desactive ? 0.45 : 1,
        fontFamily: fInter,
        background: actif ? 'var(--brand-teal-10)' : 'transparent',
        border: `0.5px solid ${actif ? 'var(--brand-teal)' : C.border}`,
        color: C.text,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{titre}</div>
      <div style={{ fontSize: 11, color: C.textSec, lineHeight: 1.45 }}>{aide}</div>
    </button>
  );
}
