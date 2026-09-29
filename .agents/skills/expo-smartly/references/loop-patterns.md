# Expo loop patterns

## Heartbeat (daily)

Prompt: "Run expo-smartly heartbeat: check livhappierapps/The-Memory-Machine for open PRs and failing checks, skim expo/skills releases for SDK bumps, report anything needing a human."
Done-definition: a short digest with links, or "nothing to do."
Fail-closed: if GitHub API errors, say so — do not fabricate repo state.

## Hook (on PR)

Trigger: PR opened/updated on The-Memory-Machine.
Prompt: "expo-smartly hook: new PR on The-Memory-Machine. Read the diff, run typecheck guidance from expo-upgrade if SDK-touched, comment findings."
Approval gate: no merge, no publish, no delete without explicit user OK.

## Cron (weekly)

Prompt: "expo-smartly weekly: hunt public SKILL.md repos for new Expo playbooks, score against references/hunt-catalog.md, propose thin installs."
Idempotency: never install twice; check local skills dir first.

## Goal loop

Prompt: "expo-smartly goal: <one sentence>. Work until done or blocked. Report progress each cycle."
Stop condition: done-definition met, or three consecutive blocked cycles.
