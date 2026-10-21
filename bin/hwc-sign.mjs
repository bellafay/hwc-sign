#!/usr/bin/env node
/**
 * hwc-sign — 华为云 API 签名与调试 CLI
 *
 *   hwc-sign sign -u <url> [-m GET] [-a AK] [-s SK]
 *   hwc-sign call -u <url> [-b '<json>'] [--token-file creds.json]
 *   hwc-sign sts --agency-urn iam::<账号ID>:agency:SELF_VERIFY --out creds.json
 *   hwc-sign call -u <url> --print-curl
 *
 * 凭证来源优先级：命令行 > 环境变量 HWC_AK / HWC_SK / HWC_TOKEN
 */
import fs from "node:fs";
import path from "node:path";
import { sign } from "../lib/sign.mjs";
import { assumeAgency } from "../lib/sts.mjs";
import { toCurl } from "../lib/curl.mjs";

const HELP = `hwc-sign 1.2.0 — 华为云 API 签名与调试 CLI

用法:
  hwc-sign sign -u <url> [-m GET] [-b <body>] [-a AK] [-s SK] [--token T] [--json]
  hwc-sign call -u <url> [-m GET] [-b <body>] [-a AK] [-s SK] [--token T] [--timeout ms]
  hwc-sign sts  --agency-urn <urn> [-a AK] [-s SK] [--session name] [--duration 900] [--out creds.json]
  hwc-sign --help

通用参数:
  -u, --url      完整 URL（必填，sign / call）
  -m, --method   HTTP 方法，默认 GET
  -b, --body     请求体字符串（JSON 请单引号包裹）
  -a, --ak       Access Key（缺省读 HWC_AK）
  -s, --sk       Secret Key（缺省读 HWC_SK）
      --token    STS security token（缺省读 HWC_TOKEN）
      --token-file  从 JSON 文件读临时凭证（hwc-sign sts --out 的产物）
      --header   额外请求头，形如 "content-type:application/json"，可重复
      --json     只输出 JSON（便于管道处理）
      --timeout  毫秒，默认 30000
      --print-curl  打印等价 curl 命令（排查 401 时可直接复现），可与其他输出同用

sts 专有参数:
      --agency-urn   委托 URN，形如 iam::<账号ID>:agency:SELF_VERIFY
      --session      会话名，默认随机
      --duration     有效期秒数，默认 900（最大 43200）
      --actions      逗号分隔的授权动作，默认 sts::GetCallerIdentity
      --out          把临时凭证写到该文件（0600），供 --token-file 复用

示例:
  hwc-sign call -u https://iam.cn-north-4.myhuaweicloud.com/v3/auth/projects --json
  hwc-sign sts --agency-urn iam::f767d8fd28014690ae304b446544afd4:agency:SELF_VERIFY --out ~/.hwc-sts.json
  hwc-sign call -u https://sts.cn-north-4.myhuaweicloud.com/v5/caller-identity --token-file ~/.hwc-sts.json
`;

function parse(argv) {
  const o = { method: "GET", headers: [], timeout: 30000, json: false, duration: 900 };
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
    else if (a === "--token-file") o.tokenFile = take(++i, a);
    else if (a === "--header") o.headers.push(take(++i, a));
    else if (a === "--timeout") o.timeout = Number(take(++i, a));
    else if (a === "--json") o.json = true;
    else if (a === "--print-curl") o.printCurl = true;
    else if (a === "--agency-urn") o.agencyUrn = take(++i, a);
    else if (a === "--session") o.session = take(++i, a);
    else if (a === "--duration") o.duration = Number(take(++i, a));
    else if (a === "--actions") o.actions = take(++i, a).split(",").map((x) => x.trim()).filter(Boolean);
    else if (a === "--out") o.out = take(++i, a);
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

/** 从 --token-file（hwc-sign sts --out 的产物）读取临时凭证 */
function readCredFile(file) {
  if (!file) return {};
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    ak: j.access_key_id || j.accessKeyId || j.AccessKeyId,
    sk: j.secret_access_key || j.secretAccessKey || j.SecretAccessKey,
    token: j.security_token || j.securityToken || j.SecurityToken,
  };
}

