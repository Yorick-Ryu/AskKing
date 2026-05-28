# AskKing Codex iOS Approval Relay PRD

版本：MVP

## 1. 产品目标

AskKing 是一个 Codex 远程审批中继：

1. Codex 要执行需要用户批准的命令时，iPhone 收到通知。
2. 用户在 iOS App 或通知动作里选择允许或拒绝。
3. Codex hook 等待中继返回决策，并把结果交给 Codex。
4. Codex 当前任务完成时，iPhone 收到完成通知。
5. 用户可在完成通知或 App 内回复一条继续指令，让 Codex 在当前 Stop hook 等待窗口内继续执行。

一句话定位：

**Agents ask. You decide.**

中文说明：

**AskKing：Agent 来问，你来批。**

## 2. MVP 范围

### 2.1 必须实现

- Codex `PermissionRequest` hook 接入。
- iOS 收到审批通知。
- iOS App 内查看审批详情。
- iOS App 内允许或拒绝。
- Codex hook 等待审批结果，超时不自动允许。
- Codex `Stop` hook 接入。
- iOS 收到任务完成通知。
- 用户可对完成事件回复一条继续指令。
- Stop hook 在短等待窗口内收到回复时，把回复作为 continuation prompt 交回 Codex。
- iOS 客户端使用 Swift 和 SwiftUI。
- 后端中继支持局域网自部署和公网部署两种形态。

### 2.2 可以放入 MVP 后半段

- 通知快捷动作直接允许或拒绝。
- 通知文本输入动作直接回复继续指令。
- 多台 iOS 设备广播同一个请求。
- 高危命令进入 App 后二次确认。
- 最近事件列表和基础日志。

### 2.3 第一版不做

- Android 客户端。
- Web 管理后台。
- 多用户团队权限。
- Claude Code 或其他 agent 接入。
- 完整审计平台。
- 复杂规则引擎。
- 自动批准高危命令。
- 很久之后从 iOS 回复并自动恢复已结束的 Codex turn。

## 3. 系统组成

### 3.1 Codex Hook Adapter

运行在用户本机，由 Codex hooks 调用。

职责：

- 读取 Codex hook stdin payload。
- 识别 `PermissionRequest` 和 `Stop`。
- 将事件上报给中继。
- 对审批请求进行短轮询或长轮询。
- 输出 Codex 当前版本支持的 hook JSON。
- 失败时保守处理，不自动允许命令。

实现建议：

- 使用 Python 3。
- 首版尽量只用标准库，减少用户安装成本。
- 配置通过环境变量或本地配置文件读取。
- hook 输出格式必须以当前 Codex 官方 hooks 文档和本机版本实测为准。

### 3.2 Relay Service

中继服务是系统核心，不直接执行用户本机命令，只保存事件、转发通知、等待决策。

职责：

- 接收 Codex hook 事件。
- 创建审批请求和完成事件。
- 发送 APNs 通知。
- 接收 iOS 的允许、拒绝、继续回复。
- 给 Codex hook 提供等待结果的能力。
- 管理设备配对和 token。

### 3.3 iOS App

第一版唯一客户端，使用 Swift。

职责：

- 首次配对中继服务。
- 注册 APNs device token。
- 接收通知。
- 展示审批详情。
- 提交允许或拒绝。
- 展示完成事件。
- 提交继续指令。

## 4. 部署模式

AskKing 中继必须支持两种部署模式。

### 4.1 局域网自部署

中继运行在用户本机、局域网服务器、NAS 或 Mac mini 上。

典型链路：

1. Mac 上的 Codex hook 访问局域网中继。
2. 中继通过公网 APNs 向 iPhone 发通知。
3. iPhone 收到通知后，向局域网中继提交允许、拒绝或回复。
4. Codex hook 从中继取回结果。

前提条件：

