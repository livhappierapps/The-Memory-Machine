/**
 * IncomingShareContext
 *
 * Provides the current share-intent file (if any) and a clearIncoming function
 * to all screens in the app, including unauthenticated ones.
 *
 * IMPORTANT: IncomingShareProvider must be rendered *inside* ShareIntentProvider
 * but *outside* (above) the auth guard so that a ZIP shared while the user is
 * logged out is captured before the app redirects to the sign-in screen.  After
 * sign-in the tab layout reads the pending file from this context and opens the
 * ImportSheet automatically.
 */

import React, { createContext, useContext } from "react";
import type { IncomingFile } from "@/hooks/useIncomingShare";
import { useIncomingShare } from "@/hooks/useIncomingShare";

interface IncomingShareContextValue {
  incomingFile: IncomingFile | null;
  clearIncoming: () => void;
}

const IncomingShareContext = createContext<IncomingShareContextValue>({
  incomingFile: null,
  clearIncoming: () => {},
});

/**
 * Self-contained provider: calls useIncomingShare internally so the hook
 * lifecycle is tied to this node in the tree (root layout), not the tab layout.
 * Render this inside ShareIntentProvider but outside the auth guard.
 */
export function IncomingShareProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { incomingFile, clearIncoming } = useIncomingShare();

  return (
    <IncomingShareContext.Provider value={{ incomingFile, clearIncoming }}>
      {children}
    </IncomingShareContext.Provider>
  );
}

export function useIncomingShareContext(): IncomingShareContextValue {
  return useContext(IncomingShareContext);
}
