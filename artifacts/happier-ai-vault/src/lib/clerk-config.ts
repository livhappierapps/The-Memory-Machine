import { shadcn } from "@clerk/themes";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Strip the Vite base path prefix from Clerk-generated navigation URLs
 * so wouter's relative router receives just the path portion.
 */
export function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

export { basePath };

export const clerkAppearance = {
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
