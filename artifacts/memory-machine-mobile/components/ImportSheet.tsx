import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Phase = "idle" | "picking" | "uploading" | "processing" | "done" | "error";

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

const CHUNK_SIZE = 5 * 1024 * 1024;

export function ImportSheet({ visible, onClose, onImported }: Props) {
  const { getToken } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>("idle");
  const [chunksDone, setChunksDone] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const baseUrl = `https://${process.env["EXPO_PUBLIC_DOMAIN"]}`;

  const reset = () => {
    setPhase("idle");
    setChunksDone(0);
    setTotalChunks(0);
    setResult(null);
    setErrorMsg(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const uploadChunk = useCallback(
    async (
      fileUri: string,
      uploadId: string,
      chunkIndex: number,
      chunks: number,
      position: number,
      length: number,
      mimeType: string,
      fileName: string,
    ) => {
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
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
      form.append("file", blob, fileName);

      const res = await fetch(`${baseUrl}/api/import/chunk`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Chunk ${chunkIndex + 1}/${chunks} failed (${res.status}): ${text.slice(0, 100)}`);
      }
    },
    [baseUrl, getToken],
  );

  const handleImport = useCallback(async () => {
    setPhase("picking");
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/json", "application/octet-stream", "*/*"],
        copyToCacheDirectory: true,
      });

      if (picked.canceled || !picked.assets || picked.assets.length === 0) {
        setPhase("idle");
        return;
      }

      const asset = picked.assets[0]!;
      const fileUri = asset.uri;
      const mimeType = asset.mimeType ?? "application/octet-stream";
      const fileName = asset.name ?? "import.zip";
      const uploadId = `mob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const info = await FileSystem.getInfoAsync(fileUri);
      if (!info.exists) throw new Error("Selected file could not be read.");

      const fileSize = (info as { exists: true; size?: number }).size ?? 0;
      const chunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));

      setPhase("uploading");
      setTotalChunks(chunks);
      setChunksDone(0);

      for (let i = 0; i < chunks; i++) {
        const position = i * CHUNK_SIZE;
        const length = Math.min(CHUNK_SIZE, fileSize - position);
        await uploadChunk(fileUri, uploadId, i, chunks, position, length, mimeType, fileName);
        setChunksDone(i + 1);
      }

      setPhase("processing");

      const freshToken = await getToken();
      const finalizeRes = await expoFetch(`${baseUrl}/api/import/finalize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${freshToken}`,
        },
        body: JSON.stringify({ uploadId }),
      });

      if (!finalizeRes.ok) {
        const text = await finalizeRes.text().catch(() => "");
        throw new Error(`Finalize failed (${finalizeRes.status}): ${text.slice(0, 120)}`);
      }

      const reader = finalizeRes.body?.getReader();
      if (!reader) throw new Error("No response body from server");

      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: ImportResult = { imported: 0, skipped: 0, errors: 0 };

      while (true) {
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
            };
            if (event.type === "done") {
              finalResult = {
                imported: event.imported ?? 0,
                skipped: event.skipped ?? 0,
                errors: event.errors ?? 0,
              };
            }
          } catch {
            // ignore individual parse errors
          }
        }
      }

      setResult(finalResult);
      setPhase("done");
      onImported();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed. Please try again.";
      setErrorMsg(msg);
      setPhase("error");
    }
  }, [baseUrl, getToken, onImported, uploadChunk]);

  const isWorking = phase === "uploading" || phase === "processing" || phase === "picking";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Import Conversations</Text>
            <TouchableOpacity
              onPress={handleClose}
              disabled={isWorking}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.desc, { color: colors.mutedForeground }]}>
            Select a Grok conversation export (.zip or .json) to import into your vault.
          </Text>

          {phase === "idle" && (
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={handleImport}
              activeOpacity={0.8}
            >
              <Feather name="upload" size={18} color={colors.primaryForeground} />
              <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Choose File</Text>
            </TouchableOpacity>
          )}

          {phase === "picking" && (
            <View style={styles.statusRow}>
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
                Uploading chunk {chunksDone} of {totalChunks}…
              </Text>
              <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: colors.primary,
                      width: `${Math.round((chunksDone / Math.max(totalChunks, 1)) * 100)}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          {phase === "processing" && (
            <View style={styles.statusBlock}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                Parsing and saving conversations…
              </Text>
              <Text style={[styles.statusHint, { color: colors.muted }]}>
                This may take a minute for large exports.
              </Text>
            </View>
          )}

          {phase === "done" && result && (
            <View style={styles.resultBlock}>
              <View
                style={[
                  styles.resultBadge,
                  { backgroundColor: `${colors.primary}22`, borderColor: colors.primary },
                ]}
              >
                <Feather name="check-circle" size={28} color={colors.primary} />
                <Text style={[styles.resultTitle, { color: colors.foreground }]}>Import complete</Text>
              </View>
              <View style={styles.resultStats}>
                <StatRow label="Imported" value={result.imported} valueColor={colors.primary} textColor={colors.foreground} mutedColor={colors.mutedForeground} />
                <StatRow label="Skipped" value={result.skipped} valueColor={colors.mutedForeground} textColor={colors.foreground} mutedColor={colors.mutedForeground} />
                {result.errors > 0 && (
                  <StatRow label="Errors" value={result.errors} valueColor={colors.destructive} textColor={colors.foreground} mutedColor={colors.mutedForeground} />
                )}
              </View>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.primary }]}
                onPress={handleClose}
                activeOpacity={0.8}
              >
                <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Done</Text>
              </TouchableOpacity>
            </View>
          )}

          {phase === "error" && (
            <View style={styles.resultBlock}>
              <View
                style={[
                  styles.resultBadge,
                  {
                    backgroundColor: `${colors.destructive}22`,
                    borderColor: colors.destructive,
                  },
                ]}
              >
                <Feather name="alert-circle" size={28} color={colors.destructive} />
                <Text style={[styles.resultTitle, { color: colors.foreground }]}>Import failed</Text>
              </View>
              <Text style={[styles.errorDetail, { color: colors.mutedForeground }]} numberOfLines={4}>
                {errorMsg}
              </Text>
              <View style={styles.errorActions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnOutline, { borderColor: colors.border, flex: 1 }]}
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
                  <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Try Again</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function StatRow({
  label,
  value,
  valueColor,
  textColor,
  mutedColor,
}: {
  label: string;
  value: number;
  valueColor: string;
  textColor: string;
  mutedColor: string;
}) {
  void textColor;
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
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 24,
    gap: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  desc: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  btn: {
    height: 50,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnOutline: { borderWidth: 1 },
  btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  statusBlock: { alignItems: "center", gap: 12, paddingVertical: 16 },
  statusText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  statusHint: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  progressTrack: { height: 4, borderRadius: 2, width: "100%", overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  resultBlock: { gap: 16 },
  resultBadge: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    gap: 8,
  },
  resultTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  resultStats: { gap: 8 },
  statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statLabel: { fontSize: 15, fontFamily: "Inter_400Regular" },
  statValue: { fontSize: 17, fontFamily: "Inter_700Bold" },
  errorDetail: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  errorActions: { flexDirection: "row", gap: 10 },
  muted: {},
});
