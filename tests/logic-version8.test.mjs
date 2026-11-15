// Version 8 logic (grows with each phase). Phase 2: Night Light, Location, Touchpad, Power mode.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {onOffMessage, touchpadMessage, profileMessage} from '../switchlogic.js';
import {CATEGORIES} from '../data.js';
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

// ---- the new kinds have rows and the right default priority
const prio = {nightlight: 0, location: 0, touchpad: 1, powermode: 1, monitor: 1, ethernet: 1, gamepad: 1, printer: 1, brightness: 0};
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
