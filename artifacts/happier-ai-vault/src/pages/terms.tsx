import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function Terms() {
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
          <h1 className="text-3xl font-bold text-foreground mb-3">Terms of Service</h1>
          <p className="text-sm text-muted-foreground">
            <strong>Effective date:</strong> July 1, 2026 &nbsp;·&nbsp; <strong>Last updated:</strong> July 1, 2026
          </p>
        </header>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-sm leading-relaxed text-muted-foreground">

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Agreement to Terms</h2>
            <p>
              By downloading, installing, or using The Memory Machine ("the App"), you agree to be bound by
              these Terms of Service ("Terms"). If you do not agree, do not use the App.
              The App is developed and operated by <strong className="text-foreground">Livhappier Apps</strong>.
              Questions? <a href="mailto:oblivionhappier@icloud.com" className="text-primary hover:underline">oblivionhappier@icloud.com</a>
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Eligibility</h2>
            <p>You must be at least <strong className="text-foreground">13 years old</strong> to use the App. If you are under 18, your parent or guardian must review and agree to these Terms on your behalf.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Your Account</h2>
            <p>You are responsible for maintaining the confidentiality of your login credentials, all activity under your account, and notifying us immediately of any unauthorized access.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">What the App Does</h2>
            <p>The Memory Machine lets you conduct conversations with AI language models and stores those conversations in an encrypted personal vault. Key features include:</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li><strong className="text-foreground">Conversation storage</strong> — messages encrypted at rest with per-user AES-256-GCM encryption.</li>
              <li><strong className="text-foreground">AI responses</strong> — the App routes your messages to an AI provider (xAI Grok by default, or others you configure).</li>
              <li><strong className="text-foreground">Snapshots</strong> — periodic encrypted backups of your vault.</li>
              <li><strong className="text-foreground">Trusted devices</strong> — device verification for sensitive account actions.</li>
              <li><strong className="text-foreground">Import/export</strong> — import from other AI services; export as JSON or Markdown.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">AI Disclaimer</h2>
            <p>
              The App is a <strong className="text-foreground">tool for interacting with third-party AI services</strong>.
              We do not operate the AI models themselves. AI responses may be inaccurate or incomplete —
              do not rely on them for medical, legal, financial, or safety-critical decisions.
              AI conversations are sent to the AI provider you select, and their terms apply.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">API Keys</h2>
            <p>
              If you provide your own API keys for third-party AI providers, your keys are encrypted at rest
              and used only to make requests on your behalf. You are responsible for any costs incurred through
              your API keys.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Acceptable Use</h2>
            <p>You agree not to use the App to:</p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>Violate any applicable law or regulation.</li>
              <li>Harass, threaten, or harm any person.</li>
              <li>Attempt to circumvent security measures or gain unauthorized access.</li>
              <li>Use automated tools to scrape or extract data without written permission.</li>
              <li>Reverse engineer, decompile, or disassemble the App.</li>
              <li>Attempt to use another user's account or impersonate any person.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Data Ownership</h2>
            <p>
              <strong className="text-foreground">You own your conversations.</strong> We claim no ownership
              over the content you store. You grant us a limited license to store, encrypt, and retrieve your
              content solely to provide the App's functionality. You can export or delete your data at any time.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Deletion and Account Termination</h2>
            <p>
              You can request account deletion through the App's Settings. Bulk deletions and full account
              deletions are subject to a waiting period (24 hours for single threads, 2 weeks for full
              history or account deletion) as protection against accidental or coerced deletion.
            </p>
            <p className="mt-2">
              We may suspend or terminate your access if you violate these Terms. In the event we discontinue
              the App, we will provide reasonable advance notice and an opportunity to export your data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Intellectual Property</h2>
            <p>
              The App, including its design, code, and branding, is owned by Livhappier Apps and protected
              by copyright law. You may not copy, modify, or distribute the App without our written permission.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Disclaimers</h2>
            <p className="uppercase text-xs tracking-wide">
              The App is provided "as is" and "as available" without warranties of any kind, express or implied,
              including but not limited to warranties of merchantability, fitness for a particular purpose,
              or non-infringement. We do not warrant that the App will be uninterrupted, error-free, or secure,
              or that any AI responses will be accurate or complete.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Limitation of Liability</h2>
            <p className="uppercase text-xs tracking-wide">
              To the maximum extent permitted by law, Livhappier Apps shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages, including loss of data, loss of profits,
              or business interruption. Our total liability for any claim shall not exceed the amount you paid
              us in the preceding 12 months, or $50 USD if you have not made any payments.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Governing Law</h2>
            <p>
              These Terms are governed by the laws of Oklahoma, without regard to conflict of law principles.
              Any disputes shall be resolved in the courts of Tulsa County, Oklahoma.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. We will notify you by updating the "Last updated"
              date above. Continued use of the App after changes constitutes acceptance.
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
