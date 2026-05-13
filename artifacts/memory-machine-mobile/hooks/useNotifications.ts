import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface PushTokenResult {
  token: string | null;
  granted: boolean;
}

async function registerForPushNotifications(): Promise<PushTokenResult> {
  if (Platform.OS === "web") return { token: null, granted: false };

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return { token: null, granted: false };
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    return { token: tokenData.data, granted: true };
  } catch {
    return { token: null, granted: true };
  }
}

export function useNotifications(onNotification?: (notification: Notifications.Notification) => void) {
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    void registerForPushNotifications();

    if (onNotification) {
      notificationListener.current = Notifications.addNotificationReceivedListener(onNotification);
    }

    responseListener.current = Notifications.addNotificationResponseReceivedListener(() => {
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [onNotification]);
}
