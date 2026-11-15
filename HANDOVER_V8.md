# Handover: Informer version 8 (16 new confirmation messages + icons)

You are continuing **Informer** (`informer@umesh`), a GNOME Shell 50/51 top-bar extension in GNOME 45+ ES-module style (GJS).
The repo is the folder with `extension.js`, `metadata.json`, `schemas/`, `icons/`. Version 7 is done. Build version 8 from this file.
The owner is Umesh. Keep answers and strings simple and short.

## 0. Read first
Read `README.md`, `CHANGELOG.md`, `extension.js`, `sources.js`, `data.js`, `util.js`, `prefs.js`, `queue.js`, `tests/`, `tests/harness/README.md`.
Follow the existing style. Make small additions, do not rewrite working code.

## 1. What the owner wants
Small **confirmation messages in the top bar** when something happens on the computer (like the existing "Wi-Fi is connected to ...",
"Bluetooth is ON", "Charging: 45%", "Safe to remove"). 16 new ones, listed in section 4.
The owner gave an **icons zip** with 16 SVG files, plain still pictures, **no animation**.

**Do not add any animation.** No `<animate>`, `<animateTransform>`, `<set>`, CSS `@keyframes` inside an SVG, and no code that spins,
pulses, shakes or bounces an icon. If an SVG from the zip has animation tags, remove them and keep the still picture.

**Keep the dropdown menu short.** Do not add rows to it. These messages go in the bar only.

## 2. Rules for every change (same as before)
1. Every new setting needs a `<key>` in `schemas/org.gnome.shell.extensions.informer.gschema.xml` (default, range, summary) and a control in `prefs.js`.
2. Every new kind of message is a row in `CATEGORIES` (`data.js`) and has three schema keys: `show-<key>`, `priority-<key>`, `icon-<key>`.
   `tests/logic-version7.test.mjs` fails when one is missing. A missing key crashes the extension, so do not skip this.
3. Every message goes through `_flash()` or `ctx.post()` so priorities, quiet hours and the on/off switch work.
4. Everything that runs (timer, subprocess, D-Bus subscription, signal, file monitor, settings handler) is removed in `destroy()`.
   Nothing may run after `disable()`. The harness checks this at the end.
5. Never block the shell. Use async APIs and `run()` from `util.js`. No synchronous subprocess or network calls.
6. No emoji. Short text, use `clip()` for long names.
7. Only optional tools: if a file, command or D-Bus service is missing, that message quietly does nothing (no errors, no crash).
8. Silent at startup: what already exists when the extension starts is not announced. Only changes are.
9. Do not rename or remove existing setting keys.
10. No new network hosts.
11. Add each new setting to the Settings window. Messages appear in Settings > Messages automatically through `CATEGORIES`.

## 3. Icons
Put the zip's SVGs in `icons/`. Names (must match, lower case):

`monitor ethernet gamepad printer moon power record location touchpad brightness speaker hotspot sleep thermometer reboot network-switch`

- The owner said every SVG has its name **except the signal tower one: save it as `network-switch.svg`**.
- If a file name in the zip is slightly different (for example `power-off`), check what it shows and use the right name from the list.
- Make each icon like the existing ones (see `icons/pendrive.svg`):
  `width="64" height="64"`, `viewBox` cropped tight to the drawing (use `svgelements` to find the bounding box),
  every part that should take the message colour filled `#ffffff`. If an icon has many colours, turn it into one white silhouette.
  Remove `<?xml ...>`, `<!DOCTYPE>`, comments, ids, and animation.
- Render all of them on a dark grey background (`cairosvg`, `pip install cairosvg svgelements pillow --break-system-packages`)
  into one picture and look at it. Fix any that look wrong (cut off, black on dark, too thin).
- Add them to `iconFor()` in `extension.js` and to the icon list in `README.md`.
- Existing icons stay: `wifi-on wifi-off bluetooth volume-up volume-down battery-* airplane dnd keyboard music update thought sun alert timer clipboard screenshot download down up pendrive headphone`.

## 4. The 16 messages
Category key, default priority, icon, text, and how to detect it. Detection ideas are a starting point: check them against the
real APIs, and if one cannot work on GNOME 51, **drop it and say so** in your final answer. Do not guess.

