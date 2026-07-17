'use client';

/**
 * Hall de l'onglet « Programmer » de l'overlay MAGELIAN
 * (spec 2026-07-17) : point d'entrée de la production de campagne.
 * - CTA « Nouvelle campagne » (naissance d'une coquille + wizard) ;
 * - « Reprendre une création » : coquilles magelian sans stratégie, badge
 *   brouillon si un autosave existe, suppression possible (ces coquilles ne
 *   sont plus visibles dans Aperçu depuis le partage strict) ;
 * - « Modifier une campagne lancée » : campagnes avec stratégie → wizard en
 *   reprogrammation.
 * Composant d'affichage : les listes et actions viennent du parent
 * (MagelianOverlay), seule la modale de confirmation est locale.
 */
import { useState } from 'react';
import { ConfirmModal } from '@/components/ui/confirm-modal';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

export interface HallCampaign {
  id: string;
  name: string;
}

interface Props {
  loading: boolean;
  shells: HallCampaign[];
  launched: HallCampaign[];
  /** campaign_id → date ISO du dernier autosave de l'utilisateur (badge brouillon). */
  draftSavedAt: ReadonlyMap<string, string>;
  creating: boolean;
  onCreate: () => void;
  onPick: (id: string) => void;
  /** Supprime la coquille côté serveur + listes ; résout quand c'est fait. */
  onDelete: (id: string) => Promise<void>;
}

function SectionTitle({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '22px 0 10px' }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
      <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{label}</span>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
      border: '0.5px solid var(--border-subtle)', borderRadius: 8, marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

export function CreationHall({
  loading, shells, launched, draftSavedAt, creating, onCreate, onPick, onDelete,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<HallCampaign | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try { await onDelete(pendingDelete.id); } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.6 }}>
        Crée une nouvelle campagne, reprends une création en cours ou reprogramme une campagne déjà lancée.
      </p>

      <button
        type="button"
        onClick={onCreate}
        disabled={creating}
        style={{
          background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none',
          borderRadius: 6, padding: '11px 20px', fontFamily: fInter, fontSize: 13, fontWeight: 500,
          cursor: creating ? 'wait' : 'pointer',
        }}
      >
        {creating ? 'Création…' : 'Nouvelle campagne'}
      </button>

      {loading && (
        <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', marginTop: 18 }}>Chargement…</div>
      )}

      {!loading && shells.length > 0 && (
        <>
          <SectionTitle label="Reprendre une création" />
          {shells.map((c) => {
            const savedAt = draftSavedAt.get(c.id);
            return (
              <Row key={c.id}>
                <button
                  type="button"
                  onClick={() => onPick(c.id)}
                  style={{
                    flex: 1, minWidth: 0, background: 'transparent', border: 'none', padding: 0,
                    textAlign: 'left', cursor: 'pointer', fontFamily: fInter, fontSize: 13,
                    color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                </button>
                {savedAt && (
                  <span style={{
                    fontFamily: fMono, fontSize: 10, padding: '2px 8px', borderRadius: 4,
                    border: '0.5px solid var(--brand-teal-30)', color: 'var(--brand-teal)', flexShrink: 0,
                  }}>
                    brouillon · {new Date(savedAt).toLocaleDateString('fr-FR')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPendingDelete(c)}
                  style={{
                    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                    fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0,
                  }}
                >
                  Supprimer
                </button>
              </Row>
            );
          })}
        </>
      )}

      {!loading && launched.length > 0 && (
        <>
          <SectionTitle label="Modifier une campagne lancée" />
          {launched.map((c) => (
            <Row key={c.id}>
              <span style={{
                flex: 1, minWidth: 0, fontFamily: fInter, fontSize: 13, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.name}
              </span>
              <button
                type="button"
                onClick={() => onPick(c.id)}
                style={{
                  background: 'transparent', border: '0.5px solid var(--brand-teal)', color: 'var(--brand-teal)',
                  borderRadius: 6, padding: '5px 12px', fontFamily: fInter, fontSize: 11, fontWeight: 500,
                  cursor: 'pointer', flexShrink: 0,
                }}
              >
                Modifier
              </button>
            </Row>
          ))}
        </>
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        onConfirm={() => { void confirmDelete(); }}
        title="Supprimer cette campagne ?"
        message={pendingDelete ? `« ${pendingDelete.name} » et son brouillon seront supprimés — action irréversible.` : ''}
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
