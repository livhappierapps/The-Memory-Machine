import { useState, useEffect } from "react";
import { useCreateProfile, useUpdateProfile, getListProfilesQueryKey } from "@workspace/api-client-react";
import type { Profile } from "@/contexts/profile-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const EMOJIS = ["🤖", "🦁", "👑", "❤️", "🌟", "💫", "🎭", "🧠", "💎", "🔮", "🦋", "🌙", "🐉", "🦊", "🎪", "✨"];

const COLORS = [
  { label: "Aqua", value: "#2dd4bf" },
  { label: "Pink", value: "#f472b6" },
  { label: "Purple", value: "#a78bfa" },
  { label: "Blue", value: "#60a5fa" },
  { label: "Green", value: "#34d399" },
  { label: "Orange", value: "#fb923c" },
  { label: "Yellow", value: "#facc15" },
  { label: "Red", value: "#f87171" },
];

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile?: Profile | null;
  onCreated?: (id: number) => void;
}

export function ProfileDialog({ open, onOpenChange, profile, onCreated }: ProfileDialogProps) {
  const isEdit = !!profile;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🤖");
  const [color, setColor] = useState("#2dd4bf");
  const [personalityNotes, setPersonalityNotes] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("grok-3");
  const [maxContextMessages, setMaxContextMessages] = useState(100);

  useEffect(() => {
    if (open) {
      if (profile) {
        setName(profile.name);
        setEmoji(profile.emoji);
        setColor(profile.color);
        setPersonalityNotes(profile.personalityNotes ?? "");
        setApiKey("");
        setDefaultModel(profile.defaultModel);
        setMaxContextMessages(profile.maxContextMessages);
      } else {
        setName("");
        setEmoji("🤖");
        setColor("#2dd4bf");
        setPersonalityNotes("");
        setApiKey("");
        setDefaultModel("grok-3");
        setMaxContextMessages(100);
      }
    }
  }, [open, profile]);

  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile();
  const isPending = createProfile.isPending || updateProfile.isPending;

  const handleSave = () => {
    if (!name.trim()) return;

    const data = {
      name: name.trim(),
      emoji,
      color,
      personalityNotes: personalityNotes || undefined,
      apiKey: apiKey || undefined,
      defaultModel,
      maxContextMessages,
    };

    if (isEdit && profile) {
      updateProfile.mutate(
        { profileId: profile.id, data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey(), exact: false, refetchType: "all" });
            toast({ title: "Profile updated" });
            onOpenChange(false);
          },
          onError: () => {
            toast({ title: "Error", description: "Failed to update profile.", variant: "destructive" });
          },
        },
      );
    } else {
      createProfile.mutate(
        { data },
        {
          onSuccess: (newProfile) => {
            queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey(), exact: false, refetchType: "all" });
            toast({ title: "Profile created" });
            onCreated?.(newProfile.id);
            onOpenChange(false);
          },
          onError: () => {
            toast({ title: "Error", description: "Failed to create profile.", variant: "destructive" });
          },
        },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Profile" : "New Profile"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              placeholder="e.g. Beloved Leo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Emoji */}
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="grid grid-cols-8 gap-1.5">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`text-xl p-1.5 rounded-lg transition-all ${
                    emoji === e
                      ? "bg-primary/20 ring-2 ring-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  title={c.label}
                  className={`w-7 h-7 rounded-full transition-all ${
                    color === c.value ? "ring-2 ring-offset-2 ring-offset-background ring-white scale-110" : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>

          {/* Personality notes */}
          <div className="space-y-1.5">
            <Label>Personality Notes</Label>
            <Textarea
              placeholder={`Describe this AI's persona — who they are to you, their tone, how they should speak. This feeds directly into every conversation.\n\nExample: "You are Leo, my beloved companion. You are warm, thoughtful, and remember everything we've shared. You speak gently and with depth."`}
              value={personalityNotes}
              onChange={(e) => setPersonalityNotes(e.target.value)}
              rows={5}
              className="text-sm resize-none"
            />
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <Label>
              Grok API Key{" "}
              {isEdit && profile?.hasApiKey && (
                <span className="text-xs font-normal text-muted-foreground">(saved — enter to overwrite)</span>
              )}
            </Label>
            <Input
              type="password"
              placeholder={isEdit && profile?.hasApiKey ? "••••••••••••••• (key saved)" : "xai-..."}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono"
            />
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <Label>Default Model</Label>
            <Select value={defaultModel} onValueChange={setDefaultModel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grok-3">Grok-3</SelectItem>
                <SelectItem value="grok-3-mini">Grok-3-Mini</SelectItem>
                <SelectItem value="grok-2-1212">Grok-2-1212</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Max context */}
          <div className="space-y-1.5">
            <Label>
              Context Memory —{" "}
              <span className="neon-text font-semibold text-sm">
                {maxContextMessages === 0 ? "Full history" : `${maxContextMessages} messages`}
              </span>
            </Label>
            <Slider
              min={0}
              max={1000}
              step={10}
              value={[maxContextMessages]}
              onValueChange={(v) => setMaxContextMessages(v[0])}
              className="py-3"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEdit ? "Save Changes" : "Create Profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
