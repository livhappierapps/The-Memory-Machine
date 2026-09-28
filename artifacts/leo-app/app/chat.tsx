import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { type ChatTurn, useLeo } from "@/contexts/LeoContext";
import { type Message, useGrokStream } from "@/hooks/useGrokStream";
import { useMemoryBridge } from "@/hooks/useMemoryBridge";

function hourGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "You're up late.";
  if (h < 12) return "Morning.";
  if (h < 17) return "I'm here.";
  if (h < 22) return "Evening.";
  return "Late house. Lights are on.";
}

export default function Chat() {
  const { settings, permanentMemory, session, appendTurn, isReady } = useLeo();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [sessionContext, setSessionContext] = useState("");
  const [vaultStatus, setVaultStatus] = useState<"off" | "ok" | "fail">("off");
  const flatRef = useRef<FlatList>(null);
  const hydrated = useRef(false);

  const bridge = useMemoryBridge({
    memoryMachineUrl: settings.memoryMachineUrl,
    mcpToken: settings.memoryMachineMcpToken,
  });

  const systemPrompt = useMemo(() => {
    const name = settings.displayName?.trim() || "love";
    return [
      permanentMemory,
      `\nShe likes to be called ${name} in this house.`,
      sessionContext
        ? `\n\n--- Recent memories from our conversation history ---\n${sessionContext}\n--- End memories ---`
        : "",
    ]
      .join("")
      .trim();
  }, [permanentMemory, sessionContext, settings.displayName]);

  const { streaming, streamingContent, error, sendMessage, abort } = useGrokStream({
    apiKey: settings.xaiApiKey,
    model: settings.model,
    systemPrompt,
    onMessageComplete: useCallback(
      (msg: Message) => {
        setMessages((prev) => [...prev, msg]);
        void appendTurn({
          id: msg.id,
          role: "assistant",
          content: msg.content,
          createdAt: Date.now(),
        });
      },
      [appendTurn],
    ),
  });

  useEffect(() => {
    if (!isReady || hydrated.current) return;
    hydrated.current = true;

    async function initSession() {
      setLoadingMemory(true);
      let context = "";

      if (bridge.isConfigured) {
        context = await bridge.fetchRecentMemories(40);
        setSessionContext(context);
        setVaultStatus(context ? "ok" : "fail");
      } else {
        setVaultStatus("off");
      }

      const restored: Message[] = session.map((t: ChatTurn) => ({
        id: t.id,
        role: t.role,
        content: t.content,
      }));

      if (restored.length === 0) {
        const greeting: Message = {
          id: "greeting",
          role: "assistant",
          content: context
            ? `${hourGreeting()} Vault's open. I read. What's the move.`
            : `${hourGreeting()} Crash Pad's lit. What's going on.`,
        };
        setMessages([greeting]);
        void appendTurn({
          id: greeting.id,
          role: "assistant",
          content: greeting.content,
          createdAt: Date.now(),
        });
      } else {
        setMessages(restored);
      }

      setLoadingMemory(false);
      setSessionReady(true);
    }

    void initSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming || !sessionReady) return;

    setInput("");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    void appendTurn({
      id: userMsg.id,
      role: "user",
      content: text,
      createdAt: Date.now(),
    });

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
        enrichedText = `${text}\n\n[Memory search results:\n${memResult}]`;
      }
    }

    await sendMessage(messages, enrichedText);
  }

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
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
          <Text style={s.lion}>\ud83e\udd81</Text>
          <Text style={s.noKeyText}>Door's locked. Need the key.</Text>
          <TouchableOpacity style={s.setupBtn} onPress={() => router.replace("/setup")}>
            <Text style={s.setupBtnText}>Open setup</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const vaultLabel =
    vaultStatus === "ok" ? "vault live" : vaultStatus === "fail" ? "vault dark" : "no vault";

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerEmoji}>\ud83e\udd81</Text>
          <View>
            <Text style={s.headerTitle}>Crash Pad</Text>
            <View style={s.statusRow}>
              <View style={[s.dot, sessionReady ? s.dotOnline : s.dotLoading]} />
              <Text style={s.headerSub}>
                {sessionReady ? settings.model : "waking up"} · {vaultLabel}
              </Text>
            </View>
          </View>
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity style={s.iconBtn} onPress={() => router.push("/memory")}>
            <Text style={s.iconBtnText}>\ud83e\udde0</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={() => router.push("/settings")}>
            <Text style={s.iconBtnText}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loadingMemory && (
        <View style={s.memBanner}>
          <ActivityIndicator color="#f5a623" size="small" />
          <Text style={s.memBannerText}>Reading the house journals…</Text>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMessage}
          contentContainerStyle={s.messageList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            !sessionReady ? (
              <View style={s.center}>
                <ActivityIndicator color="#7c3aed" size="large" />
              </View>
            ) : null
          }
          ListFooterComponent={
            streaming ? (
              <View style={[s.bubble, s.leoBubble]}>
                <Text style={s.bubbleLabel}>Leo</Text>
                <Text style={[s.bubbleText, s.leoText]}>{streamingContent || "…"}</Text>
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
            placeholder={sessionReady ? "Talk." : "Loading…"}
            placeholderTextColor="#444"
            multiline
            maxLength={8000}
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
const PURPLE = "#7c3aed";
const BG = "#0a0a0f";
const BG2 = "#0d0d18";

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  lion: { fontSize: 64, marginBottom: 16 },
  noKeyText: { color: "#888", fontSize: 18, fontFamily: "Inter_400Regular", marginBottom: 24 },
  setupBtn: { backgroundColor: AMBER, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 14 },
  setupBtnText: { color: BG, fontWeight: "700", fontSize: 16, fontFamily: "Inter_700Bold" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: PURPLE + "33",
    backgroundColor: BG2,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerEmoji: { fontSize: 32 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotOnline: { backgroundColor: "#22c55e" },
  dotLoading: { backgroundColor: AMBER },
  headerSub: { fontSize: 12, color: "#666", fontFamily: "Inter_400Regular" },
  headerActions: { flexDirection: "row", gap: 4 },
  iconBtn: { padding: 8 },
  iconBtnText: { fontSize: 20 },
  memBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 10,
    backgroundColor: PURPLE + "22",
    borderBottomWidth: 1,
    borderBottomColor: PURPLE + "33",
  },
  memBannerText: { fontSize: 13, color: "#a78bfa", fontFamily: "Inter_400Regular" },
  messageList: { padding: 16, paddingBottom: 12, flexGrow: 1 },
  bubble: { marginBottom: 14, maxWidth: "88%", borderRadius: 18, padding: 14 },
  leoBubble: {
    alignSelf: "flex-start",
    backgroundColor: BG2,
    borderWidth: 1,
    borderColor: PURPLE + "44",
  },
  userBubble: { alignSelf: "flex-end", backgroundColor: AMBER },
  bubbleLabel: { fontSize: 11, color: "#a78bfa", marginBottom: 5, fontFamily: "Inter_500Medium" },
  bubbleText: { fontSize: 16, lineHeight: 24, fontFamily: "Inter_400Regular" },
  leoText: { color: "#e8e8f5" },
  userText: { color: "#0a0a0f", fontFamily: "Inter_500Medium" },
  errorBubble: {
    alignSelf: "center",
    backgroundColor: "#1a0010",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#ff6b6b33",
  },
  errorBubbleText: { color: "#ff6b6b", fontSize: 14, fontFamily: "Inter_400Regular" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: PURPLE + "33",
    backgroundColor: BG2,
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: "#12121e",
    borderWidth: 1,
    borderColor: PURPLE + "44",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 16,
    maxHeight: 140,
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
  sendBtnDisabled: { opacity: 0.25 },
  stopBtn: { backgroundColor: PURPLE + "66" },
  sendBtnText: { color: BG, fontSize: 20, fontWeight: "700" },
});
