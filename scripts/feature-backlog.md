# hwc-sign 每日新功能清单

用途：`scripts/daily-feature.mjs` 每天取**第一条未完成**的条目，让模型按规格实现成
`lib/cmd/<slug>.mjs` + `test/<slug>.test.mjs`，测试全绿才提交并发版。
展览馆投稿只认「有新版本」，所以这份清单就是 +200/天 的燃料。

规则：
- 一条一个**真实可用**的小功能，能在 5 分钟内讲清楚怎么验证
- 只允许新增文件（可插拔子命令机制保证不用改分发逻辑）
- 完成后由脚本自动改成 `[x]`；清单空了脚本会告警，此时要么补条目、要么停投（不灌水）

## 待实现

- [ ] probe | `hwc-sign probe -u <url>` 发一次无签名 GET/HEAD，打印状态码、耗时毫秒、关键响应头（x-request-id / content-type / retry-after），用于判断 401 是网络还是签名问题
- [ ] env | `hwc-sign env` 打印当前生效的 AK/SK/Token 来源（命令行 / 环境变量 / --token-file 文件），SK 与 Token 只显示前 4 位加星号
- [ ] verify | `hwc-sign verify -u <url>` 本地重算一遍 canonical request 与 signature 并打印，便于和抓包结果逐行对账
- [ ] retry | `hwc-sign call -u <url> --retry 3 --retry-delay 800` 对 5xx 与网络错误按次数重试，最终结果与总耗时一起输出
- [ ] dryrun | `hwc-sign call -u <url> --dry-run` 只打印将要发出的方法、URL、请求头、body 字节数，不发任何网络请求
- [ ] failon | `hwc-sign call -u <url> --fail-on 2xx` 状态码不匹配时以退出码 3 结束，方便 shell 脚本判断
- [ ] pretty | `hwc-sign call -u <url> --pretty` 强制把响应体按 JSON pretty print，非 JSON 原样输出并给一行提示
- [ ] headers | `hwc-sign call -u <url> --show-headers` 把响应头全部打印（默认只看状态码和响应体）
- [ ] tokensexp | `hwc-sign env --check-token` 若凭证来自 --token-file，解析 expiration 并提示剩余秒数，剩余 < 60 秒时退出码 4
- [ ] stsrefresh | `hwc-sign sts --refresh-file creds.json` 凭证文件剩余有效期 < 60 秒时才重新换取，否则直接复用（幂等）
- [ ] canonical | `hwc-sign sign -u <url> --explain` 逐段打印 stringToSign 及每一段的来源说明，专门讲清「URI 必须以 / 结尾」这类坑
- [ ] urlcheck | `hwc-sign sign -u <url> --lint` 检查 URL 是否缺 query 编码、是否用了非 https、host 是否与签名 host 一致，列出风险项
