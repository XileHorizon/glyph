import { describe, expect, it } from 'vitest';
import { afterPendingDeletes } from './launch.ts';

describe('capture launch ordering', () => {
  it('does not mount immediate Speak until the deferred delete has finished', async () => {
    const events: string[] = [];
    let finishDelete!: () => void;
    const deleting = new Promise<void>((resolve) => { finishDelete = resolve; });
    const launch = afterPendingDeletes(
      async () => {
        events.push('delete-started');
        await deleting;
        events.push('delete-finished');
      },
      () => events.push('capture-mounted'),
    );

    await Promise.resolve();
    expect(events).toEqual(['delete-started']);
    finishDelete();
    await launch;
    expect(events).toEqual(['delete-started', 'delete-finished', 'capture-mounted']);
  });
});
