import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useListProfiles, getListProfilesQueryKey } from "@workspace/api-client-react";
import type { Profile } from "@workspace/api-client-react";

export type { Profile };

interface ProfileContextType {
  profiles: Profile[];
  activeProfile: Profile | null;
  activeProfileId: number | null;
  setActiveProfileId: (id: number) => void;
  isLoading: boolean;
  refetchProfiles: () => void;
}

const ProfileContext = createContext<ProfileContextType | null>(null);

const STORAGE_KEY = "mm_active_profile_id";

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [activeProfileId, setActiveProfileIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : null;
  });

  // True while the user has explicitly selected a profile that hasn't landed
  // in the profiles list yet (e.g. brand-new profile pending its first refetch).
  // Prevents the guard useEffect from resetting activeProfileId before the
  // refetch returns the new profile.
  //
  // NOTE: starts as false so the normal fallback-to-first still fires on
  // fresh page loads where no profile ID is stored in localStorage.
  const userSetProfileRef = useRef(false);

  const { data: profiles = [], isLoading, refetch } = useListProfiles({
    query: { queryKey: getListProfilesQueryKey() },
  });

  useEffect(() => {
    if (profiles.length === 0) return;

    const valid = profiles.find((p) => p.id === activeProfileId);
    if (!valid) {
      // The user explicitly selected this ID — it may not be in the list yet
      // because the refetch hasn't returned. Hold off on the fallback.
      if (userSetProfileRef.current) return;

      // Genuinely invalid (no stored ID on fresh load, or profile deleted
      // elsewhere) — fall back to the first available profile.
      const first = profiles[0];
      setActiveProfileIdState(first.id);
      localStorage.setItem(STORAGE_KEY, String(first.id));
    } else {
      // Profile confirmed in the list — clear the pending guard.
      userSetProfileRef.current = false;
    }
  }, [profiles, activeProfileId]);

  const setActiveProfileId = (id: number) => {
    userSetProfileRef.current = true;
    setActiveProfileIdState(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  };

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  return (
    <ProfileContext.Provider
      value={{
        profiles,
        activeProfile,
        activeProfileId,
        setActiveProfileId,
        isLoading,
        refetchProfiles: refetch,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}
