# 配置

RingKo 的用户级配置放在两个根目录下：

| 路径 | 内容 |
| --- | --- |
| `~/.ringko/settings.local.json` | 工作区、权限、沙盒、能力开关、思考档位、压缩、工作流 |
| `~/.ringko/provider.json` | 供应商、模型、当前模型与辅助模型 |
| `~/.ringko/auth/auth.json` | 供应商凭证，POSIX 上写入权限为 0600 |
| `~/.ringko/tool.auth.json` | MCP 与连接器凭证，POSIX 上写入权限为 0600 |
| `~/.ringko/.mcp.json` | RingKo 自己的 MCP server |
| `~/.agents/.mcp.json` | 与其他 agent 工具共享的 MCP server |
| `~/.ringko/sessions/` | 事件溯源会话日志 |

`RINGKO_HOME` 会替换 `.ringko` 所在的用户主目录，`AGENTS_HOME` 对 `.agents`
做同样的事。显式传入的 `--config <path>` 按原样读取，不与用户级文件合并。

查看和修改配置：

```sh
ringko config show
ringko config path
ringko config get permission
ringko config set permission assist
ringko config unset workflow
ringko info
```

`ringko config set` 写入用户级设置文件。凭证应放在 `~/.ringko/auth/`，不要写进
`settings.local.json`。

## 首次启动

首次启动终端 UI、Web 后端或其他有效的配置/运行命令时，RingKo 会自动创建缺失的
`settings.local.json` 和 `provider.json`。只缺一个文件时只创建那一个；已有文件
（包括空占位文件）按原样保留，不回填或覆盖用户字段。省略的扫描字段使用下文的运行时
默认值。损坏的 JSON、不可读文件或目录占用配置路径会报错，需修复后重试。

创建使用完整临时文件和排他发布，并发启动不会覆盖先完成的文件。新文件在 POSIX 上为
`0600`，新建的配置目录为 `0700`。帮助、版本和未知命令不会生成这两份配置；指定
`--config <path>` 时也不会创建用户级配置，`config show/path/set/unset` 均操作指定文件。
SDK 的纯读取函数 `loadConfig()` 不会自行生成文件。

默认供应商文件为：

```json
{ "model": "", "small_model": "", "providers": [] }
```

它不会生成 API key 或选择远程模型；配置供应商前保留原有的离线 echo 行为。默认设置
包含更新检查、权限、沙盒、能力开关、思考/显示、回合上限、压缩、插件信任、子代理和指令
扫描参数，不固定启动目录为工作区。其中网络和 shell 能力默认关闭。下方设置示例演示了
如何显式开启它们。

## settings.local.json

```json
{
  "workspace": "/path/to/project",
  "permission": "approval",
  "sandbox": {
    "mode": "workspace-write",
    "additionalWritableRoots": []
  },
  "capabilities": {
    "network": true,
    "shell": true,
    "privateNetwork": false,
    "websearchProvider": "exa"
  },
  "thinking": "high",
  "maxTurns": 50,
  "compaction": {
    "enabled": true,
    "ratio": 0.8,
    "keepRecent": 6,
    "margin": 2000
  }
}
```

| 键 | 含义 |
| --- | --- |
| `permission` | `approval`、`assist` 或 `full`，默认 `approval`。`mode` 是旧别名。 |
| `sandbox.mode` | `read-only`、`workspace-write` 或 `danger-full-access`，默认 `workspace-write`。 |
| `sandbox.additionalWritableRoots` | `workspace-write` 下额外可写的目录；相对路径从工作区解析。 |
| `capabilities.network` | 注册 `webfetch` 与 `websearch`。不写则这两个工具不存在。 |
| `capabilities.shell` | 注册 `shell`。不写则不存在。 |
| `capabilities.privateNetwork` | 允许 `webfetch` 访问本地或私有地址，默认关闭。 |
| `capabilities.websearchProvider` | `exa`（默认）或 `parallel`。密钥来自 `EXA_API_KEY` 或 `PARALLEL_API_KEY`。 |
| `thinking` | `off`、`low`、`high` 或 `max`，映射到当前供应商自己的字段。 |
| `maxTurns` | 每次运行的工具回合上限，默认 50。 |
| `compaction` | 自动上下文压缩。默认在窗口 80% 时触发，保留最近六条消息。 |
| `workflow` | 当前工作流 id，来自 `~/.ringko/workflows.json`。 |
| `subagents` | 委派 provider 注册表：`default`、`maxActive`、`maxPerRun`、`providers`。见[子代理](subagents.zh-CN.md)。 |
| `updates.checkOnStartup` | 启动时检查 CLI 最新稳定版，默认 `true`。 |
| `updates.autoUpdate` | 启动检测发现新版本后自动安装，默认 `false`。 |
| `instructionScan` | 指令文件的递归范围、排除目录及资源上限，见下文。 |

