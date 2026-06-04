import { defineConfig, devices } from "@playwright/test";

const NIX_LIB_PATHS = [
  "/nix/store/y3nxdc2x8hwivppzgx5hkrhacsh87l21-glib-2.84.3/lib",
  "/nix/store/wilz94hzz4q3fss6qvv625zvww4a6s4s-mesa-libgbm-25.0.1/lib",
  "/nix/store/7227amwg7k4sbl6mhglq17v5x5ki54ks-libglvnd-1.7.0/lib",
  "/nix/store/cpwib3zazj49fm0y04y53w4xkbqsgrgm-mesa-25.0.7/lib",
  "/nix/store/sisfq9wihyqqjzmrpik9b4xksifw97ha-libxkbcommon-1.8.1/lib",
  "/nix/store/qrij2csr7p6jsfa40d7h4ckzqg4wd5w2-at-spi2-core-2.56.2/lib",
  "/nix/store/gpb87pb8s826aggy1s3f352alp40dkj8-nspr-4.36/lib",
  "/nix/store/2jsrwgic869zynqljiqa4g7dqzpwm2yd-nss-3.101.2/lib",
  "/nix/store/xm2418a7fclainspb35n6h05xfsxb6vn-cups-2.4.11-lib/lib",
  "/nix/store/l0d83xf43lsyhzqziy0am1cidhkcxs9q-expat-2.7.1/lib",
  "/nix/store/231d6mmkylzr80pf30dbywa9x9aryjgy-dbus-1.14.10-lib/lib",
  "/nix/store/xpszkfp1gaf8jfmcsll93xg0pb4c0rk7-libdrm-2.4.124/lib",
  "/nix/store/2y2hhlki6macaj9j1409q1j6i33l6igf-libxcb-1.17.0/lib",
  "/nix/store/1nsvsrqp5zm96r9p3rrq3yhlyw8jiy91-libX11-1.8.12/lib",
  "/nix/store/94grp8dx897wmf0x3azpdbgzj3krz7v5-libXfixes-6.0.1/lib",
  "/nix/store/4phl6z95v2i4525y0zpmi9v6ac0n4bx7-libXcomposite-0.4.6/lib",
  "/nix/store/h8143a07cf1vw41s49h0zahnq13zim94-libXdamage-1.1.6/lib",
  "/nix/store/f8kjcizw0kmpyrn1abm1nfsbc007418g-libXau-1.0.12/lib",
  "/nix/store/0046rn5sgi6l38zl81bg2r02zlzxqqbc-libXext-1.3.6/lib",
  "/nix/store/v53v67k3s16wmak41qy0q54pd7dkbcvr-libXrender-0.9.12/lib",
  "/nix/store/5fcbi2lycw2hz7rbn3nl5nrhhk2ki8dd-libXrandr-1.5.4/lib",
  "/nix/store/yw5xqn8lqinrifm9ij80nrmf0i6fdcbx-alsa-lib-1.2.13/lib",
  "/nix/store/jl19fdc7gdxqz9a1s368r9d15vpirnqy-zlib-1.3.1/lib",
  "/nix/store/rnn29mhynsa4ncmk0fkcrdr29n0j20l4-libffi-3.4.8/lib",
  "/nix/store/flpfkdzbac7071xlydh8f4qqq6dvnzx9-gettext-0.22.5/lib",
].join(":");

const existing = process.env.LD_LIBRARY_PATH ?? "";
process.env.LD_LIBRARY_PATH = existing
  ? `${NIX_LIB_PATHS}:${existing}`
  : NIX_LIB_PATHS;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:80",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
