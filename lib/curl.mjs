/**
 * 把已签名的请求还原成可直接粘贴执行的 curl 命令。
 *
 * 为什么需要：排查华为云 401 时，最省时间的做法是把「脚本里发的请求」
 * 原样交给对方（或未来的自己）复现。手工拼 header 很容易漏掉
 * X-Sdk-Date / X-Project-Id / X-Security-Token，导致复现失败后误判成权限问题。
 */

/** 单引号包裹，内部单引号用 '\'' 断开 —— POSIX sh / bash / zsh 通用 */
export function shellQuote(s) {
  const str = String(s);
  if (str === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(str)) return str;
  return "'" + str.replace(/'/g, `'\\''`) + "'";
}

/**
 * @param {object} o
 * @param {string} o.method
 * @param {string} o.url
 * @param {Record<string,string>} o.headers
 * @param {string} [o.body]
 * @returns {string} 多行 curl 命令
 */
export function toCurl({ method, url, headers, body }) {
  const parts = [`curl -sS -X ${method} ${shellQuote(url)}`];
  for (const [k, v] of Object.entries(headers || {})) {
    // Host / Content-Length 由 curl 自己算，带上反而会写错
    if (/^(host|content-length)$/i.test(k)) continue;
    parts.push(`  -H ${shellQuote(`${k}: ${v}`)}`);
  }
  if (body) parts.push(`  --data-raw ${shellQuote(body)}`);
  return parts.join(" \\\n");
}

/** 需要打码的敏感头（日志里不该出现完整值） */
export function maskHeaders(headers, keep = 4) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (/authorization|security-token|token/i.test(k) && typeof v === "string" && v.length > keep * 2) {
      out[k] = v.slice(0, keep) + "…" + v.slice(-keep);
    } else {
      out[k] = v;
    }
  }
  return out;
}
