import assert from 'node:assert/strict';
import {makeSettings} from './settings.mjs';
const R = new URL('../../', import.meta.url).href;
globalThis.__now = Date.UTC(2026, 10, 15, 10, 0, 0);
Date.now = () => globalThis.__now;
globalThis.__fs = {files: new Map(), dirs: new Map(), run: null};
globalThis.__settings = makeSettings();
const S = globalThis.__settings;
const fs = globalThis.__fs;
fs.files.set('/sys/class/power_supply/BAT0/capacity', '45');
fs.files.set('/sys/class/power_supply/BAT0/status', 'Discharging');
let hpConnected = false;
fs.run = argv => {
    if (argv[0] === 'pactl' && argv[1] === '--format=json')
        return JSON.stringify([{name: 'alsa_output.pci', active_port: hpConnected ? 'analog-output-headphones' : 'analog-output-speaker',
            ports: [{name: 'analog-output-headphones', type: 'Headphones', availability: hpConnected ? 'available' : 'not available'},
                {name: 'analog-output-speaker', type: 'Speaker', availability: 'availability unknown'}]}]);
    return '';
};
const {default: Ext} = await import(R + 'extension.js');
const src = await import(R + 'sources.js');
const ext = new Ext();
ext.enable();
const ind = ext._indicator;
const heartbeat = () => { for (const t of [...globalThis.__timers.values()]) if (t.ms === 1000) t.cb(); };
const step = (ms) => { globalThis.__now += ms; heartbeat(); };
const texts = () => [ind._q.cur?.text, ...ind._q.items.map(m => m.text)].filter(Boolean);
const drain = () => { ind._q.clear(); };
for (let i = 0; i < 3; i++) step(1000);
console.log('boot ok; bar group:', ind._wantGroup);
assert.match(ind._wantGroup, /^idle:speed/);

// ---- battery: charging speed + fully charged
drain();
fs.files.set('/sys/class/power_supply/BAT0/status', 'Charging');
fs.files.set('/sys/class/power_supply/BAT0/power_now', '38500000');
step(1000);
assert.ok(!texts().some(t => /^Charging/.test(t)), 'no message yet, waits for the speed to settle');
step(2500);
assert.ok(texts().includes('Charging: 45% (39 W)'), 'charging with watts: ' + texts());
drain();
fs.files.set('/sys/class/power_supply/BAT0/status', 'Full'); fs.files.set('/sys/class/power_supply/BAT0/capacity', '100');
step(1000);
assert.ok(texts().includes('Battery fully charged: 100%'), texts().join('|'));
fs.files.set('/sys/class/power_supply/BAT0/status', 'Discharging');
step(1000);
// charging with no watts info still says charging
fs.files.set('/sys/class/power_supply/BAT0/power_now', '0'); fs.files.set('/sys/class/power_supply/BAT0/capacity', '50');
drain(); fs.files.set('/sys/class/power_supply/BAT0/status', 'Charging'); step(1000); step(2500);
assert.ok(texts().includes('Charging: 50%'), texts().join('|'));
// unplugged before the wait is over: nothing
drain(); fs.files.set('/sys/class/power_supply/BAT0/status', 'Discharging'); step(1000);
fs.files.set('/sys/class/power_supply/BAT0/status', 'Charging'); step(1000);
fs.files.set('/sys/class/power_supply/BAT0/status', 'Discharging'); step(1000); step(3000);
assert.ok(!texts().some(t => /^Charging/.test(t)), texts().join('|'));
console.log('battery ok');

// ---- focus timer + sessions today
drain();
ind._pomDo('toggle');
step(1000);
assert.match(ind._wantGroup, /idle:pomodoro/);
for (let i = 0; i < 25 * 60; i += 60) step(60000);      // 25 minutes
let all = texts();
assert.ok(all.some(t => /^Focus done/.test(t)), all.join('|'));
assert.ok(all.includes('1 focus session done today'), all.join('|'));
assert.equal(JSON.parse(S.get_string('focus-today')).n, 1);
drain(); ind._pomDo('reset');
// skipping does not count
ind._pomDo('toggle'); ind._pomDo('skip');
assert.ok(!texts().some(t => /focus session/.test(t)), 'skip does not count');
ind._pomDo('reset'); drain();
console.log('focus ok');

