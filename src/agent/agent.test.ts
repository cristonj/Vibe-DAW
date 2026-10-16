import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmRequest, LlmResult } from './llm';
const mocks = vi.hoisted(() => ({ stream: vi.fn(), tool: vi.fn() }));
vi.mock('./llm', () => ({ streamGenerate: mocks.stream, explainError: (e: Error) => e.message }));
vi.mock('./tools', () => ({ runTool: mocks.tool, toolDeclarations: () => [] }));
vi.mock('./prompts', () => ({ systemPrompt: () => 'Producer' }));
vi.mock('../state/settings', () => ({ aiAvailable: () => ({ ok: true }), useSettings: { getState: () => ({ thinking: 'LOW' }) } }));
import { runAgent, steerAgent, stopAgent, useAgent } from './agent';
import { useDaw } from '../state/store';
import { createProject } from '../model/project';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { resolve, promise };
}
const answer = (): LlmResult => ({ content: { role: 'model', parts: [{ text: 'Done' }] } });
const calls = (): LlmResult => ({ content: { role: 'model', parts: [{ thoughtSignature: 'sig', functionCall: { name: 'edit', id: 'a' } }, { functionCall: { name: 'edit', id: 'b' } }] } });

beforeEach(() => { mocks.stream.mockReset(); mocks.tool.mockReset(); useAgent.getState().clear(); useDaw.getState().replaceProject(createProject()); });

describe('agent steering', () => {
  it('accepts follow-ups while streaming and skips stale tool calls before replanning', async () => {
    const first = deferred<LlmResult>();
    mocks.stream.mockReturnValueOnce(first.promise).mockResolvedValueOnce(answer());
    const run = runAgent('Make a beat');
    await runAgent('Keep it slow');
    expect(steerAgent('No extra hats')).toBe(true);
    expect(useAgent.getState().steering).toHaveLength(2);
    first.resolve(calls());
    await run;
    expect(mocks.tool).not.toHaveBeenCalled();
    const second = mocks.stream.mock.calls[1][0] as LlmRequest;
    expect(JSON.stringify(second.contents)).toContain('No extra hats');
    expect(JSON.stringify(second.contents)).toContain('Keep it slow');
    expect(JSON.stringify(second.contents)).toContain('Skipped because');
    expect(JSON.stringify(second.contents)).toContain('sig');
    expect(useAgent.getState().running).toBe(false);
    expect(useAgent.getState().items.filter((i) => i.kind === 'user' && i.steering === 'applied')).toHaveLength(2);
  });
  it('finishes the current tool and skips the remaining batch when steering arrives', async () => {
    const current = deferred<{ result: { ok: boolean }; summary: string }>();
    mocks.stream.mockResolvedValueOnce(calls()).mockResolvedValueOnce(answer());
    mocks.tool.mockReturnValueOnce(current.promise);
    const run = runAgent('Make a beat');
    await vi.waitFor(() => expect(mocks.tool).toHaveBeenCalledTimes(1));
    steerAgent('Make the bass quieter');
    current.resolve({ result: { ok: true }, summary: 'Edited' });
    await run;
    expect(mocks.tool).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.stream.mock.calls[1][0].contents)).toContain('bass quieter');
  });
  it('stops cleanly without executing buffered calls or losing the undo boundary', async () => {
    const first = deferred<LlmResult>();
    mocks.stream.mockReturnValueOnce(first.promise);
    const run = runAgent('Make a beat');
    steerAgent('Stay in C minor');
    stopAgent(); first.resolve(calls());
    await run;
    expect(mocks.tool).not.toHaveBeenCalled();
    expect(useAgent.getState().items.some((i) => i.kind === 'user' && i.steering === 'cancelled')).toBe(true);
    expect(useDaw.getState().transaction).toBeNull();
  });
  it('does not restore old history or mutate a newly opened project after clear', async () => {
    const first = deferred<LlmResult>();
    mocks.stream.mockReturnValueOnce(first.promise);
    const run = runAgent('Make a beat');
    useAgent.getState().clear();
    useDaw.getState().replaceProject(createProject('Other project'));
    first.resolve(calls()); await run;
    expect(mocks.tool).not.toHaveBeenCalled();
    expect(useAgent.getState().items).toEqual([]);
    expect(useDaw.getState().project.name).toBe('Other project');
  });
});
