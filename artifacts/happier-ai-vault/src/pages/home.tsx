import { Show } from "@clerk/react";
import { Redirect, Link } from "wouter";

export default function Home() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/vault" />
      </Show>
      <Show when="signed-out">
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
          <div className="max-w-md text-center space-y-6">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              Happier AI Vault
            </h1>
            <p className="text-muted-foreground text-lg">
              A permanent, secure archive for all your Grok conversations.
            </p>
            <div className="flex gap-4 justify-center">
              <Link href="/sign-in" className="bg-primary text-primary-foreground hover:bg-primary/90 px-6 py-2 rounded-md font-medium">
                Sign In
              </Link>
              <Link href="/sign-up" className="bg-secondary text-secondary-foreground hover:bg-secondary/90 px-6 py-2 rounded-md font-medium">
                Sign Up
              </Link>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}