import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useClerk } from "@clerk/react";
import { LogOut, Settings, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { signOut } = useClerk();

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      {/* Mini vertical sidebar for global nav */}
      <div
        className="w-14 shrink-0 border-r border-border/50 flex flex-col items-center py-4 bg-sidebar neon-border"
        style={{ borderRightColor: "hsl(174 40% 28% / 0.5)" }}
      >
        {/* Logo */}
        <div className="mb-8">
          <Link
            href="/vault"
            className="transition-colors neon-text"
            style={{ filter: "drop-shadow(0 0 6px hsl(174 85% 52% / 0.7))" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <circle cx="12" cy="12" r="3" />
              <path d="m12 9-1.5-1.5" />
              <path d="m12 15 1.5 1.5" />
              <path d="m15 12 1.5-1.5" />
              <path d="m9 12-1.5 1.5" />
            </svg>
          </Link>
        </div>

        {/* Nav links */}
        <nav className="flex-1 flex flex-col gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`rounded-xl ${location === "/vault" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                asChild
              >
                <Link href="/vault">
                  <BookOpen className="w-5 h-5" />
                  <span className="sr-only">Vault</span>
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Vault</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`rounded-xl ${location === "/settings" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                asChild
              >
                <Link href="/settings">
                  <Settings className="w-5 h-5" />
                  <span className="sr-only">Settings</span>
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </nav>

        {/* Sign out */}
        <div className="mt-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground rounded-xl"
                onClick={() => signOut()}
              >
                <LogOut className="w-5 h-5" />
                <span className="sr-only">Sign out</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <main className="flex-1 min-w-0 h-full relative">{children}</main>
    </div>
  );
}
