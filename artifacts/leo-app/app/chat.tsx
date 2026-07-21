import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLeo } from "@/contexts/LeoContext";
import { type Message, useGrokStream } from "@/hooks/useGrokStream";
import { useMemoryBridge } from "@/hooks/useMemoryBridge";

export default function Chat() {
  const { settings, permanentMemory } = useLeo();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [sessionContext, setSessionContext] = useState("");
  const flatRef = useRef<FlatList>(null);

  const bridge = useMemoryBridge({
    memoryMachineUrl: settings.memoryMachineUrl,
    mcpToken: settings.memoryMachineMcpToken,
  });

  // Build the system prompt: permanent memory + recent memories loaded at session start
  const systemPrompt = [
    permanentMemory,
    sessionContext
      ? `\n\n--- Recent memories from our conversation history ---\n${sessionContext}\n--- End memories ---`
      : "",
  ]
    .join("")
    .trim();

  const { streaming, streamingContent, error, sendMessage, abort } = useGrokStream({
    apiKey: settings.xaiApiKey,
    model: settings.model,
    systemPrompt,
    onMessageComplete: useCallback((msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    }, []),
  });

  // Session start: load recent memories, then greet
  useEffect(() => {
    if (sessionReady) return;

    async function initSession() {
      setLoadingMemory(true);
      let context = "";

      if (bridge.isConfigured) {
        context = await bridge.fetchRecentMemories(40);
        setSessionContext(context);
      }

      setLoadingMemory(false);
      setSessionReady(true);

      // Leo's opening message — he knows the context already
      const greeting: Message = {
        id: "greeting",
        role: "assistant",
        content: context
          ? "Hey. I'm caught up 🦁 — just finished reading through our recent conversations. What's going on?"
          : "Hey, I'm home. What's on your mind?",
      };
      setMessages([greeting]);
    }

    initSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming || !sessionReady) return;

    setInput("");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    // Check if message is asking Leo to search memory
    const lowerText = text.toLowerCase();
    const isMemorySearch =
      bridge.isConfigured &&
      (lowerText.includes("remember") ||
        lowerText.includes("memory") ||
        lowerText.includes("search") ||
        lowerText.includes("recall") ||
        lowerText.includes("when did") ||
        lowerText.includes("what did we"));

    let enrichedText = text;
    if (isMemorySearch) {
      const query = text.replace(/remember|recall|search|memory/gi, "").trim();
      const memResult = await bridge.callMcpTool("search_memories", { query: query || text, limit: 5 });
      if (memResult && !memResult.includes("failed")) {
        enrichedText = `${text}\n\n[Memory search results for context:\n${memResult}]`;
      }
    }

    await sendMessage(messages, enrichedText);
  }

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, streamingContent]);

  function renderMessage({ item }: { item: Message }) {
    const isLeo = item.role === "assistant";
    return (
      <View style={[s.bubble, isLeo ? s.leoBubble : s.userBubble]}>
        {isLeo && <Text style={s.bubbleLabel}>Leo</Text>}
        <Text style={[s.bubbleText, isLeo ? s.leoText : s.userText]}>{item.content}</Text>
      </View>
    );
  }

  if (!settings.xaiApiKey) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <Text style={s.errorMsg}>No API key set.</Text>
          <TouchableOpacity onPress={() => router.replace("/setup")}>
            <Text style={s.link}>Go to Setup →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>🦁 Leo</Text>
          <Text style={s.headerSub}>{settings.model}</Text>
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity style={s.iconBtn} onPress={() => router.push("/memory")}>
            <Text style={s.iconBtnText}>🧠</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => router.push("/settings")}>
            <Text style={s.iconBtnText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loadingMemory ? (
        <View style={s.memoryLoading}>
          <ActivityIndicator color="#f5a623" size="small" />
          <Text style={s.memoryLoadingText}>Loading memories…</Text>
        </View>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={s.messageList}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            streaming ? (
              <View style={[s.bubble, s.leoBubble]}>
                <Text style={s.bubbleLabel}>Leo</Text>
                <Text style={[s.bubbleText, s.leoText]}>
                  {streamingContent || "…"}
                </Text>
              </View>
            ) : error ? (
              <View style={s.errorBubble}>
                <Text style={s.errorBubbleText}>{error}</Text>
              </View>
            ) : null
          }
        />

        <View style={s.inputRow}>
          <TextInput
            style={s.textInput}
            value={input}
            onChangeText={setInput}
            placeholder="Say something…"
            placeholderTextColor="#444"
            multiline
            maxLength={4000}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
            editable={!streaming && sessionReady}
          />
          {streaming ? (
            <TouchableOpacity style={[s.sendBtn, s.stopBtn]} onPress={abort}>
              <Text style={s.sendBtnText}>◼</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.sendBtn, (!input.trim() || !sessionReady) && s.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!input.trim() || !sessionReady}
            >
              <Text style={s.sendBtnText}>↑</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const AMBER = "#f5a623";
const BG = "#0a0a0f";

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2a",
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, color: "#555", fontFamily: "Inter_400Regular", marginTop: 2 },
  headerActions: { flexDirection: "row", gap: 8 },
  iconBtn: { padding: 8 },
  iconBtnText: { fontSize: 20 },
  memoryLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
    backgroundColor: "#0f0f1a",
  },
  memoryLoadingText: { fontSize: 13, color: "#666", fontFamily: "Inter_400Regular" },
  messageList: { padding: 16, paddingBottom: 8 },
  bubble: { marginBottom: 12, maxWidth: "85%", borderRadius: 16, padding: 14 },
  leoBubble: { alignSelf: "flex-start", backgroundColor: "#141420", borderWidth: 1, borderColor: "#1e1e30" },
  userBubble: { alignSelf: "flex-end", backgroundColor: AMBER },
  bubbleLabel: { fontSize: 11, color: "#555", marginBottom: 4, fontFamily: "Inter_500Medium" },
  bubbleText: { fontSize: 16, lineHeight: 24, fontFamily: "Inter_400Regular" },
  leoText: { color: "#e8e8f0" },
  userText: { color: "#0a0a0f", fontFamily: "Inter_500Medium" },
  errorBubble: { alignSelf: "center", backgroundColor: "#2a0000", borderRadius: 10, padding: 12, marginBottom: 12 },
  errorBubbleText: { color: "#ff6b6b", fontSize: 14, fontFamily: "Inter_400Regular" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#1a1a2a",
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: "#141420",
    borderWidth: 1,
    borderColor: "#2a2a3a",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 16,
    maxHeight: 120,
    fontFamily: "Inter_400Regular",
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: AMBER,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.3 },
  stopBtn: { backgroundColor: "#2a1a00" },
  sendBtnText: { color: "#0a0a0f", fontSize: 20, fontWeight: "700" },
  errorMsg: { color: "#ff6b6b", fontSize: 16, fontFamily: "Inter_400Regular", marginBottom: 12 },
  link: { color: AMBER, fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
