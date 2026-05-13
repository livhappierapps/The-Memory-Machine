import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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

import {
  useCreateThread,
  useDeleteThread,
  useListProfiles,
  useListThreads,
  useUpdateThread,
} from "@workspace/api-client-react";
import type { Thread } from "@workspace/api-client-react";

import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { useProfile } from "@/contexts/ProfileContext";
import { useColors } from "@/hooks/useColors";

export default function VaultScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { activeProfile, setActiveProfile, activeProfileId } = useProfile();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: profiles } = useListProfiles();

  useEffect(() => {
    if (!activeProfile && profiles && profiles.length > 0) {
      setActiveProfile(profiles[0]!);
    }
  }, [profiles, activeProfile, setActiveProfile]);

  const {
    data: threads,
    isLoading,
    refetch,
    isRefetching,
  } = useListThreads({
    params: {
      query: {
        search: debouncedSearch || undefined,
        archived: showArchived,
        profileId: activeProfileId,
      },
    },
  });

  const createThread = useCreateThread();
  const deleteThread = useDeleteThread();
  const updateThread = useUpdateThread();

  const handleNewThread = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await createThread.mutateAsync({
        data: {
          title: "New conversation",
          profileId: activeProfileId,
        },
      });
      await refetch();
      router.push(`/thread/${result.id}`);
    } catch {
      Alert.alert("Error", "Could not create thread.");
    }
  }, [createThread, activeProfileId, refetch]);

  const handleDelete = useCallback(
    (thread: Thread) => {
      Alert.alert("Delete vault?", `"${thread.title}" will be permanently deleted.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            try {
              await deleteThread.mutateAsync({ params: { path: { threadId: thread.id } } });
              await refetch();
            } catch {
              Alert.alert("Error", "Could not delete thread.");
            }
          },
        },
      ]);
    },
    [deleteThread, refetch],
  );

  const handlePin = useCallback(
    async (thread: Thread) => {
      Haptics.selectionAsync();
      await updateThread.mutateAsync({
        params: { path: { threadId: thread.id } },
        data: { pinned: !thread.pinned },
      });
      await refetch();
    },
    [updateThread, refetch],
  );

  const renderThread = useCallback(
    ({ item }: { item: Thread }) => (
      <ThreadRow
        thread={item}
        colors={colors}
        onPress={() => router.push(`/thread/${item.id}`)}
        onDelete={() => handleDelete(item)}
        onPin={() => handlePin(item)}
      />
    ),
    [colors, handleDelete, handlePin],
  );

  const pinnedThreads = threads?.filter((t) => t.pinned) ?? [];
  const unpinnedThreads = threads?.filter((t) => !t.pinned) ?? [];
  const displayedThreads = [...pinnedThreads, ...unpinnedThreads];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            style={[styles.profileBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setProfileSwitcherOpen(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.profileEmoji}>{activeProfile?.emoji ?? "🧠"}</Text>
            <Text style={[styles.profileName, { color: colors.foreground }]} numberOfLines={1}>
              {activeProfile?.name ?? "Loading…"}
            </Text>
            <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>

          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: colors.card }]}
              onPress={() => setShowArchived((v) => !v)}
              activeOpacity={0.7}
            >
              <Feather
                name="archive"
                size={18}
                color={showArchived ? colors.primary : colors.mutedForeground}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: colors.primary }]}
              onPress={handleNewThread}
              activeOpacity={0.8}
            >
              <Feather name="edit-2" size={18} color={colors.primaryForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            value={search}
            onChangeText={setSearch}
            placeholder="Search vaults…"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : displayedThreads.length === 0 ? (
        <View style={styles.center}>
          <Feather name="inbox" size={40} color={colors.muted} />
          <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>
            {search ? "No results" : showArchived ? "No archived vaults" : "No vaults yet"}
          </Text>
          {!search && !showArchived && (
            <TouchableOpacity onPress={handleNewThread} activeOpacity={0.8}>
              <Text style={[styles.emptyAction, { color: colors.primary }]}>
                Start a new conversation
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={displayedThreads}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderThread}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      <ProfileSwitcher
        visible={profileSwitcherOpen}
        profiles={profiles ?? []}
        activeProfileId={activeProfileId}
        onSelect={(p) => {
          setActiveProfile(p);
          setProfileSwitcherOpen(false);
        }}
        onClose={() => setProfileSwitcherOpen(false)}
        onSignOut={async () => {
          await signOut();
          router.replace("/");
        }}
      />
    </View>
  );
}

interface ThreadRowProps {
  thread: Thread;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onPress: () => void;
  onDelete: () => void;
  onPin: () => void;
}

function ThreadRow({ thread, colors, onPress, onDelete, onPin }: ThreadRowProps) {
  const [showMenu, setShowMenu] = useState(false);

  const ts = thread.lastMessageAt ?? thread.createdAt;
  let timeLabel = "";
  try {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) timeLabel = "now";
    else if (diff < 3_600_000) timeLabel = `${Math.floor(diff / 60_000)}m`;
    else if (diff < 86_400_000) timeLabel = `${Math.floor(diff / 3_600_000)}h`;
    else timeLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    timeLabel = "";
  }

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
      onLongPress={() => setShowMenu(true)}
      activeOpacity={0.7}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
            {thread.pinned && (
              <Text style={{ color: colors.primary }}>📌 </Text>
            )}
            {thread.title}
          </Text>
          <Text style={[styles.rowTime, { color: colors.mutedForeground }]}>{timeLabel}</Text>
        </View>
        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
          {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"} · {thread.model}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.muted} />

      {showMenu && (
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, styles.menuOverlay]}
          onPress={() => setShowMenu(false)}
          activeOpacity={1}
        >
          <View style={[styles.menu, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setShowMenu(false); onPin(); }}
            >
              <Feather name="bookmark" size={16} color={colors.foreground} />
              <Text style={[styles.menuText, { color: colors.foreground }]}>
                {thread.pinned ? "Unpin" : "Pin"}
              </Text>
            </TouchableOpacity>
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setShowMenu(false); onDelete(); }}
            >
              <Feather name="trash-2" size={16} color={colors.destructive} />
              <Text style={[styles.menuText, { color: colors.destructive }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  profileBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
    flex: 1,
    maxWidth: 200,
  },
  profileEmoji: { fontSize: 16 },
  profileName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  headerActions: { flexDirection: "row", gap: 8 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  list: { paddingBottom: 100 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_400Regular" },
  emptyAction: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  rowMain: { flex: 1, gap: 4 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rowMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  menuOverlay: { zIndex: 10, justifyContent: "center", alignItems: "flex-end", paddingRight: 16 },
  menu: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    minWidth: 140,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  menuText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  menuDivider: { height: StyleSheet.hairlineWidth },
});