- 中继机器必须能访问 Apple APNs。
- iPhone 必须能访问中继地址。
- 如果 iPhone 离开局域网，需要 VPN、Tailscale、ZeroTier 或其他内网穿透。
- iOS 正式环境建议使用 HTTPS。开发阶段可使用本地证书或临时 ATS 例外。

优点：

- 数据主要留在本地。
- 成本低。
- 适合个人使用和可信网络。

限制：

- iPhone 不在同一网络时，通知可能能收到，但通知动作无法把决策提交回中继。
- 本地 HTTPS 和证书信任会增加配置成本。
- 不适合没有 VPN 的远程审批场景。

### 4.2 公网部署

中继部署在公网 HTTPS 地址上，Codex hook 和 iOS App 都主动连接它。

典型链路：

1. Mac 上的 Codex hook 访问公网中继。
2. 公网中继通过 APNs 推送到 iPhone。
3. iOS App 或通知动作把决策提交到公网中继。
4. Codex hook 从公网中继取回结果。

优点：

- iPhone 在蜂窝网络或任意 Wi-Fi 下都可审批。
- HTTPS、证书和域名更标准。
- 更适合长期使用。

限制：

- 必须认真处理 token、过期、重放和日志脱敏。
- 事件元数据会经过公网服务。
- 部署和密钥管理比局域网模式复杂。

公网部署目标：

- Cloudflare Workers。
- AWS Lambda。

## 5. 技术栈建议

### 5.1 iOS

推荐：

- Swift。
- SwiftUI。
- 支持深色模式和浅色模式。
- 使用 Apple 系统视觉语言，优先采用 iOS 26 Liquid Glass 风格的原生控件、材质、圆角、模糊和分层效果。
- UserNotifications。
- URLSession。
- Keychain 保存 session token。
- APNs token-based remote notification。

通知能力：

- 审批通知：标题、项目名、命令摘要。
- 完成通知：标题、项目名、完成摘要。
- 快捷审批：`UNNotificationAction`。
- 快捷回复：`UNTextInputNotificationAction`。

实现顺序：

1. App 内审批和回复。
2. APNs 普通通知。
3. 通知快捷审批。
4. 通知文本输入回复。

### 5.2 Hook Adapter

推荐：

- Python 3 脚本。
- 使用 `urllib.request` 或极少量依赖。
- `PermissionRequest` 默认等待 5 到 10 分钟。
- `Stop` 默认等待 30 到 60 秒。
- 网络失败、超时、解析失败时，不自动允许。

为什么不用 Swift 或 Node 写 hook：

- Python 在 macOS 上更容易作为独立脚本运行。
- Codex hook 需要的是稳定、低依赖、易复制的本机脚本。
- iOS 客户端用 Swift，不代表本机 hook 也需要 Swift。

### 5.3 Relay Service

推荐主语言：

- TypeScript。

推荐 Web 框架：

- Hono。

理由：

- Hono 足够轻，不像 NestJS 那样重。
- 同一套路由和业务逻辑可适配 Node、本地服务、Cloudflare Workers、AWS Lambda。
- 适合小型中继服务。
- 比 FastAPI 更容易复用到 Cloudflare Workers。

不建议第一版使用：

- NestJS：功能完整，但对这个中继过重。
- FastAPI：本地和 AWS 可行，但 Cloudflare Workers 适配差。
- WebSocket：第一版没有必要，轮询足够。

### 5.4 存储

存储只需要支持短生命周期状态和少量历史记录。

本地自部署：

- SQLite。

Cloudflare Workers：

- D1 保存设备、客户端和历史事件。
- Durable Objects 或 KV 保存短期 pending 状态。
- 如果 APNs 直连或等待请求不稳定，需要做专项 POC。

AWS Lambda：

- DynamoDB 保存设备、客户端、审批请求和完成事件。
- TTL 自动清理过期请求。
- Lambda 内可使用 Node.js `http2` 或成熟 APNs 库发送推送。

抽象要求：

