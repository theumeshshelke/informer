# Informer
GNOME Shell top-bar extension: live **network speed** (and the temperature)
that slides in live updates (green = good, red = bad, amber = warning), plus a
good thought every few minutes. The old time-based greeting is still there:
Settings > General > Default line.

**Click** the item to open settings. **Middle-click** to see the next good
thought right away.

## Icons
SVG icons in `icons/` sit next to the text: arrows for download / upload, a
sun for the weather, and icons for Wi-Fi, Bluetooth, volume, battery, airplane
mode, a timer, a clipboard, a screenshot frame, now playing, updates, good thoughts and warnings. They take the colour
of the message. Switch off in Settings > General > Show icons (the bar then
shows plain `↓ ↑` text). To change an icon, replace the file in `icons/`
(keep the name); parts filled with `#ffffff` take the message colour, any
other colour (like the sun) stays as it is.

## Animations
Settings > General > Animation: slide right-to-left, slide left-to-right,
**roll top-to-bottom**, **roll bottom-to-top**, **flip**, or **random** (a
different one each time). Rolling and flip move the old text out first, then
the new text in. The speed numbers change quietly every second; only a new
message animates.

## What it tells you
- **Network speed** (download / upload, all real interfaces) as the default line
- **Weather**: temperature in the default line and a weather message every
  15 minutes (condition, humidity, wind). Data from Open-Meteo; set a city in
  Settings > Weather, or leave it empty to use the place your IP address points
  to (looked up through ipwho.is). Celsius or Fahrenheit.
- Wi-Fi, Bluetooth, charging, volume (as before)
- **Internet lost / back** (Wi-Fi connected but nothing works), with how long you were offline
- **Now playing** from any media player, including YouTube Music in the browser (MPRIS over D-Bus)
- **USB** pen drives plugged / removed, by name (storage only, via UDisks2)
- Caps Lock / Num Lock, **microphone** muted, **camera** in use
- **VPN**, **hotspot** and **airplane mode** on / off
- **Battery**: "unplug the charger" at your charge limit (default 80%), clearer low (20%) and critical (10%, 5%) warnings
- **Calendar**: "Meeting in 10 min" (uses the calendars already in GNOME's clock menu)
- **System warnings**: high CPU, RAM, temperature, low disk space, updates available
- Your **own good thoughts**, edited in the settings window

## Priorities
Every kind of message has a priority: Low, Normal, High or Critical (set in
Settings > Messages). A higher priority interrupts the message on screen; the
rest wait in a queue, best first. Waiting messages that go stale are dropped
(Critical never is). A new message with the same topic (volume, caps lock ...)
replaces the old one.

## Quiet hours
Settings > General: pick hours, and/or stay quiet while an app is fullscreen.
Only Critical messages get through.

## Install
    gnome-extensions install --force informer@umesh.shell-extension.zip
Log out and back in, then:
    gnome-extensions enable informer@umesh

Requires GNOME Shell 50/51, NetworkManager, BlueZ and pactl.
The weather needs internet access (libsoup 3, already part of GNOME Shell).
Optional: UDisks2 (USB), PackageKit or apt (updates), GNOME calendars (events).

## New in version 6
- **Speed colours**: green when fast, amber when slow, red when there is no link.
- **Data used today**: shown every few hours. It is kept across restarts and resets at midnight.
- **Weather alerts**: a warning once when rain, heat or cold starts (same Open-Meteo request, no new host).
- **Icon switch** for each kind of message (Messages page).
- New icon use: `alert` (weather alerts), `down` (data used today).

## Dropdown (new)
Left-click the bar to open a details menu: weather (now, today, tomorrow), network (speed, data used today, Wi-Fi name and signal, local IP), system (CPU, RAM, temperature, free disk) and battery (percent, time left). Right-click opens settings, middle-click shows the next good thought. In General settings you can set left-click back to opening settings. The menu only reads things while it is open.

## Focus timer (new)
Start, pause, skip and reset from the bar menu, or press the shortcut (default Super+Alt+P). Focus 25 min, short break 5, long break 15 every 4th break (all changeable). The bar shows `Focus 18:42` in its own colour instead of the speed. A message and a sound mark the end of each phase. Nothing is kept across restarts.

## Latency and public IP (new)
The latency is the time to connect to 1.1.1.1:443 every 10 seconds (no `ping` command). A warning shows when it stays high. The menu also shows your public IP and place, and a message names your VPN exit place when a VPN connects.

## Reminders (new)
The Reminders page lets you add messages that show at a time you pick (text, hour and minute, days of the week, repeat or once). Presets: Drink water, Stretch, Fixed time event. A reminder shows once per day and time, even if you are a minute or two late. No network.

## Notices (new)
- **Screenshot saved**: watches `~/Pictures/Screenshots` (and `~/Pictures` for files named Screenshot...). On by default.
- **Download finished**: watches your Downloads folder. A file counts as done when its size stays the same for 2 seconds. Temporary files (`.crdownload`, `.part`, `.download`) and hidden files are ignored. On by default.
- **Copied**: says only "Copied" when you copy something. It never reads or shows what you copied. Off by default.
- **Notification mirror**: shows "App: title" of a new notification, never the text. Off by default. You can limit it to some apps.
Folder watching and clipboard listening only run while their switch is on.

## Network access
- `api.open-meteo.com`, `geocoding-api.open-meteo.com`: weather (can be turned off).
- `ipwho.is`: place of your IP for the weather when no city is set, the public IP in the menu (at most every 30 minutes, only while the menu is open or after a VPN connects), and VPN location. Looked up at login only if you turn on "Look up the public IP at login".
- `1.1.1.1:443`: latency and internet checks (a plain connection, no data sent).

## Files
- `extension.js` - the bar item, queue wiring, Wi-Fi / Bluetooth / volume / mic / battery
- `sources.js` - now playing, USB, lock keys, camera, internet, system warnings, calendar, weather
- `speedlogic.js`, `usage.js`, `weatherlogic.js` - small logic files (no GNOME imports, easy to test)
- `sysinfo.js` - small helpers for the dropdown (no GNOME imports)
- `pomodoro.js`, `pinglogic.js`, `publicip.js` - focus timer, latency and public IP logic (no GNOME imports)
- `reminders.js`, `filters.js` - reminder times and file / notification filters (no GNOME imports)
- `queue.js` - the priority queue (no GNOME imports, easy to test)
- `icons/` - the SVG icons
- `data.js` - message kinds, default priorities, hourly lines, built-in thoughts
- `prefs.js` - settings window
