// Version 7 logic: sun, air quality, weekly data, focus count, USB devices, headphones, charge watts, timer
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseLocalIso, sunEvents, sunDue} from '../sunlogic.js';
import {aqiBand, aqiName, airAlert} from '../airlogic.js';
import {UsageTracker, DayCounter} from '../usage.js';
import {focusText} from '../pomodoro.js';
import {USB_DEVICE_RE, trackUsb, usbName, diffUsb} from '../usblogic.js';
import {parseHeadphones} from '../headphones.js';
import {chargeWatts, fmtWatts} from '../sysinfo.js';
import {SimpleTimer, fmtTimer, timerLabel, timerDoneText} from '../timerlogic.js';
import {CATEGORIES} from '../data.js';

// ---- sun: India is UTC+5:30 (19800 s)
const off = 19800;
assert.equal(parseLocalIso('2026-11-15T17:42', off), Date.UTC(2026, 10, 15, 12, 12));
assert.equal(parseLocalIso('nonsense', off), null);
const ev = sunEvents({sunrise: ['2026-11-15T06:30', '2026-11-16T06:31'], sunset: ['2026-11-15T17:42', '2026-11-16T17:41']}, off);
assert.equal(ev.length, 4);
assert.deepEqual(ev.map(e => e.kind), ['sunrise', 'sunset', 'sunrise', 'sunset']);
const sunset = ev[1].at;
assert.equal(sunDue(ev, sunset - 31 * 60000, 30, null), null);              // too early
let d = sunDue(ev, sunset - 30 * 60000, 30, null);
assert.equal(d.text, 'Sunset in 30 min');
assert.equal(sunDue(ev, sunset - 29 * 60000, 30, d.key), null);             // only once per event
d = sunDue(ev, sunset - 90000, 30, null);
assert.equal(d.text, 'Sunset in 2 min');                                     // rounds up
assert.equal(sunDue(ev, sunset + 60000, 30, null), null);                    // next is far away
assert.equal(sunDue(ev, ev[2].at - 10 * 60000, 30, d.key).text, 'Sunrise in 10 min');
assert.equal(sunDue([], 0, 30, null), null);
assert.equal(sunEvents(null, 0).length, 0);

// ---- air quality
assert.equal(aqiName(30), 'Good'); assert.equal(aqiName(100), 'Moderate'); assert.equal(aqiName(151), 'Unhealthy');
assert.equal(aqiBand(400), 5);
let st = {high: false, band: -1};
let r = airAlert(st, 90, 150); assert.equal(r.alert, null);
r = airAlert(r.state, 162, 150); assert.match(r.alert.text, /AQI 162 \(Unhealthy\)/);
r = airAlert(r.state, 170, 150); assert.equal(r.alert, null);                 // same band: quiet
r = airAlert(r.state, 210, 150); assert.match(r.alert.text, /Very unhealthy/); // worse band: warn again
r = airAlert(r.state, 145, 150); assert.equal(r.alert, null); assert.equal(r.state.high, true); // inside the 10 point margin
r = airAlert(r.state, 120, 150); assert.equal(r.state.high, false);
r = airAlert(r.state, 160, 150); assert.ok(r.alert);                           // bad again: warn again
r = airAlert(r.state, null, 150); assert.equal(r.alert, null); assert.equal(r.state.high, true);   // no data: keep state

