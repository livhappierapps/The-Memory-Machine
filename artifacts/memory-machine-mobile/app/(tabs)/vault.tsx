import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
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
  useListProfiles,
  useListThreads,
  useUpdateThread,
  getListThreadsQueryKey,
} from "@workspace/api-client-react";
import type { Thread } from "@workspace/api-client-react";

import { ImportProgressBanner } from "@/components/ImportProgressBanner";
import { ImportSheet } from "@/components/ImportSheet";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { useImport } from "@/contexts/ImportContext";
import { useProfile } from "@/contexts/ProfileContext";
import { useIncomingShareContext } from "@/contexts/IncomingShareContext";
import { useColors } from "@/hooks/useColors";

export default function VaultScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { activeProfile, setActiveProfile, activeProfileId, storedProfileId } = useProfile();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);
  const [importSheetOpen, setImportSheetOpen] = useState(false);

  // Import context — gives us live phase/result so we can show the banner and toast.
  const { phase: importPhase, result: importResult } = useImport();

  // Toast state — shown briefly after an import completes or fails.
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevImportPhase = useRef(importPhase);

  const showToast = useCallback((message: string, isError: boolean) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, isError });
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [toastOpacity]);

  // Share-intent integration: incomingFile is set by the tab layout's
  // useIncomingShare call (which also navigates here) so the import sheet
  // opens regardless of which tab was active when the ZIP was shared.
  const { incomingFile, clearIncoming } = useIncomingShareContext();
  useEffect(() => {
    if (incomingFile) {
      setImportSheetOpen(true);
    }
  }, [incomingFile]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: profiles } = useListProfiles();

  // Watch for import phase transitions to "done" / "error" / "interrupted"
  // so we can refresh the thread list and surface a result toast, even when
  // the ImportSheet has been dismissed.
  const refetchRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!activeProfile && profiles && profiles.length > 0) {
      const restored = storedProfileId
        ? profiles.find((p) => p.id === storedProfileId)
        : undefined;
      setActiveProfile(restored ?? profiles[0]!);
    }
  }, [profiles, activeProfile, setActiveProfile, storedProfileId]);

  const {
    data: threads,
    isLoading,
    refetch,
    isRefetching,
  } = useListThreads({
    search: debouncedSearch || undefined,
    archived: showArchived,
    profileId: activeProfileId,
    source: "chat",
  });

  // Keep a stable ref to refetch so the phase-watcher effect can call it
  // without being in its dependency array (avoids looping).
  refetchRef.current = refetch;

  const notesParams = { profileId: activeProfileId, source: "mcp" } as const;
  const {
    data: notes,
    refetch: refetchNotes,
    isRefetching: isRefetchingNotes,
    dataUpdatedAt: notesUpdatedAt,
  } = useListThreads(
    notesParams,
    // Poll every 30 s so MCP memories saved by Leo in Grok sessions appear
    // automatically — no manual export or pull-to-refresh needed.
    { query: { queryKey: getListThreadsQueryKey(notesParams), refetchInterval: 30_000 } },
  );

  const [notesExpanded, setNotesExpanded] = useState(true);
  const [notesPinnedOnly, setNotesPinnedOnly] = useState(false);
  const [notesRecentOnly, setNotesRecentOnly] = useState(false);
  // Recompute on render (including each sync) so the rolling window stays current.
  const now = Date.now();
  const recentCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const displayedNotes = notes?.filter((note) => {
    if (notesPinnedOnly && !note.pinned) return false;
    if (!notesRecentOnly) return true;
    const createdAt = new Date(note.createdAt).getTime();
    return createdAt >= recentCutoff && createdAt <= now;
  });
  const hasNotesFilters = notesPinnedOnly || notesRecentOnly;

  // When the import transitions to a terminal phase (done / error / interrupted)
  // refresh the thread list and show a brief result toast at the top of the screen.
  useEffect(() => {
    const prev = prevImportPhase.current;
    prevImportPhase.current = importPhase;

    const wasActive = prev === "uploading" || prev === "processing";
    if (!wasActive) return;

    if (importPhase === "done") {
      void refetchRef.current?.();
      clearIncoming();
      const n = importResult?.imported ?? 0;
      showToast(
        `✓ ${n} conversation${n === 1 ? "" : "s"} imported`,
        false,
      );
    } else if (importPhase === "error") {
      showToast("Import failed — tap to retry", true);
    } else if (importPhase === "interrupted") {
      void refetchRef.current?.();
      clearIncoming();
      showToast("Import may be incomplete — check your vault", true);
    }
  }, [importPhase, importResult, clearIncoming, showToast]);

  const createThread = useCreateThread();
  const updateThread = useUpdateThread();
  const { getToken } = useAuth();
  const domain = process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "";

  // Deletion flow state
  const [deletionThread, setDeletionThread] = useState<Thread | null>(null);
  const [deletionStep, setDeletionStep] = useState<"confirming" | "otp" | "keyphrase" | "waiting" | null>(null);
  const [deletionRequestId, setDeletionRequestId] = useState<number | null>(null);
  const [deletionOtp, setDeletionOtp] = useState("");
  const [deletionKeyphrase, setDeletionKeyphrase] = useState("");
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [deletionError, setDeletionError] = useState("");

  const closeDeletion = useCallback(() => {
    setDeletionThread(null);
    setDeletionStep(null);
    setDeletionRequestId(null);
    setDeletionOtp("");
    setDeletionKeyphrase("");
    setDeletionError("");
  }, []);

  const handleStartDeletion = useCallback(async () => {
    if (!deletionThread) return;
    setDeletionLoading(true);
    setDeletionError("");
    try {
      const token = await getToken();
      const res = await fetch(`${domain}/api/deletion-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetType: "thread", targetIds: [deletionThread.id] }),
      });
      const data = (await res.json()) as { id?: number; error?: string; message?: string };
      if (!res.ok) {
        if (data.error === "two_factor_required") {
          setDeletionError("Enable two-factor authentication on your account first, then try again.");
        } else if (data.error === "recency_lock") {
          setDeletionError(data.message ?? "This thread is within the 30-day protection period.");
        } else {
          setDeletionError(data.error ?? "Failed to start deletion request.");
        }
        return;
      }
      setDeletionRequestId(data.id ?? null);
      setDeletionStep("otp");
    } catch {
      setDeletionError("Network error. Please try again.");
    } finally {
      setDeletionLoading(false);
    }
  }, [deletionThread, domain, getToken]);

  const handleConfirmOtp = useCallback(async (keyphrase?: string) => {
    if (!deletionRequestId) return;
    setDeletionLoading(true);
    setDeletionError("");
    try {
      const token = await getToken();
      const body: Record<string, string> = { otp: deletionOtp };
      if (keyphrase) body.keyphrase = keyphrase;
      const res = await fetch(`${domain}/api/deletion-requests/${deletionRequestId}/confirm-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        if (data.error === "keyphrase_required") {
          setDeletionStep("keyphrase");
          setDeletionError("");
        } else if (data.error === "invalid_otp") {
          setDeletionError("Incorrect code. Check your email and try again.");
        } else {
          setDeletionError(data.error ?? "OTP verification failed.");
        }
        return;
      }
      setDeletionStep("waiting");
    } catch {
      setDeletionError("Network error. Please try again.");
    } finally {
      setDeletionLoading(false);
    }
  }, [deletionRequestId, deletionOtp, domain, getToken]);

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

  const handleRefetchAll = useCallback(async () => {
    await Promise.all([refetch(), refetchNotes()]);
  }, [refetch, refetchNotes]);

  const handleDelete = useCallback(
    (thread: Thread) => {
      const ageMs = Date.now() - new Date(thread.createdAt).getTime();
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      if (ageMs < THIRTY_DAYS_MS) {
        const daysLeft = Math.ceil((THIRTY_DAYS_MS - ageMs) / (24 * 60 * 60 * 1000));
        Alert.alert(
          "Thread Locked",
          `This conversation is protected for ${daysLeft} more day${daysLeft !== 1 ? "s" : ""}. Threads cannot be deleted within 30 days of creation.`,
          [{ text: "OK" }],
        );
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setDeletionThread(thread);
      setDeletionOtp("");
      setDeletionError("");
      setDeletionStep("confirming");
    },
    [],
  );

  const handlePin = useCallback(
    async (thread: Thread) => {
      Haptics.selectionAsync();
      await updateThread.mutateAsync({
        threadId: thread.id,
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
              style={[styles.iconBtn, { backgroundColor: colors.card }]}
              onPress={() => setImportSheetOpen(true)}
              activeOpacity={0.7}
            >
              <Feather name="upload" size={18} color={colors.mutedForeground} />
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

        {/* Import progress banner — slides in while an import runs in the background */}
        <ImportProgressBanner onPress={() => setImportSheetOpen(true)} />

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

      {/* Result toast — auto-dismisses after ~3 s */}
      {toast && (
        <Animated.View
          style={[
            styles.toast,
            {
              backgroundColor: toast.isError ? colors.destructive : colors.primary,
              opacity: toastOpacity,
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.toastText}>{toast.message}</Text>
        </Animated.View>
      )}

      {/* List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={displayedThreads}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderThread}
          refreshing={isRefetching}
          onRefresh={handleRefetchAll}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            notes && notes.length > 0 && !showArchived && !search ? (
              <View style={styles.notesSection}>
                <TouchableOpacity
                  style={styles.notesSectionHeader}
                  onPress={() => setNotesExpanded((v) => !v)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Leo Memories"
                  accessibilityState={{ expanded: notesExpanded }}
                >
                  <Feather name="zap" size={14} color={colors.primary} />
                  <Text style={[styles.notesSectionTitle, { color: colors.mutedForeground }]}>
                    Leo Memories
                  </Text>
                  <Text style={[styles.notesSectionCount, { color: colors.mutedForeground }]}>
                    {hasNotesFilters ? `${displayedNotes?.length ?? 0} / ${notes.length}` : notes.length}
                  </Text>
                  {/* Live sync indicator */}
                  <View style={styles.liveBadge}>
                    <View
                      style={[
                        styles.liveDot,
                        { backgroundColor: isRefetchingNotes ? colors.mutedForeground : "#22c55e" },
                      ]}
                    />
                    <Text style={[styles.liveLabel, { color: isRefetchingNotes ? colors.mutedForeground : "#22c55e" }]}>
                      {isRefetchingNotes ? "syncing" : "live"}
                    </Text>
                  </View>
                  <Feather
                    name={notesExpanded ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={colors.mutedForeground}
                  />
                </TouchableOpacity>
                {(notes.length > 5 || hasNotesFilters) && (
                  <View style={styles.notesFilterControls}>
                    <TouchableOpacity
                      style={styles.notesFilterToggle}
                      onPress={() => setNotesPinnedOnly((value) => !value)}
                      accessibilityRole="switch"
                      accessibilityLabel="Pinned only"
                      accessibilityState={{ checked: notesPinnedOnly }}
                      activeOpacity={0.7}
                    >
                      <Feather
                        name={notesPinnedOnly ? "check-square" : "square"}
                        size={16}
                        color={notesPinnedOnly ? colors.primary : colors.mutedForeground}
                      />
                      <Text style={[styles.notesFilterLabel, { color: notesPinnedOnly ? colors.primary : colors.mutedForeground }]}>
                        Pinned only
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.notesFilterToggle}
                      onPress={() => setNotesRecentOnly((value) => !value)}
                      accessibilityRole="switch"
                      accessibilityLabel="Last 7 days"
                      accessibilityState={{ checked: notesRecentOnly }}
                      activeOpacity={0.7}
                    >
                      <Feather
                        name={notesRecentOnly ? "check-square" : "square"}
                        size={16}
                        color={notesRecentOnly ? colors.primary : colors.mutedForeground}
                      />
                      <Text style={[styles.notesFilterLabel, { color: notesRecentOnly ? colors.primary : colors.mutedForeground }]}>
                        Last 7 days
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                {notesExpanded && hasNotesFilters && displayedNotes?.length === 0 && (
                  <Text style={[styles.notesEmpty, { color: colors.mutedForeground }]}>
                    {notesPinnedOnly && notesRecentOnly
                      ? "No pinned Leo memories from the last 7 days. Turn off the filters to see all memories."
                      : notesRecentOnly
                        ? "No Leo memories from the last 7 days. Turn off Last 7 days to see all memories."
                        : "No pinned Leo memories yet. Turn off Pinned only to see all memories."}
                  </Text>
                )}
                {notesExpanded && displayedNotes?.map((note) => (
                  <TouchableOpacity
                    key={note.id}
                    style={[styles.noteRow, { borderBottomColor: colors.border }]}
                    onPress={() => router.push(`/thread/${note.id}`)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.noteRowMain}>
                      <Text style={[styles.noteRowTitle, { color: colors.foreground }]} numberOfLines={1}>
                        {note.title}
                      </Text>
                      <Text style={[styles.noteRowMeta, { color: colors.mutedForeground }]}>
                        Leo memory · synced {new Date(note.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={colors.muted} />
                  </TouchableOpacity>
                ))}
                {notesUpdatedAt > 0 && (
                  <Text style={[styles.notesLastSynced, { color: colors.mutedForeground }]}>
                    Last synced {new Date(notesUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                )}
                <View style={[styles.notesDivider, { backgroundColor: colors.border }]} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            displayedThreads.length === 0 ? (
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
            ) : null
          }
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

      <ImportSheet
        visible={importSheetOpen}
        onClose={() => {
          setImportSheetOpen(false);
          // Clear the share intent so the hook doesn't re-trigger if the user
          // dismisses the sheet and returns to the vault.
          clearIncoming();
        }}
        preloadedFile={incomingFile}
      />

      {/* Protected deletion flow modal */}
      <Modal
        visible={deletionStep !== null}
        transparent
        animationType="fade"
        onRequestClose={closeDeletion}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={deletionLoading ? undefined : closeDeletion}
        >
          <TouchableOpacity
            style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            activeOpacity={1}
          >
            {deletionStep === "confirming" && (
              <>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Delete Conversation?</Text>
                <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                  "{deletionThread?.title}" will be scheduled for deletion after a 24-hour waiting period. A verification code will be sent to your email, and you can cancel at any time during this window.
                </Text>
                {deletionError ? (
                  <Text style={[styles.modalError, { color: colors.destructive }]}>{deletionError}</Text>
                ) : null}
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colors.muted }]}
                    onPress={closeDeletion}
                    disabled={deletionLoading}
                  >
                    <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colors.destructive }]}
                    onPress={() => void handleStartDeletion()}
                    disabled={deletionLoading}
                  >
                    {deletionLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={[styles.modalBtnText, { color: "#fff" }]}>Start Deletion</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {deletionStep === "otp" && (
              <>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Enter Verification Code</Text>
                <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                  A 6-digit code was sent to your email address. Enter it below to confirm the deletion request.
                </Text>
                <TextInput
                  style={[styles.otpInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  value={deletionOtp}
                  onChangeText={setDeletionOtp}
                  placeholder="123456"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
                {deletionError ? (
                  <Text style={[styles.modalError, { color: colors.destructive }]}>{deletionError}</Text>
                ) : null}
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colors.muted }]}
                    onPress={closeDeletion}
                    disabled={deletionLoading}
                  >
                    <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colors.destructive, opacity: deletionOtp.length < 6 ? 0.5 : 1 }]}
                    onPress={() => void handleConfirmOtp()}
                    disabled={deletionLoading || deletionOtp.length < 6}
                  >
                    {deletionLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={[styles.modalBtnText, { color: "#fff" }]}>Confirm</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {deletionStep === "keyphrase" && (
              <>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Enter Your Keyphrase</Text>
                <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                  Your account is protected by a keyphrase. Enter it below to complete verification.
                </Text>
                <TextInput
                  style={[styles.otpInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background, fontSize: 16, letterSpacing: 1 }]}
                  value={deletionKeyphrase}
                  onChangeText={setDeletionKeyphrase}
                  placeholder="Your keyphrase"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                  autoFocus
                />
                {deletionError ? (
                  <Text style={[styles.modalError, { color: colors.destructive }]}>{deletionError}</Text>
                ) : null}
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colors.muted }]}
                    onPress={closeDeletion}
                    disabled={deletionLoading}
                  >
                    <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colors.destructive, opacity: deletionKeyphrase.length === 0 ? 0.5 : 1 }]}
                    onPress={() => void handleConfirmOtp(deletionKeyphrase)}
                    disabled={deletionLoading || deletionKeyphrase.length === 0}
                  >
                    {deletionLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={[styles.modalBtnText, { color: "#fff" }]}>Verify</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {deletionStep === "waiting" && (
              <>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Deletion Scheduled</Text>
                <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                  Your request is confirmed. You'll receive an email within 24 hours with a link to complete the deletion. You can cancel the request in Settings before then.
                </Text>
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colors.primary }]}
                    onPress={() => { closeDeletion(); void refetch(); }}
                  >
                    <Text style={[styles.modalBtnText, { color: colors.primaryForeground }]}>Done</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
            {thread.pinned ? "📌 " : ""}{thread.title}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 60 },
  notesSection: { paddingTop: 8 },
  notesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  notesSectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flex: 1,
  },
  notesSectionCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  notesFilterControls: { flexDirection: "row", flexWrap: "wrap" },
  notesFilterToggle: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingHorizontal: 16,
    minHeight: 44,
  },
  notesFilterLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  notesEmpty: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 12 },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  noteRowMain: { flex: 1, gap: 2 },
  noteRowTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  noteRowMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  notesDivider: { height: 1, marginHorizontal: 16, marginTop: 4, marginBottom: 4, opacity: 0.5 },
  notesLastSynced: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 16,
    paddingBottom: 6,
    opacity: 0.6,
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(34,197,94,0.12)",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  modalBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  modalError: { fontSize: 13, fontFamily: "Inter_500Medium" },
  modalActions: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center",
  },
  modalBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  otpInput: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    letterSpacing: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
  },
  toast: {
    position: "absolute",
    top: 80,
    left: 16,
    right: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 100,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  toastText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
    textAlign: "center",
  },
});
