// @clerk/expo 3.x always autolinks ClerkGoogleSignIn -> GoogleSignIn -> AppCheckCore.
// AppCheckCore is a Swift pod whose deps (GoogleUtilities, RecaptchaInterop) do not
// define modules, so `pod install` fails with static libraries. Opt those two pods
// into modular headers. Remove once on @clerk/expo 4 (Google sign-in split out).
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

const MARKER = "# withGoogleModularHeaders";
const LINES = [
  MARKER,
  "  pod 'GoogleUtilities', :modular_headers => true",
  "  pod 'RecaptchaInterop', :modular_headers => true",
].join("\n");

module.exports = function withGoogleModularHeaders(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let src = fs.readFileSync(podfile, "utf8");
      if (!src.includes(MARKER)) {
        const anchor = /^(\s*use_expo_modules!.*)$/m;
        if (!anchor.test(src)) throw new Error("withGoogleModularHeaders: use_expo_modules! not found in Podfile");
        src = src.replace(anchor, `$1\n${LINES}`);
        fs.writeFileSync(podfile, src);
      }
      return cfg;
    },
  ]);
};
