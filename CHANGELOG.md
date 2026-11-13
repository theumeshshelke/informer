# Changelog

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
