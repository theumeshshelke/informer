# Task: extend the "Informer" GNOME Shell extension with 20 new features

You are working on **Informer** (`informer@umesh`), a GNOME Shell 50/51 top-bar extension written in GNOME 45+ ES-module style (GJS). Build **every feature listed below**, in the phases given. Work in the repo root (the folder that contains `extension.js`, `metadata.json`, `schemas/`, `icons/`).

Read all the existing code first (about 2,500 lines): `extension.js`, `sources.js`, `queue.js`, `data.js`, `util.js`, `prefs.js`, `README.md`, `schemas/*.gschema.xml`. Follow the existing style exactly. Do not rewrite working code. Make surgical additions.

---------------------------------------------------------------------
## 1. How the extension works now (do not break any of this)

- `extension.js`: `InformerIndicator` (a `PanelMenu.Button`, created with `super._init(0.0, 'Informer', true)`, i.e. **no dropdown menu yet**). It contains:
  - `_row` (St.BoxLayout, the thing that is animated, min-width set for the idle line) > `_content` (St.BoxLayout) > a list of `St.Icon` / `St.Label` widgets.
  - `_show(parts, color, group, minEm)`: `parts` = `[{icon:'name', gap?}, {text, gap?}]`. A change of `group` is animated; text changes inside one group (live speed numbers) are drawn silently. `_apply()` rebuilds widgets only when the shape (icons + colour) changes.
  - `_animate()` / `_enter()` / `_pickMode()`: modes `right-to-left`, `left-to-right`, `top-to-bottom`, `bottom-to-top`, `flip`, `random`. Rolling modes animate the old text out first; stale callbacks are cancelled with `this._gen`.
  - `_paint(cur)`: shows the current queued message, or the **idle line**: network speed (`↓/↑` icons + numbers, read from `/proc/net/dev` by `_sampleNet()` every 1 s) plus the temperature with a sun icon. Setting `idle-display` = `speed` | `greeting`.
  - `iconFor(m)`: maps a queued message `{text, kind, cat, key}` to an icon name. `_gicon(name, color)` loads `icons/<name>.svg`, replaces `#ffffff` with the message colour, wraps it in a `Gio.BytesIcon`. Icons are cropped tight to their artwork; size is `ICON_PX`.
  - 1-second heartbeat (`this._timer`): `_checkBattery()`, `_sampleNet()`, `_render()`.
  - `_flash(text, kind, cat, opts)`: the only way to post a message. `kind` = `good|bad|warn|info|thought`. `cat` = a category key from `data.js` (controls the on/off switch `show-<cat>` and the priority `priority-<cat>`). `opts` = `{key, boost, prio, ms, force}`. A message with the same `key` replaces the older one.
  - Left click opens preferences; middle click shows the next good thought.
- `queue.js`: priority queue (Low 0, Normal 1, High 2, Critical 3). A higher priority interrupts; stale low-priority messages are dropped. Pure ES module, no `gi://` imports.
- `sources.js`: `class Source` base (timers via `every()` / `after()`, D-Bus subscriptions, `destroy()` cleans up everything) and sources: `MediaSource`, `UsbSource`, `KeyboardSource`, `CameraSource`, `InternetSource`, `SystemSource`, `CalendarSource`, `WeatherSource` (Open-Meteo through `Soup 3`, exposes `.current` and `.brief()`). Each source gets `ctx = {settings, post}`; `post({text, kind, cat, key?, boost?, ms?})`.
- `data.js`: `CATEGORIES` (one row per kind of message; `toggle:false` means no `show-<key>` switch), `HOURLY`, `THOUGHTS`. No `gi://` imports, because `prefs.js` imports it too.
- `prefs.js`: Adw preferences window with pages General, Weather, Messages, Alerts, Thoughts, Colors. Helpers: `spinRow`, `switchRow`, `colorRow`, `categoryRow`.
- Settings live in `schemas/org.gnome.shell.extensions.informer.gschema.xml`.

