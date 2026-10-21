import test from "node:test";
import assert from "node:assert/strict";
import command, { parseArgs, probe, formatText, formatJson } from "../lib/cmd/probe.mjs";

function mockResponse({ status = 401, statusText = "Unauthorized", headers = {} } = {}) {
  return {
    status,
    statusText,
    headers: { get: (key) => (key in headers ? headers[key] : null) },
    body: { cancel: async () => {} },
  };
}

test("parseArgs 默认 GET 并保留完整 URL", () => {
  const opts = parseArgs(["-u", "https://iam.cn-north-4.myhuaweicloud.com/v3/auth/projects"]);
  assert.equal(opts.url, "https://iam.cn-north-4.myhuaweicloud.com/v3/auth/projects");
  assert.equal(opts.method, "GET");
  assert.equal(opts.timeout, 30000);
  assert.equal(opts.json, false);
});

test("parseArgs 支持 --key=value、HEAD 与超时", () => {
  const opts = parseArgs([
    "--url=https://example.com/health",
    "--method=head",
    "--timeout=1500",
    "--json",
  ]);
  assert.equal(opts.url, "https://example.com/health");
  assert.equal(opts.method, "HEAD");
  assert.equal(opts.timeout, 1500);
  assert.equal(opts.json, true);
});

test("parseArgs 缺少 URL 时抛错", () => {
  assert.throws(() => parseArgs([]), /缺少必填参数/);
  assert.throws(() => parseArgs(["-m", "GET"]), /缺少必填参数/);
});

test("parseArgs 拒绝非法 URL、方法、超时和未知参数", () => {
  assert.throws(() => parseArgs(["-u", "not a url"]), /URL 格式非法/);
  assert.throws(() => parseArgs(["-u", "ftp://example.com/x"]), /只支持 http\/https/);
  assert.throws(() => parseArgs(["-u", "https://example.com", "-m", "POST"]), /不支持的方法/);
  assert.throws(() => parseArgs(["-u", "https://example.com", "--timeout", "abc"]), /--timeout/);
  assert.throws(() => parseArgs(["-u", "https://example.com", "--bogus"]), /未知参数/);
});

test("run 在参数缺失或非法时返回退出码 2", async () => {
  const original = console.error;
  const messages = [];
  console.error = (message) => messages.push(message);
  try {
    assert.equal(await command.run([]), 2);
    assert.equal(await command.run(["-u", "not a url"]), 2);
  } finally {
    console.error = original;
  }
  assert.equal(messages.length, 2);
});

test("probe 返回状态码、耗时和三个关键响应头", async () => {
  const calls = [];
  let clock = 100;
  const report = await probe({
    url: "https://example.com/",
    method: "GET",
    timeout: 1000,
    fetchImpl: async (url, init) => {
      calls.push([url, init.method, init.redirect]);
      return mockResponse({
        status: 401,
        headers: {
          "x-request-id": "req-123",
          "content-type": "application/json",
          "retry-after": "3",
          "x-ignored": "nope",
        },
      });
    },
    now: () => (clock += 7),
  });
  assert.deepEqual(calls, [["https://example.com/", "GET", "manual"]]);
  assert.equal(report.status, 401);
  assert.equal(report.statusText, "Unauthorized");
  assert.equal(report.elapsedMs, 7);
  assert.deepEqual(report.headers, {
    "x-request-id": "req-123",
    "content-type": "application/json",
    "retry-after": "3",
  });
});

test("probe 把 AbortError 转成可读的超时错误", async () => {
  await assert.rejects(
    probe({
      url: "https://example.com/",
      timeout: 5,
      fetchImpl: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
      now: () => 0,
    }),
    /请求超时（5 ms）/,
  );
});

test("probe 原样抛出网络错误，便于区分签名问题", async () => {
  await assert.rejects(
    probe({
      url: "https://example.com/",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
      now: () => 0,
    }),
    /ECONNREFUSED/,
  );
});

test("formatText 固定列出关键响应头，缺失显示 -", () => {
  const text = formatText({
    url: "https://example.com/",
    method: "HEAD",
    status: 403,
    statusText: "Forbidden",
    elapsedMs: 42,
    headers: { "x-request-id": "req-1" },
  });
  assert.match(text, /^HEAD https:\/\/example\.com\/ -> 403 Forbidden {2}42 ms/);
  assert.match(text, /content-type: -/);
  assert.match(text, /retry-after: -/);
});

test("formatJson 输出可被重新解析的 JSON", () => {
  const report = {
    url: "https://example.com/",
    method: "GET",
    status: 200,
    statusText: "OK",
    elapsedMs: 1,
    headers: {},
  };
  assert.deepEqual(JSON.parse(formatJson(report)), report);
});

export default { name: "probe", file: "test/probe.test.mjs" };