## 指令扫描

以下是首次生成的 `instructionScan` 默认值；旧设置文件不必改写也会使用这些默认值：

```json
{
  "instructionScan": {
    "recursive": true,
    "excludeDirectories": [".git", ".hg", ".svn", "node_modules", "dist", "build", "coverage", ".next", "target", "vendor", "venv", "__pycache__", "bower_components"],
    "excludeNestedRepositories": true,
    "maxDepth": 12,
    "maxDirectories": 4096
  }
}
```

- 递归扫描只补充工作区下的 `AGENTS.md`；全局指令和从工作区向上的
  `AGENTS.md` / `CLAUDE.md` 查找优先级保持原有规则。关闭 `recursive` 不会关闭这些指令。
- `excludeNestedRepositories` 默认跳过子目录中的独立仓库，包括 `.git` 目录、Git worktree
  的 `.git` 文件，以及 `.hg` / `.svn` 标记。当前选定的工作区本身不会被跳过，普通子目录
  仍递归加载。若需要纳入嵌套仓库，可将此项设为 `false`。
- `excludeDirectories` 中的单个目录名匹配任意层级；含 `/` 或 `\\` 的路径从工作区根目录
  匹配。例如 `Example` 排除工作区内所有同名目录，`Example/reference` 只排除该相对路径。
  不支持 glob、绝对路径或 `..`。自定义数组**替换**默认排除表；空数组清空这张表。
  点开头的目录和目录符号链接始终不遍历；不读取 `.gitignore`。
- 工作区深度为 `0`，`maxDepth` 可设 `0–64`；`maxDirectories` 可设 `1–65536`，包含工作区
  根目录。排除的目录和嵌套仓库不计入预算。达到深度边界即停止向下扫描；超过目录预算则
  报错，不会悄悄忽略指令后继续请求模型。
- 无效扫描字段会逐项回退，并写入诊断日志；运行宿主提供通知时也会显示提示。每个文件
  `256 KiB`、合计 `1 MiB`、最多 `64` 份指令的预算不受这些设置影响。

扫描范围过宽时，优先选择实际项目作为工作区，或在排除数组中保留所需默认项并添加
`Example` 等参考目录。新版后端会在下一次运行读取保存后的设置；更新程序代码后须重启
已有共享后端，旧进程不会自动加载新代码。

## 版本更新

```json
{
  "updates": { "checkOnStartup": true, "autoUpdate": false }
}
```

```sh
ringko update --check
ringko update
ringko config set updates.checkOnStartup false
ringko config set updates.autoUpdate true
```

启动检测适用于终端 UI、`web`、`run`、`loop` 和 `service start`；帮助、版本、配置命令
及后台服务进程不会检测。关闭 `checkOnStartup` 也会关闭启动时自动安装，手动 `update`
仍可使用。支持显式 `--config`。无效配置会提示并回退到上述默认值；检测最多等待 5 秒，
检测或安装失败会报告原因，随后继续原命令。

以 npm registry 的 `latest` 为稳定版来源，不自动安装预发布版或降级。全局 npm 安装更新
其所属的全局目录；本地/npx 安装需通过原包管理器更新，源码运行需拉取代码并重新构建。
独立版下载对应平台的官方 GitHub Release，验证 SHA-256 与可执行文件版本，并在替换
程序和 WebUI 失败时回滚。安装目录需要可写，更新器不会提权。启动时成功安装会结束本次
启动，请重新启动 RingKo 及共享后端以使用新版本。Windows 上仍在使用的旧可执行文件
可能暂时无法清理，程序会报告其路径，退出后即可删除。

项目级文件也可以带 `mcpServers`；查找顺序见 [MCP server](mcp.zh-CN.md)。

## 访问模式

### 三档权限预设

终端 `/permissions`（或 `/permission`）和网页输入区的权限菜单使用相同预设：

