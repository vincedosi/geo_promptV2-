import { useCallback } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { CustomGeoExportFormat } from '@/types/custom-geo';

export function useZoneActions(onSuccess?: () => void) {
  const rename = useCallback(async (id: string, name: string, description?: string) => {
    const body: Record<string, string> = { name };
    if (description !== undefined) body.description = description;
    const res = await adminFetch(`/api/custom-geo/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Rename failed');
    onSuccess?.();
  }, [onSuccess]);

  const remove = useCallback(async (id: string) => {
    const res = await adminFetch(`/api/custom-geo/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    onSuccess?.();
  }, [onSuccess]);

  const exportZone = useCallback((id: string, format: CustomGeoExportFormat) => {
    window.open(`/api/custom-geo/${id}/export?format=${format}`, '_blank');
  }, []);

  return { rename, remove, exportZone };
}
