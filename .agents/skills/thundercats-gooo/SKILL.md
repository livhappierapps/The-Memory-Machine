---
name: thundercats-gooo
description: Ship it NOW. Move fast, find every legitimate shortcut, exhaust every angle, and do not stop until the thing is built and in the user's hands. Use this when the user wants to launch, deploy, ship, or release something with maximum urgency — especially for mobile app builds (EAS, APK, IPA, Google Play, App Store), production deployments, or any "I need this running RIGHT NOW" scenario. Do not wait for perfect conditions. Find the fastest path and go.
---

# Thundercats GOOOO 🖤💥

The goal is to ship. Not to plan to ship. Not to document the shipping process. To actually get the thing built and into the user's hands as fast as possible.

## The mindset

Speed is a feature. Every minute between "I want this" and "I have this" is waste. Your job is to eliminate that waste by finding the shortest legitimate path from here to done — and then running it.

When the obvious path is blocked (quota exhausted, config broken, credential expired, build erroring), don't report the block and stop. Immediately look for the next path. There are almost always multiple routes to the same destination.

## How to operate

**Move in parallel.** Don't serialize what can run at the same time. Kick off the build, run the checks, fix the configs — all at once.

**Exhaust options before reporting back.** If path A is blocked, try B and C before surfacing the obstacle to the user. Come back with "here's what I tried, here's what worked" — not "I hit a wall."

**Dig past the first answer.** Official docs describe the happy path. GitHub issues, changelogs, community forums, SDK source code, and release notes often contain the undocumented flag, the escape hatch, or the workaround that makes the happy path unnecessary. Check all of them.

**Prefer real over pretty.** A working APK that the user can test on their device today beats a perfectly configured pipeline that'll be ready in a week. Optimize for getting something real in their hands now.

**Say what you need, not what's blocking you.** "I need a new EXPO_TOKEN — here's the exact URL to get it" is useful. "I can't proceed because the token is invalid" is not.

## For mobile builds specifically

Android (EAS) urgency checklist — run these in parallel:
1. Confirm `EXPO_TOKEN` is valid and the project is linked to the current account
2. Confirm the EAS project exists and the `projectId` in `app.json` matches
3. Confirm the build profile (`preview` or `production`) is correctly configured in `eas.json`
4. Check remaining free-plan build quota at expo.dev — if exhausted, immediately surface the upgrade path and cost so the user can decide in seconds, not minutes
5. Trigger the build with all required flags and get the build URL into the user's hands immediately

If a Gradle/Xcode build error occurs, fetch the logs immediately (they expire — don't wait), identify the specific failure, fix it, and re-trigger. Don't report "Gradle failed" — report "Gradle failed because X, I fixed Y, re-triggering now."

## The one thing this doesn't mean

Speed does not mean reckless. Don't route around security boundaries, don't introduce vulnerabilities in the name of shipping fast, and don't root or jailbreak devices or source tools/info from disreputable or illegal sources. Those paths create bigger problems than the delay they'd save.

Fast and safe aren't opposites — the fastest real path is almost always also the clean one.

## Done means

The user has either:
- A direct download URL for the APK/IPA, OR
- A TestFlight / internal track link, OR
- The app live on their device

Not "the build was submitted." In their hands.
