import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import { useLeo } from "@/contexts/LeoContext";

export default function Index() {
  const { settings, isReady } = useLeo();
  const router = useRouter();

  useEffect(() => {
    if (!isReady) return;
    if (!settings.xaiApiKey) {
      router.replace("/setup");
    } else {
      router.replace("/chat");
    }
  }, [isReady, settings.xaiApiKey, router]);

  return (
    <View style={{ flex: 1, backgroundColor: "#0a0a0f", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color="#f5a623" size="large" />
    </View>
  );
}
