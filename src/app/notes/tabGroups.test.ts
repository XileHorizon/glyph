import { describe, expect, it } from 'vitest';
import {
  afterMove,
  displayOrder,
  joinGroup,
  leaveGroup,
  membersOf,
  newGroup,
  NO_GROUPS,
  pruneGroups,
  recolourGroup,
  renameGroup,
  toggleGroup,
  ungroup,
  type TabGroups,
} from './tabGroups.ts';

const two = (): TabGroups => ({
  list: [
    { id: 'g1', name: 'Trip', hue: 'sea' },
    { id: 'g2', name: 'Work', hue: 'ember' },
  ],
  of: { b: 'g1', d: 'g1', c: 'g2' },
});

describe('tab groups', () => {
  it('draws a group together, where its first tab stands', () => {
    // b and d are one group: d is drawn beside b, not three places along.
    expect(displayOrder(['a', 'b', 'c', 'd', 'e'], two())).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(displayOrder(['a', 'b'], NO_GROUPS)).toEqual(['a', 'b']);
  });

  it('makes a new group around one tab, in a colour no other group wears', () => {
    const { groups, id } = newGroup(two(), 'a', 'g3');
    expect(groups.of.a).toBe('g3');
    expect(groups.list.find((g) => g.id === id)).toMatchObject({ name: 'Group' });
    expect(groups.list.find((g) => g.id === id)?.hue).not.toMatch(/^(sea|ember|ink)$/);
  });

  it('moves a tab into another group rather than leaving it in two', () => {
    const groups = joinGroup(two(), 'c', 'g1');
    expect(groups.of.c).toBe('g1');
    // g2 had only c in it, so it goes.
    expect(groups.list.map((g) => g.id)).toEqual(['g1']);
  });

  it('lets a tab leave, and drops a group left empty', () => {
    const groups = leaveGroup(two(), 'c');
    expect(groups.of.c).toBeUndefined();
    expect(groups.list.map((g) => g.id)).toEqual(['g1']);
  });

  it('renames, recolours and folds a group', () => {
    let groups = renameGroup(two(), 'g1', '  Weekend   away ');
    expect(groups.list[0]?.name).toBe('Weekend away');
    // An empty name is no name: the old one stays.
    expect(renameGroup(groups, 'g1', '   ').list[0]?.name).toBe('Weekend away');
    groups = recolourGroup(groups, 'g1', 'violet');
    expect(groups.list[0]?.hue).toBe('violet');
    groups = toggleGroup(groups, 'g1');
    expect(groups.list[0]?.collapsed).toBe(true);
    expect(toggleGroup(groups, 'g1').list[0]?.collapsed).toBe(false);
  });

  it('ungroups without closing anything', () => {
    const groups = ungroup(two(), 'g1');
    expect(groups.list.map((g) => g.id)).toEqual(['g2']);
    expect(groups.of).toEqual({ c: 'g2' });
  });

  it('forgets closed tabs, and any group they leave empty', () => {
    const groups = pruneGroups(two(), ['a', 'b']);
    expect(groups.of).toEqual({ b: 'g1' });
    expect(groups.list.map((g) => g.id)).toEqual(['g1']);
  });

  it('lists a group in the order its tabs are drawn', () => {
    expect(membersOf(two(), 'g1', ['d', 'a', 'b'])).toEqual(['d', 'b']);
  });

  describe('where a dragged tab lands', () => {
    it('joins a group when dropped between two of its tabs', () => {
      expect(afterMove(two(), ['b', 'a', 'd'], 'a').of.a).toBe('g1');
    });

    it('stays in its group while moved about inside it, or to its edge', () => {
      expect(afterMove(two(), ['a', 'd', 'b', 'e'], 'd').of.d).toBe('g1');
      expect(afterMove(two(), ['a', 'b', 'd', 'e'], 'd').of.d).toBe('g1');
    });

    it('leaves its group when dropped among tabs of none', () => {
      expect(afterMove(two(), ['b', 'a', 'd', 'e'], 'd').of.d).toBeUndefined();
    });

    it('does not join a group it was only dropped next to', () => {
      // At the end of g1, beside ungrouped e: an ungrouped tab stays ungrouped.
      expect(afterMove(two(), ['b', 'd', 'a', 'e'], 'a').of.a).toBeUndefined();
    });
  });
});
