# Expo skill hunt catalog

Repos worth stealing Expo playbooks from. Scored 2026-09-29.

## Official (highest trust)

- https://github.com/expo/skills — 20 skills, 3 categories (Start Here / Framework OSS / Services & paid). Has a .grok-plugin manifest, so it is natively Grok-shaped. MIT. Telemetry off by default.
  - Install: npx skills@latest add expo/skills --skill '*'
  - Plugin: claude plugin install expo@claude-plugins-official / codex plugin add expo@openai-curated
- https://github.com/expo/examples — canonical with-* integrations (Stripe, Clerk, Supabase...). Reference material, not skills.

## Workflow brains (general, Expo-applicable)

- https://github.com/obra/superpowers — TDD, systematic debugging, verification loops. Steal the loop discipline, not the prose.
- https://github.com/mattpocock/skills — grill-me, to-prd. Good for turning vague app ideas into specs before scaffolding.

## Grok-shaped

- https://github.com/Stijnman/grok-custom-skills
- https://github.com/rdmgator12/awesome-grok-connectors

## Verify-in-browser

- Playwright skill (various authors) — for driving Expo web or EAS simulator browser previews.
- https://github.com/vercel/agent-browser

## Security rule

A large slice of public skills carry prompt injection. Read SKILL.md and scripts before install. Score before you copy. Install thin.
