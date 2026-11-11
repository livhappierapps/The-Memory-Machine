import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PreloadedFile, useImport } from "@/contexts/ImportContext";
import { useColors } from "@/hooks/useColors";

// Phrases emitted by the server when the file is the wrong format.
const WRONG_FORMAT_PATTERNS = [
  "No JSON files found inside this ZIP",
  "No conversations found in this file",
  "does not contain valid JSON",
  "doesn't look like a Grok export",
  "Could not open the ZIP file",
];

function isWrongFormatError(msg: string): boolean {
  return WRONG_FORMAT_PATTERNS.some((p) => msg.includes(p));
}

const GROK_EXPORT_URL = "https://x.com/i/grok";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** When set the sheet opens directly into upload mode, bypassing the picker. */
  preloadedFile?: PreloadedFile | null;
}

export function ImportSheet({ visible, onClose, preloadedFile }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [exportHelpExpanded, setExportHelpExpanded] = useState(false);

  useEffect(() => {
    if (!visible) setExportHelpExpanded(false);
  }, [visible]);

  const {
    phase,
    chunksDone,
    totalChunks,
    savedCount,
    statusMsg,
    result,
    errorMsg,
    startImportFromPicker,
    startImportFromFile,
    cancelImport,
    resetImport,
    retryImport,
  } = useImport();

  // Auto-start when a preloaded file arrives (share intent path).
  const startedForFileRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible || !preloadedFile || phase !== "idle") return;
    if (startedForFileRef.current === preloadedFile.uri) return;
    startedForFileRef.current = preloadedFile.uri;
    startImportFromFile(preloadedFile);
  }, [visible, preloadedFile, phase, startImportFromFile]);

  const isWorking = phase === "uploading" || phase === "processing" || phase === "picking";
  const canDismissWithoutCancelling = phase === "uploading" || phase === "processing";

  /**
   * Close the sheet. During upload/processing we just hide it — the import
   * continues in ImportContext and the progress banner takes over in the vault
   * header. Only the explicit Cancel button actually aborts the import.
   */
  const handleClose = useCallback(() => {
    if (!canDismissWithoutCancelling) {
      // In picking/idle/done/error/interrupted: reset and close
      if (phase === "picking") {
        cancelImport();
      }
    }
    onClose();
  }, [canDismissWithoutCancelling, phase, cancelImport, onClose]);

  const handleCancel = useCallback(() => {
    cancelImport();
    onClose();
  }, [cancelImport, onClose]);

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
      onRequestClose={handleClose}
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
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name="x" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
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
                    onPress={() => void startImportFromPicker()}
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
                  <TouchableOpacity
                    style={styles.exportHelpToggle}
                    onPress={() => setExportHelpExpanded((expanded) => !expanded)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: exportHelpExpanded }}
                    activeOpacity={0.8}
                  >
                    <Feather name="info" size={16} color={colors.primary} />
                    <Text style={[styles.exportHelpLabel, { color: colors.primary }]}>
                      How to export from Grok?
                    </Text>
                    <Feather
                      name={exportHelpExpanded ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                  {exportHelpExpanded && <GrokExportHelp />}
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
                  </View>

                  <View style={[styles.dismissHint, { backgroundColor: `${colors.primary}14`, borderColor: `${colors.primary}30` }]}>
                    <Feather name="info" size={13} color={colors.primary} />
                    <Text style={[styles.dismissHintText, { color: colors.foreground }]}>
                      You can close this sheet — the import keeps running in the background.
                    </Text>
                  </View>

                  <View style={styles.rowButtons}>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnOutline, { borderColor: colors.border, flex: 1 }]}
                      onPress={handleCancel}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel import</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: colors.primary, flex: 1 }]}
                      onPress={handleClose}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Continue browsing</Text>
                    </TouchableOpacity>
                  </View>
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

                  <View style={[styles.dismissHint, { backgroundColor: `${colors.primary}14`, borderColor: `${colors.primary}30` }]}>
                    <Feather name="info" size={13} color={colors.primary} />
                    <Text style={[styles.dismissHintText, { color: colors.foreground }]}>
                      You can close this sheet — the import keeps running in the background.
                    </Text>
                  </View>

                  <View style={styles.rowButtons}>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnOutline, { borderColor: colors.border, flex: 1 }]}
                      onPress={handleCancel}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.btnText, { color: colors.foreground }]}>Cancel import</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: colors.primary, flex: 1 }]}
                      onPress={handleClose}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Continue browsing</Text>
                    </TouchableOpacity>
                  </View>
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
                      onPress={resetImport}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.btnText, { color: colors.foreground }]}>
                        Import another
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: colors.primary, flex: 1 }]}
                      onPress={() => { resetImport(); onClose(); }}
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
                    onPress={() => { resetImport(); onClose(); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
                      Check my conversations
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {phase === "error" && (() => {
                const wrongFormat = isWrongFormatError(errorMsg ?? "");
                return (
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
                      <Feather
                        name={wrongFormat ? "x-circle" : "alert-circle"}
                        size={28}
                        color={colors.destructive}
                      />
                      <Text style={[styles.resultTitle, { color: colors.foreground }]}>
                        {wrongFormat ? "Wrong file format" : "Import failed"}
                      </Text>
                    </View>

                    {wrongFormat ? (
                      <>
                        <Text style={[styles.desc, { color: colors.mutedForeground }]}>
                          This doesn't look like a Grok export. Photo archives, WhatsApp backups,
                          and other ZIPs won't work here.
                        </Text>
                        <GrokExportHelp />
                      </>
                    ) : (
                      <Text
                        style={[styles.errorDetail, { color: colors.mutedForeground }]}
                        numberOfLines={5}
                      >
                        {errorMsg}
                      </Text>
                    )}

                    <View style={styles.rowButtons}>
                      <TouchableOpacity
                        style={[
                          styles.btn,
                          styles.btnOutline,
                          { borderColor: colors.border, flex: 1 },
                        ]}
                        onPress={() => { resetImport(); onClose(); }}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.btnText, { color: colors.foreground }]}>Close</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, { backgroundColor: colors.primary, flex: 1 }]}
                        onPress={() => void retryImport()}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
                          Try Again
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })()}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function GrokExportHelp() {
  const colors = useColors();

  return (
    <View style={styles.exportHelpContent}>
      <View
        style={[
          styles.tipBox,
          { backgroundColor: `${colors.primary}10`, borderColor: `${colors.primary}30` },
        ]}
      >
        <Feather name="info" size={16} color={colors.primary} />
        <Text style={[styles.tipText, { color: colors.foreground }]}>
          <Text style={{ fontFamily: "Inter_600SemiBold" }}>
            How to export from Grok:{" "}
          </Text>
          Open Grok → tap your profile → Settings → Download your data →
          Conversations. You'll receive a ZIP file — share that here.
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.btn, styles.btnOutline, { borderColor: colors.primary }]}
        onPress={() => void Linking.openURL(GROK_EXPORT_URL)}
        accessibilityRole="link"
        activeOpacity={0.8}
      >
        <Feather name="external-link" size={16} color={colors.primary} />
        <Text style={[styles.btnText, { color: colors.primary }]}>Open Grok</Text>
      </TouchableOpacity>
    </View>
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
  dismissHint: {
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: "flex-start",
    alignSelf: "stretch",
  },
  dismissHintText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
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
  rowButtons: { flexDirection: "row", gap: 10, width: "100%" },
  exportHelpToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
  },
  exportHelpLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  exportHelpContent: { gap: 16 },
  tipBox: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "flex-start",
  },
  tipText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
});