function resolveCreds(o) {
  const f = readCredFile(o.tokenFile);
  return {
    ak: o.ak || process.env.HWC_AK || f.ak,
    sk: o.sk || process.env.HWC_SK || f.sk,
    token: o.token || process.env.HWC_TOKEN || f.token,
  };
}

async function timedFetch(url, init, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    return { res, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

function printResult(res, text, json) {
  if (json) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* 非 JSON 原样返回 */ }
    console.log(JSON.stringify({ status: res.status, ok: res.ok, body: parsed ?? text }, null, 2));
  } else {
    console.log(`status ${res.status} ${res.ok ? "OK" : "FAIL"}`);
    console.log(text.slice(0, 4000));
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
    console.log(HELP);
    return 0;
  }
  const cmd = argv[0];
  if (!["sign", "call", "sts"].includes(cmd)) throw new Error(`未知子命令: ${cmd}（可用 sign / call / sts）`);

  const o = parse(argv.slice(1));
  const { ak, sk, token } = resolveCreds(o);
  if (!ak || !sk) throw new Error("缺少凭证：用 -a/-s、--token-file 或环境变量 HWC_AK/HWC_SK");

  /* ---- sts：自委托换临时凭证 ---- */
  if (cmd === "sts") {
    if (!o.agencyUrn) throw new Error("sts 需要 --agency-urn");
    const out = await assumeAgency({
      agencyUrn: o.agencyUrn,
      sessionName: o.session,
      durationSeconds: o.duration,
      actions: o.actions,
      ak, sk,
    });
    if (!out.ok) {
      console.error(`STS 失败 ${out.status}: ${out.error}`);
      return 1;
    }
    if (o.out) {
      fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
      fs.writeFileSync(o.out, JSON.stringify(out.credentials, null, 2), { mode: 0o600 });
      console.error(`临时凭证已写入 ${o.out}（0600，${out.credentials.expiration} 过期）`);
    }
    const c = out.credentials;
    if (o.json) console.log(JSON.stringify(c, null, 2));
    else {
      console.log(`# 过期时间 ${c.expiration}`);
      console.log(`export HWC_AK=${c.access_key_id}`);
      console.log(`export HWC_SK=${c.secret_access_key}`);
      console.log(`export HWC_TOKEN=${c.security_token}`);
    }
    return 0;
  }

  if (!o.url) throw new Error("缺少 -u/--url");
  const extra = extraHeaders(o.headers);
  const body = o.method === "GET" || o.method === "HEAD" ? "" : (o.body || "");
  const signed = sign({ method: o.method, url: o.url, body, ak, sk, token, headers: extra });

  /* ---- sign：只算签名 ---- */
  if (o.printCurl) console.log(toCurl({ method: o.method, url: o.url, headers: signed.headers, body }) + "\n");

  if (cmd === "sign") {
    if (o.json) {
      console.log(JSON.stringify({ url: o.url, method: o.method, headers: signed.headers, stringToSign: signed.stringToSign }, null, 2));
    } else {
      console.log(`${o.method} ${o.url}`);
      for (const [k, v] of Object.entries(signed.headers)) console.log(`${k}: ${v}`);
      if (body) console.log(`\nbody: ${body}`);
    }
    return 0;
  }

  /* ---- call：发请求 ---- */
  if (o.printCurl && o.json) console.error(toCurl({ method: o.method, url: o.url, headers: signed.headers, body }));
  const { res, text } = await timedFetch(o.url, {
    method: o.method,
    headers: signed.headers,
    body: body || undefined,
  }, o.timeout);
  printResult(res, text, o.json);
  return res.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("错误: " + e.message);
    process.exit(2);
  }
);
