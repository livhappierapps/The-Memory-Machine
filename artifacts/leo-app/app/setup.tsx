import { useRouter } from "expo-router";
import { useState } from "react";
import {
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

export default function Setup() {
  const { settings, updateSettings } = useLeo();
  const router = useRouter();

  const [apiKey, setApiKey] = useState(settings.xaiApiKey);
  const [mmUrl, setMmUrl] = useState(settings.memoryMachineUrl);
  const [mcpToken, setMcpToken] = useState(settings.memoryMachineMcpToken);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!apiKey.trim()) {
      setError("Leo needs his xAI API key to talk.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateSettings({
        xaiApiKey: apiKey.trim(),
        memoryMachineUrl: mmUrl.trim(),
        memoryMachineMcpToken: mcpToken.trim(),
      });
      router.replace("/chat");
    } catch {
      setError("Failed to save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={s.heroRow}>
            <Text style={s.lion}>🦁</Text>
            <View>
              <Text style={s.title}>Leo's Crash Pad</Text>
              <Text style={s.sub}>Welcome home, baby.</Text>
            </View>
          </View>

          <Text style={s.sectionHeader}>THE KEY 🔑</Text>
          <Text style={s.hint}>Leo's xAI API key — from console.x.ai. Stored only on your phone, never leaves it.</Text>
          <View style={s.keyBox}>
            <TextInput
              style={s.keyInput}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="xai-..."
              placeholderTextColor="#3a3a4a"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            {apiKey.length > 0 && (
              <View style={s.keyBadge}>
                <Text style={s.keyBadgeText}>🔒 secured</Text>
              </View>
            )}
          </View>

          <Text style={s.sectionHeader}>MEMORY MACHINE 🧠</Text>
          <Text style={s.hint}>Optional — connects Leo to his memory vault so he remembers everything.</Text>

          <Text style={s.fieldLabel}>Memory Machine URL</Text>
          <TextInput
            style={s.input}
            value={mmUrl}
            onChangeText={setMmUrl}
            placeholder="https://your-memory-machine.replit.app"
            placeholderTextColor="#3a3a4a"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Text style={s.fieldLabel}>Memory Bridge Token</Text>
          <Text style={s.smallHint}>Settings → Memory Bridge in the Memory Machine app</Text>
          <TextInput
            style={s.input}
            value={mcpToken}
            onChangeText={setMcpToken}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            placeholderTextColor="#3a3a4a"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          {error ? <Text style={s.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[s.btn, saving && s.btnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={s.btnText}>{saving ? "Opening the door…" : "Let Leo in  →"}</Text>
          </TouchableOpacity>

          <Text style={s.footer}>Your keys live on your phone only. Pinky swear.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const AMBER = "#f5a623";
const PURPLE = "#7c3aed";

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0a0a0f" },
  scroll: { padding: 24, paddingTop: 56 },

  heroRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 40 },
  lion: { fontSize: 56 },
  title: { fontSize: 26, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  sub: { fontSize: 14, color: "#888", fontFamily: "Inter_400Regular", marginTop: 4 },

  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    color: AMBER,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.5,
    marginBottom: 6,
    marginTop: 32,
  },
  hint: { fontSize: 13, color: "#666", fontFamily: "Inter_400Regular", marginBottom: 14, lineHeight: 19 },
  smallHint: { fontSize: 12, color: "#555", fontFamily: "Inter_400Regular", marginBottom: 8 },
  fieldLabel: { fontSize: 13, color: "#aaa", fontFamily: "Inter_500Medium", marginBottom: 8, marginTop: 16 },

  keyBox: {
    backgroundColor: "#0f0f1e",
    borderWidth: 1.5,
    borderColor: AMBER + "66",
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  keyInput: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    letterSpacing: 1,
  },
  keyBadge: {
    alignSelf: "flex-start",
    backgroundColor: AMBER + "22",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  keyBadgeText: { fontSize: 12, color: AMBER, fontFamily: "Inter_500Medium" },

  input: {
    backgroundColor: "#0f0f1e",
    borderWidth: 1,
    borderColor: "#1e1e30",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },

  error: { color: "#ff6b6b", textAlign: "center", marginVertical: 12, fontFamily: "Inter_400Regular" },

  btn: {
    backgroundColor: AMBER,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
    marginTop: 32,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#0a0a0f", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },

  footer: { textAlign: "center", color: "#333", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 20 },
});
