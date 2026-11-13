import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import privacyContent from "@/legal/privacy-policy.md?raw";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to app
          </Link>
        </div>

        <div className="
          prose prose-sm max-w-none
          prose-headings:text-foreground prose-headings:font-semibold
          prose-h1:text-2xl prose-h2:text-base prose-h3:text-sm
          prose-p:text-muted-foreground prose-p:leading-relaxed
          prose-a:text-primary prose-a:no-underline hover:prose-a:underline
          prose-strong:text-foreground
          prose-ul:text-muted-foreground prose-ol:text-muted-foreground
          prose-li:marker:text-muted-foreground
          prose-table:text-xs prose-th:text-foreground prose-th:font-semibold
          prose-td:text-muted-foreground
          prose-hr:border-border
          [&_table]:w-full [&_th]:text-left [&_th]:py-2 [&_th]:pr-4 [&_td]:py-2 [&_td]:pr-4
          [&_thead]:border-b [&_thead]:border-border
          [&_tbody_tr]:border-b [&_tbody_tr]:border-border/40
        ">
          <ReactMarkdown>{privacyContent}</ReactMarkdown>
        </div>

        <div className="border-t border-border/50 pt-6 mt-8 flex gap-6 text-xs text-muted-foreground">
          <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
          <Link href="/" className="hover:text-foreground">Back to app</Link>
        </div>
      </div>
    </div>
  );
}
