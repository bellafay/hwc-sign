import test from "node:test";
import assert from "node:assert/strict";
import { assumeAgency, buildPolicy, STS_URL } from "../lib/sts.mjs";

const AK = "AKX", SK = "SKX";
const URN = "iam::1234567890:agency:SELF_VERIFY";

function fakeFetch(status, payload, spy) {
  return async (url, init) => {
    if (spy) spy(url, init);
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
  };
}

test("policy 必须是 JSON 字符串而不是对象", () => {
  const p = buildPolicy(["sts::GetCallerIdentity"]);
  assert.equal(typeof p, "string");
  const parsed = JSON.parse(p);
  assert.equal(parsed.Version, "5.0");
  assert.deepEqual(parsed.Statement[0].Action, ["sts::GetCallerIdentity"]);
});

test("请求体字段为下划线风格，duration 默认 900", async () => {
  let seen = null;
  await assumeAgency({
    agencyUrn: URN, ak: AK, sk: SK,
    fetchImpl: fakeFetch(200, { credentials: { access_key_id: "a", secret_access_key: "b", security_token: "c", expiration: "2026-01-01T00:00:00Z" } },
      (url, init) => { seen = { url, init }; }),
  });
  assert.equal(seen.url, STS_URL);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.agency_urn, URN);
  assert.equal(body.duration_seconds, 900);
  assert.equal(typeof body.policy, "string");
  assert.match(body.agency_session_name, /^hs\d{10}$/);
  assert.match(seen.init.headers.Authorization, /^SDK-HMAC-SHA256 Access=AKX,/);
  assert.equal(seen.init.headers["content-type"], "application/json");
  assert.match(seen.init.headers.Authorization, /SignedHeaders=content-type;host;x-sdk-date/, "content-type 必须参与签名");
});

test("成功时把下划线字段规范成 credentials", async () => {
  const r = await assumeAgency({
    agencyUrn: URN, ak: AK, sk: SK, sessionName: "s1", durationSeconds: 1800,
    fetchImpl: fakeFetch(200, { credentials: { access_key_id: "AK1", secret_access_key: "SK1", security_token: "TOK1", expiration: "2026-01-01T00:00:00Z" } }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.credentials, {
    access_key_id: "AK1", secret_access_key: "SK1", security_token: "TOK1", expiration: "2026-01-01T00:00:00Z",
  });
});

test("缺 security_token 视为失败（防止后续含糊的身份校验错误）", async () => {
  const r = await assumeAgency({
    agencyUrn: URN, ak: AK, sk: SK,
    fetchImpl: fakeFetch(200, { credentials: { access_key_id: "AK1", secret_access_key: "SK1" } }),
  });
  assert.equal(r.ok, false);
});

test("委托不存在时透出服务端 error_msg", async () => {
  const r = await assumeAgency({
    agencyUrn: URN, ak: AK, sk: SK,
    fetchImpl: fakeFetch(400, { error_code: "STS.1106", error_msg: "the agency cannot be found" }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /cannot be found/);
});
