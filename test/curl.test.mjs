import test from "node:test";
import assert from "node:assert/strict";
import { shellQuote, toCurl, maskHeaders } from "../lib/curl.mjs";

test("shellQuote 保留安全字符原样", () => {
  assert.equal(shellQuote("abc-123_x"), "abc-123_x");
  assert.equal(shellQuote("https://a.b/c?d=1&e=2"), "https://a.b/c?d=1&e=2");
});

test("shellQuote 转义单引号与空格", () => {
  assert.equal(shellQuote("a b"), "'a b'");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
  assert.equal(shellQuote(""), "''");
});

test("toCurl 跳过 host 与 content-length", () => {
  const c = toCurl({
    method: "GET",
    url: "https://x/y",
    headers: { host: "x", "content-length": "0", "x-sdk-date": "20261021T000000Z" },
  });
  assert.ok(c.includes("x-sdk-date"));
  assert.ok(!/^\s+-H 'host:/m.test(c));
  assert.ok(!/content-length/i.test(c));
});

test("toCurl 带 body 时用 --data-raw 且不丢引号", () => {
  const body = JSON.stringify({ a: 1, b: "x'y" });
  const c = toCurl({ method: "POST", url: "https://x/y", headers: {}, body });
  assert.ok(c.includes("--data-raw"));
  assert.ok(c.includes("\\'"));
});

test("maskHeaders 只打码 token 类头", () => {
  const m = maskHeaders({ Authorization: "SDK-HMAC-SHA256 Access=ak, Signature=" + "f".repeat(64), "x-sdk-date": "2026" });
  assert.ok(m.Authorization.includes("…"));
  assert.equal(m["x-sdk-date"], "2026");
});
