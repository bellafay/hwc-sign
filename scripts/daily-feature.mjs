#!/usr/bin/env node
/**
 * STATUS: ACTIVE — 每日新功能管线（Mac 侧 cron 09:40，NAS 10:30 展览馆投稿依赖它）
 *
 * 为什么需要它：展览馆任务只认「有新版本」的投稿，天天投旧版本就是灌水。
 * 所以每天的闭环是：清单取一条规格 → 模型实现成可插拔子命令 → 测试全绿 →
 * 升 patch 版本 → 写 CHANGELOG → 提交推送 → NAS 拉取并投稿。
 *
 * 硬闸门（任一不满足就放弃当天，不写死代码、不硬造假）：
 *   1. 工作区必须干净（避免把别人的改动卷进自动提交）
 *   2. 只允许新增文件：lib/cmd/<slug>.mjs 与 test/<slug>.test.mjs
 *   3. `npm test` 必须全绿
 *   4. 推送失败则回滚本地提交，保持仓库可用
 *
 * 用法：
 *   node scripts/daily-feature.mjs            # 生产：取清单第一条并落地
 *   node scripts/daily-feature.mjs --dry-run  # 只打印规格与提示词，不调用模型
 *   node scripts/daily-feature.mjs --check    # 只报告清单还剩几条
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const BACKLOG = process.env.HWC_BACKLOG_FILE || path.join(ROOT, "scripts/feature-backlog.md");
const LOG_DIR = process.env.HWC_FEATURE_LOG_DIR || path.join(ROOT, "scripts/logs");
const AXON = process.env.AXONHUB_URL || "http://192.168.8.199:8090/v1";
const KEY_FILE = process.env.AXONHUB_KEY_FILE || path.join(process.env.HOME || "", ".pi-adhoc/hwc-grow-fix/.axonhub-key");
const MODEL = process.env.HWC_FEATURE_MODEL || "value";
const BARK = process.env.BARK_KEY || "sULGWewJg6p8WYJav2q9tb";
const MAX_TOKENS = Number(process.env.HWC_FEATURE_MAX_TOKENS || 48000); // value 是推理模型，实测 reasoning 吃 20k+ token

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const CHECK_ONLY = argv.includes("--check");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  const line = `[${new Date().toISOString().replace("T", " ").slice(0, 19)}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, "daily-feature.log"), line + "\n");
  } catch { /* 日志失败不影响主流程 */ }
}

function bark(title, body, level = "active") {
  try {
    const d = JSON.stringify({ device_key: BARK, title, body, group: "HuaweiGrow", level });
    execFileSync("curl", ["-s", "-m", "8", "-X", "POST", "http://192.168.8.199:28080/push", "-H", "Content-Type: application/json", "-d", d], { stdio: "ignore" });
  } catch { /* 通知失败不影响主流程 */ }
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function gitDirty() {
  return sh("git", ["status", "--porcelain"]).trim();
}

/** 解析清单：返回 [{done, slug, spec}]，保持文件顺序 */
export function parseBacklog(text) {
  const items = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^- \[( |x)\] ([a-z0-9-]+) \| (.+)$/);
    if (m) items.push({ done: m[1] === "x", slug: m[2], spec: m[3].trim() });
  }
  return items;
}

function repoContext() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (rel.endsWith(".mjs") || rel.endsWith(".md") || rel.endsWith(".json")) files.push(rel);
    }
  };
  walk("bin"); walk("lib"); walk("test");
  const snippet = (f, n = 60) => {
    try {
      return `--- ${f} ---\n` + fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").slice(0, n).join("\n");
    } catch { return ""; }
  };
  return [
    "仓库：hwc-sign（华为云 API 签名与调试 CLI，零依赖，ESM，node:test）",
    "文件清单：\n" + files.join("\n"),
    snippet("bin/hwc-sign.mjs", 40),
    snippet("lib/sign.mjs", 60),
    snippet("lib/commands.mjs", 50),
    snippet("test/sign.test.mjs", 25),
    snippet("package.json", 30),
  ].join("\n\n");
}

