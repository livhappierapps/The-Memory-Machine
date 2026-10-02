import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_PERMANENT_MEMORY } from "./leoDefaultMemory";

export interface LeoSettings {
  xaiApiKey: string;
  memoryMachineUrl: string;
  memoryMachineMcpToken: string;
  model: string;
  displayName: string;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

interface LeoContextValue {
  settings: LeoSettings;
  updateSettings: (s: Partial<LeoSettings>) => Promise<void>;
  permanentMemory: string;
  updatePermanentMemory: (text: string) => Promise<void>;
  session: ChatTurn[];
  setSession: (turns: ChatTurn[]) => Promise<void>;
  appendTurn: (turn: ChatTurn) => Promise<void>;
  clearSession: () => Promise<void>;
  isReady: boolean;
}

const DEFAULT_SETTINGS: LeoSettings = {
  xaiApiKey: "",
  memoryMachineUrl: "",
  memoryMachineMcpToken: "",
  model: "grok-4",
  displayName: "love",
};

// Re-export so existing imports of DEFAULT_PERMANENT_MEMORY from this file keep working.
export { DEFAULT_PERMANENT_MEMORY };

const LeoContext = createContext<LeoContextValue | null>(null);

const SETTINGS_KEY = "leo_settings_v2";
const SETTINGS_KEY_LEGACY = "leo_settings_v1";
const MEMORY_KEY = "leo_permanent_memory_v2";
const MEMORY_KEY_LEGACY = "leo_permanent_memory_v1";
const SESSION_KEY = "leo_session_v1";

export function LeoProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<LeoSettings>(DEFAULT_SETTINGS);
  const [permanentMemory, setPermanentMemory] = useState(DEFAULT_PERMANENT_MEMORY);
  const [session, setSessionState] = useState<ChatTurn[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [storedV2, storedV1, memV2, memV1, sess] = await Promise.all([
          SecureStore.getItemAsync(SETTINGS_KEY),
          SecureStore.getItemAsync(SETTINGS_KEY_LEGACY),
          AsyncStorage.getItem(MEMORY_KEY),
          AsyncStorage.getItem(MEMORY_KEY_LEGACY),
          AsyncStorage.getItem(SESSION_KEY),
        ]);
        const raw = storedV2 ?? storedV1;
        if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
        if (memV2) setPermanentMemory(memV2);
        else if (memV1) setPermanentMemory(memV1);
        if (sess) {
          const parsed = JSON.parse(sess) as ChatTurn[];
          if (Array.isArray(parsed)) setSessionState(parsed.slice(-80));
        }
      } catch {
        // defaults
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  const updateSettings = useCallback(async (partial: Partial<LeoSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const updatePermanentMemory = useCallback(async (text: string) => {
    setPermanentMemory(text);
    await AsyncStorage.setItem(MEMORY_KEY, text);
  }, []);

  const setSession = useCallback(async (turns: ChatTurn[]) => {
    const clipped = turns.slice(-80);
    setSessionState(clipped);
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(clipped));
  }, []);

  const appendTurn = useCallback(async (turn: ChatTurn) => {
    setSessionState((prev) => {
      const next = [...prev, turn].slice(-80);
      AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearSession = useCallback(async () => {
    setSessionState([]);
    await AsyncStorage.removeItem(SESSION_KEY);
  }, []);

  return (
    <LeoContext.Provider
      value={{
        settings,
        updateSettings,
        permanentMemory,
        updatePermanentMemory,
        session,
        setSession,
        appendTurn,
        clearSession,
        isReady,
      }}}
    >
      {children}
    </LeoContext.Provider>
  );
}

export function useLeo() {
  const ctx = useContext(LeoContext);
  if (!ctx) throw new Error("useLeo must be used within LeoProvider");
  return ctx;
}
