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
mode, now playing, updates, good thoughts and warnings. They take the colour
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

## Files
- `extension.js` - the bar item, queue wiring, Wi-Fi / Bluetooth / volume / mic / battery
- `sources.js` - now playing, USB, lock keys, camera, internet, system warnings, calendar, weather
- `queue.js` - the priority queue (no GNOME imports, easy to test)
- `icons/` - the SVG icons
- `data.js` - message kinds, default priorities, hourly lines, built-in thoughts
- `prefs.js` - settings window
