import { useAuth } from "@clerk/expo";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

interface PendingDeletion {
  id: number;
  status: string;
  targetType: string;
  dateFrom: string | null;
  dateTo: string | null;
  executeAfter: string;
}

function formatCountdown(targetDate: Date): string {
  const diff = targetDate.getTime() - Date.now();
  if (diff <= 0) return "executing soon...";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function targetLabel(request: PendingDeletion): string {
  if (request.targetType === "account") return "your entire account";
  if (request.targetType === "history") return "your full conversation history";
  if (request.dateFrom || request.dateTo) return "conversations in date range";
  return "selected conversations";
}

export function DeletionWarningBanner({ baseUrl }: { baseUrl: string }) {
  const { getToken } = useAuth();
  const [pending, setPending] = useState<PendingDeletion | null>(null);
  const [countdown, setCountdown] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let mounted = true;
    const fetchPending = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${baseUrl}/api/deletion-requests/pending`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && mounted) {
          const data = await res.json();
          setPending(data);
        }
      } catch {
        /* silent */
      }
    };
    fetchPending();
    const poll = setInterval(fetchPending, 60_000);
    return () => {
      mounted = false;
      clearInterval(poll);
    };
  }, [getToken, baseUrl]);

  useEffect(() => {
    if (!pending) return;
    const target = new Date(pending.executeAfter);
    const tick = () => setCountdown(formatCountdown(target));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pending, pulseAnim]);

  const handleCancel = useCallback(async () => {
    if (!pending || cancelling) return;
    setCancelling(true);
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${baseUrl}/api/deletion-requests/${pending.id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setPending(null);
    } finally {
      setCancelling(false);
    }
  }, [pending, cancelling, getToken, baseUrl]);

  if (!pending) return null;

  return (
    <Animated.View style={[styles.banner, { opacity: pulseAnim }]}>
      <Pressable onPress={handleCancel} style={styles.content}>
        <Text style={styles.label}>⚠ DELETION PENDING</Text>
        <Text style={styles.body}>
          {targetLabel(pending)} deletes in{" "}
          <Text style={styles.countdown}>{countdown}</Text>
        </Text>
        <Text style={styles.cancelHint}>
          {cancelling ? "Cancelling..." : "TAP TO CANCEL"}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#991b1b",
    borderBottomWidth: 2,
    borderBottomColor: "#ef4444",
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 2,
  },
  label: {
    color: "#fca5a5",
    fontWeight: "700",
    fontSize: 12,
    letterSpacing: 0.5,
  },
  body: {
    color: "#fecaca",
    fontSize: 13,
  },
  countdown: {
    color: "#ff6b6b",
    fontFamily: "monospace",
    fontWeight: "700",
  },
  cancelHint: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
});