| 预设 | 审批策略 | 沙盒 |
| --- | --- | --- |
| 只读 `read-only` | `approval` | `read-only` |
| 默认 `default` | `approval` | `workspace-write` |
| 完全访问 `full-access` | `full` | `danger-full-access` |

切换时审批与沙盒在一次配置替换中同时保存。完全访问需要明确确认；终端 Config 页切入
完全访问时按 `Y` 确认，Esc 取消。`/permissions read-only` 等命令也可直接选择，
`/permissions rules` 保留原来的规则查看、移除入口。Shift+Tab 仍切思考档位。

配置中保存 `permissionPreset`、`permission` 和 `sandbox.mode`；界面根据实际后两项
推导有效预设。手工修改导致组合不匹配时显示「自定义权限」，不会仅凭旧预设名称放宽限制。
现有旧配置保持原义，特别是单独的 `permission: full` 不会自动解除沙盒。

只读档中的 write/edit 必须逐次审批，授权只适用于当次风险评估的规范化目标；保存的 allow
规则不能代替这次授权。默认档的工作区内写入无需普通审批，外部文件需要逐次审批。
Shell 在需要更宽范围时可请求 `sandbox_permissions: "workspace-write"` 或
`"danger-full-access"`，批准后仅这条命令使用更宽沙盒，活动模式不变。

切换沿用现有**配置级**作用域，影响共享此配置的后续运行，不会追溯修改已启动的执行。
服务端会拒绝在活跃运行、上传或交互终端期间切换，并重建 MCP 连接，避免沿用旧模式进程。
显式 `--config` 只更新指定文件；否则更新用户设置，而非单个会话的临时覆盖。

权限预设不会启用已被宿主关闭的 shell/network 能力，也不会删除显式 deny/ask 规则或
额外可写目录设置。网络工具仍经过审批；当前进程沙盒未隔离网络，因此默认档仍要求 Shell
命令审批，不宣称具有 Codex 的「任意命令免审批且网络受隔离」能力。

### 兼容的底层审批策略

| 模式 | 行为 |
| --- | --- |
| `approval` | 外部文件、网络访问和 shell 命令都会询问；工作区读取放行。 |
| `assist` | 只在风险评估为 medium 或更高时询问。 |
| `full` | 不询问。Web UI 切换到该模式前需要二次确认。 |

访问模式与沙盒相互独立。沙盒放宽不会关闭审批门，`full` 访问模式本身也不会扩大
沙盒范围。

## 沙盒

`read-only` 禁止持久写入；`workspace-write` 允许工作区与
`additionalWritableRoots`；`danger-full-access` 取消这些限制。平台 runner 不可用
时失败关闭，不会退回无约束的 shell。平台细节与剩余边界见[沙盒说明](../SANDBOX.md)。

远程 MCP server 即使沙盒可写也需要单独的宿主授权；见
[MCP 授权](mcp.zh-CN.md#授权)。授权写在同一个设置文件里：

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "mcp": {
      "docs": {
        "url": "https://mcp.example.com/mcp",
        "readOnlyTools": ["search"],
        "allowedTools": ["create_page"]
      }
    }
  }
}
```

## 供应商

供应商与模型选择放在 `~/.ringko/provider.json`；字段、凭证查找、思考字段和模型
元数据见[供应商](providers.zh-CN.md)。当前模型写成
`"<供应商 name>/<模型 id>"`，例如：

```json
{
  "model": "DeepSeek/deepseek-chat",
  "small_model": "DeepSeek/deepseek-chat",
  "providers": []
}
```

配置 `small_model` 后，压缩和会话元数据会使用它。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `RINGKO_HOME` | 包含 `.ringko` 的主目录。 |
| `AGENTS_HOME` | 包含 `.agents` 的主目录。 |
| `RINGKO_SERVER` | 指定后端地址，替代自动发现的本机服务。 |
| `RINGKO_WEB_TOKEN` | Web UI 与终端客户端连接后端时共用的令牌。 |
| `RINGKO_MODELS_URL` | 兼容 Models.dev 的目录或镜像地址；除回环外要求 HTTPS。 |
| `RINGKO_GIT_BASH_PATH` | Windows 终端与完全访问 shell 使用的 Git Bash 路径。 |
| `EXA_API_KEY` / `PARALLEL_API_KEY` | Web 搜索凭证。 |

不要把令牌或 API key 写进项目文件或提交进仓库。后端会比较 Web UI 令牌；凭证应放在
请求头，不要放在 URL 中。
