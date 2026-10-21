import test from "node:test";
import assert from "node:assert/strict";
import { sign, sdkDate, canonicalUri, canonicalQuery, sha256Hex } from "../lib/sign.mjs";

const AK = "AKEXAMPLE", SK = "SKEXAMPLE";

test("x-sdk-date 必须是 YYYYMMDDTHHMMSSZ", () => {
  assert.equal(sdkDate(new Date("2026-10-21T03:50:53.123Z")), "20261021T035053Z");
  assert.match(sdkDate(), /^\d{8}T\d{6}Z$/);
});

test("CanonicalURI 必须以 / 结尾", () => {
  assert.equal(canonicalUri("/v3/auth/projects"), "/v3/auth/projects/");
  assert.equal(canonicalUri("/v3/auth/projects/"), "/v3/auth/projects/");
  assert.equal(canonicalUri(""), "/");
  assert.equal(canonicalUri("v1/x"), "/v1/x/");
});

test("CanonicalQuery 按 key 字典序且做 RFC3986 编码", () => {
  assert.equal(canonicalQuery("?b=2&a=1"), "a=1&b=2");
  assert.equal(canonicalQuery("?name=中文&x=a b"), "name=%E4%B8%AD%E6%96%87&x=a%20b");
  assert.equal(canonicalQuery(""), "");
  assert.equal(canonicalQuery("?flag"), "flag=");
});

test("签名头包含三类关键字段", () => {
  const r = sign({ method: "GET", url: "https://iam.cn-north-4.myhuaweicloud.com/v3/auth/projects", ak: AK, sk: SK });
  assert.equal(r.headers.host, "iam.cn-north-4.myhuaweicloud.com");
  assert.match(r.headers["x-sdk-date"], /^\d{8}T\d{6}Z$/);
  assert.match(r.headers.Authorization, /^SDK-HMAC-SHA256 Access=AKEXAMPLE, SignedHeaders=host;x-sdk-date, Signature=[0-9a-f]{64}$/);
  assert.equal(r.headers["x-security-token"], undefined);
});

test("临时凭证会签入 x-security-token", () => {
  const r = sign({ method: "GET", url: "https://sts.cn-north-4.myhuaweicloud.com/v5/caller-identity", ak: AK, sk: SK, token: "tok123" });
  assert.equal(r.headers["x-security-token"], "tok123");
  assert.match(r.headers.Authorization, /SignedHeaders=host;x-sdk-date;x-security-token/);
});

test("CanonicalRequest 六段结构固定", () => {
  const r = sign({
    method: "post",
    url: "https://sts.cn-north-4.myhuaweicloud.com/v5/agencies/assume?b=2&a=1",
    body: '{"x":1}',
    ak: AK, sk: SK, date: new Date("2026-10-21T03:50:53Z"),
  });
  const lines = r.canonicalRequest.split("\n");
  assert.equal(lines[0], "POST");
  assert.equal(lines[1], "/v5/agencies/assume/");
  assert.equal(lines[2], "a=1&b=2");
  assert.equal(lines[3], "host:sts.cn-north-4.myhuaweicloud.com");
  assert.equal(lines[4], "x-sdk-date:20261021T035053Z");
  assert.equal(lines[5], "");
  assert.equal(lines[6], "host;x-sdk-date");
  assert.equal(lines[7], sha256Hex('{"x":1}'));
  assert.equal(lines.length, 8);
});

test("签名对 AK/SK/方法/路径 变化敏感（防回退）", () => {
  const base = { method: "GET", url: "https://a.example.com/x", ak: AK, sk: SK, date: new Date("2026-01-01T00:00:00Z") };
  const s1 = sign(base).signature;
  assert.notEqual(s1, sign({ ...base, sk: "OTHER" }).signature);
  assert.notEqual(s1, sign({ ...base, method: "POST" }).signature);
  assert.notEqual(s1, sign({ ...base, url: "https://a.example.com/y" }).signature);
  assert.equal(s1, sign(base).signature, "相同输入必须稳定");
});

test("缺少凭证直接报错", () => {
  assert.throws(() => sign({ method: "GET", url: "https://a.example.com/x", ak: "", sk: SK }), /缺少 ak/);
});
