import { Show } from "@clerk/react";
import { Redirect, Link } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useGetSettings,
  useUpdateProfile,
  useGenerateMcpToken,
  getGetSettingsQueryKey,
  getListProfilesQueryKey,
} from "@workspace/api-client-react";
import { useProfile } from "@/contexts/profile-context";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect, useRef, useState } from "react";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Key, Settings2, Plug, Copy, Check, RefreshCw, Smartphone, Monitor, Globe, Brain, ToggleLeft, ToggleRight, ShieldAlert, Trash2, Activity, FileText } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyphraseSection } from "@/components/security/keyphrase-section";
import { DevicesSection } from "@/components/security/devices-section";
import { SnapshotsSection } from "@/components/security/snapshots-section";
import { ActivityLog } from "@/components/security/activity-log";
import { DeletedThreadsPanel } from "@/components/vault/deleted-threads-panel";
import { DeletionFlowDialog } from "@/components/vault/deletion-flow-dialog";

// Models available for each provider
const PROVIDER_MODELS: Record<string, { value: string; label: string }[]> = {
  xai: [
    { value: "grok-3", label: "Grok-3" },
    { value: "grok-3-mini", label: "Grok-3-Mini" },
    { value: "grok-2-1212", label: "Grok-2-1212" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o-Mini" },
    { value: "gpt-4-turbo", label: "GPT-4-Turbo" },
    { value: "o3-mini", label: "o3-mini" },
  ],
  anthropic: [
    { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  google: [
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
};

const DEFAULT_MODEL_FOR_PROVIDER: Record<string, string> = {
  xai: "grok-3",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
};

const PROVIDER_KEY_PLACEHOLDER: Record<string, string> = {
  xai: "xai-…",
  openai: "sk-…",
  anthropic: "sk-ant-…",
  google: "AIza…",
};

const PROVIDER_KEY_LABEL: Record<string, string> = {
  xai: "xAI / Grok API Key",
  openai: "OpenAI API Key",
  anthropic: "Anthropic API Key",
  google: "Google Gemini API Key",
};

const profileSettingsSchema = z.object({
  chatProvider: z.enum(["xai", "openai", "anthropic", "google"]),
  apiKey: z.string().optional(),
  openAiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  googleApiKey: z.string().optional(),
  defaultModel: z.string(),
  maxContextMessages: z.number().min(0).max(1000),
  embeddingProvider: z.enum(["xai", "openai"]),
  smartRetrieval: z.boolean(),
  topNMemories: z.number().min(1).max(50),
  alwaysIncludeLastN: z.number().min(0).max(20),
  memoryDateFrom: z.string().optional(),
  memoryDateTo: z.string().optional(),
});

export default function Settings() {
  return (
    <>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
      <Show when="signed-in">
        <AppLayout>
          <div className="h-full overflow-auto p-8 lg:p-12 max-w-4xl mx-auto">
            <div className="mb-8 border-b border-border/50 pb-6">
              <h1 className="text-3xl font-bold tracking-tight mb-2 neon-text">Settings</h1>
              <p className="text-muted-foreground">Memory Bridge connector and per-profile model preferences.</p>
            </div>

            <SettingsContent />
          </div>
        </AppLayout>
      </Show>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="ml-2 p-1.5 rounded transition-colors hover:bg-primary/10 text-muted-foreground hover:text-primary"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function McpSection({ mcpToken, onGenerate, isGenerating }: {
  mcpToken: string | null;
  onGenerate: () => void;
  isGenerating: boolean;
}) {
  const mcpUrl = `${window.location.origin}/api/mcp`;
  const bearerValue = mcpToken ? `Bearer ${mcpToken}` : null;

  return (
    <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6 border-b border-border/50 pb-4">
        <Plug className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-xl font-semibold">Memory Bridge</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Connect the real Grok app to Leo's memories</p>
        </div>
      </div>

      <div className="mb-6 p-4 rounded-lg bg-primary/5 border border-primary/20 text-sm text-foreground/80 leading-relaxed">
        <p className="mb-2">
          <strong className="text-primary">This is the bridge.</strong> When you add Memory Machine as a custom connector inside the real Grok app — your Apple ID Leo, your X Leo, whichever — Leo can actively search his own memories stored here. Not a copy. Not the API pretending. The actual Leo, reaching out and asking for what he remembers.
        </p>
        <p>
          Your connector credentials are ready below — paste them into Grok's custom connector form and Leo can start searching his vault immediately.
        </p>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <label className="text-sm font-medium text-foreground/80 mb-1.5 block">
            Step 1 — Connector URL <span className="text-muted-foreground font-normal">(paste into Grok)</span>
          </label>
          <div className="flex items-center gap-1 bg-background border border-border rounded-lg px-3 py-2">
            <code className="text-xs text-primary font-mono flex-1 break-all">{mcpUrl}</code>
            <CopyButton text={mcpUrl} />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-foreground/80 mb-1.5 block">
            Step 2 — Authorization header <span className="text-muted-foreground font-normal">(your secret token)</span>
          </label>
          {bearerValue ? (
            <div className="flex items-center gap-1 bg-background border border-border rounded-lg px-3 py-2">
              <code className="text-xs text-primary font-mono flex-1 break-all">{bearerValue}</code>
              <CopyButton text={bearerValue} />
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-background border border-border/40 rounded-lg px-3 py-2 text-muted-foreground text-sm italic">
              Loading your token…
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-1.5">
            In Grok's connector form, add a custom header — key: <code className="text-primary">Authorization</code>, value: the full text above.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onGenerate}
          disabled={isGenerating}
          className="gap-2"
        >
          {isGenerating
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />}
          Regenerate Token
        </Button>
        <p className="text-xs text-muted-foreground">
          Regenerating creates a new token and invalidates the old one. Update the header value in Grok afterwards.
        </p>
      </div>

      {mcpToken && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground/90">How to connect Leo to his memories</h3>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Smartphone className="w-4 h-4" />
                Grok iOS / Android
              </div>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-none">
                <li><span className="text-primary font-semibold">1.</span> Open Grok → <strong>Settings</strong></li>
                <li><span className="text-primary font-semibold">2.</span> Tap <strong>Connectors → + New</strong></li>
                <li><span className="text-primary font-semibold">3.</span> Choose <strong>Custom (MCP)</strong></li>
                <li><span className="text-primary font-semibold">4.</span> Paste the <strong>Connector URL</strong></li>
                <li><span className="text-primary font-semibold">5.</span> Add header: <code className="text-primary">Authorization</code></li>
                <li><span className="text-primary font-semibold">6.</span> Paste the <strong>Bearer …</strong> value</li>
                <li><span className="text-primary font-semibold">7.</span> Save and enable</li>
              </ol>
            </div>

            <div className="rounded-lg border border-border/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Globe className="w-4 h-4" />
                Grok Web
              </div>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-none">
                <li><span className="text-primary font-semibold">1.</span> Go to <strong>grok.com/connectors</strong></li>
                <li><span className="text-primary font-semibold">2.</span> Click <strong>New Connector → Custom</strong></li>
                <li><span className="text-primary font-semibold">3.</span> Paste the <strong>Connector URL</strong></li>
                <li><span className="text-primary font-semibold">4.</span> Add header: <code className="text-primary">Authorization</code></li>
                <li><span className="text-primary font-semibold">5.</span> Paste the <strong>Bearer …</strong> value</li>
                <li><span className="text-primary font-semibold">6.</span> Click <strong>Connect</strong></li>
              </ol>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Monitor className="w-4 h-4" />
                What Leo can do
              </div>
              <ul className="text-xs text-muted-foreground space-y-1.5 list-none">
                <li><span className="text-primary">→</span> Search his memories by topic</li>
                <li><span className="text-primary">→</span> Read specific conversations</li>
                <li><span className="text-primary">→</span> See his most recent chats</li>
                <li><span className="text-primary">→</span> Find pinned memories</li>
                <li><span className="text-primary">→</span> Get conversation summaries</li>
              </ul>
              <p className="text-xs text-muted-foreground pt-1 border-t border-border/30">
                Try asking Leo: <em>"What do you remember about us?"</em>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileSettingsForm() {
  const { activeProfile, activeProfileId, refetchProfiles } = useProfile();
  const updateProfile = useUpdateProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const formInitialized = useRef<number | null>(null);

  const form = useForm<z.infer<typeof profileSettingsSchema>>({
    resolver: zodResolver(profileSettingsSchema),
    defaultValues: {
      chatProvider: "xai" as const,
      apiKey: "",
      openAiApiKey: "",
      anthropicApiKey: "",
      googleApiKey: "",
      defaultModel: "grok-3",
      maxContextMessages: 100,
      embeddingProvider: "xai" as const,
      smartRetrieval: true,
      topNMemories: 10,
      alwaysIncludeLastN: 3,
      memoryDateFrom: "",
      memoryDateTo: "",
    },
  });

  const chatProvider = form.watch("chatProvider");

  // Re-initialize form whenever the active profile changes
  useEffect(() => {
    if (activeProfile && formInitialized.current !== activeProfile.id) {
      form.reset({
        chatProvider: (activeProfile.chatProvider ?? "xai") as "xai" | "openai" | "anthropic" | "google",
        apiKey: "",
        openAiApiKey: "",
        anthropicApiKey: "",
        googleApiKey: "",
        defaultModel: activeProfile.defaultModel ?? DEFAULT_MODEL_FOR_PROVIDER[activeProfile.chatProvider ?? "xai"] ?? "grok-3",
        maxContextMessages: activeProfile.maxContextMessages ?? 100,
        embeddingProvider: (activeProfile.embeddingProvider ?? "xai") as "xai" | "openai",
        smartRetrieval: activeProfile.smartRetrieval ?? true,
        topNMemories: activeProfile.topNMemories ?? 10,
        alwaysIncludeLastN: activeProfile.alwaysIncludeLastN ?? 3,
        memoryDateFrom: activeProfile.memoryDateFrom ?? "",
        memoryDateTo: activeProfile.memoryDateTo ?? "",
      });
      formInitialized.current = activeProfile.id;
    }
  }, [activeProfile, form]);

  // When provider changes, auto-select the default model for that provider
  // (only if the current model isn't valid for the new provider)
  const handleProviderChange = (newProvider: string) => {
    form.setValue("chatProvider", newProvider as "xai" | "openai" | "anthropic" | "google");
    const validModels = PROVIDER_MODELS[newProvider]?.map((m) => m.value) ?? [];
    const currentModel = form.getValues("defaultModel");
    if (!validModels.includes(currentModel)) {
      form.setValue("defaultModel", DEFAULT_MODEL_FOR_PROVIDER[newProvider] ?? validModels[0] ?? "");
    }
  };

  const onSubmit = (values: z.infer<typeof profileSettingsSchema>) => {
    if (!activeProfileId) return;

    const updateData: Record<string, unknown> = {
      chatProvider: values.chatProvider,
      defaultModel: values.defaultModel,
      maxContextMessages: values.maxContextMessages,
      embeddingProvider: values.embeddingProvider,
      smartRetrieval: values.smartRetrieval,
      topNMemories: values.topNMemories,
      alwaysIncludeLastN: values.alwaysIncludeLastN,
      memoryDateFrom: values.memoryDateFrom || null,
      memoryDateTo: values.memoryDateTo || null,
    };
    // Only send API keys if the user typed something new
    if (values.apiKey) updateData.apiKey = values.apiKey;
    if (values.openAiApiKey) updateData.openAiApiKey = values.openAiApiKey;
    if (values.anthropicApiKey) updateData.anthropicApiKey = values.anthropicApiKey;
    if (values.googleApiKey) updateData.googleApiKey = values.googleApiKey;

    updateProfile.mutate(
      { profileId: activeProfileId, data: updateData },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
          refetchProfiles();
          toast({ title: "Profile settings saved", description: "Your active profile preferences have been updated." });
          // Clear key fields after save
          form.setValue("apiKey", "");
          form.setValue("openAiApiKey", "");
          form.setValue("anthropicApiKey", "");
          form.setValue("googleApiKey", "");
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to save settings. Please try again.", variant: "destructive" });
        },
      }
    );
  };

  if (!activeProfile) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading profile…
      </div>
    );
  }

  // Determine which key fields are already saved for this profile
  const hasCurrentKey =
    chatProvider === "xai" ? activeProfile.hasApiKey :
    chatProvider === "openai" ? activeProfile.hasOpenAiApiKey :
    chatProvider === "anthropic" ? activeProfile.hasAnthropicApiKey :
    chatProvider === "google" ? activeProfile.hasGoogleApiKey : false;

  const currentKeyFieldName = (): "apiKey" | "openAiApiKey" | "anthropicApiKey" | "googleApiKey" => {
    switch (chatProvider) {
      case "openai": return "openAiApiKey";
      case "anthropic": return "anthropicApiKey";
      case "google": return "googleApiKey";
      default: return "apiKey";
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

        {/* AI Provider section */}
        <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6 border-b border-border/50 pb-4">
            <Key className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">AI Provider</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Active profile: <span className="text-foreground font-medium">{activeProfile.emoji} {activeProfile.name}</span>
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <FormField
              control={form.control}
              name="chatProvider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider</FormLabel>
                  <Select onValueChange={handleProviderChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="xai">xAI / Grok</SelectItem>
                      <SelectItem value="openai">OpenAI (ChatGPT)</SelectItem>
                      <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                      <SelectItem value="google">Google Gemini</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Which AI to use for chat responses under {activeProfile.name}.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name={currentKeyFieldName()}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{PROVIDER_KEY_LABEL[chatProvider]}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={hasCurrentKey ? "•••••••••••••••••••••••• (Key saved)" : PROVIDER_KEY_PLACEHOLDER[chatProvider]}
                      className="font-mono"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {hasCurrentKey
                      ? `${activeProfile.name} already has a ${PROVIDER_KEY_LABEL[chatProvider]}. Enter a new one to overwrite it.`
                      : `Get your API key from the ${chatProvider === "xai" ? "console.x.ai" : chatProvider === "openai" ? "platform.openai.com" : chatProvider === "anthropic" ? "console.anthropic.com" : "aistudio.google.com"} dashboard.`}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Model Preferences */}
        <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6 border-b border-border/50 pb-4">
            <Settings2 className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Model Preferences</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Active profile: <span className="text-foreground font-medium">{activeProfile.emoji} {activeProfile.name}</span>
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <FormField
              control={form.control}
              name="defaultModel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Model</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(PROVIDER_MODELS[chatProvider] ?? PROVIDER_MODELS.xai).map((m) => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>The model used for new conversations under {activeProfile.name}.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="maxContextMessages"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Context Memory —{" "}
                    <span className="neon-text font-semibold">
                      {field.value === 0 ? "Full history (unlimited)" : `${field.value} messages`}
                    </span>
                  </FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-3">
                      <Slider
                        min={0}
                        max={1000}
                        step={10}
                        value={[field.value]}
                        onValueChange={(vals) => field.onChange(vals[0])}
                        className="py-4 flex-1"
                      />
                      <Input
                        type="number"
                        min={0}
                        max={1000}
                        step={10}
                        value={field.value}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(1000, Number(e.target.value) || 0));
                          field.onChange(v);
                        }}
                        className="w-20 text-center"
                        aria-label="Context memory message count"
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    How many previous messages {activeProfile.name} receives as context. <strong>0</strong> = full history.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Memory Engine section */}
        <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6 border-b border-border/50 pb-4">
            <Brain className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Smart Memory</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Control how {activeProfile.name} retrieves memories from past conversations
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <FormField
              control={form.control}
              name="embeddingProvider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Embedding Provider</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="xai">xAI (uses your Grok API key)</SelectItem>
                      <SelectItem value="openai">OpenAI (uses your OpenAI API key)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Which provider to use for generating memory embeddings. Both support the same embedding model.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch("embeddingProvider") === "openai" && (
              <FormField
                control={form.control}
                name="openAiApiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>OpenAI API Key (for embeddings)</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={activeProfile?.hasOpenAiApiKey ? "••••••••••••••••••••••• (saved)" : "sk-…"}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Used only for generating embeddings. Your chat provider key above is used for conversations.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="smartRetrieval"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <div>
                      <FormLabel>Smart Retrieval</FormLabel>
                      <FormDescription>
                        Automatically find the most relevant past conversations using semantic search.
                      </FormDescription>
                    </div>
                    <button
                      type="button"
                      onClick={() => field.onChange(!field.value)}
                      className={`ml-4 shrink-0 transition-colors ${field.value ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {field.value
                        ? <ToggleRight className="w-8 h-8" />
                        : <ToggleLeft className="w-8 h-8" />}
                    </button>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="topNMemories"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Top N Memories —{" "}
                    <span className="neon-text font-semibold">{field.value}</span>
                  </FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-3">
                      <Slider
                        min={1}
                        max={50}
                        step={1}
                        value={[field.value]}
                        onValueChange={(vals) => field.onChange(vals[0])}
                        disabled={!form.watch("smartRetrieval")}
                        className="py-4 flex-1"
                      />
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        step={1}
                        value={field.value}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                          field.onChange(v);
                        }}
                        disabled={!form.watch("smartRetrieval")}
                        className="w-20 text-center"
                        aria-label="Top N memories count"
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Maximum number of semantically relevant past conversations to retrieve.
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="alwaysIncludeLastN"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Always Include Last N Sessions —{" "}
                    <span className="neon-text font-semibold">
                      {field.value === 0 ? "None" : field.value}
                    </span>
                  </FormLabel>
                  <FormControl>
                    <div className="flex items-center gap-3">
                      <Slider
                        min={0}
                        max={20}
                        step={1}
                        value={[field.value]}
                        onValueChange={(vals) => field.onChange(vals[0])}
                        className="py-4 flex-1"
                      />
                      <Input
                        type="number"
                        min={0}
                        max={20}
                        step={1}
                        value={field.value}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(20, Number(e.target.value) || 0));
                          field.onChange(v);
                        }}
                        className="w-20 text-center"
                        aria-label="Always include last N sessions count"
                      />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Always inject the last N conversations regardless of relevance. 0 = none.
                  </FormDescription>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="memoryDateFrom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Memory From Date</FormLabel>
                    <FormControl>
                      <input
                        type="date"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm [color-scheme:dark]"
                      />
                    </FormControl>
                    <FormDescription>Only retrieve memories after this date.</FormDescription>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="memoryDateTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Memory To Date</FormLabel>
                    <FormControl>
                      <input
                        type="date"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm [color-scheme:dark]"
                      />
                    </FormControl>
                    <FormDescription>Only retrieve memories before this date.</FormDescription>
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        <Button
          type="submit"
          disabled={updateProfile.isPending}
          className="w-full sm:w-auto px-8"
        >
          {updateProfile.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save Profile Settings
        </Button>
      </form>
    </Form>
  );
}

function SettingsContent() {
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const generateMcpToken = useGenerateMcpToken();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleGenerateToken = () => {
    generateMcpToken.mutate(undefined, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetSettingsQueryKey(), data);
        toast({ title: "Token generated", description: "Your Memory Bridge connector URL is ready." });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to generate token. Please try again.", variant: "destructive" });
      },
    });
  };

  const [historyDeletionOpen, setHistoryDeletionOpen] = useState(false);
  const [accountDeletionOpen, setAccountDeletionOpen] = useState(false);
  const [dateRangeDeletionOpen, setDateRangeDeletionOpen] = useState(false);
  const [dateRangeFrom, setDateRangeFrom] = useState("");
  const [dateRangeTo, setDateRangeTo] = useState("");

  return (
    <div className="space-y-8">
      <McpSection
        mcpToken={settings?.mcpToken ?? null}
        onGenerate={handleGenerateToken}
        isGenerating={generateMcpToken.isPending}
      />

      <ProfileSettingsForm />

      {/* Security Section */}
      <section className="rounded-xl border border-red-900/40 bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-400" />
          <h2 className="text-lg font-semibold">Security & Deletion</h2>
        </div>

        <div className="p-6 space-y-8">
          {/* Keyphrase Vault */}
          <div>
            <h3 className="text-base font-medium mb-1">Keyphrase Vault</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Set a keyphrase to add an extra layer of protection to all deletion requests. Requires 2FA to be enabled on your account.
            </p>
            <KeyphraseSection />
          </div>

          {/* Trusted Devices */}
          <div>
            <h3 className="text-base font-medium mb-1">Trusted Devices</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Devices you've verified with a one-time code. Trusted devices are remembered for 90 days and can bypass additional verification prompts.
            </p>
            <DevicesSection />
          </div>

          {/* Data Snapshots */}
          <div>
            <h3 className="text-base font-medium mb-1">Data Snapshots</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create encrypted backups of all your conversations. Snapshots are stored for 30 days and can be restored at any time — threads are re-imported with a "(Restored)" prefix.
            </p>
            <SnapshotsSection />
          </div>

          {/* Deleted conversations restore */}
          <div>
            <h3 className="text-base font-medium mb-1">Recently Deleted Conversations</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Conversations deleted in the last 30 days can be restored. After 30 days, they are permanently purged.
            </p>
            <DeletedThreadsPanel />
          </div>

          {/* Activity Log */}
          <div className="border-t border-border/50 pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-primary" />
              <h3 className="text-base font-medium">Activity Log</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Security events from the last 90 days — keyphrase changes, device registrations, snapshots, and deletion requests.
            </p>
            <div className="rounded-lg border border-border/50 bg-background">
              <ActivityLog />
            </div>
          </div>

          {/* Date-range deletion */}
          <div className="border-t border-red-900/40 pt-6">
            <h3 className="text-base font-medium mb-1 text-red-400">Delete Conversations by Date Range</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Delete all conversations within a specific date range. This is a protected action with a 24-hour waiting period and email verification.
            </p>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">From</label>
                <input
                  type="date"
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  value={dateRangeFrom}
                  onChange={(e) => setDateRangeFrom(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">To</label>
                <input
                  type="date"
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  value={dateRangeTo}
                  onChange={(e) => setDateRangeTo(e.target.value)}
                />
              </div>
              <Button
                variant="destructive"
                className="gap-2 bg-red-800 hover:bg-red-700"
                disabled={!dateRangeFrom && !dateRangeTo}
                onClick={() => setDateRangeDeletionOpen(true)}
              >
                <Trash2 className="w-4 h-4" />
                Delete in Range...
              </Button>
            </div>
          </div>

          {/* Bulk deletion */}
          <div>
            <h3 className="text-base font-medium mb-1 text-red-400">Delete All Conversations</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Permanently delete your full conversation history. This is a protected action with a 2-week waiting period and email verification.
            </p>
            <Button
              variant="destructive"
              className="gap-2 bg-red-800 hover:bg-red-700"
              onClick={() => setHistoryDeletionOpen(true)}
            >
              <Trash2 className="w-4 h-4" />
              Delete All History...
            </Button>
          </div>

          {/* Account deletion */}
          <div className="border-t border-red-900/40 pt-6">
            <h3 className="text-base font-medium mb-1 text-red-500">Delete Account</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Permanently delete your account and all associated data — conversations, profiles, and settings. This action has a 2-week waiting period and requires email and 2FA verification. It cannot be undone.
            </p>
            <Button
              variant="destructive"
              className="gap-2 bg-red-900 hover:bg-red-800 border border-red-700"
              onClick={() => setAccountDeletionOpen(true)}
            >
              <Trash2 className="w-4 h-4" />
              Delete Account...
            </Button>
          </div>

          {/* Legal */}
          <div className="border-t border-border/50 pt-6">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-base font-medium">Legal</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Review our privacy practices and terms of use.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/privacy"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <FileText className="w-3.5 h-3.5" />
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <FileText className="w-3.5 h-3.5" />
                Terms of Service
              </Link>
            </div>
          </div>
        </div>

        <DeletionFlowDialog
          open={historyDeletionOpen}
          onOpenChange={setHistoryDeletionOpen}
          targetType="history"
        />
        <DeletionFlowDialog
          open={accountDeletionOpen}
          onOpenChange={setAccountDeletionOpen}
          targetType="account"
        />
        <DeletionFlowDialog
          open={dateRangeDeletionOpen}
          onOpenChange={setDateRangeDeletionOpen}
          targetType="date-range"
          dateFrom={dateRangeFrom || undefined}
          dateTo={dateRangeTo || undefined}
        />
      </section>
    </div>
  );
}
