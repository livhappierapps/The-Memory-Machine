import { createContext, useContext, useEffect, useState } from "react";
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

  const { data: profiles = [], isLoading, refetch } = useListProfiles({
    query: { queryKey: getListProfilesQueryKey() },
  });

  useEffect(() => {
    if (profiles.length === 0) return;

    const valid = profiles.find((p) => p.id === activeProfileId);
    if (!valid) {
      const first = profiles[0];
      setActiveProfileIdState(first.id);
      localStorage.setItem(STORAGE_KEY, String(first.id));
    }
  }, [profiles, activeProfileId]);

  const setActiveProfileId = (id: number) => {
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