### Rules for every change (important)
1. **Every new setting** needs: a `<key>` in the schema (with default, range where relevant, summary), a control in `prefs.js`, and, if it is a new kind of message, a row in `CATEGORIES` (`data.js`) with a sensible default priority.
2. **Every new message** goes through `_flash()` / `ctx.post()`, so quiet hours, priorities, and the on/off switch keep working.
3. **Every new timer, subprocess, D-Bus subscription, signal connection or HTTP request must be cleaned up in `destroy()`** (extension review rule: nothing may run after `disable()`). Use the `Source` base class helpers.
4. **Never block the shell.** Use async APIs / `run()` from `util.js`. No synchronous subprocess or network calls.
5. **No emoji.** Use the SVG icons in `icons/`. For a new icon: add `icons/<name>.svg` with `viewBox` cropped tight to the artwork, a `width="64" height="64"`, parts that should take the message colour filled with `#ffffff`. Add it to `iconFor()`. Make sure the name appears in the README icon list.
6. Keep `metadata.json` valid; bump `"version"` once at the end.
7. Keep every user-visible string short (the bar is narrow). Use `clip()` from `util.js` for anything long or user-supplied.
8. Keep the code dependency-free (only GNOME Shell / GLib / Gio / Soup / St / Clutter). Use external CLI tools only if they are optional and the feature quietly turns itself off when they are missing (like `pactl` / `nmcli` already do).
9. Do not remove or rename existing settings keys; existing users' settings must keep working.

---------------------------------------------------------------------
## 2. The features to build

### Phase A: quick wins

**A1. Speed colours.** In the idle line, colour the speed numbers and arrows by speed: green when above a "fast" threshold, the normal idle colour in between, amber below a "slow" threshold, red when the link is down (no real interface is up or `nmcli` says disconnected). Add settings `speed-colors` (bool, default true), `speed-fast-kbps`, `speed-slow-kbps`. Colours come from the existing `color-good` / `color-warn` / `color-bad`. Colour changes must not trigger the arrival animation (same group).

**A2. Data used today.** Track total downloaded/uploaded bytes since local midnight (persist the running totals and the date in a new setting `data-usage` of type `a{sx}` or a JSON string `s`, saved at most once a minute and on `destroy()`, so it survives restarts and reboots; handle counter resets after a reboot by tracking deltas, never absolute counters). Show it as a message "Today: 2.3 GB down, 340 MB up" every N hours (`data-usage-hours`, default 3, category `datausage`, low priority) and on demand (see B1 dropdown). Reset at midnight.

**A3. Weather alerts.** Extend `WeatherSource`: request hourly precipitation probability + temperature (Open-Meteo `hourly=precipitation_probability,temperature_2m`, `forecast_hours=6`). Post a `warn` message "Rain likely in about an hour (70%)" when the chance is >= `weather-rain-percent` (default 60) within the next 2 hours (post it once per rain event, not every refresh), and an alert when the temperature crosses `weather-hot` (default 38 °C, converted for °F) or `weather-cold`. Category `weatheralert`, priority High, icon `alert`. Setting switch `show-weatheralert`.

**A4. Per-category icon toggle.** Add a second small switch per row on the Messages page: "Show icon". Setting key `icon-<cat>` for every category (generate in a loop in the schema file by hand, since the schema must be static XML; default true). `iconFor()` returns null when it is off. The global `show-icons` still works as a master switch.

### Phase B: the dropdown (needed by several later features)

**B1. Details dropdown.** Today the indicator is created with `dontCreateMenu = true` and left-click opens preferences. Change it so **left-click opens a popup menu** (`PopupMenu`) with these live rows, each with its icon:
- Weather: city, temperature, feels-like, condition, humidity, wind, high/low for today and a short forecast line (from the A3 request; add `daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max`).
- Network: current speed, today's data (A2), Wi-Fi name and signal, local IP, public IP (see C4), ping (see C3).
- System: CPU %, RAM %, temperature, disk free (reuse `SystemSource` readings; expose them through a `snapshot()` method rather than reading the files twice).
- Battery: percent, status, time remaining (read `time_to_empty_now` / `time_to_full_now` or compute from `energy_now` / `power_now` when present).
- Pomodoro controls (see C1).
- Footer items: "Next good thought", "Settings".
Keep **middle-click** = next good thought, and add **right-click** = open Settings. Add a setting `left-click` (`menu` | `settings`, default `menu`) so the old behaviour can be restored. The menu must refresh its rows only while it is open (connect `open-state-changed`), and must not hold timers when closed. Style it to match the Shell (use `PopupMenu.PopupMenuItem`, `PopupSeparatorMenuItem`, `PopupBaseMenuItem` with `St.Icon`s).

### Phase C: medium features

