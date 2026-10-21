import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBacklog, takenSlugs, validateBacklogAdditions, extractJson } from "../scripts/daily-feature.mjs";

const backlog = [
  "# 清单",
  "",
  "- [ ] alpha | `hwc-sign alpha -u <url>` 打印状态码",
  "- [x] beta | `hwc-sign beta` 已经做完的",
  "- [ ] gamma-two | `hwc-sign gamma-two --x` 输出两行",
].join("\n");

test("parseBacklog: 只认规范条目，保留完成状态与顺序", () => {
  const items = parseBacklog(backlog);
  assert.deepEqual(items.map((i) => i.slug), ["alpha", "beta", "gamma-two"]);
  assert.deepEqual(items.map((i) => i.done), [false, true, false]);
});

test("parseBacklog: 说明文字里形似条目的行不会误判", () => {
  const text = "- [ ] 这不是条目，因为没有 slug 竖线格式\n- 也没有中括号\n";
  assert.deepEqual(parseBacklog(text), []);
});

test("takenSlugs: 同时收 lib/cmd 已有子命令和清单条目", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hwc-taken-"));
  fs.writeFileSync(path.join(d, "probe.mjs"), "");
  fs.writeFileSync(path.join(d, "helper.txt"), "");
  const t = takenSlugs(d, backlog);
  assert.ok(t.has("probe"));
  assert.ok(t.has("alpha"));
  assert.ok(!t.has("helper"));
});

test("takenSlugs: 目录不存在时不抛错", () => {
  const t = takenSlugs(path.join(os.tmpdir(), "definitely-missing-dir"), backlog);
  assert.ok(t.has("beta"));
});

test("validateBacklogAdditions: 合格条目原样通过", () => {
  const raw = [1, 2, 3].map((n) => ({ slug: `new-${n}`, spec: `\`hwc-sign new-${n}\` 打印第 ${n} 项，验证输出含数字 ${n}` }));
  const got = validateBacklogAdditions(raw, new Set(["alpha"]));
  assert.equal(got.length, 3);
  assert.equal(got[0].slug, "new-1");
});

test("validateBacklogAdditions: 少于 3 条直接拒绝（防止隔天断供）", () => {
  const raw = [{ slug: "only-one", spec: "`hwc-sign only-one` 打印一行" }];
  assert.throws(() => validateBacklogAdditions(raw, new Set()), /至少补 3 条/);
});

test("validateBacklogAdditions: 与已占用 slug 重复要拒绝", () => {
  const raw = [1, 2, 3].map((n) => ({ slug: n === 2 ? "alpha" : `fresh-${n}`, spec: `\`hwc-sign fresh-${n}\` 打印一行` }));
  assert.throws(() => validateBacklogAdditions(raw, new Set(["alpha"])), /slug 重复/);
});

test("validateBacklogAdditions: 规格里没有实际调用方式要拒绝", () => {
  const raw = [1, 2, 3].map((n) => ({ slug: `vague-${n}`, spec: "完善整体体验，支持所有常见场景，让这个工具在日常使用中更加顺手好用" }));
  assert.throws(() => validateBacklogAdditions(raw, new Set()), /实际调用方式/);
});

test("validateBacklogAdditions: Slug 必须 kebab-case", () => {
  const raw = [
    { slug: "Bad_Slug", spec: "`hwc-sign x` 打印一行" },
    { slug: "ok-2", spec: "`hwc-sign ok-2` 打印一行" },
    { slug: "ok-3", spec: "`hwc-sign ok-3` 打印一行" },
  ];
  assert.throws(() => validateBacklogAdditions(raw, new Set()), /slug 不合规/);
});

test("extractJson: 能从带前后废话的输出里取出对象", () => {
  assert.deepEqual(extractJson('好的，结果如下：{"a":1} 以上。'), { a: 1 });
});

test("extractJson: 没有 JSON 时明确报错", () => {
  assert.throws(() => extractJson("纯文字"), /没有 JSON/);
});
