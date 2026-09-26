import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ImportSheet } from "@/components/ImportSheet";
import { useColors } from "@/hooks/useColors";
import {
  deleteLocalThread,
  loadLocalThreads,
  searchLocalThreads,
  type LocalThread,
} from "@/lib/localVault";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function PhoneVaultScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [threads, setThreads] = useState<LocalThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setThreads(await loadLocalThreads());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const askDelete = useCallback((item: LocalThread) => {
    Alert.alert("Delete from this phone?", item.title, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setThreads(await deleteLocalThread(item.id));
          })();
        },
      },
    ]);
  }, []);

  const shown = searchLocalThreads(threads, search);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <Text style={[styles.title, { color: colors.foreground }]}>On this phone</Text>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.primary }]}
            onPress={() => setImportOpen(true)}
          >
            <Feather name="upload" size={18} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>
        <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            value={search}
            onChangeText={setSearch}
            placeholder="Search local threads"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : shown.length === 0 ? (
        <View style={styles.center}>
          <Feather name="smartphone" size={40} color={colors.muted} />
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            {search ? "No matches" : "Nothing imported yet"}
          </Text>
          <TouchableOpacity onPress={() => setImportOpen(true)}>
            <Text style={{ color: colors.primary, marginTop: 8 }}>Import a zip</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(item) => item.id}
          onRefresh={() => void refresh()}
          refreshing={loading}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push(`/thread/local/${item.id}`)}
              onLongPress={() => askDelete(item)}
              delayLongPress={380}
              activeOpacity={0.75}
            >
              <View style={styles.rowTop}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <TouchableOpacity onPress={() => askDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                {item.messages.length} messages
                {item.createdAt ? ` · ${formatWhen(item.createdAt)}` : ""}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      <ImportSheet
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          void refresh();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 22, fontWeight: "700" },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    height: 40,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { marginTop: 10, fontSize: 15 },
  list: { padding: 16, gap: 8 },
  row: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: "600" },
  rowMeta: { fontSize: 13 },
});
