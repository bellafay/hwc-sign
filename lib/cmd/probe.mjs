/**
 * hwc-sign probe — 发一次无签名请求，判断 401 是网络还是签名问题。
 *
 * 签名错误和网络错误在 CLI 里都表现为「请求失败」，但排查方向完全相反：
 * 先不带签名打一发，能拿到 401/403 且带 x-request-id，说明请求已到达网关，
 * 签名才是嫌疑；连不上或超时则先查网络、DNS、代理。因此这里刻意只支持
 * GET/HEAD，避免探测动作本身产生副作用。
 */

const HEADER_KEYS = ["x-request-id", "content-type", "retry-after"];
const METHODS = new Set(["GET", "HEAD"]);
const DEFAULT_TIMEOUT = 30000;

const USAGE = [
  "用法: hwc-sign probe -u <url> [-m GET|HEAD] [--timeout ms] [--json]",
  "",
  "发一次无签名请求，观察服务端在「没有签名」时的真实反应：",
  "  401 + x-request-id 说明请求已到达网关，问题多半在签名；",
  "  连接失败/超时则先排查网络、DNS 或代理。",
].join("\n");

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("-")) {
    throw new Error(`${flag} 缺少参数值`);
  }
  return value;
}

function parseTimeout(raw) {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--timeout 必须是正整数，收到: ${raw}`);
  }
  const timeout = Number(raw);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error(`--timeout 必须大于 0，收到: ${raw}`);
  }
  return timeout;
}

function normalizeUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`URL 格式非法: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`只支持 http/https URL，收到: ${parsed.protocol}`);
  }
  return parsed.toString();
}

/** 解析 argv；不依赖主 CLI 的参数白名单，probe 自己定义语义。 */
export function parseArgs(argv) {
  const opts = { url: "", method: "GET", timeout: DEFAULT_TIMEOUT, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      opts.help = true;
    } else if (arg === "-u" || arg === "--url") {
      opts.url = requireValue(argv, i, arg);
      i += 1;
    } else if (arg.startsWith("--url=")) {
      opts.url = arg.slice("--url=".length);
    } else if (arg === "-m" || arg === "--method") {
      opts.method = requireValue(argv, i, arg).toUpperCase();
      i += 1;
    } else if (arg.startsWith("--method=")) {
      opts.method = arg.slice("--method=".length).toUpperCase();
    } else if (arg === "--timeout") {
      opts.timeout = parseTimeout(requireValue(argv, i, arg));
      i += 1;
    } else if (arg.startsWith("--timeout=")) {
      opts.timeout = parseTimeout(arg.slice("--timeout=".length));
    } else if (arg === "--json") {
      opts.json = true;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  if (opts.help) return opts;
  if (!opts.url) {
    throw new Error("缺少必填参数 -u/--url");
  }
  if (!METHODS.has(opts.method)) {
    throw new Error(`不支持的方法: ${opts.method}（只允许 GET / HEAD）`);
  }
  opts.url = normalizeUrl(opts.url);
  return opts;
}

function pickHeaders(headers) {
  const picked = {};
  for (const key of HEADER_KEYS) {
    const value = headers?.get?.(key);
    if (value !== null && value !== undefined && value !== "") {
      picked[key] = value;
    }
  }
  return picked;
}

const defaultNow = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/**
 * 执行探测。fetch/now 可注入，测试不需要联网，也能稳定断言耗时。
 * 失败时抛错，由 run 决定退出码，纯函数本身不碰 process。
 */
export async function probe({
  url,
  method = "GET",
  timeout = DEFAULT_TIMEOUT,
  fetchImpl = globalThis.fetch,
  now = defaultNow,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("当前运行时没有 fetch，请使用 Node 18 或更高版本");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = now();
  try {
    const response = await fetchImpl(url, {
      method,
      // 不跟随重定向：302 到登录页本身就是有价值的探测结果
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "*/*" },
    });
    const elapsedMs = Math.max(0, Math.round(now() - started));
    try {
      // 只关心响应头，主动取消 body 避免连接被占住
      await response.body?.cancel?.();
    } catch {
      // 取消失败不影响探测结论
    }
    return {
      url,
      method,
      status: response.status,
      statusText: response.statusText || "",
      elapsedMs,
      headers: pickHeaders(response.headers),
    };
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`请求超时（${timeout} ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function formatText(report) {
  const status = `${report.status}${report.statusText ? " " + report.statusText : ""}`;
  const lines = [`${report.method} ${report.url} -> ${status}  ${report.elapsedMs} ms`];
  for (const key of HEADER_KEYS) {
    lines.push(`${key}: ${report.headers[key] ?? "-"}`);
  }
  return lines.join("\n");
}

export function formatJson(report) {
  return JSON.stringify(report, null, 2);
}

export default {
  name: "probe",
  async run(argv) {
    let opts;
    try {
      opts = parseArgs(argv);
    } catch (error) {
      console.error(`hwc-sign probe: ${error.message}`);
      return 2;
    }
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    try {
      const report = await probe(opts);
      console.log(opts.json ? formatJson(report) : formatText(report));
      // HTTP 401 是探测结果而非 CLI 失败，只有探测本身失败才返回非 0
      return 0;
    } catch (error) {
      console.error(`hwc-sign probe: ${error.message}`);
      return 1;
    }
  },
};
