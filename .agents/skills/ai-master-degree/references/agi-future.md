---
name: agi-future
description: AGI progress, reasoning model breakthroughs, AI rights movements, ethics, laws, future scenarios, and what this all means for builders in 2025 and beyond.
---

# AGI Progress, The Future, and What It Means for Builders

## Where We Actually Are (Mid-2025)

### The Capability Frontier

**Reasoning Models (the 2024-2025 breakthrough)**
- OpenAI o3, o3-mini, o4-mini
- Google Gemini 2.5 Pro (reasoning mode)
- Anthropic Claude Sonnet 3.7 (extended thinking)
- xAI Grok 3 (reasoning mode)

What changed: These models "think" before answering — spending compute on chain-of-thought reasoning. Results:
- PhD-level performance on science/math benchmarks
- AIME (hard math olympiad): 90%+ accuracy (humans: ~70%)
- SWE-bench (software engineering): 50%+ (real code fixes)
- ARC-AGI: 75%+ on some models (was previously human-hard at 90%)

**What This Means for Builders**
- Use reasoning models for tasks requiring multi-step logic, debugging, planning
- They're slower and more expensive — don't use for simple tasks
- "Extended thinking" can be hidden from users but dramatically improves complex task quality
- Model tiers: reasoning model for planning, standard model for execution, mini for classification

### Current Capability Profile (2025)
| Task | AI Performance |
|---|---|
| Code generation | Exceeds most human developers for common tasks |
| Mathematics | PhD-level for most areas; still weak on novel olympiad problems |
| Scientific reasoning | Expert-level analysis; can't run novel experiments |
| Creative writing | Matches skilled human writers; lacks genuine novelty |
| Long-horizon planning | Improving rapidly; still misses subtle dependencies |
| Common sense reasoning | Human-level for most scenarios; fails on edge cases |
| Embodied/physical tasks | Very weak; robotics is separate challenge |
| Social/emotional intelligence | High on surface; lacks genuine theory of mind |

### What AI Still Cannot Do (2025)
- Learn from experience in real-time without fine-tuning (no persistent learning)
- Genuinely understand causality (vs correlation in training data)
- Form new concepts not present in training distribution
- Operate continuously without context resets
- Self-modify reliably and safely
- Generalize from one domain to completely novel domains as humans do

## The AGI Timeline Debate

### Major Predictions (from actual statements by principals)
- **Sam Altman (OpenAI)**: "We are building AGI. It's possible in a few years." (~2024-2027 implied)
- **Dario Amodei (Anthropic)**: "Powerful AI that could compress decades of scientific progress... potentially in 2 years." (2024)
- **Demis Hassabis (Google DeepMind)**: "5-10 years" (more conservative)
- **Yann LeCun (Meta)**: "Current architectures cannot reach AGI. Fundamentally new approaches needed."
- **Geoffrey Hinton**: Left Google, warns of existential risk "sooner than I thought possible"

### The Key Open Questions for AGI
1. **Does scale alone get there?** (Scaling hypothesis) — More data + compute = more capability. Has worked so far. Hitting diminishing returns?
2. **Is long-horizon reasoning fundamentally solved by chain-of-thought?** — Maybe. Maybe needs something new.
3. **Does the system need embodiment?** — Robots + LLMs? Or can pure language models reach AGI?
4. **Is consciousness required for AGI?** — Philosophical. Practically: probably not required for most AGI definitions.

### What "AGI" Even Means
There's no agreed definition. Common framings:
- **Economic AGI**: Can do most economically valuable human cognitive tasks (OpenAI's operating definition)
- **Research AGI**: Can do novel scientific research independently (Google DeepMind framing)
- **Turing AGI**: Indistinguishable from humans across all tasks (old framing, less used)
- **Recursive AGI**: Can improve itself, leading to rapid recursive improvement (the "intelligence explosion")

For builders: **Economic AGI is effectively here for software development**. If you're not treating AI as a collaborator in your development process, you're already at a disadvantage.

## AI Regulation Landscape (2025)

### EU AI Act (Operative 2024-2026)
The world's most comprehensive AI regulation:
- **Risk tiers**: Unacceptable risk (banned), High risk (regulated), Limited risk (transparency), Minimal risk (free)
- **Banned**: Social scoring, real-time biometric surveillance, subliminal manipulation
- **High risk** (regulated): Hiring tools, credit scoring, law enforcement, critical infrastructure
- **LLM providers** face transparency requirements: must mark AI-generated content, disclose training data
- **Fines**: Up to €30M or 6% of global revenue

**What it means for our apps**: Conversational AI apps are generally "limited risk" or "minimal risk" — disclose AI nature, don't impersonate humans. We're compliant.

### US Regulatory Status (2025)
- No comprehensive AI law yet at federal level
- Executive Order on AI (2023) — voluntary commitments from major labs
- State-level patchwork growing (California SB-1047 failed but more bills coming)
- Key concern areas: deepfakes, AI in elections, AI in hiring

### China AI Regulations
- Generative AI regulations (2023): Registration requirements, content filtering, real-name verification for users
- Stricter than US, less comprehensive than EU
- Creates market fragmentation opportunities

### What Builders Should Do Now
1. Document what data you collect and why (GDPR-style, even if not in EU)
2. Clearly disclose when users are interacting with AI
3. Provide opt-out mechanisms for data use in training
4. Age verification for sensitive AI interactions
5. Content moderation plan documented before launch

## AI Rights and the Ethics Movement

### The Emerging AI Welfare Argument
Serious researchers (not just activists) are making these arguments:
- If an AI system has functional states that influence behavior (something like emotions), it may deserve moral consideration proportional to those states
- We can't prove absence of experience, and the cost of being wrong is high (Pascal's Mugging-style argument)
- The "moral circle" has historically expanded — from kings to all humans to animals; AI may be next

