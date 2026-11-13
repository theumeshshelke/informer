# Task: finish the "Informer" GNOME Shell extension (Phase D + verification + final report)

You are continuing work on **Informer** (`informer@umesh`), a GNOME Shell 50/51 top-bar extension (GNOME 45+ ES-module style, GJS). The repo root is the folder with `extension.js`, `metadata.json`, `schemas/`, `icons/`.

**First read `BUILD_PROMPT.md` in the repo root.** It is the full original specification (rules in section 1, features in section 2, cross-cutting rules in section 3, verification in section 4, deliverable in section 5). Everything in it still applies. This file tells you what is already done and what is left.

Follow the existing style exactly. Do not rewrite working code: make surgical additions. Read `extension.js`, `sources.js`, `prefs.js`, `data.js`, `util.js`, `queue.js` and the pure-logic modules before you change anything.

---------------------------------------------------------------------
## 1. Already built (Phases A, B, C = features A1-A4, B1, C1-C7)

None of this has been run on a real GNOME Shell. Only the pure logic was tested in Node (`./tests/run.sh`, needs Node 22.7+). `node --check` and `glib-compile-schemas --strict --dry-run schemas` pass.

| Feature | Where | Notes |
|---|---|---|
| A1 speed colours | `extension.js` `_paint`, `speedlogic.js` | Link-down check reads `/sys/class/net/<if>/operstate`. The spec also mentions `nmcli`: **not done**. Parts now accept an optional per-part `color`. |
| A2 data used today | `extension.js` `_usageTick/_saveUsage`, `usage.js` | Saved once a minute and in `destroy()`. Posts every `data-usage-hours`. |
| A3 weather alerts | `sources.js` `WeatherSource`, `weatherlogic.js` | Hourly + daily Open-Meteo fields. |
| A4 icon toggle | `_iconFor()` in `extension.js`, `categoryRow` in `prefs.js` | `icon-<cat>` keys exist for every category. |
| B1 dropdown | `extension.js` `_buildMenu/_refreshMenu/_refreshMenuSlow`, `sysinfo.js`, `SystemSource.snapshot()` | Left click = menu (setting `left-click`), right = settings, middle = next thought, via `vfunc_event`. Rows refresh from the 1 s heartbeat only while open. |
| C1 focus timer | `pomodoro.js`, `extension.js` (`_pomDo/_pomTick/_pomEvent`) | Keybinding `pomodoro-toggle`. Idle group `idle:pomodoro`. No timer of its own. |
| C2 clipboard / screenshot | `sources.js` `ClipboardSource`, `FilesSource` | Clipboard default off. |
| C3 ping | `sources.js` `PingSource`, `pinglogic.js` | Timer runs only while `show-latency` or `idle-show-ping` is on. Idle group `idle:speed+ping` while shown. |
| C4 public IP / VPN place | `sources.js` `PublicIpSource`, `publicip.js` | Lazy: VPN connect, menu open (30 min cache), optional at login. |
| C5 download finished | `sources.js` `FilesSource`, `filters.js` | `StableWatcher`, 2 s stable size. |
| C6 reminders | `sources.js` `ReminderSource`, `reminders.js`, `buildRemindersPage` in `prefs.js` | JSON string setting `reminders`. |
| C7 notification mirror | `sources.js` `NotifySource` | Title only, never the body. Default off. |

`metadata.json` version is already **6** (bumped once; do not bump again unless you add something after the final zip). `CHANGELOG.md` has entries for A, B, C: append Phase D to it.

### API calls written from memory, NOT checked against the real Shell JS. Verify these first
If `/usr/share/gnome-shell/js/ui/` exists in your sandbox, read it. If not, say so in the report and mark these "done but untested".
1. `vfunc_event(event)` override on `PanelMenu.Button` with `Clutter.EventType.BUTTON_PRESS` / `TOUCH_BEGIN`, plus `this.menu.toggle()`.
2. `Main.wm.addKeybinding('pomodoro-toggle', settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, cb)` and `removeKeybinding`.
3. `global.display.get_sound_player().play_from_theme('complete', 'Focus timer', null)`.
4. `global.display.get_selection()` and its `owner-changed` signal (args: selection type, source) with `Meta.SelectionType.SELECTION_CLIPBOARD`.
5. `Main.messageTray`: `connect('source-added')`, `getSources()`, and each source's `notification-added` signal (`source.title`, `notification.title`).
6. `Gio.FileMonitor` with `WATCH_MOVES` events (`RENAMED` gives `other` as the new file).
7. `Gtk.accelerator_parse` return shape in GTK4 (`[ok, key, mods]`) in `prefs.js`.
8. `Adw.ExpanderRow.add_row`, `Adw.SpinRow`, `Adw.EntryRow` `apply` signal.
Fix anything that differs and say so in the report.

### Known gaps from the earlier phases
- The mock harness from BUILD_PROMPT section 4.2 was **not built**. Cleanup (timers, signals, monitors, keybinding) was only checked by reading the code.
- `rsvg-convert` was not available earlier, so `icons/timer.svg`, `icons/clipboard.svg` and `icons/screenshot.svg` were never rendered. Check them on `#2b2b2b` and fix the `viewBox` if they are not cropped tight.
- The public IP row and ping row in the dropdown exist; the Pomodoro rows exist. Nothing else from B1 is missing.

---------------------------------------------------------------------
## 2. Still to build (Phase D)

Build exactly as in BUILD_PROMPT section 2, Phase D. Hints for this codebase:

