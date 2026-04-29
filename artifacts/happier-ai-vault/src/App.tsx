import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { useEffect, useRef } from "react";
import { queryClient } from "@/lib/queryClient";

import Home from "@/pages/home";
import Vault from "@/pages/vault";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(174 85% 52%)",
    colorBackground: "hsl(240 8% 20%)",
    colorInput: "hsl(240 8% 26%)",
    colorInputForeground: "hsl(0 0% 97%)",
    colorForeground: "hsl(0 0% 97%)",
    colorMutedForeground: "hsl(240 5% 58%)",
    colorNeutral: "hsl(240 8% 28%)",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "w-[440px] max-w-full overflow-hidden rounded-xl border border-[hsl(174_40%_32%)]",
    card: "bg-[hsl(240_8%_23%)]",
    footer: "bg-[hsl(240_8%_20%)]",
    headerTitle: "text-white",
    headerSubtitle: "text-[hsl(240_5%_58%)]",
    formFieldLabel: "text-[hsl(0_0%_90%)]",
    socialButtonsBlockButtonText: "text-[hsl(0_0%_90%)]",
    footerActionText: "text-[hsl(240_5%_58%)]",
    footerActionLink: "text-[hsl(174_85%_52%)]",
    dividerText: "text-[hsl(240_5%_58%)]",
    formButtonPrimary:
      "bg-[hsl(174_85%_52%)] text-[hsl(240_30%_8%)] shadow-[0_0_10px_hsl(174_85%_52%_/_0.6),0_0_24px_hsl(174_85%_52%_/_0.3)]",
    identityPreviewText: "text-[hsl(0_0%_90%)]",
    identityPreviewEditButton: "text-[hsl(174_85%_52%)]",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/vault" component={Vault} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
