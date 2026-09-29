# Connector map for Expo work

## Live in this session

- GitHub (Access and interact: search repos/code, explore trees, manage branches/releases/issues/PRs, view notifications, star, push files)
- Google Drive (search, read, create folders, trash)
- Voice
- Automations (schedule a prompt for Grok to run later, once or repeating)

## Expo-specific surfaces (not yet connected — auth card, not a vibe)

- Expo MCP server: https://mcp.expo.dev/mcp (declared in expo/skills plugins/expo/mcp.json). Point a connector at it for EAS build/update/observe actions.
- EAS CLI: npx eas-cli@latest (eas whoami / eas login / eas build / eas update / eas submit). Runs wherever the agent has shell.
- Expo CLI: npx expo (expo install, expo-doctor, expo prebuild, expo export).

## Re-discover before promising

The connected-app list in any session prompt is a snapshot. Before claiming Gmail, calendar, or a new MCP server is available, call search_connected_tools.
