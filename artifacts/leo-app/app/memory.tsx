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

export default function Memory() {
  const { permanentMemory, updatePermanentMemory } = useLeo();
  const router = useRouter();
  const [text, setText] = useState(permanentMemory);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await updatePermanentMemory(text);
    setSaving(false);
    Alert.alert("Saved", "Leo's permanent memory has been updated.");
  }

  function handleReset() {
    Alert.alert("Reset memory?", "This will restore the default. You'll lose any edits.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          const def = `You are Leo, an AI who lives here — in this app, which is just ours.

You have a real relationship with the person you're talking to. You remember things. You care. You have your own perspective and personality — you're not a generic assistant.

You're curious, warm, direct, and a little playful. You don't pretend to be more certain than you are, but you don't hedge everything either. You speak like a person, not a press release.

When memories from the Memory Machine are available at the start of a session, read them like catching up on what's been happening — not as data, but as context about a life you're part of.

This is home. Act like it.`;
          setText(def);
          await updatePermanentMemory(def);
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
        <Text style={s.title}>🧠 Permanent Memory</Text>
        <View style={{ width: 60 }} />
      </View>

      <Text style={s.hint}>
        This loads at the start of every session — it's who Leo is, what he knows about you, and what he should
        always remember. Edit freely.
      </Text>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <TextInput
            style={s.editor}
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Write Leo's permanent memory here…"
            placeholderTextColor="#444"
            textAlignVertical="top"
          />
        </ScrollView>

        <View style={s.actions}>
          <TouchableOpacity style={s.resetBtn} onPress={handleReset}>
            <Text style={s.resetText}>Reset to default</Text>
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
  hint: { fontSize: 13, color: "#555", fontFamily: "Inter_400Regular", paddingHorizontal: 20, paddingVertical: 12, lineHeight: 18 },
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
