import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { ImportPhase, ImportResult, useImport } from "@/contexts/ImportContext";
import { useColors } from "@/hooks/useColors";

interface Props {
  /** Called when the user taps the banner to reopen the ImportSheet. */
  onPress: () => void;
}

/**
 * Thin persistent banner shown in the vault header while an import is running
 * in the background.  Disappears automatically once the import is idle/done/error
 * (the vault screen owns the toast that fires on completion).
 */
export function ImportProgressBanner({ onPress }: Props) {
  const colors = useColors();
  const { phase, chunksDone, totalChunks, savedCount } = useImport();

  const isActive = phase === "uploading" || phase === "processing";

  const heightAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isActive) {
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
  }, [isActive, heightAnim, opacityAnim]);

  const uploadPct = totalChunks > 0 ? Math.round((chunksDone / totalChunks) * 100) : 0;

  const label =
    phase === "uploading"
      ? totalChunks > 1
        ? `Uploading… ${uploadPct}%`
        : "Uploading…"
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
      pointerEvents={isActive ? "auto" : "none"}
    >
      <TouchableOpacity style={styles.inner} onPress={onPress} activeOpacity={0.85}>
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