// ---- weekly data
let u = new UsageTracker('', '2026-11-10');
u.add(100, 10, '2026-11-10');
u.add(200, 20, '2026-11-11');                       // midnight: day 10 is kept
u.add(300, 30, '2026-11-12');
assert.deepEqual(u.week(), {rx: 600, tx: 60});
assert.equal(u.rx, 300);
// 7 days is today + 6 before; an older day drops out
u.add(1, 1, '2026-11-17');                          // 5 days later: days 10 (7 days ago) is out, 11 and 12 stay
assert.equal(u.hist.some(h => h.day === '2026-11-10'), false);
assert.deepEqual(u.week(), {rx: 200 + 300 + 1, tx: 20 + 30 + 1});
// save and load again, same day
const u2 = new UsageTracker(u.toJSON(), '2026-11-17');
assert.deepEqual(u2.week(), u.week());
// load the next day: yesterday moves to the history
const u3 = new UsageTracker(u.toJSON(), '2026-11-18');
assert.equal(u3.rx, 0); assert.deepEqual(u3.week(), {rx: 300 + 1, tx: 30 + 1});   // the window moved: day 11 is now 7 days old
// old format (no hist) still loads
const old = new UsageTracker('{"day":"2026-11-20","rx":5,"tx":6}', '2026-11-20');
assert.deepEqual(old.week(), {rx: 5, tx: 6});
const old2 = new UsageTracker('{"day":"2026-11-19","rx":5,"tx":6}', '2026-11-20');
assert.equal(old2.rx, 0); assert.deepEqual(old2.week(), {rx: 5, tx: 6});
// bad input
assert.deepEqual(new UsageTracker('garbage', '2026-11-20').week(), {rx: 0, tx: 0});
assert.deepEqual(new UsageTracker('{"day":"2026-11-20","rx":1,"tx":1,"hist":[{"day":"x","rx":1,"tx":1},{"day":"2026-11-19","rx":-1,"tx":1}]}', '2026-11-20').hist, []);
// counters must never push the total down
u.add(-50, -50, '2026-11-17'); assert.equal(u.rx, 1);

// ---- focus count
let c = new DayCounter('', '2026-11-15');
assert.equal(c.inc('2026-11-15'), 1); assert.equal(c.inc('2026-11-15'), 2);
assert.equal(focusText(1), '1 focus session done today'); assert.equal(focusText(3), '3 focus sessions done today');
const c2 = new DayCounter(c.toJSON(), '2026-11-15'); assert.equal(c2.n, 2);
assert.equal(new DayCounter(c.toJSON(), '2026-11-16').n, 0);
assert.equal(c2.inc('2026-11-16'), 1);                                          // midnight resets
assert.equal(new DayCounter('junk', '2026-11-15').n, 0);

// ---- USB devices
assert.ok(USB_DEVICE_RE.test('1-2') && USB_DEVICE_RE.test('3-1.4.2'));
assert.ok(!USB_DEVICE_RE.test('usb1') && !USB_DEVICE_RE.test('1-2:1.0'));
assert.equal(trackUsb({id: '1-2', cls: '00', removable: 'removable', ifaceClasses: ['03']}), true);
assert.equal(trackUsb({id: '1-2', cls: '09', removable: 'removable', ifaceClasses: ['09']}), false);   // hub
assert.equal(trackUsb({id: '1-5', cls: 'ef', removable: 'fixed', ifaceClasses: ['0e']}), false);        // built-in camera
assert.equal(trackUsb({id: '1-3', cls: '00', removable: 'unknown', ifaceClasses: ['08']}), false);      // storage
assert.equal(trackUsb({id: '1-3', cls: '00', removable: 'unknown', ifaceClasses: ['06']}), true);       // phone (MTP)
assert.equal(trackUsb({id: 'usb1', cls: '09', removable: '', ifaceClasses: []}), false);
assert.equal(usbName('Acme', 'Phone X'), 'Phone X'); assert.equal(usbName('Acme', ''), 'Acme'); assert.equal(usbName('', ''), 'USB device');
const df = diffUsb(new Map([['1-1', 'A'], ['1-2', 'B']]), new Map([['1-2', 'B'], ['1-3', 'C']]));
assert.deepEqual(df, {added: [['1-3', 'C']], removed: [['1-1', 'A']]});

