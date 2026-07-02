import { useSSO } from "@clerk/expo";
import { AntDesign } from "@expo/vector-icons";
import { router } from "expo-router";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

// Handle any pending authentication sessions.
WebBrowser.maybeCompleteAuthSession();

// Preloads the browser for Android devices to reduce authentication load time.
// See: https://docs.expo.dev/guides/authentication/#improving-user-experience
function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

type OAuthStrategy = "oauth_google" | "oauth_apple";

export function OAuthButtons() {
  useWarmUpBrowser();
  const { startSSOFlow } = useSSO();
  const colors = useColors();
  const [pending, setPending] = useState<OAuthStrategy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOAuth = useCallback(
    async (strategy: OAuthStrategy) => {
      if (pending) return;
      setError(null);
      setPending(strategy);
      try {
        const { createdSessionId, setActive } = await startSSOFlow({
          strategy,
          redirectUrl: AuthSession.makeRedirectUri({ path: "sso-callback" }),
        });

        if (createdSessionId && setActive) {
          await setActive({ session: createdSessionId });
          router.replace("/(tabs)/vault");
        }
      } catch (err) {
        const msg =
          (err as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ??
          "Sign-in failed. Please try again.";
        setError(msg);
      } finally {
        setPending(null);
      }
    },
    [pending, startSSOFlow],
  );

  return (
    <View style={styles.container}>
      {error ? (
        <View style={[styles.errorBox, { backgroundColor: `${colors.destructive}22`, borderColor: colors.destructive }]}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.oauthBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => handleOAuth("oauth_google")}
        activeOpacity={0.8}
        disabled={pending !== null}
      >
        {pending === "oauth_google" ? (
          <ActivityIndicator color={colors.foreground} />
        ) : (
          <>
            <AntDesign name="google" size={18} color={colors.foreground} />
            <Text style={[styles.oauthText, { color: colors.foreground }]}>Continue with Google</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.oauthBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => handleOAuth("oauth_apple")}
        activeOpacity={0.8}
        disabled={pending !== null}
      >
        {pending === "oauth_apple" ? (
          <ActivityIndicator color={colors.foreground} />
        ) : (
          <>
            <AntDesign name="apple" size={18} color={colors.foreground} />
            <Text style={[styles.oauthText, { color: colors.foreground }]}>Continue with Apple</Text>
          </>
        )}
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
        <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  oauthBtn: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  oauthText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  errorBox: { borderRadius: 8, borderWidth: 1, padding: 12 },
  errorText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
