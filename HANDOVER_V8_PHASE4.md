# Handover: Informer version 8, continue at Phase 4

You are continuing **Informer** (`informer@umesh`), a GNOME Shell 50/51 top-bar extension (GNOME 45+ ES modules, GJS).
The owner is Umesh. Keep answers short, simple words, explain hard words. **Build in phases. Do one phase, then stop and ask "go ahead with the next phase?"**
First read `HANDOVER_V8.md` (the full spec: rules in section 2, icons in section 3, the 16 messages in section 4, tests in 5, finish in 6). This file only says what is done and what is left.

## Status

| Phase | What | State |
|---|---|---|
| 1 | 16 icons from `iconv2.zip` cleaned to white one-colour SVGs (64x64, tight viewBox, no animation), added to `icons/`, mapped in `iconFor()` (all 16 categories already mapped), README list | done |
| 2 | `nightlight`, `location`, `touchpad`, `powermode` | done |
| 3 | `monitor`, `ethernet`, `gamepad`, `printer`, `brightness` | done |
| 4 | `soundout`, `hotspotclients`, `wake`, `overheat`, `reboot`, `wifiswitch`, `recording` | **next** |
| 5 | version 8 tests complete, `metadata.json` version 8, CHANGELOG, README, both zips, final report | todo |

Nothing has run on a real GNOME desktop. Only Node tests and the fake-shell harness. `/usr/share/gnome-shell/js` does not exist in the sandbox, so Shell APIs are unchecked. Say so in the final report.

## What exists now (new in v8)

- `switchlogic.js` (pure): `onOffMessage`, `touchpadMessage`, `profileMessage`.
- `hwlogic.js` (pure): `monitorChange`, `ethernetUp`, `ETH_RE`, `JS_RE`, `gamepadMessage`, `pickBacklight`, `brightnessPct`.
- `usblogic.js`: added `isPrinter`.
- `sources.js`: `SwitchSource` (3 GSettings watchers), `PowerModeSource` (D-Bus PropertiesChanged on both PowerProfiles names), `MonitorSource` (`Main.layoutManager` `monitors-changed`, 600 ms debounce), `GamepadSource` (`/dev/input` directory monitor, only while `show-gamepad` is on); `UsbDevSource` now splits printers (cat `printer`).
- `extension.js`: `_checkBrightness()` in the 1 s heartbeat; Ethernet inside `_doSlow()` (state `eth` in `_prevSlow`); new sources registered in the source list near line 360; `iconFor()` has all 16 new cats.
- `data.js` rows + schema keys (`show-/priority-/icon-<cat>`) exist for: nightlight, location, touchpad, powermode, monitor, ethernet, gamepad, printer, brightness. **Still missing for Phase 4: soundout, hotspotclients, wake, overheat, reboot, wifiswitch, recording.** `tests/logic-version7.test.mjs` fails if a row has no keys.
- Default priorities (spec): soundout Normal, hotspotclients Low, wake Normal, overheat High, reboot Low, wifiswitch Normal, recording High.
- Kinds: `warn` for recording, overheat, reboot; `good`/`bad` for on/off pairs; `info` for the rest.

## Phase 4 notes (what I had planned)

