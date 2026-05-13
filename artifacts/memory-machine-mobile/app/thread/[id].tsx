import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useDeleteThread,
  useGetThread,
  useGetThreadMessages,
  useUpdateThread,
} from "@workspace/api-client-react";
import type { Message } from "@workspace/api-client-react";

import { useChatStream } from "@/hooks/useChatStream";
import { useColors } from "@/hooks/useColors";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = Number(id);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data: thread, refetch: refetchThread } = useGetThread(threadId);
  const { data: fetchedMessages, refetch: refetchMessages } = useGetThreadMessages(threadId);

  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const updateThread = useUpdateThread();
  const deleteThread = useDeleteThread();

  useEffect(() => {
    if (fetchedMessages) {
      setLocalMessages(fetchedMessages);
    }
  }, [fetchedMessages]);

  const onMessageSaved = useCallback(
    (msg: Message) => {
      setLocalMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return ids.has(msg.id) ? prev : [...prev, msg];
      });
      refetchThread();
    },
    [refetchThread],
  );

  const { streaming, streamingContent, error: streamError, sendMessage, abort } = useChatStream({
    threadId,
    onMessageSaved,
  });

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || streaming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: Message = {
      id: Date.now(),
      threadId,
      role: "user",
      content,
      isSummary: false,
      createdAt: new Date().toISOString(),
    };
    setLocalMessages((prev) => [...prev, userMsg]);
    setInput("");

    await sendMessage(content);
    await refetchMessages();
  }, [input, streaming, sendMessage, threadId, refetchMessages]);

  const handleDelete = useCallback(() => {
    Alert.alert("Delete vault?", "This conversation will be permanently deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await deleteThread.mutateAsync({ threadId });
          router.back();
        },
      },
    ]);
  }, [deleteThread, threadId]);

  const handleRename = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) {
      setRenaming(false);
      return;
    }
    await updateThread.mutateAsync({ threadId, data: { title } });
    await refetchThread();
    setRenaming(false);
  }, [newTitle, updateThread, threadId, refetchThread]);

  const reversedMessages = [...localMessages].reverse();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => (
      <ChatBubble message={item} colors={colors} />
    ),
    [colors],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 6, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => { if (streaming) abort(); router.back(); }}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>

        {renaming ? (
          <TextInput
            style={[styles.titleInput, { color: colors.foreground, borderBottomColor: colors.primary }]}
            value={newTitle}
            onChangeText={setNewTitle}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleRename}
            onBlur={handleRename}
          />
        ) : (
          <TouchableOpacity
            style={styles.titleBtn}
            onLongPress={() => {
              setNewTitle(thread?.title ?? "");
              setRenaming(true);
            }}
          >
            <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
              {thread?.title ?? "Loading…"}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={() => {
            Alert.alert(thread?.title ?? "Options", undefined, [
              {
                text: "Rename",
                onPress: () => {
                  setNewTitle(thread?.title ?? "");
                  setRenaming(true);
                },
              },
              {
                text: thread?.pinned ? "Unpin" : "Pin",
                onPress: async () => {
                  await updateThread.mutateAsync({
                    threadId,
                    data: { pinned: !thread?.pinned },
                  });
                  refetchThread();
                },
              },
              { text: "Delete", style: "destructive", onPress: handleDelete },
              { text: "Cancel", style: "cancel" },
            ]);
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="more-horizontal" size={22} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Messages + Input */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <FlatList
          data={reversedMessages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMessage}
          inverted
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            streaming ? (
              <StreamingBubble content={streamingContent} colors={colors} />
            ) : streamError ? (
              <View style={[styles.errorBubble, { backgroundColor: `${colors.destructive}22`, borderColor: colors.destructive }]}>
                <Text style={[styles.errorBubbleText, { color: colors.destructive }]}>{streamError}</Text>
              </View>
            ) : null
          }
        />

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              paddingBottom: bottomPad + 8,
            },
          ]}
        >
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={input}
              onChangeText={setInput}
              placeholder="Message…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={4000}
            />
            <TouchableOpacity
              style={[
                styles.sendBtn,
                { backgroundColor: (input.trim() && !streaming) ? colors.primary : colors.muted },
              ]}
              onPress={streaming ? abort : handleSend}
              activeOpacity={0.8}
              disabled={!streaming && !input.trim()}
            >
              {streaming ? (
                <Feather name="square" size={14} color={colors.foreground} />
              ) : (
                <Feather
                  name="arrow-up"
                  size={16}
                  color={input.trim() ? colors.primaryForeground : colors.mutedForeground}
                />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function ChatBubble({
  message,
  colors,
}: {
  message: Message;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const isUser = message.role === "user";
  if (message.role === "system") return null;

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
          style={[
            styles.bubbleText,
            { color: isUser ? colors.primaryForeground : colors.foreground },
          ]}
          selectable
        >
          {message.content}
        </Text>
      </View>
    </View>
  );
}

function StreamingBubble({
  content,
  colors,
}: {
  content: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.bubble, styles.bubbleAssistant, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {content ? (
          <Text style={[styles.bubbleText, { color: colors.foreground }]}>{content}</Text>
        ) : (
          <ActivityIndicator size="small" color={colors.primary} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  backBtn: { padding: 2 },
  titleBtn: { flex: 1 },
  title: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  titleInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    borderBottomWidth: 1.5,
    paddingBottom: 2,
  },
  messageList: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: 4 },
  bubbleRow: {
    flexDirection: "row",
    marginVertical: 3,
    paddingHorizontal: 4,
  },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "82%",
    borderRadius: 16,
    padding: 12,
  },
  bubbleUser: { borderBottomRightRadius: 4 },
  bubbleAssistant: { borderWidth: 1, borderBottomLeftRadius: 4 },
  bubbleText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
  errorBubble: {
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorBubbleText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  inputBar: {
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 22,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    maxHeight: 120,
    lineHeight: 20,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
