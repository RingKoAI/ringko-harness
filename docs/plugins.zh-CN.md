# 插件

插件是一个包含 `plugin.json` 清单的目录。清单是声明式的：它可以添加技能、
提示词命令和 MCP 服务器，但不能执行代码。需要执行代码的扩展请使用运行时
contribution API。

## 位置与信任

插件按以下顺序发现，先找到的同名插件优先：

| 范围 | 目录 |
| --- | --- |
| 项目 | `<project>/.ringko/plugins/<id>` |
| 项目 | `<project>/.agents/plugins/<id>` |
| 用户 | `~/.ringko/plugins/<id>` |
| 共享 | `~/.agents/plugins/<id>` |

项目根目录是最近的包含 `.git`、`.mcp.json`、`ringko.json` 或 `.agents` 的
祖先目录。

只有目录名出现在**用户级** `~/.ringko/settings.local.json` 中时才会加载：

```json
{
  "plugins": {
    "trusted": [
      { "id": "reviewer", "path": "C:\\Users\\me\\.ringko\\plugins\\reviewer" }
    ]
  }
}
```

信任绑定到解析后的插件目录，而不只是名称。信任列表刻意不从项目文件读取，因此
克隆的仓库无法自行启用插件。旧式裸名称条目只对用户级目录（`~/.ringko`、
`~/.agents`）有效；项目目录必须使用路径绑定条目。删除条目即可停用插件。未受
信任的目录在解析清单之前就被忽略。

`GET /api/plugins`、`RuntimeManager.plugins()` 与 `RuntimeContext.plugins()` 可以
在不启动插件的情况下查看受信任插件清单和清单错误。`POST /api/plugins/trust` 与
`/api/plugins/untrust` 更新与 CLI 相同的用户级信任名单。运行时 agent 通过常规
工具与 MCP 注册路径看到插件技能和 MCP server。

使用 `ringko plugins` 查看发现的插件目录与信任状态，`ringko plugins trust <id>`
校验并信任所选目录，`ringko plugins untrust <id>` 停用插件。该命令在用户级设置
文件中记录路径绑定条目，并保留其他所有键。

## 清单格式

```json
{
  "schemaVersion": 1,
  "name": "reviewer",
  "version": "1.0.0",
  "description": "Review helpers",
  "skills": ["skills"],
  "commands": [
    {
      "name": "review",
      "description": "Review a diff",
      "argumentHint": "path",
      "prompt": "Review the current diff. Focus on $ARGUMENTS."
    }
  ],
  "mcpServers": {
    "reviewer": { "command": "node", "args": ["server.js"] }
  }
}
```

- `name` 必填，且必须与目录名一致。
- `schemaVersion` 存在时必须为 `1`。未知字段会被拒绝。
- 不支持 `hooks`；请改用运行时 contribution。
- `skills` 是相对于插件根目录的目录列表。绝对路径、`..` 片段以及逃逸出插件
  目录的符号链接都会被拒绝。省略时，若存在 `skills` 目录则默认使用它。每个条目
  可以是一个技能目录（包含 `SKILL.md`），也可以是多个技能目录的集合。插件技能
  使用 `<plugin-id>:<skill-name>` 命名空间，因此不会覆盖已安装的技能。
- `commands` 是 REPL 中的提示词模板。`$ARGUMENTS` 或 `{{args}}` 会被替换为
  命令后的参数；若两者都不存在，参数会追加到末尾。插件命令不能覆盖内置命令。
- `mcpServers` 与 `.mcp.json` 结构相同。名称冲突时，显式的项目或用户 MCP
  配置优先。

限制：最多 128 个插件，清单最大 256 KiB，每个插件最多 64 条命令、提示词最大
64 KiB、64 个技能目录和 64 个 MCP 服务器。

受信任插件的清单只要有一处无效，整个插件都不会贡献任何内容；所有路径都会在
读取插件目录之外的文件之前完成校验。
