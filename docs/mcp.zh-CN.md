# MCP server

RingKo 通过 stdio、Streamable HTTP 或旧版 SSE 连接 MCP server，并把它的工具与内置
工具注册在一起。MCP 工具和其他工具一样经过风险评估与审批门。

配置在后端启动时读取。修改前请停止活跃会话；Web UI 在会话运行期间会拒绝保存，手工
修改文件后需要重启后端。

## 配置文件

| 作用域 | 文件 |
| --- | --- |
| 项目 | `<project>/.mcp.json` |
| 项目 | `<project>/ringko.json`（`mcpServers` 字段） |
| 用户 | `~/.ringko/.mcp.json` |
| 共享 | `~/.agents/.mcp.json` |

项目根目录是最近的、包含 `.git`、`.mcp.json`、`ringko.json` 或 `.agents` 的祖先
目录。文件按上表顺序合并，同名 server 以第一次定义为准。文件缺失或为空会跳过；JSON
无效、`mcpServers` 不是对象、server 定义不是对象都会报错，不会静默忽略。

每个文件的格式相同：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/workspace"]
    },
    "docs": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "X-API-Key": "replace-me" }
    },
    "legacy": {
      "type": "sse",
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

## 传输方式

### stdio

`command` 非空的 server 使用 stdio。`args` 是数组，`env` 是字符串键值对象，`cwd`
默认是工作区。`env` 会合并到进程环境中。值按字面传入，不执行 shell 展开。

子进程在当前的沙盒策略内运行。`read-only` 模式下不能写入；`workspace-write` 模式
只能在沙盒允许的范围内写入。

### Streamable HTTP

有 `url` 且没有 `type`（或 `type: "http"`）时使用 Streamable HTTP。`headers` 是
字符串键值对象，会覆盖已存储的连接器凭证。URL 必须是 HTTP(S)。

### SSE

设置 `type: "sse"` 使用旧的 HTTP+SSE 传输，其余配置与 Streamable HTTP 相同。

## 管理 server

```sh
ringko mcp                                  # 列出已配置的 server
ringko mcp set docs '{"type":"http","url":"https://mcp.example.com/mcp"}'
ringko mcp remove docs
```

`ringko mcp set` 与 `ringko mcp remove` 修改 `~/.ringko/.mcp.json`。`ringko mcp`
打印名称、来源（`project`、`ringko` 或 `agents`）和传输方式。

Web UI 中打开 **设置 → 连接器**。页面分别编辑项目级和全局 server，可以测试连接，
并显示已连接的 server 及其工具数量。保存会更新配置文件并重置该工作区的 MCP 连接。

## 授权

本地 stdio server 继承沙盒，不需要单独授权。

远程 server 只有满足以下条件之一才会暴露工具：

- 当前沙盒是 `danger-full-access`，或
- `sandbox.mcp.<server 名称>` 授权了完全相同的端点。

```json
{
  "sandbox": {
    "mode": "workspace-write",
    "mcp": {
      "docs": {
        "url": "https://mcp.example.com/mcp",
        "readOnlyTools": ["search", "get_page"],
        "allowedTools": ["create_page", "update_page"]
      }
    }
  }
}
```

`url` 必须与规范化后的 server URL 完全一致，包括路径，且不能带内嵌凭证或 fragment。
授权按工具名精确匹配：

- `read-only` 模式只暴露 `readOnlyTools`。
- `workspace-write` 模式暴露 `readOnlyTools` 与 `allowedTools`。
- `danger-full-access` 模式暴露 server 列出的全部工具。

Server 自带的 `readOnlyHint` 注释不授予权限，只有宿主配置或进程边界才作数。

远程 OAuth 使用授权码 + PKCE 与动态客户端注册。在 **设置 → 连接器** 中为远程 server
发起登录，并在浏览器里完成。令牌保存在 `~/.ringko/tool.auth.json`（权限 0600），
过期前自动刷新。需要静态密钥的 server 可以在 MCP 配置里写 `headers`，或在
`tool.auth.json` 中放一条记录：

```json
{
  "docs": { "type": "apikey", "key": "replace-me" }
}
```

`apikey` 会以 `Authorization: Bearer <key>` 发送。`type: "headers"` 则保存一组
字面请求头。

## 工具名与风险

Server 的工具暴露为 `<server>__<tool>`。`[A-Za-z0-9_-]` 之外的字符替换为 `_`；
server 前缀最多 40 个字符，最终名称最多 128 个。名称冲突时后注册的工具被跳过，因此
内置工具保留原名。

所有 MCP 工具都注册为 `network` 风险调用，仍然经过审批门：`approval` 模式每次都
询问，`assist` 模式按风险评估决定，`full` 模式不询问。

## 运行行为

- 后端启动时并行连接 server。慢 server 不会阻塞其他 server；发现流程最多等待启动
  连接 1.5 秒。
- 连接失败会重试两次（间隔 1 秒、2 秒），三次失败后停止自动重试。错误显示在 Web UI
  和诊断日志中，其他 server 继续工作。
- 每个 JSON-RPC 请求超时为 30 秒。
- 单个 server 最多 512 个工具、最多 32 页。
- 单次响应或 SSE 事件上限为 1 MiB。
- 配置最多 64 个 server。
- 每次运行前会重新注册工具，因此重连成功的 server 不需要重启后端即可使用。
- `GET /api/mcp/connected` 只返回当前连接与错误，不会启动或重连任何东西。

工具返回的文本内容用换行拼接，非文本内容序列化为 JSON。Server 返回 `isError` 时，
调用以返回文本作为错误失败。