1. **wifiswitch**: in `_doSlow()` where Wi-Fi is compared (`prev.wifi` vs `wifi`): if both `s === 'connected'` and the ssid differs, flash `Switched to NAME` (cat `wifiswitch`, key `wifi`) **instead of** "Wi-Fi is connected to ...". Not from none. Use `clip()`.
2. **soundout**: in the existing pactl subscribe handler (`_readPactl`), debounce, then `pactl get-default-sink` + sink description (`pactl --format=json list sinks`, see `headphones.js`). Icon is `headphone` when the output is headphones (`iconFor` already checks `/headphone/i` in the text). Skip for 2 s after the existing "Headphones connected/unplugged" message. Silent at start. Quietly nothing if `pactl` is missing.
3. **hotspotclients**: only while hotspot mode is on (`prev.hotspot`/`hotspot` in `_doSlow`). Count neighbours on the hotspot interface (`ip neigh` or `/proc/net/arp`); message only when the count changes: "2 devices on your hotspot". Pure parser + test.
4. **wake**: logind `PrepareForSleep` on the system bus (`org.freedesktop.login1`). Keep the time from the clock (`Date.now()`), not from the signal. Ignore sleeps under 1 minute. Text "Welcome back, slept 2h 10m" (use `fmtDuration`/`fmtHM`). Pure helper + test.
5. **overheat**: `/sys/devices/system/cpu/cpu0/thermal_throttle/core_throttle_count` going up; missing file = quiet; at most once per 10 minutes; "CPU is slowing down: too hot". Different from `syswarn`. Pure helper + test.
6. **reboot**: `/var/run/reboot-required` exists; check at login and every 30 min; once per boot. "Reboot needed to finish updates".
7. **recording**: the Shell panel has a screen-recording indicator. Find how Shell 51 exposes it (likely `Main.panel.statusArea` screencast indicator or `Main.screenshotUI`/`global.screencast` signals). **I could not check this offline. If you cannot confirm the API, drop it and say so. Do not guess.**

Existing hooks to reuse: `Source` base class in `sources.js` (`every`, `after`, `sub`, `cancel`, `destroy`), `this.post({text, kind, cat, key})`, `_flash()` in `extension.js`. Everything must be removed in `destroy()`.

## Test harness (important)

Run: `./tests/run.sh` (pure tests, Node 22.7+), `node --import ./tests/harness/register.mjs tests/harness/run.mjs`, `glib-compile-schemas --strict --dry-run schemas`, `node --check` on each `.js` (copy to `.mjs`).
I extended the harness (`tests/harness/gjs-stubs.mjs`, `loader.mjs`):
- `globalThis.__gs.schemas[schemaId] = {key: value}` makes a GSettings schema exist; `__gs.set(schema, key, value)` fires `changed::key`; `__gs.count()` = open handlers.
- `globalThis.__dbus.emit('system'|'session', path, iface, member, params)` fires a D-Bus signal; `__dbus.reply = (dest, path, iface, method) => ...` answers `bus.call` (return an `Error` to fail, `undefined` to ignore); `__dbus.count()` = open subscriptions. `params` needs `get_child_value(i).recursiveUnpack()`.
- `globalThis.__fm.emit(dir, 'created'|'deleted', basename)` fires a directory monitor; `__fm.active` = open monitors.
- `globalThis.__lm.set(n)` sets the monitor count and fires `monitors-changed`.
- Files: `__fs.files` (Map path->text, trimmed text), `__fs.dirs` (Map path->names), `__fs.run = argv => text` for commands.
- The last lines of `run.mjs` check that nothing is left after `disable()` (timers, settings handlers, system settings handlers, file monitors, monitor handlers, D-Bus subscriptions). Add scenario blocks **before** the "clean shutdown" section, in a `{ ... }` block like phases 2 and 3 (`ext.disable()` first, set up fake files, `ext.enable()`, use `ext._indicator`).
- Gotchas I hit: (a) `step(ms)` only fires 1 s timers; fire other timers by hand (`fire(600)` helper in the phase 3 block). (b) `_pollSlow()` is guarded: await it, then flush with `await new Promise(r => setTimeout(r, 0))` twice (`poll` helper). (c) An older harness block switches `show-usbdev` off and leaves it; reset settings you need at the start of your block.
- Tests for pure logic go in `tests/logic-version8.test.mjs` (already has phases 2 and 3, extend it).

## Finish (Phase 5)

Bump `metadata.json` version to 8, update `CHANGELOG.md` (there is no v8 entry yet) and `README.md` (a "New in version 8 (in progress)" section exists; rename it, add Phase 4 messages, "no new hosts"). Build:
`zip -r informer@umesh.shell-extension.zip metadata.json *.js schemas icons -x "tests/*"` and the whole repo zip. Final answer: short, simple words. List what works, what was dropped and why, what the owner must test on the real desktop.
Suggested commit message is in `HANDOVER_V8.md` section 6.