- Relay 代码应把存储封装为接口。
- 业务逻辑不直接绑定 SQLite、D1 或 DynamoDB。
- 第一版可以只实现 SQLite 和一个公网存储，另一个公网存储作为后续适配。

### 5.5 APNs

推荐：

- 使用 APNs token-based authentication。
- 不把 Apple 私钥写入客户端。
- APNs 私钥只放在中继部署环境。

风险：

- APNs Provider API 要求 HTTP/2。
- AWS Lambda 的 Node.js 环境更适合直接使用 HTTP/2 或现成 APNs 库。
- Cloudflare Workers 能否稳定直接调用 APNs，需要先做最小 POC。若 POC 不通过，Cloudflare 方案需要改为调用一个专门的 APNs sender，或优先使用 AWS Lambda。

### 5.6 轮询策略

第一版使用轮询，不引入 WebSocket。

审批等待：

- Hook 创建审批请求后，每 1 到 2 秒查询一次。
- 总等待时间默认 5 到 10 分钟。
- 用户允许或拒绝后立即返回。
- 超时后返回保守结果。

完成后继续：

- Stop hook 上报完成事件后，短暂等待 30 到 60 秒。
- 如果用户在窗口内回复，hook 把回复交回 Codex 继续。
- 如果用户未回复，hook 正常结束。
- 超出窗口的回复不保证能继续当前 turn，后续版本再处理队列化和恢复。

## 6. 核心状态

### 6.1 ApprovalRequest

状态：

- `pending`：等待用户决策。
- `allowed`：用户允许。
- `denied`：用户拒绝。
- `expired`：等待超时。

必要字段：

- request id。
- client id。
- event id 或 turn id。
- 项目名。
- 工作目录。
- 命令或工具摘要。
- 风险摘要。
- 创建时间。
- 过期时间。
- 决策时间。
- 决策来源。

### 6.2 CompletionEvent

状态：

- `notified`：已通知。
- `waiting_reply`：Stop hook 正在等待回复。
- `replied`：用户已回复。
- `expired`：等待窗口结束。

必要字段：

- completion id。
- client id。
- event id 或 turn id。
- 项目名。
- 工作目录。
- 完成摘要。
- 创建时间。
- 回复内容。
- 回复时间。

### 6.3 Device

必要字段：

- device id。
- APNs device token。
- 设备名。
- session token hash。
- 创建时间。
- 最近活跃时间。
- 是否启用。

### 6.4 CodexClient

必要字段：

- client id。
- client token hash。
- 显示名称。
- 默认项目名。
- 创建时间。
- 最近活跃时间。
- 是否启用。

## 7. 用户流程

### 7.1 首次配对

1. 用户部署中继。
2. 中继生成短期 pairing code 或 QR code。
3. iOS App 输入或扫描 pairing code。
4. iOS App 注册 APNs device token。
5. 中继返回 iOS session token。
6. iOS App 显示连接状态。
7. 用户在 Codex 本机配置 hook adapter 的中继地址和 client token。

### 7.2 命令审批

1. Codex 即将执行需要审批的命令。
2. Codex 触发 `PermissionRequest` hook。
3. Hook adapter 上报审批请求。
4. Relay 创建 `ApprovalRequest`。
5. Relay 发送 APNs 通知。
6. 用户打开 App 查看详情。
7. 用户点击允许或拒绝。
8. iOS App 提交决策。
9. Hook adapter 取回决策。
10. Hook adapter 输出 Codex hook JSON。
11. Codex 继续执行或拒绝执行。

### 7.3 完成通知

1. Codex 当前 turn 结束。
2. Codex 触发 `Stop` hook。
3. Hook adapter 上报完成事件。
4. Relay 发送 APNs 通知。
5. Hook adapter 进入短等待窗口。
6. 用户可以忽略通知，Codex 正常结束。
7. 用户也可以回复继续指令。
8. Relay 保存回复。
9. Hook adapter 在等待窗口内拿到回复。
10. Hook adapter 请求 Codex 用该回复继续。

