import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
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
  const CHUNK_SIZE = 5 * 1024 * 1024;

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
      const uploadId = `mob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      setPhase("uploading");

      const token = await getToken();

      const form = new FormData();
      form.append("uploadId", uploadId);
      form.append("chunkIndex", "0");
      form.append("totalChunks", "1");
      form.append(
        "file",
        {
          uri: asset.uri,
          type: asset.mimeType ?? "application/octet-stream",
          name: asset.name ?? "import.zip",
        } as unknown as Blob,
      );

      setTotalChunks(1);
      const chunkRes = await fetch(`${baseUrl}/api/import/chunk`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!chunkRes.ok) {
        const text = await chunkRes.text().catch(() => "");
        throw new Error(`Upload failed (${chunkRes.status}): ${text.slice(0, 120)}`);
      }
      setChunksDone(1);

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
              processed?: number;
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
  }, [baseUrl, getToken, onImported]);

  const isWorking = phase === "uploading" || phase === "processing" || phase === "picking";

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Import Conversations</Text>
            <TouchableOpacity onPress={handleClose} disabled={isWorking} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
              <Text style={[styles.statusText, { color: colors.mutedForeground }]}>Opening file picker…</Text>
            </View>
          )}

          {phase === "uploading" && (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                Uploading… {chunksDone}/{totalChunks}
              </Text>
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
              <View style={[styles.resultBadge, { backgroundColor: `${colors.primary}22`, borderColor: colors.primary }]}>
                <Feather name="check-circle" size={28} color={colors.primary} />
                <Text style={[styles.resultTitle, { color: colors.foreground }]}>Import complete</Text>
              </View>
              <View style={styles.resultStats}>
                <StatRow label="Imported" value={result.imported} color={colors.primary} foreground={colors.foreground} muted={colors.mutedForeground} />
                <StatRow label="Skipped" value={result.skipped} color={colors.mutedForeground} foreground={colors.foreground} muted={colors.mutedForeground} />
                {result.errors > 0 && (
                  <StatRow label="Errors" value={result.errors} color={colors.destructive} foreground={colors.foreground} muted={colors.mutedForeground} />
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
              <View style={[styles.resultBadge, { backgroundColor: `${colors.destructive}22`, borderColor: colors.destructive }]}>
                <Feather name="alert-circle" size={28} color={colors.destructive} />
                <Text style={[styles.resultTitle, { color: colors.foreground }]}>Import failed</Text>
              </View>
              <Text style={[styles.errorDetail, { color: colors.mutedForeground }]} numberOfLines={4}>
                {errorMsg}
              </Text>
              <View style={styles.errorActions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnOutline, { borderColor: colors.border }]}
                  onPress={handleClose}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.btnText, { color: colors.foreground }]}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: colors.primary, flex: 1 }]}
                  onPress={() => { reset(); handleImport(); }}
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
  color,
  foreground,
  muted,
}: {
  label: string;
  value: number;
  color: string;
  foreground: string;
  muted: string;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, { color: muted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: color || foreground }]}>{value}</Text>
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
