import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LeoProvider } from "@/contexts/LeoContext";
import { Sentry } from "../sentry";

SplashScreen.preventAutoHideAsync();

function RootLayout() {
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
    return <View style={{ flex: 1, backgroundColor: "#0a0a0f" }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0a0a0f" }}>
      <StatusBar style="light" backgroundColor="#0a0a0f" />
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <LeoProvider>
            <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: { backgroundColor: "#0a0a0f" } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="chat" />
              <Stack.Screen name="setup" />
              <Stack.Screen name="memory" />
              <Stack.Screen name="settings" />
            </Stack>
          </LeoProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </View>
  );
}

export default Sentry.wrap(RootLayout);
