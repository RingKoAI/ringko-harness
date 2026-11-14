# Claude Code 与 RingKo 命令对照

核对日期：2026-11-10。Claude Code 本机版本：`2.1.316`，实际执行了
`claude --version`、`claude --help`；同时核对官方 CLI、交互模式和命令文档。
官方在线文档会变化，部分功能依赖平台、账户、订阅和功能开关。
RingKo 以当前工作区源码为准，不代表已经发布的 npm 版本。

## 结论

RingKo 已覆盖基本对话、模型切换、权限、上下文压缩、会话恢复、MCP、技能、插件及任务查看。
主要差距不是菜单数量，而是脚本接口、会话操作入口和终端运行期间的交互。
同名命令不一定同义，不能只加别名后声称兼容。

## 命令行

| 使用目标 | Claude Code | RingKo 当前实现 |
| --- | --- | --- |
| 交互终端 | `claude` | `ringko` / `ringko tui` |
| 初始提示词 | `claude "任务"` | 尚无对应入口；进入终端后发送，或使用 `run` |
| 单次执行 | `claude -p "任务"` | `ringko run "任务"`；目前不支持 `-p` |
| 标准输入管道 | `cat file \| claude -p "任务"` | `run` 未实现 stdin 合并 |
| 机器可读结果 | `--output-format json/stream-json` | `run` 只有文本结果，运行诊断写 stderr |
| 最近会话 | `-c` / `--continue` | `-c` / `--continue` / `--resume` |
| 指定会话 | `-r` / `--resume <ID或名称>` | `-s <ID>` / `--session <ID>`；无参数打开选择器 |
| 模型 | `--model` | `--model` 与 `--provider` |
| 单次思考档位 | `--effort` | 配置 `thinking` 或交互 `/effort`，无对应 CLI 参数 |
| 单次回合上限 | `--max-turns` | 配置 `maxTurns`，无对应 CLI 参数 |
| 配置文件 | `--settings`，可覆盖合并 | `--config`，独立文件，不与用户文件合并 |
| 权限 | `--permission-mode` | 配置 `permission`；枚举与行为不同 |
| 补充工具目录 | `--add-dir` | 配置 `sandbox.additionalWritableRoots`；并非同等语义 |
| 单次系统指令 | `--system-prompt` / `--append-system-prompt` | SDK 支持指令；CLI 未暴露同类参数 |
| 认证 | `auth login/logout/status` | 同类命令，另有 `auth set/default` 和多提供商 |
| MCP 管理 | `mcp` 及子命令 | `mcp` / `mcp set/remove`；完整管理也可在 Web 设置中进行 |
| 插件 | `plugin` / `plugins` | `plugins` / `plugins trust/untrust`；没有相同市场安装机制 |
| 版本更新 | `update` | `update` / `update --check` |
| 安装诊断 | `doctor` | 尚无独立诊断命令；交互 Settings 的 Status 有诊断信息 |
| 会话列表 | 恢复选择器、后台 agent 管理 | `session list`，指定 `--workspace` 可过滤 |
| 后台会话管理 | `agents` / `attach` / `logs` / `stop` 等 | 共享后端与任务能力已有，但没有同等 shell 命令集 |
| 本地网页 | 远程控制、桌面和云端是不同入口 | `web` 按需开放网页，复用共享后端 |
| 后端生命周期 | Claude 的 supervisor 机制 | CLI/Web 进程租约，最后一个前端离开且任务收尾后自动关闭 |
| 常驻后台 | `daemon` 管理 | `service start/status/stop`；`start` 显式常驻 |
| Git 隔离 | `--worktree` | 未提供对应 CLI 功能 |

## 交互斜杠命令

