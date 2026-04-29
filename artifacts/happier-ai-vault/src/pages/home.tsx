import { Show } from "@clerk/react";
import { Redirect, Link } from "wouter";

export default function Home() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/vault" />
      </Show>
      <Show when="signed-out">
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
          {/* Subtle radial glow behind the card */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse 60% 45% at 50% 50%, hsl(174 85% 52% / 0.07) 0%, transparent 70%)",
            }}
          />

          {/* Circuit art placeholder — user will drop their image here */}
          <div id="circuit-art-slot" className="mb-8 w-full max-w-md flex justify-center" />

          <div className="max-w-md text-center space-y-6 relative z-10">
            <h1 className="text-5xl font-bold tracking-tight neon-text-pulse">
              Happier AI Vault
            </h1>
            <p className="text-foreground/70 text-lg leading-relaxed">
              A permanent, secure archive for all your Grok conversations.
            </p>

            {/* Neon divider line */}
            <div
              className="mx-auto w-24 h-px"
              style={{
                background: "hsl(174 85% 52%)",
                boxShadow:
                  "0 0 6px hsl(174 85% 52% / 0.8), 0 0 16px hsl(174 85% 52% / 0.4)",
              }}
            />

            <div className="flex gap-4 justify-center pt-2">
              <Link
                href="/sign-in"
                className="relative px-7 py-2.5 rounded-md font-semibold text-sm transition-all duration-200"
                style={{
                  background: "hsl(174 85% 52%)",
                  color: "hsl(240 30% 8%)",
                  boxShadow:
                    "0 0 10px hsl(174 85% 52% / 0.65), 0 0 24px hsl(174 85% 52% / 0.35), 0 0 48px hsl(174 85% 52% / 0.15)",
                }}
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                className="px-7 py-2.5 rounded-md font-semibold text-sm transition-all duration-200"
                style={{
                  background: "transparent",
                  color: "hsl(174 85% 52%)",
                  border: "1px solid hsl(174 85% 52% / 0.7)",
                  boxShadow:
                    "0 0 6px hsl(174 85% 52% / 0.3), 0 0 14px hsl(174 85% 52% / 0.15)",
                }}
              >
                Sign Up
              </Link>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}
