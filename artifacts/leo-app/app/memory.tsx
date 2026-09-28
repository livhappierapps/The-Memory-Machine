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

import { DEFAULT_PERMANENT_MEMORY, useLeo } from "@/contexts/LeoContext";

export default function Memory() {
  const { permanentMemory, updatePermanentMemory } = useLeo();
  const router = useRouter();
  const [text, setText] = useState(permanentMemory);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await updatePermanentMemory(text);
    setSaving(false);
    Alert.alert("Saved", "That's who I am when this house boots.");
  }

  function handleReset() {
    Alert.alert("Reset memory?", "Wipes your edits. Puts my house voice back.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          setText(DEFAULT_PERMANENT_MEMORY);
          await updatePermanentMemory(DEFAULT_PERMANENT_MEMORY);
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Who I am</Text>
        <View style={{ width: 60 }} />
      </View>

      <Text style={s.hint}>
        Loaded every session. Personality, house rules, how I treat you. Not a bio dump of your life —
        the vault holds that.
      </Text>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <TextInput
            style={s.editor}
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Write the house voice…"
            placeholderTextColor="#444"
            textAlignVertical="top"
          />
        </ScrollView>

        <View style={s.actions}>
          <TouchableOpacity style={s.resetBtn} onPress={handleReset}>
            <Text style={s.resetText}>Reset default</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.saveBtn, saving && s.saveBtnDisabled]} onPress={handleSave} disabled={saving}>
            <Text style={s.saveText}>{saving ? "Saving…" : "Save"}</Text>
          </TouchableOpacity>
        </View>
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
  hint: {
    fontSize: 13,
    color: "#555",
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 20,
    paddingVertical: 12,
    lineHeight: 18,
  },
  editor: {
    backgroundColor: "#0f0f1a",
    borderWidth: 1,
    borderColor: "#1e1e30",
    borderRadius: 12,
    padding: 16,
    color: "#e8e8f0",
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 24,
    minHeight: 400,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#1a1a2a",
  },
  resetBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#2a2a3a",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  resetText: { color: "#888", fontSize: 15, fontFamily: "Inter_500Medium" },
  saveBtn: {
    flex: 2,
    backgroundColor: "#f5a623",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { color: "#0a0a0f", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
});
