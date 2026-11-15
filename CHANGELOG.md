# Changelog

## 7
- Pen drive: after you unmount or eject a USB drive the bar says "Safe to remove: NAME" (category `usb`). The "USB removed" message is skipped right after it.
- Other USB devices (OTG): phone, mouse, keyboard, adapter plugged / removed, read from `/sys/bus/usb/devices` every 3 seconds, only while `show-usbdev` is on. Hubs, built-in parts and pen drives are skipped. Module `usblogic.js`, category `usbdev` (Normal).
- Headphones: "Headphones connected / unplugged" for wired headphones, read with `pactl --format=json list sinks` (optional tool). Bluetooth headphones stay in the Bluetooth row. Module `headphones.js`, category `headphones` (Normal).
- Battery: "Charging: 45% (38 W)" a moment after plugging in (charging speed), and "Battery fully charged: 100%". The menu battery row shows the watts too. `chargeWatts()` in `sysinfo.js`.
- Sunrise / sunset: "Sunset in 30 min" once per event. Setting `sun-lead-min`, category `sun` (Low). Same weather request (adds `sunrise,sunset`), checked every minute without the network. Module `sunlogic.js`.
- Data used this week: the last 7 days, every `data-week-hours` hours (default 6). `data-usage` now also keeps the 6 earlier days (old saved data still loads). Category `dataweek` (Low).
- Focus sessions: "3 focus sessions done today" after a focus ends by itself (skipping does not count). Setting `focus-today` (kept by the extension, never exported). Category `focusstats` (Normal).
- Air quality: warning when the US AQI reaches `air-aqi-warn` (default 150), again if it gets worse by a band. Category `airquality` (High). New host: `air-quality-api.open-meteo.com` (only while that message kind is on). The menu shows the AQI.
- Timer: countdown and stopwatch from the bar menu, shown in the bar like `Timer 04:10` / `Stopwatch 01:23` (the focus timer comes first if both run). Settings `timer-minutes`, `timer-sound`; category `timer` (High, also shown in quiet hours). Module `timerlogic.js`.
- Dropdown made short: weather (2 lines, air quality only when bad), data today / 7 days, Wi-Fi, one system line, one battery line, and the timers. Speed, local and public IP, ping, humidity and wind rows were removed (the speed is in the bar already).
- Icons: new `pendrive.svg` (USB) and `headphone.svg`.
- `UsageTracker` and `DayCounter` in `usage.js`. Tests: `tests/logic-version7.test.mjs` (also checks that every category has its three schema keys).

## 6 - Phase A
- Speed colours: settings `speed-colors`, `speed-fast-kbps`, `speed-slow-kbps`.
- Data used today: settings `data-usage` (kept by the extension), `data-usage-hours`; category `datausage` (Low).
- Weather alerts: settings `weather-rain-percent`, `weather-hot`, `weather-cold`; category `weatheralert` (High), icon `alert`.
- Icon switch per message kind: `icon-<category>` keys (one per category).
- New modules: `speedlogic.js`, `usage.js`, `weatherlogic.js`.
- Network: no new hosts (the weather request to open-meteo.com also asks for hourly data).

## 6 - Phase B
- Details dropdown on left click (weather, network, system, battery, footer items). Right click = settings, middle click = next thought.
- New setting `left-click` (`menu` | `settings`, default `menu`).
- Weather request also asks for `daily` high/low/rain (same host, open-meteo.com). `SystemSource.snapshot()` added.
- New module `sysinfo.js`. Public IP, ping and Pomodoro rows will be added with C1, C3 and C4.

## 6 - Phase C (part 1: C1, C3, C4)
- Focus timer: settings `pomodoro-focus-min`, `pomodoro-short-min`, `pomodoro-long-min`, `pomodoro-sound`, `color-focus`; shortcut `pomodoro-toggle` (default Super+Alt+P); category `pomodoro` (High); icon `timer`. Module `pomodoro.js`.
- Latency: settings `ping-seconds`, `idle-show-ping`, `ping-warn-ms`; category `latency` (Normal). Module `pinglogic.js`. Host: 1.1.1.1:443.
- Public IP and VPN location: setting `public-ip-at-start`; category `vpnlocation` (Low). Module `publicip.js`. Host: ipwho.is.
- Menu: new rows for ping, public IP and focus timer controls.

## 6 - Phase C (part 2: C2, C5, C6, C7)
- Clipboard "Copied" (`show-clipboard`, default off) and Screenshot saved (`show-screenshot`); categories `clipboard`, `screenshot` (Low); icons `clipboard`, `screenshot`.
- Download finished: category `download` (Normal), switch `show-download`, uses the `down` icon. Module `filters.js`.
- Reminders: setting `reminders` (JSON text), category `reminder` (High), `alert` icon, new Reminders page. Module `reminders.js`.
- Notification mirror: `show-notifications` (default off), `notification-apps` (list of app names), category `notifications` (Normal).
- Every new category also has `show-`, `priority-` and `icon-` keys. No new network hosts.

## 6 - Phase D
- Speed graph (D1): setting `idle-show-graph` (default off). Last 60 download samples in a ring buffer, filled only while the switch is on; a fixed 60x16 px drawing area, redrawn once a second only while the speed line is on screen. Idle group `idle:speed+graph`. Module `sparkline.js`.
- Input language (D2): setting `idle-show-layout` (default off); category `layout` (Low) with `show-layout`, `priority-layout`, `icon-layout`; new source `LayoutSource`; new icon `keyboard`. Message "Language: EN" only when more than one input source is set up.
- Do Not Disturb (D3): setting `quiet-follow-dnd` (default on). Quiet (only Critical) while `org.gnome.desktop.notifications` `show-banners` is false. Message "Do Not Disturb ON/OFF" (category `modes`, key `dnd`, Info, always shown because you just switched it); new icon `dnd`.
- Backup (D4): Export / Import buttons (General page). Module `settingsio.js` checks type and range; `data-usage` is never exported or imported. The Reminders page and the thoughts box now follow outside changes (an import).
- Bluetooth icon replaced with a new Bluetooth sign (`icons/bluetooth.svg`).
- New shortcuts: none. New network hosts: none.
- Tests: `tests/logic-graph-settingsio.test.mjs`.
- Icons replaced with your SVGs: `screenshot`, `timer`, `clipboard`. New `download` icon for "Download finished" (the `down` arrow stays for the speed line and data used today).
