import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";

Sentry.init({
  dsn: dsn || undefined,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  tracesSampleRate: 0.2,
  sendDefaultPii: false,
  enableAutoSessionTracking: true,
});

export { Sentry };
