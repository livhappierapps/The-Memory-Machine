import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
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

import { importLocalFile, type LocalImportResult } from "@/lib/localVault";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Phase = "idle" | "picking" | "processing" | "done" | "error";

export function ImportSheet({ visible, onClose, onImported }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<LocalImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortedRef = useRef(false);

  const reset = useCallback(() => {
    setPhase("idle");
    setResult(null);
    setErrorMsg(null);
  }, []);

  const handleClose = useCallback(() => {
    abortedRef.current = true;
    reset();
    onClose();
  }, [reset, onClose]);

  const handleImport = useCallback(async () => {
    abortedRef.current = false;
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
      setPhase("processing");
      const imported = await importLocalFile(asset.uri, asset.name ?? "import");
      if (abortedRef.current) return;
      setResult(imported);
      setPhase("done");
      onImported();
    } catch (err) {
      if (abortedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : "Import failed.");
      setPhase("error");
    }
  }, [onImported]);

  const isWorking = phase === "picking" || phase === "processing";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={isWorking ? undefined : handleClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Import on this phone</Text>
            {!isWorking && (
              <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <View style={styles.body}>
              {phase === "idle" && (
                <>
                  <Text style={[styles.desc, { color: colors.mutedForeground }]}>
                    Parses a Grok / ChatGPT export (.zip or .json) on-device. Replit can stay locked. Threads
                    stay on this phone until we have a host again.
                  </Text>
                  <TouchableOpacity
                    style={[styles.dropZone, { borderColor: colors.border }]}
                    onPress={() => void handleImport()}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.dropZoneIcon, { backgroundColor: `${colors.primary}22` }]}>
                      <Feather name="archive" size={28} color={colors.primary} />
                    </View>
                    <Text style={[styles.dropZoneTitle, { color: colors.foreground }]}>Tap to choose file</Text>
                    <Text style={[styles.dropZoneSub, { color: colors.mutedForeground }]}>.zip or .json</Text>
                  </TouchableOpacity>
                </>
              )}
              {phase === "picking" && (
                <View style={styles.statusBlock}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.statusText, { color: colors.mutedForeground }]}>Opening file picker…</Text>
                </View>
              )}
              {phase === "processing" && (
                <View style={styles.statusBlock}>
                  <ActivityIndicator color={colors.primary} size="large" />
                  <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                    Reading conversations on-device…
                  </Text>
                </View>
              )}
              {phase === "done" && result && (
                <View style={styles.resultBlock}>
                  <Text style={[styles.resultTitle, { color: colors.foreground }]}>
                    {result.imported} conversation{result.imported === 1 ? "" : "s"} saved on this phone
                  </Text>
                  <Text style={[styles.desc, { color: colors.mutedForeground }]}>
                    Skipped {result.skipped}
                    {result.errors ? ` · errors ${result.errors}` : ""}
                  </Text>
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
                  <Text style={[styles.resultTitle, { color: colors.destructive }]}>Import failed</Text>
                  <Text style={[styles.desc, { color: colors.mutedForeground }]}>{errorMsg}</Text>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: colors.primary }]}
                    onPress={reset}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Try again</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10, maxHeight: "88%" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: "600" },
  body: { gap: 16, paddingBottom: 8 },
  desc: { fontSize: 14, lineHeight: 20 },
  dropZone: { borderWidth: 1, borderStyle: "dashed", borderRadius: 16, padding: 28, alignItems: "center", gap: 8 },
  dropZoneIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "justify" === "justify" ? "center" : "center" },
  dropZoneTitle: { fontSize: 16, fontWeight: "600" },
  dropZoneSub: { fontSize: 13 },
  statusBlock: { alignItems: "center", gap: 12, paddingVertical: 24 },
  statusText: { fontSize: 14 },
  resultBlock: { gap: 12, paddingVertical: 8 },
  resultTitle: { fontSize: 18, fontWeight: "600" },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  btnText: { fontSize: 16, fontWeight: "600" },
});
