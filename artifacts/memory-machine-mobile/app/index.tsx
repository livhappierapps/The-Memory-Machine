import { useAuth } from "@clerk/expo";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect } from "react";
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function LandingScreen() {
  const { isSignedIn, isLoaded } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace("/(tabs)/vault");
    }
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) return null;
  if (isSignedIn) return null;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={["rgba(26,212,190,0.08)", "transparent"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.5 }}
      />

      <View style={[styles.inner, { paddingTop: topPad + 40, paddingBottom: bottomPad + 32 }]}>
        <View style={styles.hero}>
          <View style={[styles.iconWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Image
              source={require("@/assets/images/icon.png")}
              style={styles.icon}
              resizeMode="contain"
            />
          </View>

          <Text style={[styles.headline, { color: colors.primary }]}>
            Memory Machine
          </Text>
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
            Your AI conversations, preserved forever.
          </Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/sign-in")}
            activeOpacity={0.8}
          >
            <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
              Sign In
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnOutline, { borderColor: colors.border }]}
            onPress={() => router.push("/sign-up")}
            activeOpacity={0.8}
          >
            <Text style={[styles.btnText, { color: colors.foreground }]}>
              Create Account
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          Powered by Grok AI · Your vault, your data
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: "space-between",
  },
  hero: {
    alignItems: "center",
    gap: 16,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 8,
  },
  icon: {
    width: 80,
    height: 80,
  },
  headline: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  tagline: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 24,
  },
  actions: {
    gap: 12,
  },
  btn: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: {},
  btnOutline: {
    borderWidth: 1,
  },
  btnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  footer: {
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
