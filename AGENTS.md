# hwc-sign — 项目规则（给 Agent 的最短上下文）

华为云 API 签名与调试 CLI。零运行时依赖，只用 Node 内置模块；把 SDK-HMAC-SHA256 签名和
三个最容易踩的 401 坑（`x-sdk-date` 格式、CanonicalURI 结尾斜杠、STS security token）固化下来。

## 怎么跑

```bash
npm test                        # node --test test/，唯一门禁
node bin/hwc-sign.mjs sign ...  # 本地安装时用这个路径，不要依赖全局 bin
```

Node ≥ 18（用到内置 `fetch`、`node:test`）。无 build 步骤，无 TypeScript，无 ESLint。

## 技术栈

纯 ESM（`.mjs`）· Node 内置 `crypto`（HMAC-SHA256）· `node:test` + `node:assert`。
不引入任何第三方依赖——这是项目卖点，加依赖需要用户同意。

## 目录与约定

| 路径 | 内容 |
|---|---|
| `bin/hwc-sign.mjs` | CLI 入口，只做参数解析与分发 |
| `lib/sign.mjs` | 签名算法本体（canonical request、HMAC） |
| `lib/sts.mjs` | AssumeAgency 换临时凭证 |
| `lib/commands.mjs` | 子命令实现 |
| `lib/curl.mjs` | 把签名结果渲染成可粘贴的 curl |
| `scripts/daily-feature.mjs` | 每日新功能生成 + 发版（Mac crontab 04:40 调，供华为云展览馆投稿用） |
| `scripts/feature-backlog.md` | 待实现功能清单，脚本自动补给 |
| `test/*.test.mjs` | 每个已踩过的坑都要有一条钉死它的用例 |

约定：

- 新增/修改签名行为 → **必须**同时加一条能复现原错误的单测，否则下次会改回旧写法。
- 日期一律传 `Date` 或 `YYYYMMDDTHHMMSSZ` 字符串，禁止 ISO 带 `-` `:`。
- 路径必须补成 `/` 结尾；临时凭证必须同时带 `x-security-token` 头并参与签名。
- 版本号在三处，改一个就要全改：`package.json`、`CHANGELOG.md`、annotated tag `vX.Y.Z`。
- README 只写用法，变更历史只写 `CHANGELOG.md`（不要在 README 维护第二份变更记录）。

## 当前状态

- v1.3.4（2026-10-22）：修 `daily-feature.mjs` 用 UTC 日期判断「今天是否已发版」导致空转的问题。
- `scripts/daily-feature.mjs` 由 Mac crontab 每日 04:40 / 06:40 / 09:40 触发，产出推送后
  由 NAS 侧 `gallery-daily.sh` 打包投稿华为云开发者作品展览馆（+200 分/天）。
- 依赖方（不要擅自改接口）：NAS `/vol1/docker/hwc-grow/repo/gallery-daily.sh` 按 tag 拉版本、
  打包 `README.md + resources/cover.png` 为 detail.zip。
- 未做：周任务相关功能、定时任务的失败告警（失败只写 `scripts/logs/`）。