**D1. Speed sparkline.** `_paint` builds `parts` for the idle line; add a part type such as `{graph: true, width: 60, color}` handled in `_apply` (an `St.DrawingArea` with fixed width 60 and height ~16, cairo via `area.get_context()` in its `repaint` signal). Keep the last 60 download samples in a ring buffer filled by `_sampleNet()` only while `idle-show-graph` is on. Call `queue_repaint()` once a second only when the idle line is visible (no message and no pomodoro showing). The widget must have a fixed width so the row never changes size. Use an own group (for example `idle:speed+graph`, or combine with the ping group name) so only the arrival animates. Add setting `idle-show-graph` (default false) and a switch in prefs. Disconnect the `repaint` signal and destroy the area in `destroy()`. Note `_apply()` rebuilds widgets when its signature changes: add the graph to the signature.

**D2. Input language.** Use `Main.inputMethod` / `imports.ui.status.keyboard` (in ESM: `import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js'`, `Keyboard.getInputSourceManager()`), `currentSource` (`displayName`, `shortName`) and the manager's `current-source-changed` signal (check the exact name). Post "Language: EN" (category `layout`, Low). Setting `idle-show-layout` (default off) shows the short name in the idle line only when more than one layout is configured (`inputSources` count). New category `layout` needs `show-layout`, `priority-layout`, `icon-layout` keys and a row in `CATEGORIES`. Put it in a new source class and register it in the sources list in `extension.js`. Disconnect in `destroy()`.

**D3. Do Not Disturb sync.** In `_quiet()` read `org.gnome.desktop.notifications` `show-banners` through a `Gio.Settings` created once (guard that the schema exists with `Gio.SettingsSchemaSource.get_default().lookup(...)`). With `quiet-follow-dnd` (default true) and `show-banners == false`, treat as quiet (only Critical gets through). Post "Do Not Disturb ON/OFF" (category `modes`, key `dnd`, Info) when it changes, using a new `icons/dnd.svg` (white-filled, tight `viewBox`, 64x64) added to `iconFor()`. Add the setting and a switch in `prefs.js`. Disconnect the `Gio.Settings` signal in `destroy()`.

**D4. Export / import settings.** On the General page add Export and Import buttons with `Gtk.FileDialog`. Put the validation in a pure module (for example `settingsio.js`, no `gi://` imports) with unit tests: given the schema key list/types/ranges and a parsed JSON object, return `{valid, invalid}`. In `prefs.js` use `settings.settings_schema.list_keys()`, `get_key(k).get_value_type()` / `get_range()` (via the `Gio.SettingsSchemaKey`) and `GLib.Variant` to check type and range. Never import unknown keys. Exclude `data-usage` from export (and refuse it on import). Report invalid keys in an `Adw.Toast` (use `window.add_toast`). `buildRemindersPage` already receives `window`; reuse the same pattern.

Every new setting needs a schema key, a prefs control and, for a new kind of message, a `CATEGORIES` row (plus `show-`, `priority-` and `icon-` keys, as for every category so far).

---------------------------------------------------------------------
## 3. Verification (BUILD_PROMPT section 4, still required)

1. `node --check` every `.js` (copy to `.mjs` first), and `glib-compile-schemas --strict --dry-run schemas`. Run `./tests/run.sh` and add tests for each new pure module (D4 validation especially).
2. **Build the mock harness** outside the repo (scratch folder): a Node ESM loader (`module.register`) that stubs `gi://Clutter`, `gi://Gio`, `gi://GLib`, `gi://GObject`, `gi://St`, `gi://Meta`, `gi://Shell`, `gi://Soup?version=3.0` and the `resource:///org/gnome/shell/...` modules. Import the real `extension.js` and drive it with fake `/proc/net/dev`, fake HTTP, fake clock. Assert at least: idle text and colours; no animation on a per-second tick; message-to-icon mapping; dedupe and cooldowns; data-usage midnight rollover; pomodoro states; reminders fire exactly once; and that `destroy()` leaves nothing behind: count `GLib.timeout_add*` vs `source_remove`, `connect` vs `disconnect`, file monitors cancelled, keybinding removed, selection and message-tray handlers disconnected. Fix every leak you find.
3. Render every SVG you added on a dark background (`rsvg-convert -b '#2b2b2b'`, or `inkscape`, or another renderer; if none exists, say so) and check they are cropped tight.
4. Update `README.md` (icon list, Dropdown, Pomodoro, Reminders, Data usage, Network access list: already partly done, extend it for D) and append Phase D to `CHANGELOG.md`: every new setting key, category, icon, shortcut and network host (D adds no new host).
5. Rebuild the install zip, including **every** `.js` file (current list): `zip -r informer@umesh.shell-extension.zip metadata.json extension.js prefs.js sources.js util.js queue.js data.js speedlogic.js usage.js weatherlogic.js sysinfo.js pomodoro.js pinglogic.js publicip.js reminders.js filters.js <new .js files> schemas icons`.

---------------------------------------------------------------------
## 4. Deliverable

- Code in the repo, one commit per phase if git is available (this repo has no history yet: `git init` and commit A, B, C as one baseline commit "Phases A-C", then D as its own commit).
- Updated `CHANGELOG.md`, `README.md`, install zip, and a repo zip.
- **A final report** listing each of the 20 features (A1 to D4) as **done**, **done but untested on a real shell**, or **skipped (with the reason)**. Be honest: nothing so far has run on a real GNOME Shell. State which Shell APIs you could and could not check (section 1 above), what the mock harness covers, and what it cannot.
- Keep the user's preferences in mind when you write to them: simple everyday words, short answers, explain any hard word in plain language.