| # | key | prio | icon | text | detection |
|---|-----|------|------|------|-----------|
| 1 | `monitor` | Normal | `monitor` | "Monitor connected" / "Monitor removed" | Monitor manager `monitors-changed`; compare the count with the last count (silent at start). |
| 2 | `ethernet` | Normal | `ethernet` | "Ethernet connected" / "Ethernet unplugged" | `/sys/class/net/en*/carrier` (and `eth*`). Check inside the existing NetworkManager-triggered slow poll. |
| 3 | `gamepad` | Normal | `gamepad` | "Controller connected" / "Controller removed" | `js*` entries appearing in `/dev/input` (file monitor) or `/proc/bus/input/devices`; name from `/sys/class/input/jsN/device/name`. |
| 4 | `printer` | Normal | `printer` | "Printer connected" / "Printer removed" | Easiest: in `UsbDevSource` give USB interface class `07` its own category `printer` (works for USB printers only). |
| 5 | `nightlight` | Low | `moon` | "Night Light is ON" / "OFF" | GSettings `org.gnome.settings-daemon.plugins.color` key `night-light-enabled`. |
| 6 | `powermode` | Normal | `power` | "Power saver" / "Balanced" / "Performance" | D-Bus `net.hadess.PowerProfiles` property `ActiveProfile` (`PropertiesChanged`). |
| 7 | `recording` | High | `record` | "Screen recording started" / "stopped" | GNOME shows a red recording indicator in the panel. Find how Shell 51 exposes it (look at the panel's screen-recording indicator) and watch it. If not possible, drop it. |
| 8 | `location` | Low | `location` | "Location is ON" / "OFF" | GSettings `org.gnome.system.location` key `enabled`. |
| 9 | `touchpad` | Normal | `touchpad` | "Touchpad enabled" / "Touchpad disabled" | GSettings `org.gnome.desktop.peripherals.touchpad` key `send-events`. |
| 10 | `brightness` | Low | `brightness` | "Brightness 60%" | `/sys/class/backlight/*/brightness` and `max_brightness`. Read in the 1 s heartbeat, use a `key` so it replaces itself while sliding, ignore the first reading. |
| 11 | `soundout` | Normal | `speaker` (use `headphone` when the output is headphones) | "Sound: Speakers" / "HDMI" / "Headphones" | Default sink changed: from the existing `pactl subscribe` handler, then `pactl get-default-sink` and the sink description. Do not repeat the existing "Headphones connected" message: skip this one for 2 s after it. |
| 12 | `hotspotclients` | Low | `hotspot` | "2 devices on your hotspot" | Only while the existing hotspot mode is on. Count neighbours on the hotspot interface (`ip neigh` or `/proc/net/arp`). Message only when the count changes. |
| 13 | `wake` | Normal | `sleep` | "Welcome back, slept 2h 10m" | logind `PrepareForSleep` on the system bus. Work out the time from the clock, not from the signal. Ignore sleeps shorter than 1 minute. |
| 14 | `overheat` | High | `thermometer` | "CPU is slowing down: too hot" | `/sys/devices/system/cpu/cpu0/thermal_throttle/core_throttle_count` going up (Intel). If the file is missing, quietly do nothing. At most once per 10 minutes. This is different from the existing `syswarn` high-temperature warning. |
| 15 | `reboot` | Low | `reboot` | "Reboot needed to finish updates" | File `/var/run/reboot-required` exists (Ubuntu). Check at login and every 30 minutes. Say it once per boot. |
| 16 | `wifiswitch` | Normal | `network-switch` | "Switched to NAME" | The Wi-Fi name changes from one name to another (not from none). Do this inside the existing Wi-Fi handling so it does not repeat "Wi-Fi is connected to ...". Show only this one in that case. |

Kinds: `good` for on / connected, `bad` for off / removed, `warn` for 7, 14, 15, `info` for the rest.
For 5, 8 and 9 (settings switches), use a settings `changed::<key>` handler and disconnect it in `destroy()`.

## 5. Tests
- Pure logic (count change, parse names, hotspot count, sleep time, brightness percent) goes in small `gi://`-free modules with tests in
  `tests/logic-version8.test.mjs`. `./tests/run.sh` runs them all.
- Add a scenario block per feature to `tests/harness/run.mjs` (see its README): fake files and command output, fire the heartbeat,
  check the message text. The final lines (no timers, no settings handlers left) must still pass.
- Run `glib-compile-schemas --strict --dry-run schemas`, `./tests/run.sh` and the harness. All must pass.
- None of this proves it works on a real desktop. Say that clearly in your final answer.

## 6. Finish
- Bump `metadata.json` version to 8. Update `CHANGELOG.md` and `README.md` (new messages, new icons, "no new hosts").
- Build `informer@umesh.shell-extension.zip` with: `zip -r informer@umesh.shell-extension.zip metadata.json *.js schemas icons -x "tests/*"`
  and the whole repo zip. Give both to the owner.
- Final answer: short and simple words. List what works, what you dropped and why, and what the owner must test on the real desktop.
- Suggested commit message: "v8: 16 new confirmation messages (monitor, ethernet, controller, printer, night light, power mode, recording, location, touchpad, brightness, sound output, hotspot clients, wake, overheat, reboot, Wi-Fi switch)".
