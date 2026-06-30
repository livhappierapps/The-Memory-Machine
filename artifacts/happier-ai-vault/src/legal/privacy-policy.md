# Privacy Policy — The Memory Machine

**Effective date:** July 1, 2026  
**Last updated:** July 1, 2026  
**Published at:** livhappierapps.com/apps/thememorymachine/privacy

---

## Who We Are

The Memory Machine is developed and operated by **Livhappier Apps**. If you have any questions about this policy, contact us at **oblivionhappier@icloud.com**.

---

## What This App Does

The Memory Machine is a personal AI conversation vault. You can chat with AI models (such as Grok by xAI), and every conversation is saved and encrypted so only you can read it. Think of it as a private journal that can talk back.

---

## What Information We Collect

### Information You Provide
- **Account information** — your name and email address, collected and managed through Clerk (our authentication provider). We never see or store your password.
- **Conversations** — the messages you send and receive in the app, including any content you import from other AI services.
- **Settings and preferences** — your chosen AI model, context window size, profile settings, and optional keyphrase (stored as a one-way hash we cannot reverse).
- **API keys** — if you provide your own AI provider keys (xAI, OpenAI, Anthropic, Google), these are encrypted at rest and never transmitted to us in plaintext.

### Information Collected Automatically
- **Device identifiers** — a hashed device token stored in a cookie when you verify a trusted device. This is used only to authorize sensitive actions like account deletion.
- **Basic usage logs** — server logs recording which API endpoints were called and whether they succeeded, without logging message content. These logs are retained for up to 30 days.

### Information We Do NOT Collect
- We do not collect advertising identifiers.
- We do not track you across other websites or apps.
- We do not use cookies for advertising purposes.
- We do not sell, rent, or share your personal data with third parties for marketing.

---

## How We Protect Your Data

All conversation content, API keys, and other sensitive fields are encrypted at rest using **AES-256-GCM** with per-user keys derived via HKDF. This means:

- Even if our database were compromised, your message content would be unreadable without your encryption root secret.
- Your API keys are stored encrypted and decrypted only in memory at the moment they are needed to make an AI request.
- Snapshots (periodic backups of your conversations) are encrypted with the same per-user key before being stored.

Data is stored in a PostgreSQL database hosted on Replit infrastructure in the United States.

---

## Third-Party Services

We use the following third-party services to operate the app:

| Service | Purpose | Their Privacy Policy |
|---|---|---|
| **Clerk** | User authentication and identity | clerk.com/privacy |
| **xAI (Grok)** | AI responses (when you use the default model) | x.ai/privacy |
| **OpenAI** | AI responses (if you select the OpenAI provider) | openai.com/privacy |
| **Anthropic** | AI responses (if you select the Anthropic provider) | anthropic.com/privacy |
| **Google** | AI responses (if you select the Gemini provider) | policies.google.com/privacy |
| **Replit** | Hosting and infrastructure | replit.com/privacy |
| **Resend** | Transactional email (verification codes, deletion links) | resend.com/privacy |

When you send a message, your conversation context is sent to the AI provider you have selected. Please review their privacy policies to understand how they handle that data.

---

## How We Use Your Information

We use your information only to:

1. Authenticate you and keep your account secure.
2. Store, encrypt, and retrieve your conversations on your behalf.
3. Send transactional emails (verification codes, deletion confirmation links). We do not send marketing emails.
4. Generate automatic snapshots and provide restore functionality.
5. Improve reliability and diagnose technical issues using anonymized logs.

---

## Your Rights and Controls

You have full control over your data:

- **Export** — download any conversation as JSON or Markdown at any time.
- **Delete conversations** — delete individual threads immediately, or initiate a protected bulk-deletion flow (with a 24-hour or 2-week cooling-off period for large deletions to protect against accidental or coerced deletion).
- **Delete your account** — initiates a full account deletion with a 2-week waiting period and a signed email confirmation link.
- **Snapshots** — manually create a full encrypted backup of your vault at any time, or restore from any saved snapshot.

If you are located in the **European Economic Area (EEA)**, United Kingdom, or California, you may have additional rights under GDPR, UK GDPR, or CCPA respectively, including the right to access, rectify, or erase your data. Contact us at **oblivionhappier@icloud.com** to exercise these rights.

---

## Data Retention

| Data | Retention |
|---|---|
| Conversations and messages | Until you delete them or your account |
| Snapshots | 90 days from creation, then automatically purged |
| Server logs | Up to 30 days |
| Deleted threads (soft-deleted) | Purged within 6 hours of deletion |
| Trusted device records | 90 days from verification |

---

## Children's Privacy

The Memory Machine is not directed at children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have inadvertently collected such information, please contact us immediately.

---

## Changes to This Policy

We may update this policy from time to time. We will notify you of material changes by updating the "Last updated" date above. Continued use of the app after changes constitutes acceptance of the updated policy.

---

## Contact

**Livhappier Apps**  
Email: oblivionhappier@icloud.com
Website: livhappierapps.com
