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
