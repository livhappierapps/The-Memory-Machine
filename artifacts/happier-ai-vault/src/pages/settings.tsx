import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useEffect, useRef } from "react";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Key, Settings2 } from "lucide-react";
import { getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const settingsSchema = z.object({
  apiKey: z.string().optional(),
  defaultModel: z.string(),
  maxContextMessages: z.number().min(1).max(50),
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
              <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
              <p className="text-muted-foreground">Manage your Grok API key and vault preferences.</p>
            </div>
            
            <SettingsForm />
          </div>
        </AppLayout>
      </Show>
    </>
  );
}

function SettingsForm() {
  const { data: settings, isLoading } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const formInitialized = useRef(false);

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      apiKey: "",
      defaultModel: "grok-2-1212",
      maxContextMessages: 10,
    },
  });

  useEffect(() => {
    if (settings && !formInitialized.current) {
      form.reset({
        apiKey: "", // We don't load the real API key for security, only indicator
        defaultModel: settings.defaultModel || "grok-2-1212",
        maxContextMessages: settings.maxContextMessages || 10,
      });
      formInitialized.current = true;
    }
  }, [settings, form]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const onSubmit = (values: z.infer<typeof settingsSchema>) => {
    updateSettings.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetSettingsQueryKey(), data);
          toast({
            title: "Settings saved",
            description: "Your preferences have been updated successfully.",
          });
          if (values.apiKey) {
            form.setValue("apiKey", ""); // Clear API key field after successful save
          }
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to save settings. Please try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6 border-b border-border/50 pb-4">
            <Key className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Authentication</h2>
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
                    placeholder={settings?.hasApiKey ? "•••••••••••••••••••••••• (Key saved)" : "xai-..."} 
                    className="font-mono"
                    {...field} 
                  />
                </FormControl>
                <FormDescription>
                  {settings?.hasApiKey 
                    ? "You already have an API key saved. Enter a new one to overwrite it." 
                    : "Enter your Grok API key from the xAI console."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6 border-b border-border/50 pb-4">
            <Settings2 className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Model Preferences</h2>
          </div>
          
          <div className="space-y-6">
            <FormField
              control={form.control}
              name="defaultModel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Model</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                  <FormDescription>
                    The model to use for new conversations.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="maxContextMessages"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Context Memory ({field.value} messages)</FormLabel>
                  <FormControl>
                    <Slider
                      min={1}
                      max={50}
                      step={1}
                      value={[field.value]}
                      onValueChange={(vals) => field.onChange(vals[0])}
                      className="py-4"
                    />
                  </FormControl>
                  <FormDescription>
                    How many previous messages to include as context for the AI.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <Button 
          type="submit" 
          disabled={updateSettings.isPending}
          className="w-full sm:w-auto px-8"
        >
          {updateSettings.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save Preferences
        </Button>
      </form>
    </Form>
  );
}