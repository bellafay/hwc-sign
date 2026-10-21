/**
 * 可插拔子命令发现器。
 *
 * 为什么要自动发现而不是集中注册：`bin/hwc-sign.mjs` 每加一个子命令都要改
 * 分发逻辑，改动点越多越容易冲突。这里约定「一个文件 = 一个子命令」：
 * `lib/cmd/<name>.mjs` 默认导出 `{ name?, aliases?, run(argv) }`，
 * 加载器按文件名排序注册，别名冲突直接报错。
 *
 * 约定：
 *   - `run(argv)` 收到的是去掉子命令名之后的原始参数，自己解析（不受主 CLI 参数白名单限制）
 *   - 返回 number 退出码；抛错由主 CLI 统一转成退出码 2
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CMD_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "cmd");

/** 列出 lib/cmd/ 下的命令模块文件名（不含扩展名），排序保证可复现 */
export function listCommandFiles(dir = CMD_DIR) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".mjs") && !f.startsWith("_"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return names.sort();
}

/**
 * 加载全部子命令，返回 Map<name, {run}>；别名同样进 Map。
 * 冲突（重名/别名撞车/与内建命令撞车）抛错，避免静默覆盖。
 */
export async function loadCommands({ dir = CMD_DIR, builtin = ["sign", "call", "sts"] } = {}) {
  const map = new Map();
  for (const file of listCommandFiles(dir)) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const def = mod.default;
    if (!def || typeof def.run !== "function") {
      throw new Error(`子命令模块 ${file} 缺少默认导出 { run(argv) }`);
    }
    const name = def.name || path.basename(file, ".mjs");
    for (const key of [name, ...(def.aliases || [])]) {
      if (builtin.includes(key)) throw new Error(`子命令 ${file} 与内建命令 ${key} 重名`);
      if (map.has(key)) throw new Error(`子命令名 ${key} 冲突（${file}）`);
      map.set(key, def);
    }
  }
  return map;
}

/** 可用子命令名（去重、排序），用于错误提示与 --help */
export async function commandNames(opts) {
  return [...(await loadCommands(opts)).keys()].sort();
}
