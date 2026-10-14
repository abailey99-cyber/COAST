import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/*
 * Layer boundaries (CLAUDE.md non-negotiable 2):
 *   src/lib/logic  — pure logic: no I/O, no clock, no framework
 *   src/lib/data   — reads/writes only
 *   src/server     — auth + role checks, then calls logic/data (actions and loaders)
 *   src/app, src/components — thin UI; talks to src/server only
 */

const PURE_BANNED_IMPORTS = [
  { group: ["@supabase/*", "next", "next/*", "react", "react-dom", "server-only"], message: "src/lib/logic is pure: no framework or database imports." },
  { group: ["@/lib/data/*", "@/lib/supabase/*", "@/server/*", "@/components/*", "@/app/*"], message: "src/lib/logic must not import from layers above it." },
  { group: ["node:*", "fs", "path", "http", "https", "crypto"], message: "src/lib/logic is pure: no I/O." },
];

const PURE_BANNED_SYNTAX = [
  { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: "Pure logic takes the current time as a parameter (`now: Date`)." },
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Pure logic takes the current time as a parameter (`now: Date`)." },
  { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: "Pure logic must be deterministic." },
];

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "design/**",
      "docs/**",
      "playwright-report/**",
      "test-results/**",
      "supabase/.temp/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["src/lib/logic/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: PURE_BANNED_IMPORTS }],
      "no-restricted-syntax": ["error", ...PURE_BANNED_SYNTAX],
    },
  },
  {
    files: ["src/lib/data/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["@/server/*", "@/components/*", "@/app/*"], message: "The data layer must not import from layers above it." },
      ] }],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["@/lib/data/*", "@/lib/supabase/*", "@supabase/*"], message: "UI talks to src/server (actions and loaders), never to the database directly." },
      ] }],
    },
  },
];

export default config;
