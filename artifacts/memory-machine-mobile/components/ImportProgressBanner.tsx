import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useImport } from "@/contexts/ImportContext";
import { useColors } from "@/hooks/useColors";

interface Props {
  /** Called when the user taps the banner to reopen the ImportSheet. */
  onPress: () => void;
}

/**
 * Thin persistent banner shown in the vault header while an import is running
 * with the sheet closed. Keep terminal results visible until acknowledged,
 * including when the result arrived while the app was backgrounded.
 */
export function ImportProgressBanner({ onPress }: Props) {
  const colors = useColors();
  const { phase, chunksDone, totalChunks, savedCount, result, isUploadPaused, uploadResumed } = useImport();

  const isVisible = phase !== "idle" && phase !== "picking";

  const heightAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isVisible) {
      Animated.parallel([
        Animated.spring(heightAnim, { toValue: 36, useNativeDriver: false, damping: 20, stiffness: 200 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(heightAnim, { toValue: 0, duration: 200, useNativeDriver: false }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 150, useNativeDriver: false }),
      ]).start();
    }
  }, [isVisible, heightAnim, opacityAnim]);

  const uploadPct = totalChunks > 0 ? Math.round((chunksDone / totalChunks) * 100) : 0;

  const label =
    phase === "done"
      ? `Imported ${result?.imported ?? 0} — tap for results`
      : phase === "error"
        ? "Upload stopped — tap for details"
        : phase === "interrupted"
          ? "Check import status — tap for details"
          : phase === "uploading"
      ? isUploadPaused
        ? `Upload paused… ${uploadPct}%`
        : `${uploadResumed ? "Upload resumed" : "Uploading"}… ${uploadPct}%`
      : savedCount > 0
        ? `Importing… ${savedCount} saved`
        : "Importing conversations…";

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          height: heightAnim,
          opacity: opacityAnim,
          backgroundColor: colors.primary,
        },
      ]}
      pointerEvents={isVisible ? "auto" : "none"}
    >
      <TouchableOpacity style={styles.inner} onPress={onPress} activeOpacity={0.85}
        accessibilityRole="button" accessibilityLabel={label}>
        {/* Progress fill behind the content */}
        {phase === "uploading" && (
          <View
            style={[
              styles.fill,
              { backgroundColor: "rgba(255,255,255,0.18)", width: `${Math.max(4, uploadPct)}%` as any },
            ]}
          />
        )}
        {phase === "processing" && (
          <View style={[styles.fill, { backgroundColor: "rgba(255,255,255,0.12)", width: "100%" }]} />
        )}

        <View style={styles.row}>
          <Feather name="upload-cloud" size={13} color="rgba(255,255,255,0.9)" />
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          <Feather name="chevron-right" size={13} color="rgba(255,255,255,0.7)" />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: "hidden",
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
  },
  label: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.95)",
  },
});
