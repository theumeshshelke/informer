// Version 8 logic (grows with each phase). Phase 2: Night Light, Location, Touchpad, Power mode.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {onOffMessage, touchpadMessage, profileMessage} from '../switchlogic.js';
import {CATEGORIES} from '../data.js';
import {soundOutInfo, countClients, hotspotMessage, wakeText, ThrottleWatch} from '../eventlogic.js';
import {monitorChange, ethernetUp, gamepadMessage, JS_RE, pickBacklight, brightnessPct} from '../hwlogic.js';
import {isPrinter} from '../usblogic.js';

// ---- on / off texts
assert.deepEqual(onOffMessage('nightlight', true), {text: 'Night Light is ON', kind: 'good'});
assert.deepEqual(onOffMessage('nightlight', false), {text: 'Night Light is OFF', kind: 'bad'});
assert.deepEqual(onOffMessage('location', true), {text: 'Location is ON', kind: 'good'});
assert.deepEqual(onOffMessage('location', false), {text: 'Location is OFF', kind: 'bad'});
assert.equal(onOffMessage('nope', true), null);

// ---- touchpad
assert.deepEqual(touchpadMessage('enabled'), {text: 'Touchpad enabled', kind: 'good'});
assert.deepEqual(touchpadMessage('disabled'), {text: 'Touchpad disabled', kind: 'bad'});
assert.equal(touchpadMessage('disabled-on-external-mouse').kind, 'info');
assert.equal(touchpadMessage('something-new'), null);
assert.equal(touchpadMessage(undefined), null);

// ---- power mode
assert.equal(profileMessage('power-saver').text, 'Power saver');
assert.equal(profileMessage('balanced').text, 'Balanced');
assert.equal(profileMessage('performance').text, 'Performance');
assert.equal(profileMessage('performance').kind, 'info');
assert.equal(profileMessage('turbo'), null);
assert.equal(profileMessage(''), null);

// ===== Phase 3: Monitor, Ethernet, Controller, Printer, Brightness
assert.equal(monitorChange(1, 2), 'added');
assert.equal(monitorChange(2, 1), 'removed');
assert.equal(monitorChange(2, 2), null);
assert.equal(monitorChange(null, 2), null);       // unknown start: say nothing
assert.equal(monitorChange(2, null), null);

assert.equal(ethernetUp([{name: 'enp3s0', carrier: '1'}]), true);
assert.equal(ethernetUp([{name: 'enp3s0', carrier: '0'}]), false);
assert.equal(ethernetUp([{name: 'eth0', carrier: '1\n'}]), true);
assert.equal(ethernetUp([{name: 'wlp2s0', carrier: '1'}, {name: 'lo', carrier: '1'}]), false);   // Wi-Fi and loopback do not count
assert.equal(ethernetUp([{name: 'docker0', carrier: '1'}, {name: 'veth12ab', carrier: '1'}]), false);
assert.equal(ethernetUp([{name: 'enp3s0', carrier: ''}]), false);       // down interfaces have no carrier text
assert.equal(ethernetUp([]), false);
assert.equal(ethernetUp(undefined), false);

assert.ok(JS_RE.test('js0') && JS_RE.test('js12'));
assert.ok(!JS_RE.test('event3') && !JS_RE.test('mouse0') && !JS_RE.test('js') && !JS_RE.test('js0x'));
assert.equal(gamepadMessage(true, 'Xbox Controller'), 'Controller connected: Xbox Controller');
assert.equal(gamepadMessage(false, 'Xbox Controller'), 'Controller removed: Xbox Controller');
assert.equal(gamepadMessage(true, ''), 'Controller connected');
assert.equal(gamepadMessage(false, undefined), 'Controller removed');

assert.equal(isPrinter(['07']), true);
assert.equal(isPrinter(['03', '07']), true);
assert.equal(isPrinter(['03', '08']), false);
assert.equal(isPrinter([]), false);
assert.equal(isPrinter(undefined), false);

assert.equal(pickBacklight([{name: 'intel_backlight', type: 'raw'}, {name: 'acpi_video0', type: 'firmware'}]), 'acpi_video0');
assert.equal(pickBacklight([{name: 'a', type: 'raw'}, {name: 'b', type: 'platform'}]), 'b');
assert.equal(pickBacklight([{name: 'only', type: ''}]), 'only');
assert.equal(pickBacklight([]), null);
assert.equal(pickBacklight(undefined), null);

assert.equal(brightnessPct('120000', '120000'), 100);
assert.equal(brightnessPct('72000', '120000'), 60);
assert.equal(brightnessPct('0', '120000'), 0);
assert.equal(brightnessPct(60, 100), 60);
assert.equal(brightnessPct('x', '100'), null);
assert.equal(brightnessPct('5', '0'), null);        // no max: no answer (never divide by zero)
assert.equal(brightnessPct('', ''), null);
assert.equal(brightnessPct('150', '100'), 100);     // never above 100