function buildPrompt(item, ctx, feedback) {
  return `你在给一个真实的开源 CLI 仓库加一个小功能。只输出 JSON，不要解释，不要代码围栏。

${ctx}

今天要实现的功能（slug: ${item.slug}）：
${item.spec}

输出契约（严格遵守）：
{
  "slug": "${item.slug}",
  "title": "一句话中文标题（15-30 字）",
  "files": [
    {"path": "lib/cmd/${item.slug}.mjs", "content": "完整文件内容"},
    {"path": "test/${item.slug}.test.mjs", "content": "完整文件内容"}
  ],
  "changelog": "一行中文变更说明"
}

硬性要求：
1. 只允许新增这两个文件，路径必须完全一致，不能改 bin/ 或 lib/commands.mjs
2. lib/cmd/${item.slug}.mjs 必须 export default { name: "${item.slug}", run(argv) }，run 自行解析 argv（不要假设主 CLI 的参数白名单），返回数字退出码
3. 只用 Node 内置模块，零新增依赖；不要联网做真实请求（用注入的 fetch 或纯函数）
4. 测试用 node:test + node:assert/strict，覆盖正常路径与至少两个错误路径（缺参数、格式非法）
5. 代码注释讲「为什么」，不要写「这里做了什么」式的冗余注释
6. 所有字符串用双引号，2 空格缩进，文件以换行结尾
${feedback ? `\n上一次尝试失败，请修正：${feedback}` : ""}`;
}

