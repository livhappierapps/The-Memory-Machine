/**
 * useIncomingShare
 *
 * Wraps expo-share-intent to surface the first ZIP (or JSON) file that
 * another app shares into Memory Machine.
 *
 * ### URI strategy
 *
 * iOS: expo-share-intent copies the file into the shared app-group container
 * before handing us a `file://` path.  That path is already app-owned and
 * readable — we pass it straight to ImportSheet.
 *
 * Android: the native module sends the caller's `content://` URI *and* an
 * `file://` absolute path (from `getAbsolutePath()`).  `parseShareIntent`
 * (the library's normalisation layer) picks the `file://` path first, but
 * that path lives inside the *source* app's private storage and is typically
 * unreadable by us.  The only reliably accessible handle is the original
 * `content://` URI which Android grants temporary read permission for via the
 * share Intent mechanism.
 *
 * To recover `contentUri` we register a raw native-event listener that fires
 * in the same JS tick as the library's own listener; we capture `contentUri`
 * into a ref synchronously, so that when React subsequently processes the
 * `hasShareIntent` state change our effect finds it waiting.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { ShareIntentModule, useShareIntentContext } from "expo-share-intent";

export interface IncomingFile {
  /** Readable URI: file:// (iOS / Android external) or content:// (Android) */
  uri: string;
  fileName: string;
  mimeType: string;
}

interface UseIncomingShareResult {
  incomingFile: IncomingFile | null;
  clearIncoming: () => void;
}

/** Returns true for file types we want to import. */
function isImportable(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();
  return (
    lower.endsWith(".zip") ||
    lower.endsWith(".json") ||
    mime === "application/zip" ||
    mime === "application/x-zip-compressed" ||
    mime === "application/json"
  );
}

export function useIncomingShare(): UseIncomingShareResult {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [incomingFile, setIncomingFile] = useState<IncomingFile | null>(null);

  /**
   * Android-only: stores the most-recently-seen `contentUri` from the raw
   * native event, keyed by `fileName`.  This is populated synchronously
   * in the raw-event listener before the `hasShareIntent` state update
   * triggers our effect below.
   */
  const androidContentUriMapRef = useRef<Map<string, string>>(new Map());

  // Register a raw native-event listener on Android to capture `contentUri`
  // before `parseShareIntent` overwrites it with the inaccessible `filePath`.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (!ShareIntentModule) return;

    const subscription = (
      ShareIntentModule as {
        addListener?: (
          event: string,
          handler: (e: { value: unknown }) => void,
        ) => { remove: () => void };
      }
    ).addListener?.("onChange", (event) => {
      try {
        // Android delivers the payload as a plain object (not JSON string).
        const raw = event.value as {
          files?: Array<{
            contentUri?: string;
            fileName?: string;
            mimeType?: string;
          }>;
        };
        for (const f of raw?.files ?? []) {
          if (f.contentUri && f.fileName) {
            androidContentUriMapRef.current.set(f.fileName, f.contentUri);
          }
        }
      } catch {
        // ignore parse errors — the library's own listener handles errors
      }
    });

    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (!hasShareIntent || !shareIntent.files || shareIntent.files.length === 0) {
      return;
    }

    const file = shareIntent.files.find((f) =>
      isImportable(f.fileName ?? "", f.mimeType ?? ""),
    );

    if (!file) return;

    let uri: string;

    if (Platform.OS === "android") {
      // Prefer the raw contentUri captured from the native event (reliable,
      // Android-granted temporary read permission via the share Intent).
      const savedContentUri = file.fileName
        ? androidContentUriMapRef.current.get(file.fileName)
        : undefined;

      if (savedContentUri) {
        uri = savedContentUri;
      } else {
        // Fallback: use the parsed path.  If it's a plain file path without a
        // scheme, convert it.  content:// paths are already correct.
        const rawPath = file.path ?? "";
        uri =
          rawPath.startsWith("content://") || rawPath.startsWith("file://")
            ? rawPath
            : `file://${rawPath}`;
      }
    } else {
      // iOS: the path is already a file:// URI in the app-group container.
      const rawPath = file.path ?? "";
      uri =
        rawPath.startsWith("file://") || rawPath.startsWith("content://")
          ? rawPath
          : `file://${rawPath}`;
    }

    setIncomingFile({
      uri,
      fileName: file.fileName ?? "import",
      mimeType: file.mimeType ?? "application/octet-stream",
    });
  }, [hasShareIntent, shareIntent]);

  const clearIncoming = useCallback(() => {
    setIncomingFile(null);
    androidContentUriMapRef.current.clear();
    resetShareIntent(true);
  }, [resetShareIntent]);

  return { incomingFile, clearIncoming };
}