// ---- timer: countdown and stopwatch
ind._tmrDo('count'); step(1000);
assert.equal(ind._wantGroup, 'idle:timer');
assert.match(ind._want.parts.at(-1).text, /^Timer 09:5\d$/, ind._want.parts.at(-1).text);
ind._tmrDo('toggle'); step(1000);
assert.match(ind._want.parts.at(-1).text, /^Paused /);
ind._tmrDo('toggle');
for (let i = 0; i < 10; i++) step(60000);
assert.ok(texts().includes('Timer done: 10 min'), texts().join('|'));
assert.equal(ind._tmr.active, false);
drain(); ind._tmrDo('watch'); step(5000);
assert.match(ind._want.parts.at(-1).text, /^Stopwatch 00:0\d$/);
ind._tmrDo('reset'); step(1000);
assert.match(ind._wantGroup, /^idle:speed/);
// timer done is shown even in quiet hours
S.set_boolean('quiet-enabled', true); S.set_int('quiet-start', 0); S.set_int('quiet-end', 23);
drain(); ind._tmrDo('count'); S.set_int('timer-minutes', 1); ind._tmr.total = 1000; step(3000);
assert.ok(texts().some(t => /^Timer done/.test(t)), 'forced through quiet hours: ' + texts());
S.set_boolean('quiet-enabled', false);
console.log('timer ok');

// ---- data used this week
drain();
globalThis.__now += 7 * 3600000; step(1000); step(1000);
assert.ok(texts().some(t => /^Last 7 days: /.test(t)), texts().join('|'));
console.log('week ok');

// ---- headphones
drain();
await ind._pollHeadphones();                     // first look: silent
assert.ok(!texts().some(t => /Headphones/.test(t)));
hpConnected = true; await ind._pollHeadphones();
assert.ok(texts().includes('Headphones connected'), texts().join('|'));
hpConnected = false; await ind._pollHeadphones();
assert.ok(texts().includes('Headphones unplugged'), texts().join('|'));
S.set_boolean('show-headphones', false); await ind._pollHeadphones(); assert.equal(ind._hp, null);
S.set_boolean('show-headphones', true);
console.log('headphones ok');

// ---- sources
const posted = [];
const ctx = {settings: S, post: o => posted.push(o)};
// sun
const w = new src.WeatherSource(ctx);
const sunset = Date.now() + 30 * 60000;
w._sun = [{kind: 'sunset', at: sunset}];
w._sunTick(); w._sunTick();
assert.equal(posted.filter(p => p.cat === 'sun').length, 1);
assert.equal(posted.find(p => p.cat === 'sun').text, 'Sunset in 30 min');
// air quality (no network: fake the request)
w.current = {temp: 20};
w._getJson = async () => ({current: {us_aqi: 172}});
await w._refreshAir(w._gen, {lat: 1, lon: 2});
assert.equal(w.current.aqi, 172);
assert.match(posted.find(p => p.cat === 'airquality').text, /AQI 172 \(Unhealthy\)/);
w._getJson = async () => { throw new Error('offline'); };
await w._refreshAir(w._gen, {lat: 1, lon: 2});                  // failure: quiet, no crash
S.set_boolean('show-airquality', false); await w._refreshAir(w._gen, {lat: 1, lon: 2}); assert.equal(w.current.aqi, null);
S.set_boolean('show-airquality', true);
w.destroy();
// USB storage: safe to remove
posted.length = 0;
const u = new src.UsbSource(ctx);
const UD = 'org.freedesktop.UDisks2';
u._ingest('/d/1', {[`${UD}.Drive`]: {ConnectionBus: 'usb', Vendor: 'Sandisk', Model: 'Cruzer'}}, false);
u._ingest('/b/1', {[`${UD}.Block`]: {Drive: '/d/1', IdLabel: 'MYDRIVE'}, [`${UD}.Filesystem`]: {MountPoints: [[47]]}}, false);
u._ingest('/b/2', {[`${UD}.Block`]: {Drive: '/d/1', IdLabel: 'P2'}, [`${UD}.Filesystem`]: {MountPoints: [[48]]}}, false);
u._unmounted('/b/1');
assert.equal(posted.length, 0, 'another partition is still mounted');
u._unmounted('/b/2');
assert.equal(posted[0].text, 'Safe to remove: MYDRIVE');
u._gone('/d/1');
assert.equal(posted.length, 1, 'no "removed" right after "safe to remove"');
// unplugged without unmounting
u._ingest('/d/2', {[`${UD}.Drive`]: {ConnectionBus: 'usb', Vendor: '', Model: 'Stick'}}, false);
u._gone('/d/2');
assert.equal(posted.at(-1).text, 'USB removed: Stick');
u._unmounted('/b/none');                                           // unknown block: nothing
u.destroy();
// USB devices (OTG)
posted.length = 0;
const dev = (id, o) => { for (const [k, v] of Object.entries(o)) fs.files.set(`/sys/bus/usb/devices/${id}/${k}`, v); };
fs.dirs.set('/sys/bus/usb/devices', ['usb1', '1-1', '1-1:1.0', '1-2']);
dev('1-1', {bDeviceClass: '00', removable: 'fixed', product: 'Bluetooth Radio'});
dev('1-2', {bDeviceClass: '00', removable: 'removable', product: 'USB Mouse'});
fs.dirs.set('/sys/bus/usb/devices/1-2', ['1-2:1.0']); dev('1-2/1-2:1.0', {bInterfaceClass: '03'});
const d = new src.UsbDevSource(ctx);
assert.equal(posted.length, 0, 'what is already plugged in is silent');
fs.dirs.set('/sys/bus/usb/devices', ['usb1', '1-1', '1-2', '1-3']);
dev('1-3', {bDeviceClass: '00', removable: 'unknown', manufacturer: 'Acme', product: 'Pixel Phone'});
fs.dirs.set('/sys/bus/usb/devices/1-3', ['1-3:1.0']); dev('1-3/1-3:1.0', {bInterfaceClass: '06'});
d._scan();
assert.equal(posted.at(-1).text, 'USB device: Pixel Phone');
fs.dirs.set('/sys/bus/usb/devices', ['usb1', '1-1', '1-2']);
d._scan();
assert.equal(posted.at(-1).text, 'USB device removed: Pixel Phone');
// a pen drive (storage) is left to UsbSource
fs.dirs.set('/sys/bus/usb/devices', ['usb1', '1-1', '1-2', '1-4']);
dev('1-4', {bDeviceClass: '00', removable: 'removable', product: 'Flash'}); fs.dirs.set('/sys/bus/usb/devices/1-4', ['1-4:1.0']); dev('1-4/1-4:1.0', {bInterfaceClass: '08'});
const n = posted.length; d._scan(); assert.equal(posted.length, n);
// switch off: timer stops
S.set_boolean('show-usbdev', false); assert.equal([...globalThis.__timers.values()].filter(t => t.ms === 3000).length, 0 + [...globalThis.__timers.values()].filter(t => t.ms === 3000).length);
d.destroy();
console.log('sources ok');

