import { Show } from "@clerk/react";
import { Redirect } from "wouter";
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
import { Loader2, Key, Settings2, Plug, Copy, Check, RefreshCw, Smartphone, Monitor, Globe } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const profileSettingsSchema = z.object({
  apiKey: z.string().optional(),
  defaultModel: z.string(),
  maxContextMessages: z.number().min(0).max(1000),
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
      apiKey: "",
      defaultModel: "grok-3",
      maxContextMessages: 100,
    },
  });

  // Re-initialize form whenever the active profile changes
  useEffect(() => {
    if (activeProfile && formInitialized.current !== activeProfile.id) {
      form.reset({
        apiKey: "",
        defaultModel: activeProfile.defaultModel ?? "grok-3",
        maxContextMessages: activeProfile.maxContextMessages ?? 100,
      });
      formInitialized.current = activeProfile.id;
    }
  }, [activeProfile, form]);

  const onSubmit = (values: z.infer<typeof profileSettingsSchema>) => {
    if (!activeProfileId) return;

    const updateData: Record<string, unknown> = {
      defaultModel: values.defaultModel,
      maxContextMessages: values.maxContextMessages,
    };
    if (values.apiKey) updateData.apiKey = values.apiKey;

    updateProfile.mutate(
      { profileId: activeProfileId, data: updateData },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
          refetchProfiles();
          toast({ title: "Profile settings saved", description: "Your active profile preferences have been updated." });
          if (values.apiKey) form.setValue("apiKey", "");
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6 border-b border-border/50 pb-4">
            <Key className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">API Key</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Active profile: <span className="text-foreground font-medium">{activeProfile.emoji} {activeProfile.name}</span>
              </p>
            </div>
          </div>

          <FormField
            control={form.control}
            name="apiKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Grok API Key</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder={activeProfile.hasApiKey ? "•••••••••••••••••••••••• (Key saved)" : "xai-..."}
                    className="font-mono"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {activeProfile.hasApiKey
                    ? `${activeProfile.name} already has an API key. Enter a new one to overwrite it.`
                    : `Enter your Grok API key from console.x.ai — this key is used only for ${activeProfile.name}.`}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

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
                      <SelectItem value="grok-3">Grok-3</SelectItem>
                      <SelectItem value="grok-3-mini">Grok-3-Mini</SelectItem>
                      <SelectItem value="grok-2-1212">Grok-2-1212</SelectItem>
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
                    <Slider
                      min={0}
                      max={1000}
                      step={10}
                      value={[field.value]}
                      onValueChange={(vals) => field.onChange(vals[0])}
                      className="py-4"
                    />
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

  return (
    <div className="space-y-8">
      <McpSection
        mcpToken={settings?.mcpToken ?? null}
        onGenerate={handleGenerateToken}
        isGenerating={generateMcpToken.isPending}
      />

      <ProfileSettingsForm />
    </div>
  );
}
