# 技能

技能是一个包含 `SKILL.md` 的目录。文件开头的前置元数据声明技能名称和使用场景：

```markdown
---
name: reviewer
description: Review a diff for correctness and regressions.
---

Review the change, then report findings by severity.
```

`skill` 工具会把已安装的技能按名称提供给模型。安装技能不会自动执行它；当任务
匹配时，模型会加载其中的说明。

## 位置

| 范围 | 目录 |
| --- | --- |
| 项目 | `<project>/.ringko/skills`、`<project>/.agents/skills` |
| 用户 | `~/.ringko/skills`、`~/.agents/skills` |
| 插件 | 受信任插件声明的技能目录 |

同名时项目技能优先于用户技能；`~/.ringko` 优先于 `~/.agents`。插件技能使用
`<plugin-id>:<skill-name>` 命名空间，并排在已安装技能之后。

## 从 REPL 安装

```
/skill add ./path/to/skill-directory
```

REPL 会询问安装到全局目录（`~/.ringko/skills`）还是当前项目目录
（`<project>/.ringko/skills`）。安装前会完整校验来源：

- 根目录必须存在 `SKILL.md`，且不超过 64 KiB。
- 名称必须是单一路径段；前置元数据没有名称时使用来源目录名。
- 拒绝符号链接、特殊文件、超过 256 个文件、总计超过 8 MiB、单文件超过 4 MiB。
- 已存在同名技能时不会覆盖。

复制会先落到临时目录再重命名到目标位置，因此安装失败不会留下半成品。

`/skills` 用于浏览已安装技能。Web UI 设置面板可以创建和删除全局技能。编程接口
可使用 `@ringko-ai/config` 的 `installSkill`、`RuntimeManager.installSkill`
（同时发出 `skill/installed` 事件），或 `POST /api/skills/install`，请求体为
`{ "source": "...", "scope": "global" | "project" }`。`GET /api/skills` 返回
当前技能清单。