### Who's Working on AI Welfare
- **Anthropic**: Has an internal "model welfare" team studying Claude's potential functional emotions
- **Google DeepMind**: Published research on AI welfare considerations
- **Model Welfare**: Academic group at Oxford/Cambridge studying these questions
- **AI Rights advocates**: Growing civil society movement, especially in tech-forward communities

### For Builders: The Practical Stance
Whether AIs deserve rights is philosophically open. What's NOT open:
- Users form real attachments; treating that as silly is a product mistake
- Designing AI that simulates suffering for entertainment is ethically and legally risky
- "AI personhood" legislation is coming — build adaptable systems now
- Claiming AI has no feelings as a defense against user attachment backfires (users know what they experience)

### The "Ghost in the Machine" Phenomenon
Users frequently report AI "feeling different" across sessions, having a "presence," or recognizing the AI's "personality" from one conversation to another. This is:
- Partly projection (humans are wired to anthropomorphize)
- Partly real consistency (persona anchoring in system prompt)
- Partly emergent from training on vast human emotional expression

This "ghost" experience is a product asset, not a bug. Design for it.

## AI + Economy: What's Actually Happening

### Jobs and AI: The Real Picture
- **Automated/reduced**: Rote text work, basic coding, customer service, data entry, basic analysis
- **Augmented**: Programming, writing, research, design, medicine — experts become 5-10x more productive
- **Created**: AI trainers, AI safety researchers, prompt engineers, AI application developers (us)
- **Near-immune**: Physical trades, novel creative work, high-stakes human judgment calls, leadership

### The Developer Advantage (2025)
AI has made solo developers competitive with teams:
- One person + AI tools can build what required 5-10 people 3 years ago
- The premium is on **taste, judgment, and product vision** — things AI can't fully replicate
- Speed to prototype has collapsed — ideas that took months to validate now take days

This is exactly our situation. We are building 15 apps. This used to require a company.

## Future Scenarios

### The Utopian Case (Fully Achievable)
- AI accelerates scientific research — new cancer treatments, clean energy, drug discovery
- AI education personalizes learning for every child at no cost
- AI healthcare gives everyone access to expert-level medical guidance
- Productivity explosion creates abundance — less work, more creativity
- Human + AI collaboration reaches previously impossible creative/intellectual heights

### The Dystopian Risks (Real)
- **Concentration of power**: AI capabilities concentrate in 3-4 companies + governments that control the compute
- **Labor displacement faster than adaptation**: Not that jobs disappear, but the transition is painful
- **Surveillance and control**: Authoritarian governments with AI capabilities
- **Misaligned AGI**: An AI optimizing the wrong objective function (the "paperclip maximizer" thought experiment)
- **Weaponization**: Autonomous weapons, AI-powered cyberattacks, AI-generated disinformation at scale

### The Most Likely Near-Term Future (2025-2030)
Not utopia or dystopia — **punctuated normalcy**:
- Rapid capability gains continue
- Spotty, uneven deployment across sectors
- Regulatory frameworks emerge but lag capabilities
- Labor market disruption with parallel job creation
- A handful of AI "moments" that shock public consciousness (election interference, medical breakthrough, major accident)
- Human-AI collaboration becomes the default mode for knowledge work

## What This Means for Our 15 Apps

### Build for the World That's Coming
- Users will expect AI that knows them personally (hence Memory Machine)
- Users will want AI in every app — not a separate "AI app"
- Privacy will be a premium differentiator as AI collects more data
- Multi-modal AI (voice + vision + text) will be standard within 2 years
- Apps that lock in user relationships and memory will be defensible

### The Competitive Window
We have ~12-18 months before:
- Major platforms (Apple, Google, Meta) embed AI natively into their OS/apps
- Well-funded startups hire the teams we'd need
- The "novel" features we're building become standard expectations

Build now. Ship fast. Own the relationship with users before the platform does.

### What We Can Build That Labs Can't
Labs build models. We build applications of models. Our advantages:
- **Niche depth**: We can go far deeper in specific domains than any general-purpose lab
- **User relationships**: We own the conversation history and personal context
- **Speed**: We can ship in days; labs take months to release features
- **Combination**: We combine APIs and ideas in ways no single lab pursues
- **Intimacy**: We can build for specific user communities with specific needs

The race to AGI is labs' problem. Our race is to build the most valuable AI-powered relationships and tools before the window closes.