**C1. Pomodoro / focus timer.** New `PomodoroSource` (or a small class in a new file `pomodoro.js`). States: idle, focus (default 25 min), short break (5), long break (15 every 4th). Controlled from the dropdown (Start / Pause / Skip / Reset) and by a keyboard shortcut declared in the schema (`pomodoro-toggle`, type `as`, default `['<Super><Alt>p']`, registered with `Main.wm.addKeybinding` and removed in `destroy()`). While running, the idle line shows the countdown instead of the speed, e.g. `Focus 18:42` (group `idle:pomodoro`, minimal animation, colour from a new `color-focus` setting default `#4da3ff`). When a phase ends post a `High` message ("Focus done. Take a 5 min break.") and optionally play the system "complete" sound through `global.display.get_sound_player()` or `canberra-gtk-play` if available. Settings: durations, `pomodoro-sound` (bool), category `pomodoro`. Persist nothing across restarts.

**C2. Screenshot / clipboard notices.** Clipboard: watch `St.Clipboard.get_default()` is not event-driven in the Shell, so instead connect to `Meta.Selection` `owner-changed` (`global.display.get_selection()`), debounce 300 ms, and post "Copied" (never show the clipboard text; privacy). Screenshot: watch `~/Pictures/Screenshots` (and the XDG pictures dir) with a `Gio.FileMonitor`; on a new `*.png` post "Screenshot saved". Categories `clipboard`, `screenshot`, Low priority, each with its own switch; default **off** for clipboard (privacy), on for screenshot.

**C3. Ping / latency.** Every 10 s (setting `ping-seconds`) measure TCP connect time to `1.1.1.1:443` using `Gio.SocketClient` (the same technique `InternetSource._probe` uses; do not spawn `ping`). Keep the last 60 results in memory. Show `24 ms` after the speed numbers in the idle line when `idle-show-ping` is on (default off). Post a `warn` "High latency: 480 ms" when the median of the last 3 results exceeds `ping-warn-ms` (default 300), with a 10-minute cooldown. Category `latency`, priority Normal.

**C4. Public IP and VPN location.** When a VPN connects (the existing slow-poll in `extension.js` already detects `vpns`), fetch `https://ipwho.is/` once (through `Soup`, 10 s timeout, cancellable) and post "VPN: Frankfurt, Germany (185.x.x.x)". Also expose the public IP + country to the dropdown (B1), refreshed at most every 30 minutes and only while the menu is open or after a network change. Fetch lazily; never at login unless the user turns on `public-ip-at-start`. Category `vpnlocation` (low). Document in the README that this contacts ipwho.is.

**C5. Download finished.** Watch the XDG download directory with `Gio.FileMonitor`. Browsers write `*.crdownload`, `*.part`, `*.download` temp files and rename on completion: post "Downloaded: <name>" when a file appears whose name does not end with those suffixes and whose size has been stable for 2 seconds. Ignore hidden files. Category `download`, Normal priority, switch `show-download`. Clicking nothing is required (no actions).

**C6. Custom reminders.** New settings page "Reminders": a list of `{label, time HH:MM, days (bitmask Mon..Sun), repeat bool}`. Store as `a(sibb)`-style or a JSON string `s` key `reminders`. Edit in `prefs.js` with an `Adw.ExpanderRow` + add / delete buttons. A new `ReminderSource` checks every 20 s (using the local clock) and posts a High-priority `warn` message "Reminder: Drink water" with the `alert` icon, once per occurrence. Examples the UI should offer as presets: water, stretch, prayer / fixed-time events. No network.

**C7. Notification mirror.** Show the title (app name + summary, never the body; privacy) of a new desktop notification as a short Normal-priority message: "WhatsApp: New message". Hook `Main.messageTray` `source-added` / each source's `notification-added` (or `Main.messageTray.connectObject('source-added', ...)`), and disconnect in `destroy()`. Settings: `show-notifications` (default off) and an app allow-list `notification-apps` (`as`, empty = all). Skip notifications while quiet hours are active (that is already handled by `_flash`).

### Phase D: bigger features

**D1. Speed sparkline.** Draw a tiny graph (last 60 s of download speed, 60 samples) next to the speed numbers using `St.DrawingArea` and cairo (`area.get_context()`), height about 16 px, width 60 px, colour = the speed colour. Redraw (`queue_repaint()`) once a second only when `idle-show-graph` is on (default off) and the idle line is visible; stop repainting while a message covers it. Must not change the width of the row between ticks (fixed width).

**D2. Keyboard layout / input language.** Post "Language: EN" / "Language: मराठी" when the input source changes. Use `Main.inputMethod` / `imports.ui.status.keyboard`'s `getInputSourceManager()` and its `currentSource` (`displayName`, `shortName`); connect to its `notify::current-source`-style signal (check the exact name in the installed Shell version) and disconnect in `destroy()`. Category `layout`, Low priority. The message should show the short name in the idle line only when more than one layout is configured (setting `idle-show-layout`, default off).

