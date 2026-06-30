import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

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

        <header className="mb-10">
          <p className="text-sm font-semibold text-primary tracking-widest uppercase mb-2">Livhappier Apps</p>
          <h1 className="text-3xl font-bold text-foreground mb-3">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">
            <strong>Effective date:</strong> July 1, 2026 &nbsp;·&nbsp; <strong>Last updated:</strong> July 1, 2026
          </p>
        </header>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-sm leading-relaxed text-muted-foreground">

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Who We Are</h2>
            <p>
              The Memory Machine is developed and operated by <strong className="text-foreground">Livhappier Apps</strong>.
              If you have any questions about this policy, contact us at{" "}
              <a href="mailto:oblivionhappier@icloud.com" className="text-primary hover:underline">oblivionhappier@icloud.com</a>.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">What This App Does</h2>
            <p>
              The Memory Machine is a personal AI conversation vault. You can chat with AI models (such as Grok by xAI),
              and every conversation is saved and encrypted so only you can read it.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">What Information We Collect</h2>
            <h3 className="text-sm font-semibold text-foreground mt-4 mb-1">Information You Provide</h3>
            <ul className="list-disc list-inside space-y-1">
              <li><strong className="text-foreground">Account information</strong> — your name and email address, collected and managed through Clerk (our authentication provider). We never see or store your password.</li>
              <li><strong className="text-foreground">Conversations</strong> — the messages you send and receive in the app, including any content you import from other AI services.</li>
              <li><strong className="text-foreground">Settings and preferences</strong> — your chosen AI model, context window size, profile settings, and optional keyphrase (stored as a one-way hash we cannot reverse).</li>
              <li><strong className="text-foreground">API keys</strong> — if you provide your own AI provider keys, these are encrypted at rest and never transmitted in plaintext.</li>
            </ul>
            <h3 className="text-sm font-semibold text-foreground mt-4 mb-1">Information Collected Automatically</h3>
            <ul className="list-disc list-inside space-y-1">
              <li><strong className="text-foreground">Device identifiers</strong> — a hashed device token stored in a cookie when you verify a trusted device.</li>
              <li><strong className="text-foreground">Basic usage logs</strong> — server logs recording API endpoint calls without logging message content. Retained for up to 30 days.</li>
            </ul>
            <h3 className="text-sm font-semibold text-foreground mt-4 mb-1">Information We Do NOT Collect</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>We do not collect advertising identifiers.</li>
              <li>We do not track you across other websites or apps.</li>
              <li>We do not sell, rent, or share your data with third parties for marketing.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">How We Protect Your Data</h2>
            <p>
              All conversation content, API keys, and other sensitive fields are encrypted at rest using{" "}
              <strong className="text-foreground">AES-256-GCM</strong> with per-user keys derived via HKDF.
              Even if our database were compromised, your message content would be unreadable without your
              encryption root secret. Data is stored in a PostgreSQL database hosted on Replit infrastructure
              in the United States.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Third-Party Services</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-semibold text-foreground">Service</th>
                    <th className="text-left py-2 pr-4 font-semibold text-foreground">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {[
                    ["Clerk", "User authentication"],
                    ["xAI (Grok)", "AI responses (default model)"],
                    ["OpenAI", "AI responses (optional)"],
                    ["Anthropic", "AI responses (optional)"],
                    ["Google", "AI responses (optional)"],
                    ["Replit", "Hosting and infrastructure"],
                    ["Resend", "Transactional email"],
                  ].map(([svc, purpose]) => (
                    <tr key={svc}>
                      <td className="py-2 pr-4 text-foreground font-medium">{svc}</td>
                      <td className="py-2">{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">How We Use Your Information</h2>
            <ol className="list-decimal list-inside space-y-1">
              <li>Authenticate you and keep your account secure.</li>
              <li>Store, encrypt, and retrieve your conversations on your behalf.</li>
              <li>Send transactional emails (verification codes, deletion links). We do not send marketing emails.</li>
              <li>Generate automatic snapshots and provide restore functionality.</li>
              <li>Improve reliability and diagnose issues using anonymized logs.</li>
            </ol>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Your Rights and Controls</h2>
            <ul className="list-disc list-inside space-y-1">
              <li><strong className="text-foreground">Export</strong> — download any conversation as JSON or Markdown at any time.</li>
              <li><strong className="text-foreground">Delete conversations</strong> — delete individual threads or initiate a protected bulk-deletion flow.</li>
              <li><strong className="text-foreground">Delete your account</strong> — full account deletion with a 2-week waiting period and email confirmation.</li>
              <li><strong className="text-foreground">Snapshots</strong> — create or restore encrypted backups of your entire vault.</li>
            </ul>
            <p className="mt-3">
              If you are in the EEA, UK, or California, you may have additional rights under GDPR, UK GDPR, or CCPA.
              Contact us at <a href="mailto:oblivionhappier@icloud.com" className="text-primary hover:underline">oblivionhappier@icloud.com</a>.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Data Retention</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-semibold text-foreground">Data</th>
                    <th className="text-left py-2 font-semibold text-foreground">Retention</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {[
                    ["Conversations and messages", "Until you delete them or your account"],
                    ["Snapshots", "90 days from creation, then purged"],
                    ["Server logs", "Up to 30 days"],
                    ["Deleted threads (soft-deleted)", "Purged within 6 hours"],
                    ["Trusted device records", "90 days from verification"],
                  ].map(([data, ret]) => (
                    <tr key={data}>
                      <td className="py-2 pr-4 text-foreground">{data}</td>
                      <td className="py-2">{ret}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Children's Privacy</h2>
            <p>
              The Memory Machine is not directed at children under 13. We do not knowingly collect personal
              information from children under 13. Contact us immediately if you believe we have done so.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. We will notify you by updating the "Last updated"
              date above. Continued use of the app constitutes acceptance.
            </p>
          </section>

          <section className="border-t border-border/50 pt-6">
            <h2 className="text-base font-semibold text-foreground mb-2">Contact</h2>
            <p>
              <strong className="text-foreground">Livhappier Apps</strong><br />
              Email: <a href="mailto:oblivionhappier@icloud.com" className="text-primary hover:underline">oblivionhappier@icloud.com</a>
            </p>
          </section>

          <div className="border-t border-border/50 pt-6 flex gap-6 text-xs">
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
            <Link href="/" className="text-muted-foreground hover:text-foreground">Back to app</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
