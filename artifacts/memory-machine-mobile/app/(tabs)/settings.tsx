import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useGetSettings,
  useListProfiles,
  useUpdateProfile,
  useUpdateSettings,
} from "@workspace/api-client-react";
import type { Profile } from "@workspace/api-client-react";

import { useProfile } from "@/contexts/ProfileContext";
import { useColors } from "@/hooks/useColors";

const MODELS: Record<string, string[]> = {
  xai: ["grok-3", "grok-3-mini", "grok-2", "grok-2-mini"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5"],
  google: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
};

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { activeProfile, setActiveProfile } = useProfile();
  const { data: profiles } = useListProfiles();
  const { data: globalSettings } = useGetSettings();

  const profile = activeProfile ?? profiles?.[0] ?? null;
  const profileId = profile?.id;

  const updateProfile = useUpdateProfile();
  const updateSettings = useUpdateSettings();

  const [apiKey, setApiKey] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [model, setModel] = useState(profile?.defaultModel ?? "grok-3");
  const [maxCtx, setMaxCtx] = useState(String(profile?.maxContextMessages ?? 0));
  const [smartRetrieval, setSmartRetrieval] = useState(profile?.smartRetrieval ?? false);
  const [topN, setTopN] = useState(String(profile?.topNMemories ?? 5));
  const [saving, setSaving] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (profile) {
      setModel(profile.defaultModel);
      setMaxCtx(String(profile.maxContextMessages));
      setSmartRetrieval(profile.smartRetrieval);
      setTopN(String(profile.topNMemories));
    }
  }, [profileId]);

  const handleSave = async () => {
    if (!profileId || saving) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    try {
      const body: Parameters<typeof updateProfile.mutateAsync>[0]["data"] = {
        defaultModel: model,
        maxContextMessages: Number(maxCtx) || 0,
        smartRetrieval,
        topNMemories: Number(topN) || 5,
        ...(apiKey ? { apiKey } : {}),
        ...(openAiKey ? { openAiApiKey: openAiKey } : {}),
        ...(anthropicKey ? { anthropicApiKey: anthropicKey } : {}),
        ...(googleKey ? { googleApiKey: googleKey } : {}),
      };
      const updated = await updateProfile.mutateAsync({
        params: { path: { profileId } },
        data: body,
      });
      setActiveProfile(updated as Profile);
      setApiKey("");
      setOpenAiKey("");
      setAnthropicKey("");
      setGoogleKey("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Settings updated.");
    } catch {
      Alert.alert("Error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/");
        },
      },
    ]);
  };

  const availableModels = MODELS[profile?.chatProvider ?? "xai"] ?? MODELS["xai"]!;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: bottomPad + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: colors.foreground }]}>Settings</Text>

      {profile ? (
        <>
          {/* Profile Identity */}
          <SectionCard colors={colors} title="Profile" subtitle={`${profile.emoji} ${profile.name}`}>
            <InfoRow label="Provider" value={profile.chatProvider} colors={colors} />
            <InfoRow
              label="API Key"
              value={profile.hasApiKey ? "Configured ✓" : "Not set"}
              valueColor={profile.hasApiKey ? colors.primary : colors.destructive}
              colors={colors}
            />
          </SectionCard>

          {/* API Keys */}
          {profile.chatProvider === "xai" && (
            <SectionCard colors={colors} title="xAI API Key">
              <ApiKeyInput
                label={profile.hasApiKey ? "Replace xAI key" : "xAI API key"}
                value={apiKey}
                onChange={setApiKey}
                placeholder="xai-…"
                colors={colors}
              />
            </SectionCard>
          )}
          {profile.chatProvider === "openai" && (
            <SectionCard colors={colors} title="OpenAI API Key">
              <ApiKeyInput
                label={profile.hasApiKey ? "Replace OpenAI key" : "OpenAI API key"}
                value={openAiKey}
                onChange={setOpenAiKey}
                placeholder="sk-…"
                colors={colors}
              />
            </SectionCard>
          )}
          {profile.chatProvider === "anthropic" && (
            <SectionCard colors={colors} title="Anthropic API Key">
              <ApiKeyInput
                label={profile.hasAnthropicApiKey ? "Replace Anthropic key" : "Anthropic API key"}
                value={anthropicKey}
                onChange={setAnthropicKey}
                placeholder="sk-ant-…"
                colors={colors}
              />
            </SectionCard>
          )}
          {profile.chatProvider === "google" && (
            <SectionCard colors={colors} title="Google API Key">
              <ApiKeyInput
                label={profile.hasGoogleApiKey ? "Replace Google key" : "Google API key"}
                value={googleKey}
                onChange={setGoogleKey}
                placeholder="AIza…"
                colors={colors}
              />
            </SectionCard>
          )}

          {/* Model */}
          <SectionCard colors={colors} title="AI Model">
            <View style={styles.modelList}>
              {availableModels.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.modelChip,
                    {
                      backgroundColor: model === m ? colors.primary : colors.secondary,
                      borderColor: model === m ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setModel(m)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.modelChipText,
                      { color: model === m ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </SectionCard>

          {/* Context */}
          <SectionCard colors={colors} title="Context Window">
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Max messages</Text>
              <TextInput
                style={[styles.numInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.secondary }]}
                value={maxCtx}
                onChangeText={setMaxCtx}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              0 = full history. Set to 1–1000 to limit context.
            </Text>
          </SectionCard>

          {/* Smart Retrieval */}
          <SectionCard colors={colors} title="Smart Memory">
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Smart retrieval</Text>
              <Switch
                value={smartRetrieval}
                onValueChange={setSmartRetrieval}
                trackColor={{ true: colors.primary, false: colors.muted }}
                thumbColor={colors.foreground}
              />
            </View>
            {smartRetrieval && (
              <View style={[styles.row, { marginTop: 8 }]}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>Top N memories</Text>
                <TextInput
                  style={[styles.numInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.secondary }]}
                  value={topN}
                  onChangeText={setTopN}
                  keyboardType="number-pad"
                  placeholder="5"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
            )}
          </SectionCard>

          {/* MCP Token */}
          {globalSettings?.mcpToken && (
            <SectionCard colors={colors} title="MCP Token">
              <Text style={[styles.mcpToken, { color: colors.mutedForeground }]} selectable numberOfLines={1}>
                {globalSettings.mcpToken}
              </Text>
            </SectionCard>
          )}

          {/* Save */}
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && styles.disabled]}
            onPress={handleSave}
            activeOpacity={0.8}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Settings</Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {/* Sign Out */}
      <TouchableOpacity style={[styles.signOutBtn, { borderColor: colors.destructive }]} onPress={handleSignOut} activeOpacity={0.8}>
        <Feather name="log-out" size={16} color={colors.destructive} />
        <Text style={[styles.signOutText, { color: colors.destructive }]}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SectionCard({
  colors,
  title,
  subtitle,
  children,
}: {
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>{title.toUpperCase()}</Text>
        {subtitle && <Text style={[styles.cardSubtitle, { color: colors.foreground }]}>{subtitle}</Text>}
      </View>
      <View style={[styles.cardBody, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

function InfoRow({
  label,
  value,
  valueColor,
  colors,
}: {
  label: string;
  value: string;
  valueColor?: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor ?? colors.foreground }]}>{value}</Text>
    </View>
  );
}

function ApiKeyInput({
  label,
  value,
  onChange,
  placeholder,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const [show, setShow] = useState(false);
  return (
    <View>
      <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.keyInputRow, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
        <TextInput
          style={[styles.keyInput, { color: colors.foreground }]}
          value={value}
          onChangeText={onChange}
          secureTextEntry={!show}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity onPress={() => setShow((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name={show ? "eye-off" : "eye"} size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  pageTitle: { fontSize: 24, fontFamily: "Inter_700Bold", marginBottom: 4 },
  card: { gap: 6 },
  cardHeader: { paddingHorizontal: 4, gap: 2 },
  cardTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  cardSubtitle: { fontSize: 14, fontFamily: "Inter_500Medium" },
  cardBody: { borderRadius: 12, borderWidth: 1, overflow: "hidden", padding: 12, gap: 8 },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  infoValue: { fontSize: 14, fontFamily: "Inter_500Medium" },
  inputLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 6 },
  keyInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  keyInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLabel: { fontSize: 15, fontFamily: "Inter_400Regular" },
  numInput: {
    width: 72,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    textAlign: "center",
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  modelList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modelChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  modelChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  mcpToken: { fontSize: 12, fontFamily: "Inter_400Regular" },
  saveBtn: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  disabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  signOutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
});