**D3. Do Not Disturb sync.** Read `org.gnome.desktop.notifications` `show-banners` through a `Gio.Settings` and treat `show-banners == false` as quiet (only Critical gets through) in `_quiet()`. New setting `quiet-follow-dnd` (default true) + a switch in prefs. Show "Do Not Disturb ON/OFF" as an Info message when it changes (category `modes`, key `dnd`, icon `alert`... add a new `dnd.svg`).

**D4. Export / import settings.** On the General page add two buttons: **Export** (writes all keys of the schema to a JSON file chosen with `Gtk.FileDialog`) and **Import** (reads a JSON file, validates every key against the schema's type and range with `settings.get_range()` / `GLib.Variant` checks, applies valid ones, reports invalid ones in an `Adw.Toast`). Never import unknown keys. The `data-usage` key must be excluded from export.

---------------------------------------------------------------------
## 3. Cross-cutting requirements

- **Schema size and order:** keep related keys together; keep the file valid (`glib-compile-schemas --strict --dry-run schemas` must pass).
- **Performance:** idle CPU use should stay negligible. Do not add per-second work that is not needed; gate expensive work behind its setting. Features that are off by default must cost nothing when off (no timers, no monitors).
- **Privacy:** never log or display clipboard text, notification bodies, or full public IPs in `console` output. Features that contact the network must be listed in the README with the host name.
- **Failure handling:** every source that can fail (no network, missing file, missing D-Bus service, missing tool) must fail quietly and keep the rest of the extension working. A source throwing in its constructor must not stop the others (the existing `try/catch` around source creation does this; keep it for new sources and register new ones in the same list in `extension.js`).
- **Quiet hours / fullscreen / priorities:** all of it must keep working for the new categories, so every new message uses `_flash` with a `cat`.
- **Animations:** new idle states (pomodoro countdown, ping, graph) must use their own `group` so only the arrival animates. Never animate once per second.

---------------------------------------------------------------------
## 4. How to verify (you cannot run a real GNOME Shell, so test the logic)

1. `node --check` every `.js` file (copy to `.mjs` first), and run `glib-compile-schemas --strict --dry-run schemas`.
2. Build a **mock harness** (outside the repo, e.g. in a scratch folder) that stubs `gi://Clutter`, `gi://Gio`, `gi://GLib`, `gi://GObject`, `gi://St`, `gi://Soup?version=3.0` and the `resource:///org/gnome/shell/...` modules using a Node ESM loader hook (`module.register`), then import the real `extension.js` and drive it: feed fake `/proc/net/dev` readings, fake HTTP responses, fake clocks. Assert: idle text and colours, no animation per tick, message to icon mapping, dedupe/cooldowns, midnight rollover of data usage, pomodoro state machine, reminders firing exactly once, and that `destroy()` leaves no timers or signals behind (count `timeout_add` vs `source_remove`, and connect vs disconnect).
3. Unit-test pure logic (pomodoro state machine, reminder matching, data-usage delta logic, forecast to alert logic, settings import validation) in plain Node by putting that logic in modules **without** `gi://` imports (like `queue.js` and `data.js`) and importing them from the extension. Prefer this structure for all new pure logic.
4. Check every SVG you add renders on a dark background (`rsvg-convert -b '#2b2b2b'`) and is cropped tight.
5. Update `README.md` (new sections: Dropdown, Pomodoro, Reminders, Data usage, Network access list) and bump `metadata.json` version. Rebuild the install zip:
   `zip -r informer@umesh.shell-extension.zip metadata.json extension.js prefs.js sources.js util.js queue.js data.js schemas icons` plus any new `.js` files.

---------------------------------------------------------------------
## 5. Deliverable

- All code changes in the repo, one commit per phase (A, B, C, D) with clear messages.
- A short `CHANGELOG.md` entry listing every new setting key, category, icon, keyboard shortcut and network host.
- A final report stating, for each of the 20 features (A1 to D4), whether it is **done**, **done but untested on a real shell**, or **skipped (with the reason)**. Be honest about anything you could only test with mocks. If a Shell API differs in GNOME 50/51 from what is described above (for example the keyboard input source signal name or the exact `messageTray` signals), check the installed Shell JS sources if present (`/usr/share/gnome-shell/js/ui/`) and adapt, and say so in the report.
