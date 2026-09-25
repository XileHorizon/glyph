import { describe, expect, it, vi } from 'vitest';
import { MOST_NOTES, paletteCommands, type PaletteDoing, type PaletteWorld } from './palette.ts';

const doing = (): PaletteDoing => ({
  openNote: vi.fn(),
  newNote: vi.fn(),
  speak: vi.fn(),
  speakInto: vi.fn(),
  closeTab: vi.fn(),
  showList: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  settings: vi.fn(),
  cheatSheet: vi.fn(),
  guide: vi.fn(),
  academy: vi.fn(),
  chooseWorkspace: vi.fn(),
  fileNote: vi.fn(),
  setView: vi.fn(),
  setTheme: vi.fn(),
  pin: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
});

const world = (over: Partial<PaletteWorld> = {}): PaletteWorld => ({
  notes: [],
  tabs: [],
  workspaces: [],
  workspace: null,
  note: null,
  filedIn: null,
  pinned: false,
  canBack: false,
  canForward: false,
  view: 'mixed',
  theme: 'dark',
  ...over,
});

const ids = (commands: ReturnType<typeof paletteCommands>) => commands.map((command) => command.descriptor.id);
const run = (commands: ReturnType<typeof paletteCommands>, id: string) => commands.find((command) => command.descriptor.id === id)?.run();