// ---- the dropdown rows exist and fill in
const rows = {};
ind._setRow = (id, text) => { rows[id] = text; };
ind.menu.isOpen = true; ind._refreshMenu();
for (const id of ['data', 'sys', 'bat', 'tmr', 'wx3'])
    assert.ok(id in rows, 'row ' + id);
assert.match(rows.data, /^Data: .* today, .* in 7 days$/);
assert.equal(rows.tmr, '');
assert.ok(ind._tmrCount.visible && !ind._tmrPause.visible && !ind._tmrReset.visible);
ind._tmrDo('count'); ind._refreshMenu();
assert.match(rows.tmr, /^Timer: 01:00$|^Timer: 00:5/);
assert.ok(!ind._tmrCount.visible && ind._tmrPause.visible && ind._tmrReset.visible);
ind._tmrDo('reset');
ind.menu.isOpen = false;

// ---- version 8, phase 2: Night Light, Location, Touchpad, Power mode
{
    // the schemas and the power daemon are present when the extension starts (those are not announced).
    // (they were set up before enable() in a real run; here we restart the extension to do the same)
    ext.disable();
    Object.assign(globalThis.__gs.schemas, {
        'org.gnome.settings-daemon.plugins.color': {'night-light-enabled': false},
        'org.gnome.system.location': {enabled: true},
        'org.gnome.desktop.peripherals.touchpad': {'send-events': 'enabled'},
    });
    globalThis.__dbus.reply = (dest, path, iface, method) => (method === 'Get' && dest === 'net.hadess.PowerProfiles' ? ['balanced']
        : method === 'Get' ? new Error('no such name') : undefined);
    ext.enable();
    const ind2 = ext._indicator;
    const texts2 = () => [ind2._q.cur?.text, ...ind2._q.items.map(m => m.text)].filter(Boolean);
    for (let i = 0; i < 3; i++) step(1000);
    ind2._q.clear();
    assert.deepEqual(texts2(), [], 'silent at start: ' + texts2());
    const gs = globalThis.__gs, dbus = globalThis.__dbus;
    const iconForCat = cat => ind2._iconFor({text: 'x', kind: 'good', cat, key: cat});
    const g = (schema, key, v) => { gs.set(schema, key, v); step(1000); };
    const C = 'org.gnome.settings-daemon.plugins.color', L = 'org.gnome.system.location', T = 'org.gnome.desktop.peripherals.touchpad';

    g(C, 'night-light-enabled', true);
    assert.ok(texts2().includes('Night Light is ON'), texts2().join('|'));
    ind2._q.clear();
    g(C, 'night-light-enabled', false);
    assert.ok(texts2().includes('Night Light is OFF'), texts2().join('|'));
    ind2._q.clear();
    g(L, 'enabled', false);
    assert.ok(texts2().includes('Location is OFF'), texts2().join('|'));
    ind2._q.clear();
    g(T, 'send-events', 'disabled');
    assert.ok(texts2().includes('Touchpad disabled'), texts2().join('|'));
    ind2._q.clear();
    g(T, 'send-events', 'enabled');
    assert.ok(texts2().includes('Touchpad enabled'), texts2().join('|'));
    ind2._q.clear();
    // same value again: nothing
    gs.schemas[T]['send-events'] = 'enabled'; gs.set(T, 'send-events', 'enabled'); step(1000);
    assert.deepEqual(texts2(), [], 'no repeat: ' + texts2());
    // the on/off switch of the kind works
    S.set_boolean('show-location', false);
    g(L, 'enabled', true);
    assert.ok(!texts2().includes('Location is ON'), 'switched off kind stays quiet');
    S.set_boolean('show-location', true);
    ind2._q.clear();

    // power mode: first answer came from the second name (the first failed); start mode is "balanced"
    const pp = (path, iface, mode) => dbus.emit('system', path, iface, 'PropertiesChanged',
        {get_child_value: i => ({recursiveUnpack: () => (i === 0 ? iface : {ActiveProfile: mode})})});
    pp('/net/hadess/PowerProfiles', 'net.hadess.PowerProfiles', 'balanced'); step(1000);
    assert.deepEqual(texts2(), [], 'same mode as at start: nothing');
    pp('/net/hadess/PowerProfiles', 'net.hadess.PowerProfiles', 'power-saver'); step(1000);
    assert.ok(texts2().includes('Power saver'), texts2().join('|'));
    pp('/org/freedesktop/UPower/PowerProfiles', 'org.freedesktop.UPower.PowerProfiles', 'power-saver'); step(1000);
    assert.equal(texts2().filter(t => t === 'Power saver').length, 1, 'the other name repeats it: said once');
    ind2._q.clear();
    pp('/org/freedesktop/UPower/PowerProfiles', 'org.freedesktop.UPower.PowerProfiles', 'performance'); step(1000);
    assert.ok(texts2().includes('Performance'), texts2().join('|'));
    ind2._q.clear();
    // a property change that is not about the mode: nothing
    dbus.emit('system', '/net/hadess/PowerProfiles', 'net.hadess.PowerProfiles', 'PropertiesChanged',
        {get_child_value: i => ({recursiveUnpack: () => (i === 0 ? 'net.hadess.PowerProfiles' : {PerformanceDegraded: ''})})});
    step(1000);
    assert.deepEqual(texts2(), []);
    // icons
    assert.equal(iconForCat('nightlight'), 'moon'); assert.equal(iconForCat('powermode'), 'power');
    assert.equal(iconForCat('location'), 'location'); assert.equal(iconForCat('touchpad'), 'touchpad');
    console.log('phase 2 ok');
}

