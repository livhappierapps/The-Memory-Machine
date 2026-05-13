import { useClerk, useSignUp } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type Step = "details" | "verify";

export default function SignUpScreen() {
  const { signUp } = useSignUp();
  const { setActive } = useClerk();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const extractError = (err: unknown) =>
    (err as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ??
    "Something went wrong. Please try again.";

  const handleSignUp = async () => {
    if (!signUp || loading) return;
    setError(null);
    setLoading(true);
    try {
      const { error: createError } = await signUp.create({
        emailAddress: email.trim(),
        password,
      });
      if (createError) {
        setError(createError.longMessage ?? createError.message ?? "Sign-up failed.");
        return;
      }
      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) {
        setError(sendError.longMessage ?? sendError.message ?? "Could not send verification code.");
        return;
      }
      setStep("verify");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!signUp || loading) return;
    setError(null);
    setLoading(true);
    try {
      const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code });
      if (verifyError) {
        setError(verifyError.longMessage ?? verifyError.message ?? "Invalid code.");
        return;
      }
      if (signUp.status === "complete" && signUp.createdSessionId) {
        await setActive({ session: signUp.createdSessionId });
        router.replace("/(tabs)/vault");
      } else {
        setError("Verification incomplete. Please try again.");
      }
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.inner, { paddingTop: topPad + 24, paddingBottom: bottomPad + 24 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (step === "verify" ? setStep("details") : router.back())}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {step === "details" ? "Create account" : "Verify email"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {step === "details"
              ? "Start preserving your AI conversations"
              : `Enter the code sent to ${email}`}
          </Text>
        </View>

        <View style={styles.form}>
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: `${colors.destructive}22`, borderColor: colors.destructive }]}>
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          ) : null}

          {step === "details" ? (
            <>
              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  placeholderTextColor={colors.mutedForeground}
                  placeholder="you@example.com"
                />
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
                <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.inputInner, { color: colors.foreground }]}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPass}
                    autoComplete="new-password"
                    placeholderTextColor={colors.mutedForeground}
                    placeholder="Min 8 characters"
                    returnKeyType="go"
                    onSubmitEditing={handleSignUp}
                  />
                  <TouchableOpacity onPress={() => setShowPass((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Feather name={showPass ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.primary }, (loading || !email || !password) && styles.disabled]}
                onPress={handleSignUp}
                activeOpacity={0.8}
                disabled={loading || !email || !password}
              >
                {loading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.submitText, { color: colors.primaryForeground }]}>Continue</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Verification Code</Text>
                <TextInput
                  style={[styles.input, styles.codeInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  placeholderTextColor={colors.mutedForeground}
                  placeholder="123456"
                  autoFocus
                  returnKeyType="go"
                  onSubmitEditing={handleVerify}
                />
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.primary }, (loading || code.length < 6) && styles.disabled]}
                onPress={handleVerify}
                activeOpacity={0.8}
                disabled={loading || code.length < 6}
              >
                {loading ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.submitText, { color: colors.primaryForeground }]}>Verify &amp; Sign In</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        <TouchableOpacity onPress={() => router.replace("/sign-in")}>
          <Text style={[styles.switchText, { color: colors.mutedForeground }]}>
            Already have an account?{" "}
            <Text style={{ color: colors.primary }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 24, gap: 32 },
  backBtn: { alignSelf: "flex-start" },
  header: { gap: 6 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular" },
  form: { gap: 16 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  codeInput: {
    fontSize: 24,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    letterSpacing: 8,
  },
  inputRow: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inputInner: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  submitBtn: {
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  disabled: { opacity: 0.6 },
  submitText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  errorBox: { borderRadius: 8, borderWidth: 1, padding: 12 },
  errorText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  switchText: { textAlign: "center", fontSize: 14, fontFamily: "Inter_400Regular" },
});
