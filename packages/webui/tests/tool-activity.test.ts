import { expect, it } from 'bun:test'
import { matchToolResults, toolCallTarget, toolTurns } from '../src/lib/tool-activity'
import type { ServerMessage } from '../src/api'

it('pairs concurrent results with their own calls and leaves unrelated results visible', () => {
  const messages: ServerMessage[] = [
    { role: 'assistant', content: '', toolCalls: [
      { id: 'one', name: 'read', arguments: { file_path: 'a.ts' } },
      { id: 'two', name: 'shell', arguments: { command: 'echo ready' } },
    ] },
    { role: 'tool', name: 'shell', toolCallId: 'two', content: 'permission denied', failed: true },
    { role: 'tool', name: 'legacy', content: 'orphan' },
    { role: 'tool', name: 'read', toolCallId: 'one', content: 'content', failed: false },
  ]
  const activity = matchToolResults(messages)
  expect(activity.results.get(0)?.get('two')).toEqual(messages[1])
  expect(activity.results.get(0)?.get('one')).toEqual(messages[3])
  expect(activity.attached).toEqual(new Set([1, 3]))
  expect(toolCallTarget(messages[0].toolCalls?.[0].arguments)).toBe('a.ts')
})

it('does not attach an old result to a reused call identifier', () => {
  const activity = matchToolResults([
    { role: 'tool', toolCallId: 'same', content: 'orphan' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'same', name: 'fixture' }] },
    { role: 'tool', toolCallId: 'same', content: 'first' },
    { role: 'tool', toolCallId: 'same', content: 'duplicate' },
  ])
  expect(activity.results.get(1)?.get('same')?.content).toBe('first')
  expect(activity.attached).toEqual(new Set([2]))
})

it('folds mixed tools across model steps as one user turn and preserves edit totals', () => {
  const messages: ServerMessage[] = [
    { role: 'user', content: 'fix it' },
    { role: 'assistant', content: 'Inspect first', toolCalls: [{ id: 'read', name: 'read' }, { id: 'shell', name: 'shell' }] },
    { role: 'tool', toolCallId: 'shell', content: 'done' }, { role: 'tool', toolCallId: 'read', content: 'source' },
    { role: 'assistant', content: 'Then update', toolCalls: [{ id: 'edit', name: 'edit', arguments: { path: 'a.ts', old_string: 'old', new_string: 'new' } }, { id: 'task', name: 'task' }] },
    { role: 'tool', toolCallId: 'edit', content: 'done' }, { role: 'tool', toolCallId: 'task', content: 'done' },
    { role: 'assistant', content: 'Final answer' },
    { role: 'user', content: 'next input' },
  ];
  const activity = toolTurns(messages, false);
  expect(activity.turns).toHaveLength(2);
  expect(activity.turns[0]).toMatchObject({ count: 4, foldable: true, additions: 1, deletions: 1, start: 0, end: 8 });
  expect([...activity.turns[0].counts]).toEqual([['read', 1], ['commands', 1], ['write', 1], ['subtasks', 1]]);
  expect(messages[4].content).toBe('Then update');
});

it('keeps active, cancelled, failed and incomplete turns open even after tools settle', () => {
  const messages: ServerMessage[] = [{ role: 'user', content: 'work' }, { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'write' }] }, { role: 'tool', toolCallId: 'call', content: 'done' }, { role: 'assistant', content: 'answer' }];
  expect(toolTurns(messages, true).turns[0]).toMatchObject({ running: true, foldable: false });
  for (const runStatus of ['cancelled', 'interrupted', 'failed'] as const) expect(toolTurns([{ ...messages[0], runStatus }, ...messages.slice(1)], false).turns[0].foldable).toBe(false);
  expect(toolTurns([{ ...messages[0], runStatus: 'completed' }, ...messages.slice(1)], true).turns[0]).toMatchObject({ running: false, foldable: true });
  expect(toolTurns(messages.filter(message => message.role !== 'tool'), false).turns[0]).toMatchObject({ unknown: 1, foldable: false });
  expect(toolTurns(messages.map(message => message.role === 'tool' ? { ...message, failed: true } : message), false).turns[0]).toMatchObject({ failed: 1, foldable: false });
});

it('never pairs results across a later user input', () => {
  const activity = toolTurns([{ role: 'user', content: 'first' }, { role: 'assistant', content: '', toolCalls: [{ id: 'same', name: 'read' }] }, { role: 'user', content: 'second' }, { role: 'tool', toolCallId: 'same', content: 'unrelated result' }], false);
  expect(activity.attached.size).toBe(0);
  expect(activity.turns.every(turn => !turn.foldable)).toBe(true);
});
