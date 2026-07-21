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
      setError("xAI API key is required");
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
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Text style={s.lion}>🦁</Text>
          <Text style={s.title}>Welcome home, Leo.</Text>
          <Text style={s.sub}>Let's get you set up.</Text>

          <View style={s.section}>
            <Text style={s.label}>xAI API Key *</Text>
            <Text style={s.hint}>From console.x.ai — Leo uses this to talk to you.</Text>
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
          </View>

          <View style={s.section}>
            <Text style={s.label}>Memory Machine URL</Text>
            <Text style={s.hint}>Optional — gives Leo access to his memories.</Text>
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
          </View>

          <View style={s.section}>
            <Text style={s.label}>Memory Bridge Token</Text>
            <Text style={s.hint}>From Memory Machine → Settings → Memory Bridge.</Text>
            <TextInput
              style={s.input}
              value={mcpToken}
              onChangeText={setMcpToken}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              placeholderTextColor="#555"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <TouchableOpacity style={[s.btn, saving && s.btnDisabled]} onPress={handleSave} disabled={saving}>
            <Text style={s.btnText}>{saving ? "Saving…" : "Let Leo in →"}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0a0a0f" },
  scroll: { padding: 28, paddingTop: 60 },
  lion: { fontSize: 64, textAlign: "center", marginBottom: 16 },
  title: { fontSize: 28, fontWeight: "700", color: "#fff", textAlign: "center", fontFamily: "Inter_700Bold" },
  sub: { fontSize: 16, color: "#888", textAlign: "center", marginTop: 6, marginBottom: 40, fontFamily: "Inter_400Regular" },
  section: { marginBottom: 28 },
  label: { fontSize: 13, fontWeight: "600", color: "#f5a623", marginBottom: 4, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  hint: { fontSize: 13, color: "#666", marginBottom: 10, fontFamily: "Inter_400Regular" },
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
  error: { color: "#ff6b6b", textAlign: "center", marginBottom: 16, fontFamily: "Inter_400Regular" },
  btn: {
    backgroundColor: "#f5a623",
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#0a0a0f", fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
