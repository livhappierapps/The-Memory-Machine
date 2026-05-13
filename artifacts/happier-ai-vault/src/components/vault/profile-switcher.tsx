import { useState } from "react";
import { useProfile } from "@/contexts/profile-context";
import { useDeleteProfile, getListProfilesQueryKey } from "@workspace/api-client-react";
import { ProfileDialog } from "./profile-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Profile } from "@/contexts/profile-context";

export function ProfileSwitcher() {
  const { profiles, activeProfile, activeProfileId, setActiveProfileId, isLoading, refetchProfiles } = useProfile();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const deleteProfile = useDeleteProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleEdit = (profile: Profile, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProfile(profile);
    setDialogOpen(true);
  };

  const handleDelete = (profile: Profile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (profiles.length <= 1) {
      toast({ title: "Cannot delete the last profile", variant: "destructive" });
      return;
    }
    deleteProfile.mutate(
      { profileId: profile.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey(), exact: false, refetchType: "all" });
          if (activeProfileId === profile.id) {
            const remaining = profiles.filter((p) => p.id !== profile.id);
            if (remaining.length > 0) setActiveProfileId(remaining[0].id);
          }
          toast({ title: "Profile deleted" });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to delete profile.", variant: "destructive" });
        },
      },
    );
  };

  const handleNewProfile = () => {
    setEditingProfile(null);
    setDialogOpen(true);
  };

  const handleCreated = (id: number) => {
    setActiveProfileId(id);
    refetchProfiles();
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border/50">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between px-3 py-2 h-auto rounded-lg border border-border/50 bg-card hover:bg-muted"
          >
            <div className="flex items-center gap-2 min-w-0">
              {activeProfile && (
                <span
                  className="text-lg leading-none shrink-0"
                  style={{ filter: `drop-shadow(0 0 6px ${activeProfile.color}80)` }}
                >
                  {activeProfile.emoji}
                </span>
              )}
              <div className="min-w-0 text-left">
                <p
                  className="text-sm font-semibold truncate leading-tight"
                  style={{ color: activeProfile?.color ?? "currentColor" }}
                >
                  {activeProfile?.name ?? "Select profile"}
                </p>
                {activeProfile?.personalityNotes && (
                  <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
                    {activeProfile.personalityNotes.slice(0, 40)}…
                  </p>
                )}
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-1" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          {profiles.map((profile) => (
            <DropdownMenuItem
              key={profile.id}
              className={`flex items-center justify-between gap-2 cursor-pointer ${
                profile.id === activeProfileId ? "bg-primary/10" : ""
              }`}
              onSelect={() => setActiveProfileId(profile.id)}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-base leading-none shrink-0">{profile.emoji}</span>
                <div className="min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: profile.id === activeProfileId ? profile.color : undefined }}
                  >
                    {profile.name}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={(e) => handleEdit(profile, e)}
                  className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
                  title="Edit"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                {profiles.length > 1 && (
                  <button
                    onClick={(e) => handleDelete(profile, e)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={handleNewProfile} className="cursor-pointer text-primary">
            <Plus className="w-4 h-4 mr-2" />
            New Profile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfileDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingProfile(null);
        }}
        profile={editingProfile}
        onCreated={handleCreated}
      />
    </>
  );
}