async function callModel(prompt) {
  const key = fs.readFileSync(KEY_FILE, "utf8").trim();
  const res = await fetch(`${AXON}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "你是严谨的 Node.js 工程师，只输出合法 JSON。" },
        { role: "user", content: prompt },
      ],
      max_tokens: MAX_TOKENS,
      temperature: 0.3,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`模型调用失败 ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = j.choices?.[0]?.message?.content || "";
  return { text, usage: j.usage || {} };
}

export function extractJson(text) {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("模型输出里没有 JSON");
  return JSON.parse(text.slice(s, e + 1));
}

export function validateFeature(out, slug) {
  const want = [`lib/cmd/${slug}.mjs`, `test/${slug}.test.mjs`];
  if (!out || typeof out !== "object") throw new Error("输出不是对象");
  if (out.slug !== slug) throw new Error(`slug 不匹配：${out.slug}`);
  if (!Array.isArray(out.files) || out.files.length !== 2) throw new Error("files 必须正好两个");
  const paths = out.files.map((f) => f.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify([...want].sort())) throw new Error(`文件路径不合规：${paths.join(", ")}`);
  for (const f of out.files) {
    if (typeof f.content !== "string" || f.content.length < 200) throw new Error(`${f.path} 内容过短`);
    // 只有命令模块需要 export default；测试文件用 node:test 的具名导出
    if (f.path.startsWith("lib/cmd/") && !f.content.includes("export default")) throw new Error(`${f.path} 缺少 export default`);
    if (fs.existsSync(path.join(ROOT, f.path))) throw new Error(`${f.path} 已存在，拒绝覆盖`);
  }
  if (!out.title || !out.changelog) throw new Error("缺少 title 或 changelog");
  return out;
}

function cleanup(files) {
  for (const f of files) {
    try { fs.unlinkSync(path.join(ROOT, f.path)); } catch { /* 已删 */ }
  }
}

function runTests() {
  try {
    const out = sh("npm", ["test"], { timeout: 180000 });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function bumpVersion() {
  sh("npm", ["version", "patch", "--no-git-tag-version"]);
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

function writeChangelog(version, title, changelog, slug) {
  const p = path.join(ROOT, "CHANGELOG.md");
  const text = fs.readFileSync(p, "utf8");
  const date = new Date().toISOString().slice(0, 10);
  const entry = `## [${version}] - ${date}\n\n### Added\n\n- **${title}**（\`${slug}\`）：${changelog}\n\n`;
  const i = text.indexOf("## [") >= 0 ? text.indexOf("## [") : text.indexOf("## ");
  fs.writeFileSync(p, i >= 0 ? text.slice(0, i) + entry + text.slice(i) : text + "\n" + entry);
}

function markDone(slug) {
  const p = BACKLOG;
  const text = fs.readFileSync(p, "utf8");
  const next = text.replace(new RegExp(`^- \\[ \\] ${slug} \\|`, "m"), `- [x] ${slug} |`);
  if (next === text) throw new Error(`清单里没找到未完成条目 ${slug}`);
  fs.writeFileSync(p, next);
}

/** 已占用的 slug：lib/cmd 下已有子命令 + 清单里出现过的条目，防止重复实现同一个功能 */
export function takenSlugs(cmdDir, backlogText) {
  const names = new Set();
  try {
    for (const f of fs.readdirSync(cmdDir)) {
      if (f.endsWith(".mjs")) names.add(f.slice(0, -4));
    }
  } catch { /* 目录不存在就当没有子命令 */ }
  for (const item of parseBacklog(backlogText)) names.add(item.slug);
  return names;
}

/** 校验模型补的清单条目：slug 形如 kebab-case、规格里必须带可验证的调用方式、不能与已占用 slug 重复 */
export function validateBacklogAdditions(raw, taken) {
  if (!Array.isArray(raw)) throw new Error("补条目需要数组");
  if (raw.length < 3) throw new Error("至少补 3 条，避免明后天就断供");
  const seen = new Set(taken);
  const out = [];
  for (const it of raw) {
    const slug = String(it?.slug || "").trim();
    const spec = String(it?.spec || "").trim();
    if (!/^[a-z][a-z0-9-]{1,20}$/.test(slug)) throw new Error(`slug 不合规：${slug}`);
    if (seen.has(slug)) throw new Error(`slug 重复：${slug}`);
    if (spec.length < 20) throw new Error(`${slug} 的规格太短，无法验证`);
    if (!spec.includes("`hwc-sign")) throw new Error(`${slug} 的规格里必须写出实际调用方式（\`hwc-sign ...\`）`);
    seen.add(slug);
    out.push({ slug, spec });
  }
  return out;
}

/**
 * 清单快用完时让模型按仓库现状补条目。
 * 为什么不让它凭空想：只允许「这个工具真实缺的东西」，所以把已有子命令一起喂进去，并禁用重复 slug。
 */
export async function refillBacklog(ctx, backlogText) {
  const taken = [...takenSlugs(path.join(ROOT, "lib/cmd"), backlogText)];
  const prompt = `你在维护一个真实的 CLI 工具仓库 hwc-sign（华为云 API 签名与调试）。请提出 5 个「它确实还缺、且能在 5 分钟内验证」的小功能，作为未来几天的日更清单。

${ctx}

已经存在的子命令（严禁重复）：${taken.join(", ")}

只输出 JSON 数组，不要代码围栏：
[{"slug":"kebab-case-短名","spec":"一句话规格，必须包含实际调用方式，形如 \`hwc-sign <slug> ...\` 并说明验证点"}]

要求：
1. 每个功能必须能用一条命令演示，且输出可被肉眼判断对错
2. 只做本工具相关（签名/调试/凭证/请求重放），不要扩成别的软件
3. 纯本地实现，不新增依赖，不联网
4. 规格里不要出现「支持所有」「完善」「优化体验」这类无法验证的词`;
  const { text } = await callModel(prompt);
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("补条目输出里没有 JSON 数组");
  const items = validateBacklogAdditions(JSON.parse(text.slice(start, end + 1)), taken);
  const lines = items.map((i) => `- [ ] ${i.slug} | ${i.spec}`).join("\n");
  fs.writeFileSync(BACKLOG, fs.readFileSync(BACKLOG, "utf8").replace(/\n*$/, "\n") + lines + "\n");
  log(`清单已补 ${items.length} 条：${items.map((i) => i.slug).join(", ")}`);
  return items.length;
}

async function main() {
  const backlog = parseBacklog(fs.readFileSync(BACKLOG, "utf8"));
  const pending = backlog.filter((x) => !x.done);
  const doneCount = backlog.length - pending.length;
  log(`清单共 ${backlog.length} 条，已完成 ${doneCount}，待实现 ${pending.length}`);

  if (CHECK_ONLY) return 0;
  if (DRY) {
    console.log(buildPrompt(pending[0] || { slug: "sample", spec: "示例规格" }, repoContext(), "").slice(0, 3000));
    return 0;
  }
  // 清单少于 3 条就补货：断供一天就少 200 分，补货失败不阻断当天发版
  if (pending.length < 3) {
    try {
      await refillBacklog(repoContext(), fs.readFileSync(BACKLOG, "utf8"));
    } catch (e) {
      log(`补条目失败（不影响今天发版）：${String(e.message).slice(0, 200)}`);
      bark("hwc-sign 功能清单补给失败", `清单只剩 ${pending.length} 条，今天仍会发版；请人工补 scripts/feature-backlog.md`, "timeSensitive");
    }
  }
  if (!pending.length) {
    log("清单已空：不投旧版本，等补条目");
    bark("展览馆：功能清单已用完", "hwc-sign 没有待实现条目，今天不会发新版，+200 未领。补 scripts/feature-backlog.md 即可恢复。", "timeSensitive");
    return 3;
  }

  const item = pending[0];
  const ctx = repoContext();

  // 当天已发过版就退出：09:40 主跑 + 10:15 补跑都调这个脚本，不能一天撞出两个版本
  const today = new Date().toISOString().slice(0, 10);
  const todayCommits = sh("git", ["log", `--since=${today} 00:00`, "--grep=^feat", "--oneline"]).trim();
  if (todayCommits) {
    log(`今天已有自动发布的版本提交，跳过：${todayCommits.split("\n")[0]}`);
    return 0;
  }

  const dirty = gitDirty();
  if (dirty) {
    log(`工作区不干净，放弃本次自动提交：\n${dirty}`);
    bark("hwc-sign 每日功能：工作区有未提交改动", "为避免把别人的改动卷进自动提交，已跳过今天的新功能。", "timeSensitive");
    return 4;
  }

  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    log(`第 ${attempt} 次尝试实现 ${item.slug}`);
    let out;
    try {
      const { text, usage } = await callModel(buildPrompt(item, ctx, lastErr));
      log(`模型返回 ${text.length} 字符，usage=${JSON.stringify(usage)}`);
      out = validateFeature(extractJson(text), item.slug);
    } catch (e) {
      lastErr = String(e.message).slice(0, 300);
      log(`产出不合规：${lastErr}`);
      await sleep(2000);
      continue;
    }

    for (const f of out.files) {
      fs.mkdirSync(path.dirname(path.join(ROOT, f.path)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, f.path), f.content);
    }
    const t = runTests();
    if (!t.ok) {
      cleanup(out.files);
      lastErr = "测试失败：" + t.out.split("\n").filter((l) => /fail|Error|✖/.test(l)).slice(0, 6).join(" | ").slice(0, 400);
      log(lastErr);
      continue;
    }
    log(`测试全绿（${t.out.match(/pass (\d+)/)?.[1] || "?"} 项）`);

    const version = bumpVersion();
    writeChangelog(version, out.title, out.changelog, item.slug);
    markDone(item.slug);
    sh("git", ["add", `lib/cmd/${item.slug}.mjs`, `test/${item.slug}.test.mjs`, "scripts", "CHANGELOG.md", "package.json"]);
    sh("git", ["commit", "-q", "-m", `feat(${item.slug}): ${out.title}（v${version}）`]);
    try {
      sh("git", ["push", "-q", "origin", "HEAD:main"], { timeout: 60000 });
    } catch (e) {
      sh("git", ["reset", "-q", "--hard", "HEAD~1"]);
      log(`推送失败，已回滚本地提交：${String(e.message).slice(0, 200)}`);
      bark("hwc-sign 推送失败", `v${version} 已回滚，展览馆今天将投旧版本（不新增积分）`, "timeSensitive");
      return 5;
    }
    log(`已发布 v${version}：${out.title}`);
    bark("hwc-sign 新版本已推送", `v${version} ${out.title}；NAS 10:30 会拉取并投稿展览馆`, "active");
    return 0;
  }

  log(`两次尝试均失败：${lastErr}`);
  bark("hwc-sign 今日无新版本", `模型两次产出都不合格（${lastErr.slice(0, 120)}），未提交脏代码，展览馆今日跳过`, "timeSensitive");
  return 1;
}

export { main };

// 只有被直接执行时才跑主流程；被 import 进来（跑单测）不能有副作用
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      log("致命错误：" + e.message);
      bark("hwc-sign 每日功能管线异常", String(e.message).slice(0, 150), "timeSensitive");
      process.exit(2);
    },
  );
}
