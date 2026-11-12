import { ClerkProvider, useAuth } from "@clerk/expo";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShareIntentProvider } from "expo-share-intent";
import { Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { IncomingShareProvider } from "@/contexts/IncomingShareContext";
import { ImportProvider } from "@/contexts/ImportContext";
import { ProfileProvider } from "@/contexts/ProfileContext";
import { useNotifications } from "@/hooks/useNotifications";
import { resolveApiOrigin } from "@/utils/api-origin";

// Persist Clerk sessions to secure storage so users stay logged in across
// app restarts and cold launches on real devices.
const tokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // ignore — don't crash if secure store is unavailable
    }
  },
  async clearToken(key: string) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // ignore
    }
  },
};

// Point all generated hooks at the remote API server.
setBaseUrl(resolveApiOrigin(process.env["EXPO_PUBLIC_DOMAIN"]));

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
});

function AuthSetup() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        return await getToken();
      } catch {
        return null;
      }
    });
    return () => {
      setAuthTokenGetter(null);
    };
  }, [getToken]);
  return null;
}

function RootLayoutNav() {
  useNotifications();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="thread" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: "#2f2f37" }} />;
  }

  const publishableKey = process.env["EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"] ?? "";

  return (
    <View style={{ flex: 1, backgroundColor: "#2f2f37" }}>
      {/* ShareIntentProvider must wrap everything so useShareIntentContext
          is available in any screen (required for Expo Router apps). */}
      <ShareIntentProvider
        options={{
          scheme: "thememorymachinemobile",
          // Keep the intent alive when the user briefly backgrounds the app
          // so it isn't lost before the import sheet opens.
          resetOnBackground: false,
        }}
      >
        {/* IncomingShareProvider must sit inside ShareIntentProvider but
            outside the auth guard so a ZIP shared while logged out is
            captured before the app redirects to sign-in.  After sign-in
            the tab layout reads the pending file from context and opens
            the ImportSheet automatically. */}
        <IncomingShareProvider>
          <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
            <AuthSetup />
            <SafeAreaProvider>
              <ErrorBoundary>
                <QueryClientProvider client={queryClient}>
                  <GestureHandlerRootView style={{ flex: 1 }}>
                    <KeyboardProvider>
                      <ProfileProvider>
                        <ImportProvider>
                          <RootLayoutNav />
                        </ImportProvider>
                      </ProfileProvider>
                    </KeyboardProvider>
                  </GestureHandlerRootView>
                </QueryClientProvider>
              </ErrorBoundary>
            </SafeAreaProvider>
          </ClerkProvider>
        </IncomingShareProvider>
      </ShareIntentProvider>
    </View>
  );
}
