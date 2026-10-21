/**
 * 华为云 API 签名（SDK-HMAC-SHA256）
 *
 * 华为云与 AWS SigV4 有三处易踩的差异，本实现直接固化：
 *   1. x-sdk-date 必须是 YYYYMMDDTHHMMSSZ（不能带 - 和 :），否则报
 *      "the time format is incorrect"
 *   2. CanonicalURI 必须以 "/" 结尾，否则报
 *      "verify ak sk signature failed"
 *   3. STS 临时凭证必须额外携带 x-security-token 头
 */
import crypto from "node:crypto";

export const sha256Hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/** YYYYMMDDTHHMMSSZ */
export function sdkDate(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** 规范化 URI：必须以 "/" 结尾 */
export function canonicalUri(pathname) {
  let p = pathname || "/";
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.endsWith("/")) p += "/";
  return p;
}

/** RFC3986 编码（华为云对 query 的编码比 encodeURIComponent 更严格） */
export function rfc3986(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** 规范化 query：键值分别编码后按 key 字典序排序 */
export function canonicalQuery(search) {
  const q = (search || "").replace(/^\?/, "");
  if (!q) return "";
  return q
    .split("&")
    .filter(Boolean)
    .map((kv) => {
      const i = kv.indexOf("=");
      const k = i < 0 ? kv : kv.slice(0, i);
      const v = i < 0 ? "" : kv.slice(i + 1);
      return [rfc3986(decodeURIComponent(k)), rfc3986(decodeURIComponent(v))];
    })
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/**
 * 生成签名头。
 * @param {object} o
 * @param {string} o.method   HTTP 方法
 * @param {string} o.url      完整 URL
 * @param {string} [o.body]   请求体字符串（GET 传空串）
 * @param {string} o.ak
 * @param {string} o.sk
 * @param {string} [o.token]  STS security token
 * @param {Object<string,string>} [o.headers] 额外参与签名的头（如 content-type）
 * @param {Date}   [o.date]   指定时间（测试用）
 */
export function sign({ method, url, body = "", ak, sk, token, headers = {}, date }) {
  if (!ak || !sk) throw new Error("缺少 ak / sk");
  const u = new URL(url);
  const xDate = sdkDate(date);

  const signHeaders = { host: u.host, "x-sdk-date": xDate, ...lowerKeys(headers) };
  if (token) signHeaders["x-security-token"] = token;

  const names = Object.keys(signHeaders).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(signHeaders[n]).trim()}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(u.pathname),
    canonicalQuery(u.search),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join("\n");

  const stringToSign = ["SDK-HMAC-SHA256", xDate, sha256Hex(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", sk).update(stringToSign, "utf8").digest("hex");

  return {
    headers: {
      ...signHeaders,
      Authorization: `SDK-HMAC-SHA256 Access=${ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
    signature,
  };
}

function lowerKeys(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) out[k.toLowerCase()] = v;
  return out;
}
