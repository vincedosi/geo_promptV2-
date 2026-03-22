import fs from 'fs/promises';
import path from 'path';
import type { DownloadedBase, CatalogStatus } from './types';

const DOWNLOAD_DIR = path.join(process.cwd(), 'data', 'iris-downloads');

export async function ensureDownloadDir(): Promise<void> {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
}

export function getFilePath(catalogId: string): string {
  return path.join(DOWNLOAD_DIR, `${catalogId}.json`);
}

export async function saveBase(data: DownloadedBase): Promise<void> {
  await ensureDownloadDir();
  await fs.writeFile(getFilePath(data.catalogId), JSON.stringify(data), 'utf-8');
}

export async function loadBase(catalogId: string): Promise<DownloadedBase | null> {
  try {
    const raw = await fs.readFile(getFilePath(catalogId), 'utf-8');
    return JSON.parse(raw) as DownloadedBase;
  } catch {
    return null;
  }
}

export async function getBaseStatus(catalogId: string): Promise<CatalogStatus> {
  try {
    const filePath = getFilePath(catalogId);
    const stat = await fs.stat(filePath);
    // Lire seulement les métadonnées (évite de charger 50MB en RAM)
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as DownloadedBase;
    return {
      catalogId,
      downloaded: true,
      downloadedAt: data.downloadedAt,
      rowCount: data.rowCount,
      columnCount: data.headers.length,
      csvFileName: data.csvFileName,
      fileSizeBytes: stat.size,
    };
  } catch {
    return { catalogId, downloaded: false };
  }
}

export async function deleteBase(catalogId: string): Promise<void> {
  try {
    await fs.unlink(getFilePath(catalogId));
  } catch { /* ignore */ }
}
