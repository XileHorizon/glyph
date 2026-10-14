# Glyph plugins

Glyph's integrations are plugins: modules that ship inside the app, arrive with its updates, and can each be
switched off in **Settings › Plugins**. Two ship as standard:

| Plugin | What it adds | Folder |
| --- | --- | --- |
| **Notion** | A note's list items become tasks on a Notion board: swipe an item, say "send that to Notion", or send the whole list from the note's cog. | `src/app/plugins/notion/` |
| **Projects** | A note linked to a GitHub repo is formatted with a briefing of that repo, written by the model on the phone. | `src/app/plugins/projects/` |

A switched-off plugin offers nothing anywhere, at once. Its data stays where it was, so switching it back on
restores it as it was. A reset clears every plugin's storage, switched on or not.

## How a plugin is put together

```
plugins/
  types.ts        the manifest, the host, and every extension point
  host.ts         createHost(manifest): the plugin's only way onto the phone, cut to its manifest
  registry.ts     the plugins in this build, their switches, and what the app asks them for
  kit.tsx         sheet pieces for a plugin's page on a note's cog (SheetTitle, SheetRow, SheetField, …)
  PluginsPane.tsx Settings › Plugins
  <id>/
    manifest.ts   the manifest, and `export const host = createHost(manifest)`
    index.tsx     the GlyphPlugin: manifest, icon, and the extension points it uses
    …             the plugin's own modules, which reach the phone only through `host`
```

To add one: make the folder, write `manifest.ts` and `index.tsx`, and add the plugin to `BUILT_IN` in
`registry.ts`. Nothing else in the app changes. The note's cog, the list swipe, the recorder, the formatter and
Settings already ask the registry for whatever switched-on plugins offer.

## The manifest

```ts
export const manifest: PluginManifest = {
  id: 'notion',                    // its switch and its storage live under this
  name: 'Notion',
  description: 'One sentence for Settings › Plugins.',
  version: '1.0.0',
  author: 'Glyph',
  standard: true,                  // on until switched off
  permissions: [                   // each with the reason the person reads
    { kind: 'notes', why: '…' },   // notes · network · ai · voice · native
  ],
  hosts: ['api.notion.com'],       // shown with the network permission
  native: { generation: 12, commands: ['notion_request'] },
  storage: ['glyph-notion-links'], // localStorage keys it owns
};
```

The manifest is enforced, not decorative:

- **The host** refuses what the manifest doesn't list: a native command, a storage key, or `host.require(kind)`
  for an undeclared permission. `host.openUrl` needs `network`. Plugin code that calls a core module directly
  (the Projects plugin's `generate` and `fetch`) asserts the permission with `host.require` first.
- **The registry** refuses to load a plugin whose extension points outrun its permissions. Voice commands and item
  targets need `voice`. Note actions, the item swipe and item targets need `notes`.
- **Settings › Plugins** shows each permission with its reason, and the hosts, straight from the manifest.

## Extension points

All optional, all in `types.ts`:

| Field | Where it shows | Shape |
| --- | --- | --- |
| `settings` | Its own row and page in Settings, while it's on | `{ Pane, summary() }` |
| `noteLinks` | Rows under **Linked to** on a note's cog; each opens the plugin's `Picker` inside the sheet | `hint(noteId)`, `unavailable()`, `Picker` |
| `noteActions` | Rows under the links (Send list to Notion) | `visible`, `hint`, `enabled`, `run(editing)` |
| `itemAction` | Swiping a list item left in a note | `label`, `busyLabel`, `available(noteId)`, `run(text, editing)` |
| `voice` | Commands heard while recording, tried before Glyph's own | `parse(text)`, `run(parsed, ctx)` |
| `itemTargets` | A word that can end an item command's note name ("new task for AttackFM **in Notion**") | `word`, `afterAdd(noteId, lines, ctx)` |
| `tips` | Suggestions in a pause while recording | `(recentTitle) => Tip[]` |
| `formatContext` | Background the formatter hands the model with a note | `for(noteId)`, `version(noteId)` |
| `suggest` | A quiet word at the end of a line the plugin could act on, tapped to do it (the Notion word after an unsent to-do) | `(noteId, body) => Suggestion[]`, each `line`, `label`, `busyLabel`, `run(editing)` |
| `marks` | Read-back for the links a plugin writes: a pill on the item, a card on tap, and the actions (`done`, `reopen`) that make a tick sync both ways | `peek`, `want`, `open`, `reads?`, `actions?` |
| `formats` | An inline formatting of its own in every note (the seven built in, all in one plugin: `plugins/marks/`): the words between two runs of its delimiter, drawn its way, and a word for it in the Style page of the press-and-hold menu (the Spoiler plugin's `\|\|secret\|\|`, in smoke) | `InlineFormat[]`, each `name` (a capitalised node name), `delimiter` (one to three of a character Markdown doesn't use), `look` (`{ kind: 'wisp' }` or `{ kind: 'style', css }`) |

`NoteEditing` (for note actions, the swipe and suggestions) changes the note on screen through its editor, so each
change is one undo step and saves like typing.

**Local only.** While the person has Local only on (Settings > Formatting), every plugin whose manifest
declares the `network` permission is off, whatever its switch says, and the registry tells its listeners
when that changes. A plugin that can do part of its work without the network should split that part
into a plugin without the permission, or it goes dark with the rest.

**Linking an item.** There is one form for a list item linked to something outside Glyph, and every plugin
writes it through `core/itemLinks.ts` `linkedLine(line, url, name)`: the words stay as they are and the item
ends with a mark, a link whose words are the plugin's lowercase name - `- [ ] Buy milk [notion](https://…)`.
The editor draws the mark as a small solid pill with the name on it, `unsentItems` skips marked items (and
the older whole-words form), and the formatter carries a mark through the model and puts a lost one back on
its item. A plugin should not invent its own way of marking a line: the pill, the suggestion and the model's
handling all key off this one shape. `CaptureContext` (for voice commands) can:

- read the take's note and the last thing said
- set the status chip
- link words of the take to a URL
- append a line
- update another note while keeping the take in step

A context's `version` must change whenever `for` would say something new; the note is then formatted again. When
exactly one plugin gives a context, its version is used as it is, so notes formatted before plugins existed stay
formatted.

## Plugins from outside Glyph

Not yet. Every plugin ships in the app. The host is the seam for them: an outside plugin would get the same
`PluginHost` over a message bridge from a sandboxed frame instead of as a function call, with the manifest shown
for approval before it loads.