| 目标 | Claude Code | RingKo 当前实现与差异 |
| --- | --- | --- |
| 帮助 | `/help` | `/help`，别名 `/?` |
| 设置 | `/config`，别名 `/settings` | `/config`；无 `/settings` 别名、无内联 `key=value` |
| 状态 | `/status` 默认 Status 页 | `/status` 按现有产品要求默认 Stats 概览，可切 Status |
| 使用量 | `/usage`、`/cost`、`/stats` | `/usage` 与 `/stats`；不伪造订阅余额或账单 |
| 模型 | `/model [model]` | `/model [model]` |
| 思考 | `/effort` | `/effort off/low/high/max`，档位集合不同 |
| 思考显示 | 模型、显示设置相关 | `/thinking on/off`，控制显示，不等于思考预算 |
| 新会话 | `/clear`，别名 `/new`、`/reset` | **`/new` 新会话；`/clear` 仅清当前显示，不重置上下文** |
| 恢复 | `/resume [ID或名称]` | `/resume` 打开选择器；当前参数不会用于精确恢复 |
| 重命名 | `/rename [name]` | 会话选择器 `Ctrl+R`，尚无斜杠入口 |
| 分叉 | `/branch`、`/fork`，各有不同生命周期 | 会话选择器 `Ctrl+F` / Web 分叉；没有同等斜杠命令 |
| 压缩 | `/compact [instructions]` | `/compact [instructions]` |
| 上下文明细 | `/context` | Web 上下文信息与终端状态；无独立 `/context` 命令 |
| 权限 | `/permissions` | `/permissions` 选择只读、默认、完全访问；`/permissions rules` 管理规则。切换当前仍为配置级；Shell 保留审批，不宣称同等网络隔离。 |
| 任务 | `/tasks` 管理当前后台工作 | `/agents` 切主/子代理视图，`/todos` 查看计划；不是同一个菜单 |
| 子代理配置 | `/agents` | `ringko subagents` 列出 provider；与 `/agents` 查看任务不同 |
| 技能 | `/skills` | `/skills` 浏览，`/skill add <path>` 本地安装 |
| MCP | `/mcp` 与连接管理子命令 | `/mcp` 浏览配置和连接状态；无同等 reconnect 参数 |
| 登录 | `/login`、`/logout` | `/login [provider]`、`/connect`；退出登录使用 CLI `auth logout` |
| 循环 | `/loop [interval] [prompt]` 调度型循环 | `/loop <prompt> --max-iterations N --completion-promise TEXT` 连续迭代，**非定时器** |
| 停止循环 | 任务相关控制 | `/cancel-loop`，别名 `/stop-loop` |
| Shell | `!command`；可自动让模型响应 | `!command` 直接执行，不自动调用模型；共享会话记录输出供后续上下文使用 |
| 退出 | `/exit`、`/quit` | `/exit`、`/quit`、`/q` |
| 代码回滚 | `/rewind` / `/undo` | 未提供同等文件检查点回滚；会话分叉不能替代代码回滚 |
| 其他工具 | `/copy`、`/export`、`/diff`、`/memory`、`/init` | 部分底层能力存在，缺少对应统一命令入口 |

RingKo 额外入口：`/workspace`、`/session`、`/tools`、`/shortcuts`（`/keys`）。
受信任插件还可提供提示词命令，不能覆盖内置命令。

## 快捷键和队列差异

- RingKo `Ctrl+L` 选模型，Claude Code `Ctrl+L` 重绘屏幕。
- RingKo `Shift+Tab` 切思考档位，Claude Code 切权限模式。
- RingKo `Ctrl+R` 会话选择器，Claude Code 反向搜索输入历史。
- RingKo `Ctrl+G` 主/子代理视图，Claude Code 外部编辑器。
- RingKo `Ctrl+T` 切思考显示，Claude Code 切任务清单。
- RingKo `Ctrl+X` 复制最后回答；Claude Code 有多键组合。
- RingKo Web 已有 FIFO 消息队列、逐条直接发送、失败保留；终端尚无等价队列。
- Claude Code 的队列可在工具边界注入，直接发送有时将工作转入后台；RingKo Web 当前
  “直接发送”会停止当前回合，等待结束，再发选中的消息。两者不能宣称语义一致。

## 本次已修复

1. `run --help`、`web --help`、`auth login --help` 等优先显示帮助，不执行命令或生成配置。
2. `run -- ...` 后的参数按提示词原文保留，不误识别成模型或配置选项。
3. `info` 读取真实配置的权限模式，不再固定输出默认 approval。
4. `session list --workspace` 使用指定工作区；未知 session 子命令不再静默列出会话。
5. `models --config` 只读取、更新指定文件；保留自定义字段，不写用户配置。
6. 循环次数拒绝超出 JavaScript 安全整数范围的值。
7. 帮助说明补齐 OAuth 提供商，并纠正 shell 输出不进入模型上下文的旧描述。

## 建议实现顺序

1. **脚本入口**：`-p/--print`、stdin、`--output-format text/json/stream-json`，定义退出码和错误输出契约。
2. **会话入口**：`/resume <ID>`、`/rename`、`/branch`，复用现有后端能力；明确是否支持名称匹配。
3. **终端队列**：运行时排队、编辑、直接发送，保留草稿和任务状态，与 Web 行为一致。
4. **诊断入口**：`doctor`、`/context`，报告真实状态，不制造检查成功。
5. **高级功能**：worktree、文件检查点回滚、动态工具策略，分别设计权限及持久化契约。

`--resume` 在 RingKo 已有“恢复最近会话”语义；`/clear` 已有“清屏”语义。
直接替换成 Claude Code 的含义会破坏现有使用方式，需单独决定兼容迁移方案。

## 来源

- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/commands
- https://code.claude.com/docs/en/interactive-mode
- 本机 `claude --help`，版本 `2.1.316`
- `packages/tui/src/cli.ts`、`packages/tui/src/cli/commands/`
- `packages/repl/src/commands.ts`、`packages/repl/src/keybindings.ts`、`packages/repl/src/app.tsx`
