# Changelog

## [1.3.0] - 2026-10-21

### Added
- 可插拔子命令：`lib/cmd/<name>.mjs` 一个文件即一个子命令，`bin/hwc-sign.mjs` 无需再改，
  默认导出 `{ name, aliases, run(argv) }`，由 `lib/commands.mjs` 自动发现并注册。
  重名（含与 `sign/call/sts` 撞车、两文件抢同一名字）直接抛错，不静默覆盖。
- `scripts/daily-feature.mjs`：每日新功能管线 —— 从 `scripts/feature-backlog.md` 取一条规格，
  实现成子命令 + 单测，`npm test` 全绿才升 patch 版本、写 CHANGELOG、提交推送；
  测试失败或产出不合规就回滚，绝不留下半成品。
- `scripts/feature-backlog.md`：12 条真实小型功能规格（probe / env / verify / retry …）。

### Notes
- 扩展子命令自行解析参数，不受主 CLI 参数白名单限制；`lib/cmd/_*.mjs` 不参与加载，可放共享辅助模块。

## [1.2.0] - 2026-10-21

### Added
- `--print-curl`：把已签名请求还原成可直接执行的 curl 命令（`sign` 与 `call` 都支持），
  排查 401 时不必再手工拼 header —— 漏掉 `x-sdk-date` / `X-Security-Token` 是复现失败最常见的原因。
- `lib/curl.mjs`：`shellQuote` / `toCurl` / `maskHeaders` 三个纯函数，附 5 条单测。

## [1.1.0] - 2026-10-21

### Added
- `hwc-sign sts` 子命令：一条命令完成 STS `AssumeAgency` 自委托换取临时凭证
- `--out` 把临时凭证落盘（文件权限 0600），`--token-file` 复用，省掉手动传三件套
- `--session` / `--duration` / `--actions` 控制会话名、有效期与最小权限动作
- `lib/sts.mjs`：封装 `buildPolicy()` 与 `assumeAgency()`，统一下划线字段

### Fixed
- `policy` 必须是 JSON 字符串，传对象会被服务端拒绝（`invalid type: map, expected a string`）
- STS 返回字段为 `access_key_id/secret_access_key/security_token`，按驼峰取会全为 `undefined`

### Tests
- 新增 5 条 STS 单测（policy 字符串化、请求体字段、凭证归一、缺 token、服务端错误透出），总计 13 条

## [1.0.0] - 2026-10-21

### Added
- `sign` / `call` 两个子命令，零依赖实现华为云 `SDK-HMAC-SHA256`
- 固化三个 401 陷阱：`x-sdk-date` 格式、CanonicalURI 结尾斜杠、STS security token 参与签名
- 8 条单测覆盖上述陷阱与签名结构性
