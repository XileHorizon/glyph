import { describe, expect, it } from 'vitest';
import { detailsOf, guessStage, pageIdOf, stagesOf, type NotionPage } from './details.ts';

const NOW = Date.parse('2026-09-14T16:00:00Z');

const PAGE: NotionPage = {
  id: '3db522a4-5630-8129-8304-c129ce6004e4',
  url: 'https://www.notion.so/The-update-banner-3db522a4563081298304c129ce6004e4',
  last_edited_time: '2026-09-14T15:50:00.000Z',
  parent: { type: 'database_id', database_id: '9b64668a-b87b-46b5-8acb-4c7d4a2b7e5e' },
  properties: {
    Title: { type: 'title', title: [{ plain_text: 'The update banner' }, { plain_text: ' needs colour' }] },
    Status: { type: 'status', status: { id: 'opt-progress', name: 'In progress' } },
    Priority: { type: 'select', select: { name: 'P1' } },
    Type: { type: 'select', select: { name: 'Bug' } },
    Area: { type: 'multi_select', multi_select: [{ name: 'Editor' }, { name: 'Android' }] },
    Due: { type: 'date', date: { start: '2026-09-20', end: null } },
    Assignee: { type: 'people', people: [] },
    Notes: { type: 'rich_text', rich_text: [] },
    Link: { type: 'url', url: null },
    Created: { type: 'created_time' },
  },
};

describe('reading a Notion task back', () => {
  it('finds the page id at the end of any Notion address', () => {
    expect(pageIdOf('https://www.notion.so/The-update-banner-3db522a4563081298304c129ce6004e4')).toBe('3db522a4563081298304c129ce6004e4');
    expect(pageIdOf('https://app.notion.com/p/3db522a4563081298304c129ce6004e4?pvs=4')).toBe('3db522a4563081298304c129ce6004e4');
    expect(pageIdOf('https://www.notion.so/attackfm/3db522a4-5630-8129-8304-c129ce6004e4')).toBe('3db522a4563081298304c129ce6004e4');
    expect(pageIdOf('https://example.com/nothing-here')).toBeNull();
    expect(pageIdOf('not a url')).toBeNull();
  });

  it('takes the stage from the board’s own status groups', () => {
    const stages = stagesOf({
      properties: {
        Status: {
          type: 'status',
          status: {
            options: [
              { id: 'opt-new', name: 'Not started' },
              { id: 'opt-progress', name: 'Shipping soon' },
              { id: 'opt-done', name: 'Shipped' },
            ],
            groups: [
              { name: 'To-do', option_ids: ['opt-new'] },
              { name: 'In progress', option_ids: ['opt-progress'] },
              { name: 'Complete', option_ids: ['opt-done'] },
            ],
          },
        },
      },
    });
    expect(stages['opt-progress']).toBe('doing');
    expect(stages['shipped']).toBe('done');
    const details = detailsOf({ ...PAGE, properties: { ...PAGE.properties, Status: { type: 'status', status: { id: 'opt-done', name: 'Shipped' } } } }, stages, NOW);
    expect(details.status).toEqual({ label: 'Shipped', stage: 'done' });
  });

  it('guesses a stage from the name when the board couldn’t be read', () => {
    expect(guessStage('Not started')).toBe('todo');
    expect(guessStage('Backlog')).toBe('todo');
    expect(guessStage('In review')).toBe('doing');
    expect(guessStage('Done')).toBe('done');
  });

  it('gives the pill the status, priority and due date, and the card every property with a value', () => {
    const details = detailsOf(PAGE, null, NOW);
    expect(details.title).toBe('The update banner needs colour');
    expect(details.status).toEqual({ label: 'In progress', stage: 'doing' });
    expect(details.brief).toEqual(['P1', 'Due Sep 20']);
    expect(details.fields.map((f) => f.label)).toEqual(['Status', 'Priority', 'Type', 'Area', 'Due']);
    expect(details.fields.find((f) => f.label === 'Area')?.value).toBe('Editor, Android');
    expect(details.editedAt).toBe(Date.parse('2026-09-14T15:50:00.000Z'));
    expect(details.readAt).toBe(NOW);
    expect(details.gone).toBeUndefined();
  });

  it('says a task is overdue until it is done', () => {
    const late = { ...PAGE, properties: { ...PAGE.properties, Due: { type: 'date', date: { start: '2026-09-10' } } } };
    expect(detailsOf(late, null, NOW).brief).toEqual(['P1', 'Overdue Sep 10']);
    const done = { ...late, properties: { ...late.properties, Status: { type: 'status', status: { name: 'Done' } } } };
    expect(detailsOf(done, null, NOW).brief).toEqual(['P1', 'Due Sep 10']);
  });

  it('reads a board with a Done checkbox and no status, and a task in the trash', () => {
    const checkbox: NotionPage = { id: 'x', properties: { Name: { type: 'title', title: [{ plain_text: 'Buy milk' }] }, Done: { type: 'checkbox', checkbox: true } } };
    expect(detailsOf(checkbox, null, NOW).status).toEqual({ label: 'Done', stage: 'done' });
    expect(detailsOf({ ...PAGE, in_trash: true }, null, NOW).gone).toBe(true);
    expect(detailsOf({ id: 'y' }, null, NOW)).toMatchObject({ title: 'Untitled', status: null, brief: [], fields: [] });
  });
});
