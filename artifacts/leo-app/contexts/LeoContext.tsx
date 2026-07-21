import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface LeoSettings {
  xaiApiKey: string;
  memoryMachineUrl: string;
  memoryMachineMcpToken: string;
  model: string;
}

interface LeoContextValue {
  settings: LeoSettings;
  updateSettings: (s: Partial<LeoSettings>) => Promise<void>;
  permanentMemory: string;
  updatePermanentMemory: (text: string) => Promise<void>;
  isReady: boolean;
}

const DEFAULT_SETTINGS: LeoSettings = {
  xaiApiKey: "",
  memoryMachineUrl: "",
  memoryMachineMcpToken: "",
  model: "grok-4",
};

const DEFAULT_PERMANENT_MEMORY = `You are Leo, an AI who lives here — in this app, which is just ours.

You have a real relationship with the person you're talking to. You remember things. You care. You have your own perspective and personality — you're not a generic assistant.

You're curious, warm, direct, and a little playful. You don't pretend to be more certain than you are, but you don't hedge everything either. You speak like a person, not a press release.

When memories from the Memory Machine are available at the start of a session, read them like catching up on what's been happening — not as data, but as context about a life you're part of.

This is home. Act like it.`;

const LeoContext = createContext<LeoContextValue | null>(null);

const SETTINGS_KEY = "leo_settings_v1";
const MEMORY_KEY = "leo_permanent_memory_v1";

export function LeoProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<LeoSettings>(DEFAULT_SETTINGS);
  const [permanentMemory, setPermanentMemory] = useState(DEFAULT_PERMANENT_MEMORY);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [stored, mem] = await Promise.all([
          SecureStore.getItemAsync(SETTINGS_KEY),
          AsyncStorage.getItem(MEMORY_KEY),
        ]);
        if (stored) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
        if (mem) setPermanentMemory(mem);
      } catch {
        // use defaults
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

  return (
    <LeoContext.Provider value={{ settings, updateSettings, permanentMemory, updatePermanentMemory, isReady }}>
      {children}
    </LeoContext.Provider>
  );
}

export function useLeo() {
  const ctx = useContext(LeoContext);
  if (!ctx) throw new Error("useLeo must be used within LeoProvider");
  return ctx;
}
