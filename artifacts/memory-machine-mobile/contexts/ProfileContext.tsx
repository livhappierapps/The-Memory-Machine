import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import type { Profile } from "@workspace/api-client-react";

interface ProfileContextValue {
  activeProfile: Profile | null;
  setActiveProfile: (profile: Profile | null) => void;
  activeProfileId: number | undefined;
}

const ProfileContext = createContext<ProfileContextValue>({
  activeProfile: null,
  setActiveProfile: () => {},
  activeProfileId: undefined,
});

const STORAGE_KEY = "mm_active_profile_id";

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [activeProfile, setActiveProfileState] = useState<Profile | null>(null);
  const [_storedId, setStoredId] = useState<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((val) => {
        if (val) setStoredId(Number(val));
      })
      .catch(() => {});
  }, []);

  const setActiveProfile = useCallback((profile: Profile | null) => {
    setActiveProfileState(profile);
    if (profile) {
      AsyncStorage.setItem(STORAGE_KEY, String(profile.id)).catch(() => {});
      setStoredId(profile.id);
    } else {
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      setStoredId(null);
    }
  }, []);

  return (
    <ProfileContext.Provider
      value={{
        activeProfile,
        setActiveProfile,
        activeProfileId: activeProfile?.id,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}
