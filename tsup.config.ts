import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: [
      "src/index.ts",
      "src/react.tsx",
      "src/vue.ts",
      "src/nextjs.ts",
      "src/svelte.ts",
    ],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    target: "es2022",
    outDir: "dist",
    treeshake: true,
    external: ["react", "vue", "svelte", "svelte/store", "next", "next/server"],
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
