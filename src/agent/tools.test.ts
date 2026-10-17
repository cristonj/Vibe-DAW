import { describe, expect, it, vi } from 'vitest';
vi.mock('../engine/api', () => ({ play: vi.fn(), stop: vi.fn(), renderProject: vi.fn() }));
vi.mock('./ears', () => ({ audition: vi.fn(), listen: vi.fn() }));
import { runTool, toolDeclarations, type PlanStep } from './tools';

const plan: PlanStep[] = [{ title: 'Build drums', status: 'active' }, { title: 'Balance bass', status: 'pending' }];
const context = () => ({ signal: new AbortController().signal, goal: 'Make a beat', plan });

describe('checklist tool', () => {
  it('creates a checklist and returns its canonical state', async () => {
    const out = await runTool('update_plan', { steps: plan }, context(), 'agent');
    expect(out.plan).toEqual(plan);
    expect(out.result.steps).toEqual(plan);
  });

  it('updates individual steps atomically without losing or mutating the rest', async () => {
    const out = await runTool('update_plan', { updates: [{ step: 1, status: 'done' }, { step: 2, status: 'active', title: 'Balance kick and bass' }] }, context(), 'agent');
    expect(out.plan).toEqual([{ title: 'Build drums', status: 'done' }, { title: 'Balance kick and bass', status: 'active' }]);
    expect(plan[0].status).toBe('active');
    expect(plan[1].title).toBe('Balance bass');
    const single = await runTool('update_plan', { updates: [{ step: 2, status: 'active' }] }, context(), 'agent');
    expect(single.plan?.[0]).toEqual(plan[0]);
  });

  it('permits progress updates in Ask mode without changing the project', async () => {
    expect(toolDeclarations('ask').some((t) => t.name === 'update_plan')).toBe(true);
    const out = await runTool('update_plan', { updates: [{ step: 1, status: 'done' }] }, context(), 'ask');
    expect(out.plan?.[0].status).toBe('done');
  });

  it.each([
    {}, { steps: [] }, { steps: plan, updates: [] },
    { updates: [{ step: 0, status: 'done' }] },
    { updates: [{ step: 3, status: 'done' }] },
    { updates: [{ step: 1.5, status: 'done' }] },
    { updates: [{ step: 1, status: 'finished' }] },
    { updates: [{ step: 1, status: 'done' }, { step: 2, status: 'active', title: ' ' }] },
    { steps: [null] }, { steps: [{ title: '', status: 'done' }] },
  ])('rejects invalid updates without publishing partial progress: %j', async (args) => {
    const out = await runTool('update_plan', args, context(), 'agent');
    expect(out.result).toHaveProperty('error');
    expect(out.plan).toBeUndefined();
    expect(plan[0].status).toBe('active');
  });

  it('requires an existing checklist before patching steps', async () => {
    const out = await runTool('update_plan', { updates: [{ step: 1, status: 'done' }] }, { ...context(), plan: undefined }, 'agent');
    expect(out.result.error).toContain('Create a checklist');
  });
});

import { createProject } from '../model/project';
import { useDaw } from '../state/store';

describe('annotation tools', () => {
  it('writes timed lyrics with no audio track, supports editing/resolve/delete and one-step undo', async () => {
    useDaw.getState().replaceProject(createProject());
    useDaw.getState().beginTransaction('Producer writing cues');
    const added = await runTool('add_annotation', { text: 'Under the city lights', kind: 'lyric', start_bar: 3, end_bar: 5 }, context(), 'agent');
    const id = added.result.annotation_id;
    expect(useDaw.getState().project.annotations?.[0]).toMatchObject({ id, start: 8, length: 8, author: 'producer', aiPending: true });
    await runTool('edit_annotation', { annotation_id: id, text: 'Under neon skies', end_bar: 4 }, context(), 'agent');
    const read = await runTool('list_annotations', { start_bar: 3, end_bar: 5 }, context(), 'ask');
    expect(read.result.annotations).toMatchObject([{ text: 'Under neon skies', length: 4 }]);
    const blocked = await runTool('delete_annotation', { annotation_id: id }, context(), 'ask');
    expect(blocked.result.error).toContain('read-only');
    useDaw.getState().endTransaction(); useDaw.getState().undo();
    expect(useDaw.getState().project.annotations).toEqual([]);
    useDaw.getState().redo();
    await runTool('delete_annotation', { annotation_id: id }, context(), 'agent');
    expect(useDaw.getState().project.annotations).toEqual([]);
  });
  it('rejects invalid text, timing, association or kind without partial writes', async () => {
    useDaw.getState().replaceProject(createProject());
    for (const patch of [{ text: ' ' }, { end_bar: 1 }, { start_bar: -1 }, { kind: 'vocal' }, { track_id: 'missing' }, { text: 'x'.repeat(4001) }]) {
      const result = await runTool('add_annotation', { text: 'note', kind: 'note', start_bar: 1, end_bar: 2, ...patch }, context(), 'agent');
      expect(result.result).toHaveProperty('error');
    }
    expect(useDaw.getState().project.annotations).toEqual([]);
  });
});
