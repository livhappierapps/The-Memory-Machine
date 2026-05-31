---
name: AI Master Degree Skill
description: Location and structure of the ai-master-degree skill for PhD-level AI knowledge across the team.
---

# AI Master Degree Skill

**Location**: `.agents/skills/ai-master-degree/`

## Reference Files

| File | Domain |
|---|---|
| `references/grok-api-mastery.md` | xAI/Grok API — models, tricks, SSE, embeddings, limitations, cost tiers |
| `references/ai-dev-patterns.md` | SSE streaming, memory/RAG, field encryption, MCP, context budgeting, summarization, multi-provider |
| `references/ai-psychology-philosophy.md` | Human-AI attachment, persona design, sentience debate, AI rights, emotional intelligence |
| `references/ai-security-jailbreaking.md` | Red teaming, jailbreak categories, prompt injection defense, hardening our stack |
| `references/agi-future.md` | AGI progress, reasoning models, regulation landscape, future scenarios, competitive window |
| `references/cost-optimization.md` | Model tiering, summarization math, semantic cache, batch embeddings, free tiers |
| `references/ai-multimodal-voice-vision.md` | TTS/STT providers, streaming voice, camera/vision, musical analysis, multimodal future |

## When to Load
Load SKILL.md first for orientation, then the specific reference file(s) for the domain being worked on.
Combines well with codebase-specific files: lib/grok.ts, lib/memory.ts, lib/field-crypto.ts, routes/mcp.ts.

**Why it exists**: The team builds 15 AI apps competing with full labs. Every agent needs PhD-level AI knowledge instantly accessible without re-researching each session.
