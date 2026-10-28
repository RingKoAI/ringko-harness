import { expect, it } from 'bun:test'
import { toolActivityKind } from '../src/lib/tool-activity'

it('groups tool names into coarse activity categories', () => {
  const cases: Array<[string, string]> = [
    ['read', 'read'], ['tree', 'read'],
    ['glob', 'search'], ['grep', 'search'],
    ['write', 'write'], ['edit', 'write'],
    ['shell', 'commands'], ['terminal', 'commands'],
    ['task', 'subtasks'], ['job', 'subtasks'], ['subscribe', 'subtasks'],
    ['plan', 'plan'], ['update_plan', 'plan'],
    ['mcp__docs__search', 'tools'], ['unknown_tool', 'tools'],
  ]
  for (const [name, expected] of cases) expect(toolActivityKind(name)).toBe(expected as never)
})
