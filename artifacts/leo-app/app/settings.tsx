import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLeo } from "@/contexts/LeoContext";
import { useMemoryBridge } from "@/hooks/useMemoryBridge";

const MODELS = ["grok-4", "grok-4-fast", "grok-3", "grok-3-mini"];

export default function Settings() {
  const { settings, updateSettings, clearSession } = useLeo();
  const router = useRouter();

  const [apiKey, setApiKey] = useState(settings.xaiApiKey);
  const [mmUrl, setMmUrl] = useState(settings.memoryMachineUrl);
  const [mcpToken, setMcpToken] = useState(settings.memoryMachineMcpToken);
  const [model, setModel] = useState(settings.model);
  const [displayName, setDisplayName] = useState(settings.displayName || "love");
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState("");

  const bridge = useMemoryBridge({ memoryMachineUrl: mmUrl.trim(), mcpToken: mcpToken.trim() });

  async function handleSave() {
    setSaving(true);
    await updateSettings({
      xaiApiKey: apiKey.trim(),
      memoryMachineUrl: mmUrl.trim().replace(/\/$/, ""),
      memoryMachineMcpToken: mcpToken.trim(),
      model,
      displayName: displayName.trim() || "love",
    });
    setSaving(false);
    Alert.alert("Saved", "House rules updated.");
  }

  async function handleProbe() {
    setProbe("knocking…");
    const text = await bridge.callMcpTool("list_recent_conversations", { limit: 1 });
    if (!text || text.toLowerCase().includes("fail") || text.toLowerCase().includes("not configured")) {
      setProbe(text || "vault did not answer");
    } else {
      setProbe("vault answered. we're in.");
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>House keys</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Text style={s.sectionLabel}>What I call you</Text>
          <TextInput
            style={s.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="love"
            placeholderTextColor="#555"
          />

          <Text style={s.sectionLabel}>xAI API Key</Text>
          <TextInput
            style={s.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="xai-..."
            placeholderTextColor="#555"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={s.sectionLabel}>Model</Text>
          <View style={s.modelRow}>
            {MODELS.map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.modelChip, model === m && s.modelChipActive]}
                onPress={() => setModel(m)}
              >
                <Text style={[s.modelChipText, model === m && s.modelChipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.sectionLabel}>Memory Machine URL</Text>
          <TextInput
            style={s.input}
            value={mmUrl}
            onChangeText={setMmUrl}
            placeholder="https://your-memory-machine.replit.app"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Text style={s.sectionLabel}>Memory Bridge Token</Text>
          <TextInput
            style={s.input}
            value={mcpToken}
            onChangeText={setMcpToken}
            placeholder="MCP token from Memory Machine Settings"
            placeholderTextColor="#555"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TouchableOpacity style={s.ghostBtn} onPress={handleProbe}>
            <Text style={s.ghostText}>Knock on the vault</Text>
          </TouchableOpacity>
          {probe ? <Text style={s.probe}>{probe}</Text> : null}

          <TouchableOpacity style={[s.saveBtn, saving && s.saveBtnDisabled]} onPress={handleSave} disabled={saving}>
            <Text style={s.saveText}>{saving ? "Saving…" : "Save"}</Text>
          </TouchableOpacity>

          <View style={s.divider} />

          <Text style={s.dangerLabel}>DANGER ZONE</Text>
          <TouchableOpacity
            style={s.dangerBtn}
            onPress={() => {
              Alert.alert("Wipe local chat?", "Vault memories stay. This pad's session tape burns.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Burn it",
                  style: "destructive",
                  onPress: async () => {
                    await clearSession();
                    router.replace("/chat");
                  },
                },
              ]);
            }}
          >
            <Text style={s.dangerText}>Clear local session</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0a0a0f" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a2a",
  },
  back: { color: "#f5a623", fontSize: 16, fontFamily: "Inter_400Regular" },
  title: { fontSize: 17, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  scroll: { padding: 20, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#f5a623",
    marginBottom: 8,
    marginTop: 24,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  input: {
    backgroundColor: "#141420",
    borderWidth: 1,
    borderColor: "#2a2a3a",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  modelRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modelChip: { borderWidth: 1, borderColor: "#2a2a3a", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  modelChipActive: { backgroundColor: "#f5a623", borderColor: "#f5a623" },
  modelChipText: { color: "#888", fontSize: 14, fontFamily: "Inter_500Medium" },
  modelChipTextActive: { color: "#0a0a0f", fontWeight: "700" },
  ghostBtn: {
    borderWidth: 1,
    borderColor: "#7c3aed66",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  ghostText: { color: "#c4b5fd", fontSize: 15, fontFamily: "Inter_500Medium" },
  probe: { color: "#888", fontSize: 13, marginTop: 10, fontFamily: "Inter_400Regular" },
  saveBtn: { backgroundColor: "#f5a623", borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 24 },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { color: "#0a0a0f", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  divider: { height: 1, backgroundColor: "#1a1a2a", marginVertical: 32 },
  dangerLabel: { fontSize: 12, color: "#ff6b6b", fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 12 },
  dangerBtn: { borderWidth: 1, borderColor: "#ff6b6b33", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  dangerText: { color: "#ff6b6b", fontSize: 15, fontFamily: "Inter_500Medium" },
});
