# Changelog

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
