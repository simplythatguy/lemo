import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const files = (ext: string) =>
  readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(ext) && !f.startsWith(join("studio", "stage")))
    .map((f) => ({ name: f, text: readFileSync(join(SRC, f), "utf8") }));
const screenCss = files(".css").filter((f) => f.name !== "base.css");
const base = readFileSync(join(SRC, "base.css"), "utf8");

const RAW: [string, RegExp][] = [
  ["a raw colour", /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch)\(/i],
  ["a raw type size", /^\s*font(-size)?\s*:[^;]*(?<![/\d.])\d+(\.\d+)?px/],
  ["a raw weight", /^\s*font(-weight)?\s*:\s*\d{3}\b/],
  ["a raw radius", /^\s*border-radius\s*:[^;]*\b[1-9][\d.]*px/],
  ["a raw space", /^\s*(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?\s*:[^;]*\b[1-9][\d.]*px/],
  ["a raw duration", /^\s*(transition|animation)(-duration)?\s*:[^;]*\b\d[\d.]*m?s\b/],
  ["a shadow outside popovers", /^\s*box-shadow\s*:[^;]*\b0 [1-9]\d*px [1-9]/],
];

test("screen CSS takes every colour, type size, weight, radius, space, shadow and duration from base.css", () => {
  const found: string[] = [];
  for (const { name, text } of screenCss)
    text.split("\n").forEach((line, i) => {
      for (const [what, re] of RAW) if (re.test(line)) found.push(`${name}:${i + 1} ${what}: ${line.trim()}`);
    });
  assert.deepEqual(found, []);
});

test("every token a stylesheet uses is defined", () => {
  // A component may set its own per-element values inline (style={{ "--cx": ... }}); those count as defined too.
  const inline = files(".tsx").flatMap(({ text }) => [...text.matchAll(/"(--[\w-]+)":/g)].map((m) => m[1]));
  const defined = new Set([...base.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).concat(inline));
  const missing = files(".css").flatMap(({ name, text }) => [...text.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]).filter((v) => !defined.has(v)).map((v) => `${name} ${v}`));
  assert.deepEqual(missing, []);
});

test("every icon-only control has an accessible name and a tooltip, and no native title", () => {
  const bad: string[] = [];
  for (const { name, text } of files(".tsx"))
    for (const [tag] of text.matchAll(/<[a-z]+\b(?:=>|[^>])*>/g)) {
      const iconOnly = /\bclassName=(?:=>|[^>])*?\bicon-btn\b/.test(tag) || /\bdata-tip=/.test(tag);
      if (iconOnly && (!/\baria-label=/.test(tag) || !/\bdata-tip=/.test(tag) || /\btitle=/.test(tag))) bad.push(`${name}: ${tag.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  assert.deepEqual(bad, []);
});
