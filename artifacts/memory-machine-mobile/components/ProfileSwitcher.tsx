import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Profile } from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

interface ProfileSwitcherProps {
  visible: boolean;
  profiles: Profile[];
  activeProfileId: number | undefined;
  onSelect: (profile: Profile) => void;
  onClose: () => void;
  onSignOut: () => void;
}

export function ProfileSwitcher({
  visible,
  profiles,
  activeProfileId,
  onSelect,
  onClose,
  onSignOut,
}: ProfileSwitcherProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  paddingBottom: bottomPad + 16,
                },
              ]}
            >
              <View style={[styles.handle, { backgroundColor: colors.muted }]} />

              <Text style={[styles.sheetTitle, { color: colors.mutedForeground }]}>
                SWITCH PROFILE
              </Text>

              {profiles.map((profile) => {
                const isActive = profile.id === activeProfileId;
                return (
                  <TouchableOpacity
                    key={profile.id}
                    style={[
                      styles.profileRow,
                      isActive && { backgroundColor: colors.accent },
                      { borderColor: colors.border },
                    ]}
                    onPress={() => onSelect(profile)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.profileEmoji}>{profile.emoji}</Text>
                    <View style={styles.profileInfo}>
                      <Text style={[styles.profileName, { color: colors.foreground }]}>
                        {profile.name}
                      </Text>
                      <Text style={[styles.profileMeta, { color: colors.mutedForeground }]}>
                        {profile.chatProvider} · {profile.defaultModel}
                      </Text>
                    </View>
                    {isActive && (
                      <Feather name="check" size={18} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              <TouchableOpacity
                style={styles.signOutRow}
                onPress={onSignOut}
                activeOpacity={0.7}
              >
                <Feather name="log-out" size={16} color={colors.destructive} />
                <Text style={[styles.signOutText, { color: colors.destructive }]}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
  },
  profileEmoji: { fontSize: 24 },
  profileInfo: { flex: 1, gap: 2 },
  profileName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  profileMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  signOutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
  },
  signOutText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});