## 8. iOS 产品需求

### 8.1 视觉与交互原则

界面可参考“消息推送助手”这类工具型 App 的信息结构，但必须去掉与 AskKing 无关的模板功能。

设计原则：

- 使用 SwiftUI 原生组件和 Apple Human Interface Guidelines 风格。
- 支持深色模式和浅色模式，颜色、材质、阴影、分隔线都需要适配系统主题。
- 默认跟随系统外观，同时在设置中提供浅色、深色、跟随系统三个选项。
- 使用 Liquid Glass 风格：底部浮动 tab、半透明材质、柔和圆角、清晰层级、轻量动效。
- 页面以工具效率为主，不做营销页、不做大面积装饰图。
- 文案简洁，围绕 Codex 审批、完成通知、连接状态。
- 命令、路径、模型等信息以可扫读的字段形式展示。
- 高风险操作按钮要有明确颜色区分，允许使用蓝色或绿色，拒绝使用红色。

### 8.2 信息架构

底部三栏：

- `消息`：审批请求、完成事件、最近决策。
- `连接`：当前 Relay 连接、部署模式、配对信息、健康检查。
- `设置`：设备信息、外观、通知权限、关于。

不需要的模板功能：

- 不做“自定义文字”。
- 不做“自定义标题 + 文字”。
- 不做“自定义标题 + 副标题 + 文字”。
- 不做“自定义链接”。
- 不做“自定义角标”。
- 不做“自定义图片”。
- 不做“自定义图标”。
- 不做“自动复制”。
- 不做“自定义提示音”。
- 不做“承诺函”。
- 不做“推荐给朋友”。
- 不做“给应用评分”。
- 不做“更多好应用”。
- 不做“用户交流群”。

### 8.3 页面

消息页：

- 顶部标题：`AskKing` 或 `消息`。
- 搜索入口：按项目名、命令摘要、状态搜索。
- 列表卡片展示审批请求和完成事件。
- 卡片主标题：`Codex 需要批准`、`Codex 已完成`。
- 卡片字段：时间、项目、模型、状态。
- 待审批事件有明显未读点或状态标记。
- 底部 tab 显示未处理审批数量，不显示无意义的总消息数。

连接页：

- 显示当前中继地址。
- 显示连接状态。
- 显示部署模式：局域网或公网。
- 显示最近一次心跳时间。
- 支持复制 hook 配置摘要。
- 支持测试连接。
- 支持重新配对。

设置页：

- 设备信息。
- 外观设置。
- 通知权限状态。
- 清理本地缓存。
- 退出配对。
- 关于 AskKing。

审批详情页：

- 项目名。
- 工作目录。
- 命令或工具摘要。
- 请求原因。
- 风险提示。
- 创建时间。
- 过期倒计时。
- 允许按钮。
- 拒绝按钮。

完成详情页：

- 项目名。
- 完成摘要。
- 创建时间。
- 回复输入框。
- 发送继续指令按钮。

### 8.4 通知

审批通知：

- 标题：`Codex 需要批准`。
- 副标题：项目名。
- 正文：命令摘要。
- 动作：打开详情。
- 后续动作：允许、拒绝。

完成通知：

- 标题：`Codex 已完成`。
- 副标题：项目名。
- 正文：完成摘要。
- 动作：打开详情。
- 后续动作：回复。

通知正文原则：

- 不展示完整敏感命令。
- 不展示 token、API key、密码。
- 长命令只展示摘要，完整内容进入 App 后查看。

## 9. 安全要求

通用要求：

- 公网部署必须使用 HTTPS。
- 局域网正式使用也应支持 HTTPS。
- Codex client token 和 iOS session token 分离。
- Pairing code 短期有效，使用后失效。
- 审批请求必须有过期时间。
- 超时不得自动允许。
- 决策提交必须幂等。
- 重复决策只接受第一次有效提交。
- 日志必须脱敏 token、密码和 API key。
- iOS token 存入 Keychain。
- 中继支持撤销设备和撤销 Codex client。