// ---- phase 4: sound output
const sinks = JSON.stringify([
    {name: 'alsa_output.pci.analog', description: 'Built-in Audio Analog Stereo', active_port: 'analog-output-speaker',
        ports: [{name: 'analog-output-speaker', type: 'Speaker'}, {name: 'analog-output-headphones', type: 'Headphones'}]},
    {name: 'alsa_output.pci.hdmi', description: 'Built-in Audio Digital Stereo (HDMI)', active_port: 'hdmi-output-0',
        ports: [{name: 'hdmi-output-0', type: 'HDMI'}]},
    {name: 'bluez_output.AA_BB.1', description: 'JBL Flip 5', active_port: 'headset-output', ports: [{name: 'headset-output', type: 'Headset'}]},
    {name: 'alsa_output.usb', description: 'USB Audio Device', active_port: null, ports: []},
]);
assert.deepEqual(soundOutInfo(sinks, 'alsa_output.pci.analog'), {text: 'Sound: Speakers', headphones: false});
assert.deepEqual(soundOutInfo(sinks, 'alsa_output.pci.hdmi'), {text: 'Sound: HDMI', headphones: false});
assert.equal(soundOutInfo(sinks, 'alsa_output.usb\n').text, 'Sound: USB Audio Device');
// Bluetooth: the device name wins even when the port says "headset"
assert.equal(soundOutInfo(sinks, 'bluez_output.AA_BB.1').text, 'Sound: JBL Flip 5');
const hp = JSON.parse(sinks); hp[0].active_port = 'analog-output-headphones';
assert.deepEqual(soundOutInfo(JSON.stringify(hp), 'alsa_output.pci.analog'), {text: 'Sound: Headphones', headphones: true});
assert.equal(soundOutInfo(sinks, 'nope'), null);
assert.equal(soundOutInfo(sinks, ''), null);
assert.equal(soundOutInfo('not json', 'x'), null);
assert.equal(soundOutInfo('{}', 'x'), null);

// ---- phase 4: hotspot clients
const neigh = [
    '10.42.0.23 dev wlp2s0 lladdr aa:bb:cc:00:00:01 REACHABLE',
    '10.42.0.31 dev wlp2s0 lladdr aa:bb:cc:00:00:02 STALE',
    '10.42.0.40 dev wlp2s0  FAILED',
    '10.42.0.41 dev wlp2s0  INCOMPLETE',
    '192.168.1.1 dev enp3s0 lladdr 11:22:33:44:55:66 REACHABLE',
    'fe80::1 dev wlp2s0 lladdr aa:bb:cc:00:00:01 router STALE',
    'fe80::2 dev wlp2s0 lladdr aa:bb:cc:00:00:01 STALE',
].join('\n');
assert.equal(countClients(neigh, 'wlp2s0'), 2, 'two real clients, IPv6 and failed ignored');
assert.equal(countClients(neigh, 'enp3s0'), 1);
assert.equal(countClients(neigh, ''), 2, 'no interface known: use the 10.42 network');
assert.equal(countClients('', 'wlp2s0'), 0);
assert.equal(countClients(undefined, ''), 0);
assert.equal(countClients('10.42.0.5 dev wlp2s0 lladdr aa:aa:aa:aa:aa:aa REACHABLE\n10.42.0.6 dev wlp2s0 lladdr aa:aa:aa:aa:aa:aa STALE', 'wlp2s0'), 1, 'same device twice counts once');
assert.equal(hotspotMessage(2).text, '2 devices on your hotspot');
assert.equal(hotspotMessage(1).text, '1 device on your hotspot');
assert.equal(hotspotMessage(0).text, 'No devices on your hotspot');
assert.equal(hotspotMessage(-1), null);
assert.equal(hotspotMessage(NaN), null);

// ---- phase 4: wake
assert.equal(wakeText(0, 2 * 3600e3 + 10 * 60e3), 'Welcome back, slept 2h 10m');
assert.equal(wakeText(0, 25 * 60e3), 'Welcome back, slept 25m');
assert.equal(wakeText(0, 60e3), 'Welcome back, slept 1m');
assert.equal(wakeText(0, 59e3), null, 'under a minute: nothing');
assert.equal(wakeText(5000, 1000), null, 'clock went backwards: nothing');
assert.equal(wakeText(NaN, 1000), null);

// ---- phase 4: overheat
{
    const w = new ThrottleWatch(600000);
    assert.equal(w.feed('12\n', 0), false, 'first reading is silent');
    assert.equal(w.feed('12', 1000), false, 'same count');
    assert.equal(w.feed('15', 2000), true, 'count went up');
    assert.equal(w.feed('20', 3000), false, 'again within 10 minutes: quiet');
    assert.equal(w.feed('20', 700000), false, 'no rise');
    assert.equal(w.feed('25', 700000), true, 'rise after 10 minutes');
    assert.equal(w.feed('', 800000), false, 'file gone');
    assert.equal(w.feed('3', 9e6), false, 'back with a new number: silent baseline');
    assert.equal(w.feed('4', 9e6 + 1), true);
    assert.equal(w.feed('abc', 9e7), false);
    assert.equal(new ThrottleWatch().gapMs, 600000, 'default is 10 minutes');
}

// ---- the new kinds have rows and the right default priority
const prio = {nightlight: 0, location: 0, touchpad: 1, powermode: 1, monitor: 1, ethernet: 1, gamepad: 1, printer: 1, brightness: 0,
    soundout: 1, hotspotclients: 0, wake: 1, overheat: 2, reboot: 0, wifiswitch: 1, recording: 2};
const xml = readFileSync(new URL('../schemas/org.gnome.shell.extensions.informer.gschema.xml', import.meta.url), 'utf8');
for (const [key, p] of Object.entries(prio)) {
    const row = CATEGORIES.find(c => c.key === key);
    assert.ok(row, `CATEGORIES row for ${key}`);
    assert.equal(row.prio, p, `${key} default priority`);
    assert.match(xml, new RegExp(`name="priority-${key}" type="i">\\s*<default>${p}</default>`));
    for (const pre of ['show', 'icon'])
        assert.match(xml, new RegExp(`name="${pre}-${key}" type="b"`));
}

console.log('version 8 logic: all good');
