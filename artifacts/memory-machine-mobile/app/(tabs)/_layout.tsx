import { useAuth } from "@clerk/expo";
import { BlurView } from "expo-blur";
import { Redirect, Tabs, router } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { DeletionWarningBanner } from "@/components/DeletionWarningBanner";

import { useColors } from "@/hooks/useColors";
import { useIncomingShareContext } from "@/contexts/IncomingShareContext";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="vault">
        <Icon sf={{ default: "archivebox", selected: "archivebox.fill" }} />
        <Label>Vault</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="vault"
        options={{
          title: "Vault",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="archivebox" tintColor={color} size={24} />
            ) : (
              <Feather name="inbox" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="gearshape" tintColor={color} size={24} />
            ) : (
              <Feather name="settings" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const baseUrl = `https://${process.env["EXPO_PUBLIC_DOMAIN"] ?? "localhost"}`;

  const { incomingFile, clearIncoming } = useIncomingShareContext();

  // When a ZIP is shared while any tab is active, navigate to the Vault tab
  // so the ImportSheet can open.  VaultScreen reads incomingFile from context
  // and opens the sheet once it's mounted.
  useEffect(() => {
    if (incomingFile) {
      router.navigate("/(tabs)/vault");
    }
  }, [incomingFile]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const tabContent = Platform.OS === "ios" ? <NativeTabLayout /> : <ClassicTabLayout />;

  return (
    <View style={{ flex: 1 }}>
      <DeletionWarningBanner baseUrl={baseUrl} />
      {tabContent}
    </View>
  );
}