公网部署额外要求：

- 所有写入请求必须认证。
- 关键请求带时间戳或 nonce，降低重放风险。
- 后端不要把完整 raw payload 长期保存。
- APNs 私钥只保存在服务端 secret storage。

高危命令策略：

- 第一版不做自动风险引擎。
- 可以用简单关键词标记高危命令。
- 高危请求不在通知正文展示完整命令。
- 高危请求建议只允许 App 内确认，不在锁屏快捷允许。

## 10. 验收标准

命令审批：

- Codex 触发审批后，iPhone 在 5 秒内收到通知。
- 用户在 App 内允许后，Codex 继续执行原命令。
- 用户在 App 内拒绝后，Codex 不执行原命令。
- 审批超时后，Codex 不会自动允许。
- client token 错误时，中继拒绝请求。

完成通知：

- Codex `Stop` 触发后，iPhone 在 5 秒内收到完成通知。
- 用户不回复时，Codex 正常结束。
- 用户在等待窗口内回复时，Codex 收到该回复并继续。
- 超出等待窗口的回复不会被误认为当前 turn 的继续指令。

部署：

- 同一套产品能力可在局域网自部署模式下跑通。
- 公网模式至少跑通 AWS Lambda 或 Cloudflare Workers 之一。
- 另一个公网平台保留清晰的部署适配路径。

iOS：

- App 可完成配对。
- App 可注册 APNs token。
- App 可查看审批详情。
- App 可提交允许或拒绝。
- App 可查看完成事件并回复。
- App 支持深色、浅色和跟随系统外观。
- App 主要页面符合 Liquid Glass 风格，不出现无关模板功能入口。

## 11. 推荐开发顺序

1. 本地 Relay MVP：TypeScript + Hono + SQLite。
2. Codex hook adapter：先接 `PermissionRequest`，用本地 Relay 和 curl 模拟 iOS 决策。
3. iOS App 配对和基础页面：SwiftUI + URLSession。
4. APNs 普通推送：完成设备注册和通知发送。
5. 命令审批闭环：Codex -> Relay -> iOS -> Relay -> Codex。
6. Stop 完成通知：先只通知，不继续。
7. Stop 短窗口回复：iOS 回复 -> Relay -> Codex continuation。
8. 公网部署适配：优先 AWS Lambda，随后验证 Cloudflare Workers。
9. 通知快捷动作：允许、拒绝、文本回复。
10. 安全加固：token 撤销、日志脱敏、高危请求二次确认。

## 12. 技术风险

- Codex hooks 的输入和输出格式会随 Codex 版本演进，必须以当前版本实测为准。
- Stop continuation 只适合短等待窗口，不等同于任意时间恢复任务。
- iOS 通知动作在锁屏、低电量、后台状态下的行为需要真机测试。
- 局域网部署的 iPhone 可达性依赖网络环境。
- Cloudflare Workers 直接发送 APNs 需要先验证 HTTP/2 兼容性和运行时限制。
- Serverless 环境不适合长时间阻塞，第一版应使用短轮询。

## 13. 参考依据

- OpenAI Codex hooks 官方文档：https://developers.openai.com/codex/hooks
- Apple `UNNotificationAction`：https://developer.apple.com/documentation/usernotifications/unnotificationaction
- Apple `UNTextInputNotificationAction`：https://developer.apple.com/documentation/usernotifications/untextinputnotificationaction
- Apple APNs Provider API：https://developer.apple.com/documentation/usernotifications/setting_up_a_remote_notification_server/sending_notification_requests_to_apns
- Cloudflare Workers：https://developers.cloudflare.com/workers/
- AWS Lambda Node.js：https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html
