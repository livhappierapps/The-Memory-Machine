import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { chromium } from "playwright";

const OUT_DIR = path.resolve(import.meta.dirname, "../../.local/screenshots");

const SANDBOX_PORT = process.env.MOCKUP_SANDBOX_PORT ?? "8081";
const SANDBOX_BASE_PATH = process.env.MOCKUP_SANDBOX_BASE_PATH ?? "/__mockup";
const SANDBOX_BASE = `http://localhost:${SANDBOX_PORT}${SANDBOX_BASE_PATH}`;

interface Shot {
  file: string;
  component: string;
  width: number;
  height: number;
}

const PHONE_SCREENS = [
  { suffix: "01-home", component: "screenshots/Hero" },
  { suffix: "02-threads", component: "screenshots/ThreadList" },
  { suffix: "03-chat", component: "screenshots/ActiveChat" },
  { suffix: "04-settings", component: "screenshots/Settings" },
  { suffix: "05-security", component: "screenshots/Security" },
];

const SHOTS: Shot[] = [
  ...PHONE_SCREENS.map(({ suffix, component }) => ({
    file: `ios-67-${suffix}.png`,
    component,
    width: 1290,
    height: 2796,
  })),
  ...PHONE_SCREENS.map(({ suffix, component }) => ({
    file: `ios-55-${suffix}.png`,
    component,
    width: 1242,
    height: 2208,
  })),
  ...PHONE_SCREENS.map(({ suffix, component }, i) => ({
    file: `android-phone-${String(i + 1).padStart(2, "0")}.png`,
    component,
    width: 1080,
    height: 1920,
  })),
  {
    file: "android-feature-graphic.png",
    component: "screenshots/FeatureGraphic",
    width: 1024,
    height: 500,
  },
];

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const shot of SHOTS) {
      const page = await browser.newPage({
        viewport: { width: shot.width, height: shot.height },
        deviceScaleFactor: 1,
      });

      const url = `${SANDBOX_BASE}/preview/${shot.component}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForTimeout(150);

      const outPath = path.join(OUT_DIR, shot.file);
      await page.screenshot({ path: outPath });
      await page.close();

      console.log(`Saved ${shot.file} (${shot.width}x${shot.height})`);
    }
  } finally {
    await browser.close();
  }

  writeFileSync(path.join(OUT_DIR, ".gitkeep"), "");
  console.log(`\nDone. ${SHOTS.length} screenshots written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
