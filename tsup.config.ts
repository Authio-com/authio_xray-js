import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    target: "es2022",
    outDir: "dist",
    treeshake: true,
  },
  {
    entry: { xray: "src/browser.ts" },
    format: ["iife"],
    globalName: "AuthioXRay",
    dts: false,
    sourcemap: true,
    clean: false,
    minify: true,
    target: "es2020",
    outDir: "dist",
    outExtension: () => ({ js: ".global.js" }),
  },
]);
