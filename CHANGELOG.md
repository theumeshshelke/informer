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
