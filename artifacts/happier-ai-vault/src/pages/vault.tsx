import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import { AppLayout } from "@/components/layout/app-layout";
import { Sidebar } from "@/components/vault/sidebar";
import { ChatArea } from "@/components/vault/chat-area";
import { useState } from "react";

export default function Vault() {
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);

  return (
    <>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
      <Show when="signed-in">
        <AppLayout>
          <div className="flex h-full w-full overflow-hidden">
            <Sidebar 
              activeThreadId={activeThreadId} 
              onSelectThread={setActiveThreadId} 
            />
            <div className="flex-1 flex flex-col min-w-0 bg-background/50 border-l border-border/50">
              {activeThreadId ? (
                <ChatArea threadId={activeThreadId} />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="12" cy="12" r="3"/><path d="m12 9-1.5-1.5"/><path d="m12 15 1.5 1.5"/><path d="m15 12 1.5-1.5"/><path d="m9 12-1.5 1.5"/></svg>
                  </div>
                  <p>Select a thread to view or create a new one.</p>
                </div>
              )}
            </div>
          </div>
        </AppLayout>
      </Show>
    </>
  );
}