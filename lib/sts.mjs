/**
 * 华为云 STS AssumeAgency（自委托换临时凭证）
 *
 * 两个必踩的坑，本封装已固化：
 *   1. `policy` 必须是 JSON **字符串**，传对象会得到
 *      "Json deserialize error: invalid type: map, expected a string"
 *   2. 返回字段是下划线风格（access_key_id / secret_access_key /
 *      security_token / expiration），按驼峰取会全变 undefined，
 *      后续调用只会回一句含糊的「调用方身份校验失败」
 */
import { sign } from "./sign.mjs";

export const STS_HOST = "sts.cn-north-4.myhuaweicloud.com";
export const STS_URL = `https://${STS_HOST}/v5/agencies/assume`;

/** 组装最小权限 policy 字符串 */
export function buildPolicy(actions = ["sts::GetCallerIdentity"]) {
  return JSON.stringify({
    Version: "5.0",
    Statement: [{ Effect: "Allow", Action: actions, Resource: ["*"] }],
  });
}

/**
 * @param {object} o
 * @param {string} o.agencyUrn          委托 URN
 * @param {string} [o.sessionName]      会话名
 * @param {number} [o.durationSeconds]  有效期秒数
 * @param {string[]} [o.actions]        授权动作
 * @param {string} o.ak
 * @param {string} o.sk
 * @returns {Promise<{ok:boolean,status:number,credentials?:object,error?:string}>}
 */
export async function assumeAgency({ agencyUrn, sessionName, durationSeconds = 900, actions, ak, sk, fetchImpl = fetch }) {
  const body = JSON.stringify({
    agency_urn: agencyUrn,
    agency_session_name: sessionName || "hs" + Date.now().toString().slice(-10),
    duration_seconds: durationSeconds,
    policy: buildPolicy(actions),
  });

  // STS 只接受 application/json，且该头必须参与签名，否则回 "Content type error"
  const signed = sign({ method: "POST", url: STS_URL, body, ak, sk, headers: { "content-type": "application/json" } });
  const res = await fetchImpl(STS_URL, { method: "POST", headers: signed.headers, body });
  const text = await res.text();

  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }

  if (!res.ok || !json?.credentials?.security_token) {
    return {
      ok: false,
      status: res.status,
      error: json?.error_msg || json?.message || text.slice(0, 300),
    };
  }

  const c = json.credentials;
  return {
    ok: true,
    status: res.status,
    credentials: {
      access_key_id: c.access_key_id,
      secret_access_key: c.secret_access_key,
      security_token: c.security_token,
      expiration: c.expiration,
    },
  };
}
