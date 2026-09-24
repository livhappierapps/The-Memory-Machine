import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { loadLocalThreads, type LocalThread } from "@/lib/localVault";

export default function LocalThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [thread, setThread] = useState<LocalThread | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await loadLocalThreads();
      if (!cancelled) {
        setThread(all.find((t) => t.id === id) ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const messages = [...(thread?.messages ?? [])].reverse();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 6, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {thread?.title ?? (loading ? "Loading" : "Missing thread")}
        </Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={messages}
          inverted
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isUser = item.role === "user";
            return (
              <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
                <View
                  style={[
                    styles.bubble,
                    isUser
                      ? [styles.bubbleUser, { backgroundColor: colors.primary }]
                      : [styles.bubbleAssistant, { backgroundColor: colors.card, borderColor: colors.border }],
                  ]}
                >
                  <Text
                    selectable
                    style={[styles.bubbleText, { color: isUser ? colors.primaryForeground : colors.foreground }]}
                  >
                    {item.content}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 16, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 12, paddingVertical: 12 },
  bubbleRow: { flexDirection: "row", marginVertical: 3, paddingHorizontal: 4 },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubble: { maxWidth: "82%", borderRadius: 16, padding: 12 },
  bubbleUser: { borderBottomRightRadius: 4 },
  bubbleAssistant: { borderWidth: 1, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
});
