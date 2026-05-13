import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { fetch as expoFetch } from "expo/fetch";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const CHUNK_SIZE = 10 * 1024 * 1024;

interface Props {
  visible: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Phase = "idle" | "picking" | "uploading" | "processing" | "done" | "error" | "interrupted";

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

export function ImportSheet({ visible, onClose, onImported }: Props) {
  const { getToken } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>("idle");
  const [chunksDone, setChunksDone] = useState(0);
  const [totalChunks, setTotalChunks] = useState(1);
  const [savedCount, setSavedCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // abortedRef is set to true when the user cancels. It is only cleared when
  // a new import begins so that in-flight async loops cannot fire callbacks
  // after close.
  const abortedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const baseUrl = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}`;

  const reset = useCallback(() => {
    // Note: abortedRef is NOT reset here. It is cleared only at the top of
    // handleImport so that any lingering async work from the previous run
    // cannot fire state transitions after the sheet has been closed.
    setPhase("idle");
    setChunksDone(0);
    setTotalChunks(1);
    setSavedCount(0);
    setStatusMsg("");
    setResult(null);
    setErrorMsg(null);
  }, []);

  const handleClose = useCallback(() => {
    abortedRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    reset();
    onClose();
  }, [reset, onClose]);

  const uploadChunk = useCallback(
    async (
      fileUri: string,
      uploadId: string,
      chunkIndex: number,
      chunks: number,
      position: number,
      length: number,
      mimeType: string,
      signal: AbortSignal,
    ) => {
      const base64 = await LegacyFileSystem.readAsStringAsync(fileUri, {
        encoding: "base64",
        position,
        length,
      });

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });

      const token = await getToken();
      const form = new FormData();
      form.append("uploadId", uploadId);
      form.append("chunkIndex", String(chunkIndex));
      form.append("totalChunks", String(chunks));
      form.append("chunk", blob, "chunk.bin");

      const res = await fetch(`${baseUrl}/api/import/chunk`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: form,
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Chunk ${chunkIndex + 1}/${chunks} failed (${res.status}): ${text.slice(0, 120)}`,
        );
      }
    },
    [baseUrl, getToken],
  );

  const handleImport = useCallback(async () => {
    // Clear abort state and create a fresh controller for this import run.
    abortedRef.current = false;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setPhase("picking");

    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/json", "application/octet-stream", "*/*"],
        copyToCacheDirectory: true,
      });

      if (picked.canceled || !picked.assets || picked.assets.length === 0) {
        if (!abortedRef.current) setPhase("idle");
        return;
      }

      const asset = picked.assets[0]!;
      const fileUri = asset.uri;
      const mimeType = asset.mimeType ?? "application/octet-stream";
      const fileName = asset.name ?? "import";

      // Determine ZIP by file extension first (most reliable on mobile), then
      // by explicit ZIP MIME types. Do NOT treat application/octet-stream as
      // ZIP — JSON files can also arrive with that MIME type on some pickers.
      const lowerName = fileName.toLowerCase();
      const isZip =
        lowerName.endsWith(".zip") ||
        mimeType === "application/zip" ||
        mimeType === "application/x-zip-compressed";

      // uploadId must be a valid UUID v4 — the server validates with a strict regex.
      const uploadId = Crypto.randomUUID();

      const info = await LegacyFileSystem.getInfoAsync(fileUri);
      if (!info.exists) throw new Error("Selected file could not be read.");

      const fileSize = (info as { exists: true; size?: number }).size ?? 0;
      const chunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));

      if (abortedRef.current) return;

      setPhase("uploading");
      setTotalChunks(chunks);
      setChunksDone(0);

      for (let i = 0; i < chunks; i++) {
        if (abortedRef.current) return;
        const position = i * CHUNK_SIZE;
        const length = Math.min(CHUNK_SIZE, fileSize - position);
        await uploadChunk(fileUri, uploadId, i, chunks, position, length, mimeType, controller.signal);
        setChunksDone(i + 1);
      }

      if (abortedRef.current) return;

      setPhase("processing");
      setSavedCount(0);
      setStatusMsg("Assembling your file…");

      const freshToken = await getToken();
      const finalizeRes = await expoFetch(`${baseUrl}/api/import/finalize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${freshToken ?? ""}`,
        },
        body: JSON.stringify({ uploadId, totalChunks: chunks, isZip }),
      });

      if (!finalizeRes.ok) {
        const text = await finalizeRes.text().catch(() => "");
        throw new Error(`Finalize failed (${finalizeRes.status}): ${text.slice(0, 120)}`);
      }

      const reader = finalizeRes.body?.getReader();
      if (!reader) throw new Error("No response body from server");

      const decoder = new TextDecoder();
      let buffer = "";
      let receivedDone = false;

      while (!abortedRef.current) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw) as {
              type: string;
              imported?: number;
              skipped?: number;
              errors?: number;
              message?: string;
            };

            if (event.type === "status") {
              setStatusMsg(event.message ?? "");
            } else if (event.type === "progress") {
              setStatusMsg("");
              setSavedCount(event.imported ?? 0);
            } else if (event.type === "done") {
              receivedDone = true;
              setResult({
                imported: event.imported ?? 0,
                skipped: event.skipped ?? 0,
                errors: event.errors ?? 0,
              });
              setPhase("done");
              onImported();
              return;
            } else if (event.type === "error") {
              throw new Error(event.message ?? "Import failed on server");
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      if (abortedRef.current) return;

      // Stream ended without a "done" event (connection likely dropped).
      // Refresh the thread list and let the user check rather than hard error.
      if (!receivedDone) {
        onImported();
        setPhase("interrupted");
      }
    } catch (err) {
      if (abortedRef.current) return;
      const msg = err instanceof Error ? err.message : "Import failed. Please try again.";
      setErrorMsg(msg);
      setPhase("error");
    }
  }, [baseUrl, getToken, onImported, uploadChunk]);

  const isWorking = phase === "uploading" || phase === "processing" || phase === "picking";
  const uploadPct = totalChunks > 0 ? Math.round((chunksDone / totalChunks) * 100) : 0;
  const processingLabel = statusMsg
    ? statusMsg
    : savedCount > 0
      ? `Saving conversations… ${savedCount} done so far`
      : "Analysing your conversations…";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={isWorking ? undefined : handleClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
              Import Grok Export
            </Text>
            {!isWorking && (
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <View style={styles.body}>
              {phase === "idle" && (
                <>
                  <Text style={[styles.desc, { color: colors.mutedForeground }]}>
                    Select a Grok conversation export (.zip or .json) to import into your vault.
                    Any size works — the file is sent in small chunks.
                  </Text>
                  <TouchableOpacity
                    style={[styles.dropZone, { borderColor: colors.border }]}
                    onPress={() => void handleImport()}
                    activeOpacity={0.75}
                  >
                    <View
                      style={[styles.dropZoneIcon, { backgroundColor: `${colors.primary}22` }]}
                    >
                      <Feather name="archive" size={28} color={colors.primary} />
                    </View>
                    <Text style={[styles.dropZoneTitle, { color: colors.foreground }]}>
                      Tap to choose file
                    </Text>
                    <Text style={[styles.dropZoneSub, { color: colors.mutedForeground }]}>
                      .zip or .json — any size
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {phase === "picking" && (
                <View style={styles.statusBlock}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                    Opening file picker…
                  </Text>
                </View>
              )}

              {phase === "uploading" && (
                <View style={styles.statusBlock}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                    Uploading…{" "}
                    {totalChunks > 1
                      ? `part ${chunksDone} of ${totalChunks}`
                      : "almost there"}
                  </Text>

                  <View style={styles.progressGroup}>
                    <View style={styles.progressLabelRow}>
                      <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                        {uploadPct}% uploaded
                      </Text>
                      {totalChunks > 1 && (
                        <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                          {chunksDone} / {totalChunks} parts
                        </Text>
                      )}
                    </View>
                    <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            backgroundColor: colors.primary,
                            width: `${Math.max(4, uploadPct)}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                      Keep your screen on — cancelling now will stop the upload.
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.btn, styles.btnOutline, { borderColor: colors.border }]}
                    onPress={handleClose}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              )}

              {phase === "processing" && (
                <View style={styles.statusBlock}>
                  <ActivityIndicator color={colors.primary} size="large" />
                  <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                    {processingLabel}
                  </Text>
                  <View
                    style={[styles.progressTrack, { backgroundColor: colors.border, width: "100%" }]}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        { backgroundColor: colors.primary, width: "100%", opacity: 0.4 },
                      ]}
                    />
                  </View>
                  <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                    Keep this screen open — large exports can take a few minutes.
                  </Text>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnOutline, { borderColor: colors.border }]}
                    onPress={handleClose}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              )}

              {phase === "done" && result && (
                <View style={styles.resultBlock}>
                  <View
                    style={[
                      styles.resultBadge,
                      {
                        backgroundColor: `${colors.primary}18`,
                        borderColor: `${colors.primary}44`,
                      },
                    ]}
                  >
                    <Feather name="check-circle" size={32} color={colors.primary} />
                    <Text style={[styles.resultTitle, { color: colors.foreground }]}>
                      {result.imported} conversation{result.imported === 1 ? "" : "s"} imported
                    </Text>
                  </View>

                  <View style={styles.statsList}>
                    <StatRow
                      label="Imported"
                      value={result.imported}
                      valueColor={colors.primary}
                      mutedColor={colors.mutedForeground}
                    />
                    <StatRow
                      label="Skipped"
                      value={result.skipped}
                      valueColor={colors.mutedForeground}
                      mutedColor={colors.mutedForeground}
                    />
                    {result.errors > 0 && (
                      <StatRow
                        label="Errors"
                        value={result.errors}
                        valueColor={colors.destructive}
                        mutedColor={colors.mutedForeground}
                      />
                    )}
                  </View>

                  <View style={styles.rowButtons}>
                    <TouchableOpacity
                      style={[
                        styles.btn,
                        styles.btnOutline,
                        { borderColor: colors.border, flex: 1 },
                      ]}
                      onPress={reset}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.btnText, { color: colors.foreground }]}>
                        Import another
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: colors.primary, flex: 1 }]}
                      onPress={handleClose}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
                        Done
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {phase === "interrupted" && (
                <View style={styles.resultBlock}>
                  <View
                    style={[
                      styles.resultBadge,
                      { backgroundColor: "#f59e0b18", borderColor: "#f59e0b44" },
                    ]}
                  >
                    <Feather name="wifi-off" size={28} color="#f59e0b" />
                    <Text style={[styles.resultTitle, { color: colors.foreground }]}>
                      Connection was interrupted
                    </Text>
                  </View>
                  <Text style={[styles.desc, { color: colors.mutedForeground }]}>
                    Your file uploaded successfully. The server may have finished saving your
                    conversations — check your conversation list now. If nothing appears, try
                    importing again.
                  </Text>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: colors.primary }]}
                    onPress={handleClose}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
                      Check my conversations
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {phase === "error" && (
                <View style={styles.resultBlock}>
                  <View
                    style={[
                      styles.resultBadge,
                      {
                        backgroundColor: `${colors.destructive}18`,
                        borderColor: `${colors.destructive}44`,
                      },
                    ]}
                  >
                    <Feather name="alert-circle" size={28} color={colors.destructive} />
                    <Text style={[styles.resultTitle, { color: colors.foreground }]}>
                      Import failed
                    </Text>
                  </View>
                  <Text
                    style={[styles.errorDetail, { color: colors.mutedForeground }]}
                    numberOfLines={5}
                  >
                    {errorMsg}
                  </Text>
                  <View style={styles.rowButtons}>
                    <TouchableOpacity
                      style={[
                        styles.btn,
                        styles.btnOutline,
                        { borderColor: colors.border, flex: 1 },
                      ]}
                      onPress={handleClose}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.btnText, { color: colors.foreground }]}>Close</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: colors.primary, flex: 1 }]}
                      onPress={() => {
                        reset();
                        void handleImport();
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
                        Try Again
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function StatRow({
  label,
  value,
  valueColor,
  mutedColor,
}: {
  label: string;
  value: number;
  valueColor: string;
  mutedColor: string;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, { color: mutedColor }]}>{label}</Text>
      <Text style={[styles.statValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 24,
    maxHeight: "90%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  body: { gap: 20, paddingBottom: 8 },
  desc: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  dropZone: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 10,
  },
  dropZoneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  dropZoneTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  dropZoneSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  statusBlock: { alignItems: "center", gap: 14, paddingVertical: 16 },
  statusText: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  progressGroup: { width: "100%", gap: 6 },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  btn: {
    height: 50,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnOutline: { borderWidth: 1 },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  resultBlock: { gap: 16 },
  resultBadge: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    gap: 10,
  },
  resultTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  statsList: { gap: 10 },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statLabel: { fontSize: 15, fontFamily: "Inter_400Regular" },
  statValue: { fontSize: 17, fontFamily: "Inter_700Bold" },
  errorDetail: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  rowButtons: { flexDirection: "row", gap: 10 },
});
