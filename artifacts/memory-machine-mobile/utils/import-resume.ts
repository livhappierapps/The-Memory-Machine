export interface PendingImportSession {
  uploadId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  totalChunks: number;
  fileSignature: string;
  updatedAt: string;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function pendingImportStorageKey(userId: string): string {
  return `memory-machine:pending-import:v1:${encodeURIComponent(userId)}`;
}

export function parsePendingImportSession(
  serialized: string | null,
): PendingImportSession | null {
  if (!serialized) return null;

  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object") return null;
    const session = value as Partial<PendingImportSession>;
    if (
      typeof session.uploadId !== "string" ||
      !UUID_V4.test(session.uploadId) ||
      typeof session.fileName !== "string" ||
      !session.fileName.trim() ||
      typeof session.mimeType !== "string" ||
      !Number.isSafeInteger(session.fileSize) ||
      (session.fileSize ?? -1) < 0 ||
      !Number.isSafeInteger(session.totalChunks) ||
      (session.totalChunks ?? 0) < 1 ||
      (session.totalChunks ?? 10_001) > 10_000 ||
      typeof session.fileSignature !== "string" ||
      !/^[0-9a-f]{64}$/i.test(session.fileSignature) ||
      typeof session.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(session.updatedAt))
    ) {
      return null;
    }
    return session as PendingImportSession;
  } catch {
    return null;
  }
}

export function getMissingChunkIndexes(
  totalChunks: number,
  receivedChunks: readonly number[],
): number[] {
  const received = new Set(
    receivedChunks.filter(
      (index) => Number.isSafeInteger(index) && index >= 0 && index < totalChunks,
    ),
  );
  return Array.from({ length: totalChunks }, (_, index) => index).filter(
    (index) => !received.has(index),
  );
}