// ---- version 8, phase 3: Monitor, Ethernet, Controller, Printer, Brightness
{
    ext.disable();
    S.set_boolean('show-usbdev', true);      // an earlier block switched it off
    const fsx = globalThis.__fs;
    // what exists at start (not announced)
    fsx.dirs.set('/sys/class/net', ['lo', 'enp3s0', 'wlp2s0']);
    fsx.files.set('/sys/class/net/enp3s0/carrier', '0'); fsx.files.set('/sys/class/net/wlp2s0/carrier', '1');
    fsx.dirs.set('/sys/class/backlight', ['intel_backlight', 'acpi_video0']);
    fsx.files.set('/sys/class/backlight/intel_backlight/type', 'raw'); fsx.files.set('/sys/class/backlight/acpi_video0/type', 'firmware');
    fsx.files.set('/sys/class/backlight/acpi_video0/max_brightness', '100'); fsx.files.set('/sys/class/backlight/acpi_video0/brightness', '100');
    fsx.dirs.set('/dev/input', ['event0', 'mouse0']);
    fsx.dirs.set('/sys/bus/usb/devices', ['usb1']);
    globalThis.__lm.set(1);
    ext.enable();
    const ind3 = ext._indicator;
    const t3 = () => [ind3._q.cur?.text, ...ind3._q.items.map(m => m.text)].filter(Boolean);
    const fire = ms => { for (const [id, t] of [...globalThis.__timers]) if (t.ms === ms && t.cb() === false) globalThis.__timers.delete(id); };
    const settle = () => new Promise(r => setTimeout(r, 0));
    const poll = async () => { await ind3._pollSlow(); await settle(); await settle(); };
    await settle(); await poll(); await poll();
    for (let i = 0; i < 3; i++) step(1000);
    ind3._q.clear();
    assert.deepEqual(t3(), [], 'silent at start: ' + t3());

    // monitor: one message for a burst of changes, none when the count is the same
    globalThis.__lm.set(2); globalThis.__lm.set(3); fire(600); step(1000);
    assert.deepEqual(t3(), ['Monitor connected'], t3().join('|'));
    ind3._q.clear();
    globalThis.__lm.set(3); fire(600); step(1000);
    assert.deepEqual(t3(), [], 'same count: nothing');
    globalThis.__lm.set(2); fire(600); step(1000);
    assert.deepEqual(t3(), ['Monitor removed'], t3().join('|'));
    ind3._q.clear();
    S.set_boolean('show-monitor', false); globalThis.__lm.set(1); fire(600); step(1000);
    assert.deepEqual(t3(), [], 'switch off: quiet'); S.set_boolean('show-monitor', true);

    // ethernet: only en*/eth*, Wi-Fi does not count, checked in the slow poll
    fsx.files.set('/sys/class/net/enp3s0/carrier', '1');
    await poll();
    assert.deepEqual(t3(), ['Ethernet connected'], t3().join('|'));
    ind3._q.clear(); await poll();
    assert.deepEqual(t3(), [], 'no repeat');
    fsx.files.set('/sys/class/net/enp3s0/carrier', '');            // unplugged: the file reads empty
    await poll();
    assert.deepEqual(t3(), ['Ethernet unplugged'], t3().join('|'));
    ind3._q.clear();
    fsx.files.set('/sys/class/net/wlp2s0/carrier', '0'); await poll();
    assert.ok(!t3().some(t => /Ethernet/.test(t)), 'Wi-Fi going down is not Ethernet');
    ind3._q.clear();

    // controller: name from sysfs, other input devices ignored, remove says the name
    fsx.files.set('/sys/class/input/js0/device/name', 'Xbox Wireless Controller');
    globalThis.__fm.emit('/dev/input', 'created', 'event7'); fire(400); step(1000);
    assert.deepEqual(t3(), [], 'event7 is not a controller');
    globalThis.__fm.emit('/dev/input', 'created', 'js0'); fire(400); step(1000);
    assert.deepEqual(t3(), ['Controller connected: Xbox Wireless Controller'], t3().join('|'));
    ind3._q.clear();
    globalThis.__fm.emit('/dev/input', 'deleted', 'js0'); step(1000);
    assert.deepEqual(t3(), ['Controller removed: Xbox Wireless Controller'], t3().join('|'));
    ind3._q.clear();
    globalThis.__fm.emit('/dev/input', 'deleted', 'js0'); step(1000);
    assert.deepEqual(t3(), [], 'unknown device removed: nothing');
    // switch off stops watching; switching on again does not announce what is already there
    S.set_boolean('show-gamepad', false);
    assert.equal([...globalThis.__fm.active].filter(m => m.path === '/dev/input').length, 0, 'folder watch stopped');
    fsx.dirs.set('/dev/input', ['js1']); fsx.files.set('/sys/class/input/js1/device/name', 'Pad One');
    S.set_boolean('show-gamepad', true); step(1000);
    assert.deepEqual(t3(), [], 'already there: silent');
    globalThis.__fm.emit('/dev/input', 'deleted', 'js1'); step(1000);
    assert.deepEqual(t3(), ['Controller removed: Pad One'], t3().join('|'));
    ind3._q.clear();

    // printer: class 07 has its own kind, other USB stays "USB device"
    const U = '/sys/bus/usb/devices';
    const plug = (id, cls, product, iface) => {
        fsx.dirs.set(U, [...(fsx.dirs.get(U) ?? []).filter(n => n !== id), id]);
        fsx.files.set(`${U}/${id}/bDeviceClass`, cls); fsx.files.set(`${U}/${id}/product`, product);
        fsx.dirs.set(`${U}/${id}`, [`${id}:1.0`]); fsx.files.set(`${U}/${id}/${id}:1.0/bInterfaceClass`, iface);
    };
    fire(3000);                                      // first look: empty
    plug('1-2', '00', 'LaserJet 1020', '07'); fire(3000); step(1000);
    assert.deepEqual(t3(), ['Printer connected'], t3().join('|'));
    ind3._q.clear();
    plug('1-3', '00', 'Mouse X', '03'); fire(3000); step(1000);
    assert.deepEqual(t3(), ['USB device: Mouse X'], t3().join('|'));
    ind3._q.clear();
    fsx.dirs.set(U, ['usb1', '1-3']); fire(3000); step(1000);
    assert.deepEqual(t3(), ['Printer removed'], t3().join('|'));
    ind3._q.clear();
    S.set_boolean('show-printer', false);
    plug('1-4', '00', 'Other Printer', '07'); fire(3000); step(1000);
    assert.deepEqual(t3(), [], 'printer kind off: quiet');
    S.set_boolean('show-printer', true); S.set_boolean('show-usbdev', false); S.set_boolean('show-printer', false);
    assert.equal([...globalThis.__timers.values()].filter(t => t.ms === 3000).length, 0, 'both USB switches off: scan timer stopped');
    S.set_boolean('show-usbdev', true); S.set_boolean('show-printer', true);
    ind3._q.clear();

    // brightness: first reading ignored, firmware entry preferred, a drag replaces itself, off switch is quiet
    const B = '/sys/class/backlight/acpi_video0/brightness';
    for (let i = 0; i < 3; i++) step(1000);
    assert.deepEqual(t3(), [], 'first reading is silent');
    fsx.files.set(B, '60'); step(1000);
    assert.deepEqual(t3(), ['Brightness 60%'], t3().join('|'));
    fsx.files.set(B, '55'); step(1000); fsx.files.set(B, '50'); step(1000);
    assert.equal(t3().filter(t => /^Brightness/.test(t)).length, 1, 'one message while sliding: ' + t3().join('|'));
    assert.ok(t3().includes('Brightness 50%'), t3().join('|'));
    ind3._q.clear(); step(1000);
    assert.deepEqual(t3(), [], 'same value: nothing');
    S.set_boolean('show-brightness', false); fsx.files.set(B, '20'); step(1000);
    assert.deepEqual(t3(), [], 'switch off: quiet');
    S.set_boolean('show-brightness', true); step(1000);
    assert.deepEqual(t3(), [], 'back on: the first reading is silent again');
    fsx.files.set(B, ''); step(1000); fsx.files.set(B, '30'); ind3._brWait = 0; step(1000); step(1000);   // file vanished, then came back
    assert.ok(!t3().some(t => /^Brightness/.test(t)) || t3().includes('Brightness 30%'));
    ind3._q.clear();
    // no backlight at all (a desktop PC): no message, no crash
    fsx.dirs.set('/sys/class/backlight', []); ind3._brDir = null; ind3._brLast = null; ind3._brWait = 0;
    for (let i = 0; i < 3; i++) step(1000);
    assert.deepEqual(t3(), []);
    // icons
    const ic = cat => ind3._iconFor({text: 'x', kind: 'good', cat, key: cat});
    assert.deepEqual(['monitor', 'ethernet', 'gamepad', 'printer', 'brightness'].map(ic),
        ['monitor', 'ethernet', 'gamepad', 'printer', 'brightness']);
    console.log('phase 3 ok');
}

// ---- clean shutdown: no timers, no settings handlers left
ext.disable();
const left = [...globalThis.__timers.values()];
console.log('timers left after disable:', left.length, left.map(t => t.ms));
assert.equal(left.length, 0, 'nothing may keep running after disable()');
assert.equal(S.handlerCount(), 0, 'settings handlers left: ' + S.handlerCount());
assert.equal(globalThis.__gs.count(), 0, 'system setting handlers left: ' + globalThis.__gs.count());
assert.equal(globalThis.__fm.active.size, 0, 'file monitors left: ' + globalThis.__fm.active.size);
assert.equal(globalThis.__lm.count(), 0, 'monitor handlers left: ' + globalThis.__lm.count());
assert.equal(globalThis.__dbus.count(), 0, 'D-Bus subscriptions left: ' + globalThis.__dbus.count());
console.log('ALL HARNESS CHECKS PASSED');