describe('what the palette offers', () => {
  it('always offers the things that need nothing', () => {
    const list = paletteCommands(world(), doing());
    expect(ids(list)).toEqual(expect.arrayContaining(['new', 'speak', 'list', 'settings', 'cheatsheet', 'academy', 'guide']));
    // Nothing about a note, a tab or a workspace, because there are none.
    expect(ids(list).some((id) => id.startsWith('note:') || id.startsWith('tab:') || id.startsWith('space:'))).toBe(false);
  });

  it("offers a note's own commands only over a note", () => {
    const over = world({ note: { id: 'n1', title: 'Weekend trip' }, pinned: true });
    const list = ids(paletteCommands(over, doing()));
    expect(list).toEqual(expect.arrayContaining(['note:speak', 'note:view', 'note:pin', 'note:archive', 'note:delete', 'note:close']));
  });

  it('says which way a toggle goes, so the label is never a lie', () => {
    const pinned = paletteCommands(world({ note: { id: 'n1', title: 'A' }, pinned: true }), doing());
    expect(pinned.find((c) => c.descriptor.id === 'note:pin')?.descriptor.label).toBe('Unpin it from the top');
    const loose = paletteCommands(world({ note: { id: 'n1', title: 'A' }, pinned: false }), doing());
    expect(loose.find((c) => c.descriptor.id === 'note:pin')?.descriptor.label).toBe('Pin it to the top');

    const marks = paletteCommands(world({ note: { id: 'n1', title: 'A' }, view: 'mixed' }), doing());
    expect(marks.find((c) => c.descriptor.id === 'note:view')?.descriptor.label).toBe('Show it formatted');
    const formatted = paletteCommands(world({ note: { id: 'n1', title: 'A' }, view: 'formatted' }), doing());
    expect(formatted.find((c) => c.descriptor.id === 'note:view')?.descriptor.label).toBe('Show the marks');
  });

  it('never offers what is already so', () => {
    const spaces = [{ id: 'w1', name: 'Home' }, { id: 'w2', name: 'Work' }];
    const list = ids(paletteCommands(world({ workspaces: spaces, workspace: 'w1', note: { id: 'n1', title: 'A' }, filedIn: 'w2', theme: 'dark' }), doing()));
    // The workspace being shown, and the one the note is already filed in.
    expect(list).not.toContain('space:w1');
    expect(list).toContain('space:w2');
    expect(list).not.toContain('note:file:w2');
    expect(list).toContain('note:file:w1');
    // The theme it is already on.
    expect(list).not.toContain('theme:dark');
    expect(list).toContain('theme:light');
  });

  it('offers the tabs and the trail only when there are any', () => {
    const quiet = ids(paletteCommands(world(), doing()));
    expect(quiet).not.toContain('back');
    expect(quiet).not.toContain('forward');

    const busy = ids(
      paletteCommands(world({ tabs: [{ id: 'n1', title: 'A' }, { id: 'n2', title: 'B' }], note: { id: 'n1', title: 'A' }, canBack: true, canForward: true }), doing()),
    );
    // The note on screen is not offered as somewhere to go, but the other tab is.
    expect(busy).not.toContain('tab:n1');
    expect(busy).toEqual(expect.arrayContaining(['tab:n2', 'tab:close:n2', 'back', 'forward']));
  });

  it('offers every note by name, up to a limit, and not the ones already open', () => {
    const many = Array.from({ length: MOST_NOTES + 10 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}` }));
    const list = ids(paletteCommands(world({ notes: many, tabs: [many[0]!], note: many[1]! }), doing()));
    const byName = list.filter((id) => id.startsWith('open:'));
    expect(byName).not.toContain('open:n0');
    expect(byName).not.toContain('open:n1');
    expect(byName.length).toBeLessThanOrEqual(MOST_NOTES);
    expect(byName).toContain('open:n2');
  });

  it('runs what it says it runs', () => {
    const acts = doing();
    const list = paletteCommands(world({ note: { id: 'n1', title: 'A' }, workspaces: [{ id: 'w1', name: 'Home' }], notes: [{ id: 'n9', title: 'B' }] }), acts);
    run(list, 'note:speak');
    expect(acts.speakInto).toHaveBeenCalledWith('n1');
    run(list, 'note:file:w1');
    expect(acts.fileNote).toHaveBeenCalledWith('n1', 'w1');
    run(list, 'open:n9');
    expect(acts.openNote).toHaveBeenCalledWith('n9');
    run(list, 'theme:light');
    expect(acts.setTheme).toHaveBeenCalledWith('light');
    run(list, 'note:view');
    expect(acts.setView).toHaveBeenCalledWith('formatted');
    run(list, 'academy');
    expect(acts.academy).toHaveBeenCalled();
  });

  it('gives every command its own id, so the palette can tell them apart', () => {
    const list = ids(
      paletteCommands(
        world({
          notes: [{ id: 'n1', title: 'A' }, { id: 'n2', title: 'B' }],
          tabs: [{ id: 'n1', title: 'A' }],
          workspaces: [{ id: 'w1', name: 'Home' }],
          note: { id: 'n2', title: 'B' },
        }),
        doing(),
      ),
    );
    expect(new Set(list).size).toBe(list.length);
  });

  it("offers a phone its tab's groups, where a finger has no right-click", () => {
    const acts = { ...doing(), groupTab: vi.fn(), joinTabGroup: vi.fn(), leaveTabGroup: vi.fn() };
    const tab = { id: 'n1', title: 'A' };
    const groups = [{ id: 'g1', name: 'Trip' }, { id: 'g2', name: 'Work' }];
    const loose = paletteCommands(world({ note: tab, tabs: [tab], tabGroups: groups, tabGroup: null }), acts);
    expect(ids(loose)).toEqual(expect.arrayContaining(['tab:group:new', 'tab:group:g1', 'tab:group:g2']));
    expect(ids(loose)).not.toContain('tab:group:leave');
    // In a group already: not offered its own group, but offered the way out.
    const grouped = paletteCommands(world({ note: tab, tabs: [tab], tabGroups: groups, tabGroup: 'g1' }), acts);
    expect(ids(grouped)).not.toContain('tab:group:g1');
    expect(ids(grouped)).toContain('tab:group:leave');
    run(grouped, 'tab:group:g2');
    expect(acts.joinTabGroup).toHaveBeenCalledWith('n1', 'g2');
    run(grouped, 'tab:group:leave');
    expect(acts.leaveTabGroup).toHaveBeenCalledWith('n1');
    // A note that isn't open as a tab has no tab to group.
    expect(ids(paletteCommands(world({ note: tab, tabs: [], tabGroups: groups }), acts)).some((id) => id.startsWith('tab:group'))).toBe(false);
  });

  it('names a note with no title rather than offering a blank line', () => {
    const list = paletteCommands(world({ notes: [{ id: 'n1', title: '' }] }), doing());
    expect(list.find((c) => c.descriptor.id === 'open:n1')?.descriptor.label).toBe('Open Untitled');
  });
});