// ---- headphones
const sink = (name, active, ports) => ({name, active_port: active, ports});
const hpPort = av => ({name: 'analog-output-headphones', type: 'Headphones', availability: av});
const spPort = {name: 'analog-output-speaker', type: 'Speaker', availability: 'availability unknown'};
assert.deepEqual(parseHeadphones(JSON.stringify([sink('alsa_output.pci', 'analog-output-headphones', [spPort, hpPort('available')])])), {connected: true});
assert.deepEqual(parseHeadphones(JSON.stringify([sink('alsa_output.pci', 'analog-output-speaker', [spPort, hpPort('not available')])])), {connected: false});
assert.deepEqual(parseHeadphones(JSON.stringify([sink('alsa_output.pci', 'analog-output-headphones', [hpPort('availability unknown')])])), {connected: false});
assert.deepEqual(parseHeadphones(JSON.stringify([sink('bluez_output.AA', 'headset-output', [{name: 'headset-output', type: 'Headset', availability: 'available'}])])), {connected: false});   // Bluetooth: not here
assert.deepEqual(parseHeadphones(JSON.stringify([sink('alsa_output.pci', {name: 'analog-output-headphones'}, [hpPort('available')])])), {connected: true});
assert.equal(parseHeadphones(''), null); assert.equal(parseHeadphones('{}'), null); assert.equal(parseHeadphones('not json'), null);
assert.deepEqual(parseHeadphones('[]'), {connected: false});

// ---- charge watts
assert.equal(chargeWatts({powerNow: 38500000}), 38.5);
assert.equal(chargeWatts({powerNow: 0, currentNow: 2000000, voltageNow: 12000000}), 24);
assert.equal(chargeWatts({powerNow: 0, currentNow: 0, voltageNow: 12000000}), null);
assert.equal(chargeWatts({powerNow: 100}), null);                                // tiny: not real
assert.equal(chargeWatts({powerNow: NaN}), null);
assert.equal(fmtWatts(38.5), '39 W'); assert.equal(fmtWatts(7.25), '7.3 W');

// ---- timer
const t = new SimpleTimer();
assert.equal(t.active, false); assert.equal(t.tick(0), null); assert.equal(timerLabel(t), '');
t.startCountdown(250000, 1000);
assert.equal(fmtTimer(t.shown(1000), true), '04:10'); assert.equal(timerLabel(t), 'Timer');
assert.equal(fmtTimer(t.shown(61000), true), '03:10');
t.pause(61000); assert.equal(t.running, false); assert.equal(timerLabel(t), 'Paused');
assert.equal(t.tick(9e9), null);                                                   // paused: never ends
assert.equal(fmtTimer(t.shown(9e9), true), '03:10');
t.toggle(100000); assert.equal(t.running, true);
assert.equal(fmtTimer(t.shown(100000 + 10000), true), '03:00');
assert.equal(t.tick(100000 + 189999), null);
const done = t.tick(100000 + 190000); assert.deepEqual(done, {total: 250000}); assert.equal(t.active, false);
assert.equal(timerDoneText(600000), 'Timer done: 10 min'); assert.equal(timerDoneText(90000), 'Timer done: 01:30');
// stopwatch
t.startStopwatch(5000); assert.equal(timerLabel(t), 'Stopwatch');
assert.equal(fmtTimer(t.shown(5000 + 83000), false), '01:23');
t.pause(5000 + 83000); t.resume(200000); assert.equal(fmtTimer(t.shown(200000 + 17000), false), '01:40');
assert.equal(t.tick(9e12), null);                                                  // a stopwatch never ends
assert.equal(fmtTimer(3723000, false), '1:02:03');
t.reset(); assert.equal(t.active, false);

// ---- every category has its three keys in the schema (a missing key would crash the extension)
const xml = readFileSync(new URL('../schemas/org.gnome.shell.extensions.informer.gschema.xml', import.meta.url), 'utf8');
const keys = new Set([...xml.matchAll(/<key name="([^"]+)"/g)].map(m => m[1]));
for (const cat of CATEGORIES) {
    assert.ok(keys.has(`priority-${cat.key}`), `missing priority-${cat.key}`);
    assert.ok(keys.has(`icon-${cat.key}`), `missing icon-${cat.key}`);
    if (cat.toggle)
        assert.ok(keys.has(`show-${cat.key}`), `missing show-${cat.key}`);
}
for (const k of ['sun-lead-min', 'air-aqi-warn', 'data-week-hours', 'timer-minutes', 'timer-sound', 'focus-today'])
    assert.ok(keys.has(k), `missing ${k}`);
console.log('version 7 logic: all good');
