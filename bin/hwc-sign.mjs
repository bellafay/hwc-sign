#!/usr/bin/env node
/**
 * hwc-sign — 华为云 API 签名与调试 CLI
 *
 *   hwc-sign sign -m GET -u https://iam.cn-north-4.myhuaweicloud.com/v3/auth/projects -a AK -s SK
 *   hwc-sign call -m POST -u https://sts.cn-north-4.myhuaweicloud.com/v5/agencies/assume \
 *                 -a AK -s SK -b '{"agency_urn":"...","agency_session_name":"s1","duration_seconds":900}'
 *   hwc-sign call ... --token <STS_TOKEN>     # STS 临时凭证
 *
 * 凭证来源优先级：命令行 > 环境变量 HWC_AK / HWC_SK / HWC_TOKEN
 */
import { sign } from "../lib/sign.mjs";

const HELP = `hwc-sign 1.0.0 — 华为云 API 签名与调试 CLI

用法:
  hwc-sign sign -u <url> [-m GET] [-b <body>] [-a AK] [-s SK] [--token T] [--json]
  hwc-sign call -u <url> [-m GET] [-b <body>] [-a AK] [-s SK] [--token T] [--timeout ms]
  hwc-sign --help

参数:
  -u, --url      完整 URL（必填）
  -m, --method   HTTP 方法，默认 GET
  -b, --body     请求体字符串（JSON 请单引号包裹）
  -a, --ak       Access Key（缺省读 HWC_AK）
  -s, --sk       Secret Key（缺省读 HWC_SK）
      --token    STS security token（缺省读 HWC_TOKEN）
      --header   额外请求头，形如 "content-type:application/json"，可重复
      --json     只输出 JSON（便于管道处理）
      --timeout  毫秒，默认 30000

示例:
  hwc-sign call -u https://iam.cn-north-4.myhuaweicloud.com/v3/auth/projects --json
`;

function parse(argv) {
  const o = { method: "GET", headers: [], timeout: 30000, json: false };
  const take = (i, name) => {
    const v = argv[i];
    if (v === undefined) throw new Error(`${name} 缺少参数值`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-u" || a === "--url") o.url = take(++i, a);
    else if (a === "-m" || a === "--method") o.method = take(++i, a).toUpperCase();
    else if (a === "-b" || a === "--body") o.body = take(++i, a);
    else if (a === "-a" || a === "--ak") o.ak = take(++i, a);
    else if (a === "-s" || a === "--sk") o.sk = take(++i, a);
    else if (a === "--token") o.token = take(++i, a);
    else if (a === "--header") o.headers.push(take(++i, a));
    else if (a === "--timeout") o.timeout = Number(take(++i, a));
    else if (a === "--json") o.json = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else throw new Error(`未知参数: ${a}`);
  }
  return o;
}

function extraHeaders(list) {
  const h = {};
  for (const item of list) {
    const i = item.indexOf(":");
    if (i < 0) throw new Error(`--header 格式应为 name:value，收到 ${item}`);
    h[item.slice(0, i).trim()] = item.slice(i + 1).trim();
  }
  return h;
}

function resolveCreds(o) {
  return {
    ak: o.ak || process.env.HWC_AK,
    sk: o.sk || process.env.HWC_SK,
    token: o.token || process.env.HWC_TOKEN,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
    console.log(HELP);
    return 0;
  }
  const cmd = argv[0];
  if (cmd !== "sign" && cmd !== "call") throw new Error(`未知子命令: ${cmd}（可用 sign / call）`);

  const o = parse(argv.slice(1));
  if (!o.url) throw new Error("缺少 -u/--url");
  const { ak, sk, token } = resolveCreds(o);
  if (!ak || !sk) throw new Error("缺少凭证：用 -a/-s 或环境变量 HWC_AK/HWC_SK");

  const extra = extraHeaders(o.headers);
  const body = o.method === "GET" || o.method === "HEAD" ? "" : (o.body || "");
  const signed = sign({ method: o.method, url: o.url, body, ak, sk, token, headers: extra });

  if (cmd === "sign") {
    const out = { url: o.url, method: o.method, headers: signed.headers, stringToSign: signed.stringToSign };
    if (o.json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`${o.method} ${o.url}`);
      for (const [k, v] of Object.entries(signed.headers)) console.log(`${k}: ${v}`);
      if (body) console.log(`\nbody: ${body}`);
    }
    return 0;
  }

  // call
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), o.timeout);
  let res, text;
  try {
    res = await fetch(o.url, {
      method: o.method,
      headers: signed.headers,
      body: body || undefined,
      signal: ac.signal,
    });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  if (o.json) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* 非 JSON 原样返回 */ }
    console.log(JSON.stringify({ status: res.status, ok: res.ok, body: parsed ?? text }, null, 2));
  } else {
    console.log(`status ${res.status} ${res.ok ? "OK" : "FAIL"}`);
    console.log(text.slice(0, 4000));
  }
  return res.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("错误: " + e.message);
    process.exit(2);
  }
);
