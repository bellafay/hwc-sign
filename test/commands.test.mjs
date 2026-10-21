import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCommands, listCommandFiles, commandNames } from "../lib/commands.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hwc-cmd-"));
}

test("listCommandFiles: 目录不存在时返回空数组而不是抛错", () => {
  assert.deepEqual(listCommandFiles(path.join(tmpDir(), "nope")), []);
});

test("listCommandFiles: 只认 .mjs，忽略下划线开头的辅助文件，结果排序", () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, "b.mjs"), "");
  fs.writeFileSync(path.join(d, "a.mjs"), "");
  fs.writeFileSync(path.join(d, "_helper.mjs"), "");
  fs.writeFileSync(path.join(d, "note.txt"), "");
  assert.deepEqual(listCommandFiles(d), ["a.mjs", "b.mjs"]);
});

test("loadCommands: 名字取默认导出的 name，别名一并注册", async () => {
  const d = tmpDir();
  fs.writeFileSync(
    path.join(d, "probe.mjs"),
    'export default { name: "probe", aliases: ["p"], run: () => 7 };',
  );
  const map = await loadCommands({ dir: d });
  assert.equal(map.get("probe").run(), 7);
  assert.equal(map.get("p").run(), 7);
});

test("loadCommands: 与内建命令重名要报错，不能静默覆盖", async () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, "sign.mjs"), 'export default { name: "sign", run: async () => 0 };');
  await assert.rejects(() => loadCommands({ dir: d }), /与内建命令 sign 重名/);
});

test("loadCommands: 两个文件注册同名命令要报错", async () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, "a.mjs"), 'export default { name: "dup", run: async () => 0 };');
  fs.writeFileSync(path.join(d, "b.mjs"), 'export default { name: "dup", run: async () => 0 };');
  await assert.rejects(() => loadCommands({ dir: d }), /冲突/);
});

test("loadCommands: 缺少默认导出或 run 时给出文件名", async () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, "bad.mjs"), "export const x = 1;");
  await assert.rejects(() => loadCommands({ dir: d }), /bad\.mjs 缺少默认导出/);
});

test("commandNames: 返回去重排序后的可用命令", async () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, "b.mjs"), 'export default { name: "probe", run: async () => 0 };');
  fs.writeFileSync(path.join(d, "a.mjs"), 'export default { name: "env", aliases: ["e"], run: async () => 0 };');
  assert.deepEqual(await commandNames({ dir: d }), ["e", "env", "probe"]);
});
