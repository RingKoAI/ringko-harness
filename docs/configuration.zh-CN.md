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

项目级文件也可以带 `mcpServers`；查找顺序见 [MCP server](mcp.zh-CN.md)。

## 访问模式

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
