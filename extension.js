// Informer - GNOME Shell extension (GNOME 45+ ESM style)
// Top bar shows "Good Morning, Umesh". Changes (Bluetooth, Wi-Fi, charging,
// volume ...) slide in as a green/red message, a good thought slides in every
// few minutes, then the greeting returns. Click the item to open settings.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// ---------------- look & feel (code-level settings) ----------------
const SLIDE_PX = 60;        // how far the text slides
const SLIDE_MS = 250;       // slide speed (smaller = faster)
const WHITE = '#ffffff';    // fallback only - colours are set in the Informer settings
const LOW_BATTERY = [20, 10, 5];
// --------------------------------------------------------------------

const HOURLY = {
    0: 'Midnight coder mode: bugs fear you now.',
    1: 'The quiet hours. Great ideas show up uninvited.',
    2: 'Even the CPU wants you to sleep. Almost.',
    3: '3 AM: where legends and typos are born.',
    4: 'Early bird gets the best commits.',
    5: 'The sun is warming up. So should you.',
    6: 'Fresh day, clean git status.',
    7: 'Coffee loaded. Ready to compile the day.',
    8: "Let's ship something awesome today.",
    9: 'Focus time: one task, full power.',
    10: 'Small steps, big builds. Keep going.',
    11: 'Almost noon - push that commit.',
    12: 'Midday checkpoint: water, stretch, smile.',
    13: 'Lunch buffer loading... 100% needed.',
    14: "Post-lunch boss fight. You've got this.",
    15: "Afternoon grind: you're closer than you think.",
    16: 'Golden hour for debugging.',
    17: 'Wrap up, review, and be proud of today.',
    18: 'Evening vibes. Time to learn something new.',
    19: "Side-project o'clock. Build your dream.",
    20: 'Wind down, or level up - your call.',
    21: 'Night shift of the curious. Respect.',
    22: 'Save your work. Rest is a feature.',
    23: 'Last hour of today. Make it count.',
};

// Good thoughts - edit or add your own. One is shown every few minutes.
const THOUGHTS = [
    'Small progress is still progress.',
    'Do it badly, then do it better.',
    'Your future self is watching. Impress them.',
    'Consistency beats intensity.',
    'One bug fixed is one lesson earned.',
    'Be kind to yourself while you learn.',
    'Start before you feel ready.',
    'Slow is smooth, smooth is fast.',
    'Every expert was once a beginner.',
    'Focus on the next step, not the whole staircase.',
    'Rest is part of the work.',
    'You are closer than yesterday.',
    'Done is better than perfect.',
    'Curiosity is a superpower. Keep asking why.',
    'Good habits are quiet compounding.',
    "Don't compare your chapter 1 to their chapter 20.",
    'Make today a little better than yesterday.',
    'Breathe. Then continue.',
    'A calm mind writes cleaner code.',
    'Learn one thing deeply, then build with it.',
    'Hard roads lead to strong people.',
    'Say yes to growth, no to excuses.',
    "Your effort today is tomorrow's skill.",
    'Mistakes are just free tuition.',
    'Be the person who keeps showing up.',
    'Drink some water. Sit up straight.',
    'Gratitude turns enough into plenty.',
    "Build something you'd be proud to show.",
    'Patience is also progress.',
    'Dream big, ship small, repeat.',
    'Let your work speak louder than doubt.',
    'Smile. It makes the code compile faster.',
    'Courage is taking the next step anyway.',
    'Help someone today. It costs nothing.',
    'Stay humble, keep learning.',
    'Energy flows where focus goes.',
    'Today is a fresh page. Write well.',
    "Don't wait for motivation. Build momentum.",
    'Belief fuels the first mile.',
    'Small wins deserve a smile.',
    'Clear goals, calm steps, steady heart.',
    "Be proud of how far you've come.",
    'Quality grows from care, not hurry.',
    'Failure is feedback in disguise.',
    'Protect your focus like it is gold.',
    'Kind words cost nothing and mean everything.',
    'Take a short break. Your mind will thank you.',
    'The best time to start was yesterday. The next best is now.',
    'Skills are built in the boring middle.',
    'Choose progress over perfection.',
    'Your pace is your own. Keep walking.',
    'Teach what you learn, and you learn it twice.',
    'Be curious, be brave, be consistent.',
    'Good things take time and good habits.',
    'Every line of code is practice.',
    'Stay positive; the best builds are ahead.',
    'Listen more, assume less.',
    'Keep your promises, even to yourself.',
    'Peace of mind is productive.',
    "You've got this.",
];

// stride coprime with the list length so thoughts look shuffled but never repeat early
function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
}
const STRIDE = (() => {
    let s = 7;
    while (gcd(s, THOUGHTS.length) !== 1)
        s++;
    return s;
})();

function greetingWord(h) {
    if (h >= 5 && h < 12) return 'Good Morning';
    if (h >= 12 && h < 17) return 'Good Afternoon';
    if (h >= 17 && h < 21) return 'Good Evening';
    return 'Good Night';
}

// Run a command without blocking the shell. Always resolves to a string.
function run(argv) {
    return new Promise(resolve => {
        try {
            const proc = new Gio.Subprocess({
                argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, out] = p.communicate_utf8_finish(res);
                    resolve(out ?? '');
                } catch (e) {
                    resolve('');
                }
            });
        } catch (e) {
            resolve('');
        }
    });
}

function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : '';
    } catch (e) {
        return '';
    }
}

function readBattery() {
    for (const b of ['BAT0', 'BAT1', 'BATT']) {
        const cap = readFile(`/sys/class/power_supply/${b}/capacity`);
        if (cap)
            return {pct: parseInt(cap), status: readFile(`/sys/class/power_supply/${b}/status`)};
    }
    return null;
}

const InformerIndicator = GObject.registerClass(
class InformerIndicator extends PanelMenu.Button {
    _init(ext, settings) {
        super._init(0.0, 'Informer', true);   // true = no dropdown menu
        this._ext = ext;
        this._s = settings;

        this._greet = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            style: `color: ${WHITE}; font-weight: bold;`,
        });
        this.add_child(this._greet);

        // click = open the extension settings
        this.connect('button-press-event', () => {
            this._ext.openPreferences();
            return Clutter.EVENT_STOP;
        });

        this._prevSlow = null;
        this._prevVol = null;
        this._prevBat = null;
        this._lastHour = null;
        this._lastSlot = null;
        this._flashText = '';
        this._flashKind = 'info';
        this._flashUntil = 0;
        this._curText = null;
        this._curColor = null;
        this._busy = {slow: false, vol: false};
        this._pending = {slow: false, vol: false};
        this._deb = {};
        this._subs = [];
        this._pactlOk = false;
        this._destroyed = false;
        this._tick = 0;

        this._sid = this._s.connect('changed', () => {
            this._lastSlot = null;   // restart the thought timer on any change
            this._render();
        });

        this._render();
        this._pollSlow();
        this._pollVol();
        this._subscribeDBus();
        this._startPactl();

        // light 1-second heartbeat: battery file read, render, safety-net polls
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._checkBattery();
            this._render();
            this._tick = (this._tick + 1) % 3;
            if (this._tick === 0)
                this._pollSlow();            // safety net if an event was missed
            if (!this._pactlOk)
                this._pollVol();             // fallback when pactl subscribe is unavailable
            return GLib.SOURCE_CONTINUE;
        });
    }

    _str(k) { return this._s.get_string(k); }
    _int(k) { return this._s.get_int(k); }
    _bool(k) { return this._s.get_boolean(k); }

    // colour for a kind: 'greeting' | 'good' | 'bad' | 'info' | 'thought'
    _colorFor(kind) {
        return this._str(`color-${kind}`) || WHITE;
    }

    // ------------------------------------------------ display + animation
    // kind: 'good' | 'bad' | 'info' | 'thought'
    // cat: settings category ('bluetooth', 'wifi', 'battery', 'volume', 'hourly') or null
    _flash(text, kind, cat = null, ms = null) {
        if (cat && !this._bool(`show-${cat}`))
            return;
        this._flashText = text;
        this._flashKind = kind;
        this._flashUntil = Date.now() + (ms ?? this._int('flash-seconds') * 1000);
        this._render();
    }

    _show(text, color) {
        if (text === this._curText && color === this._curColor)
            return;
        const changed = text !== this._curText;
        this._curText = text;
        this._curColor = color;
        this._greet.set_text(text);
        this._greet.set_style(`color: ${color}; font-weight: bold;`);

        if (changed) {
            const dx = this._str('direction') === 'left-to-right' ? -SLIDE_PX : SLIDE_PX;
            this._greet.remove_all_transitions();
            this._greet.translation_x = dx;
            this._greet.opacity = 0;
            this._greet.ease({
                translation_x: 0,
                opacity: 255,
                duration: SLIDE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        }
    }

    _checkThought() {
        if (!this._bool('thoughts-enabled')) {
            this._lastSlot = null;
            return;
        }
        const mins = Math.max(1, this._int('thought-minutes'));
        const local = Date.now() - new Date().getTimezoneOffset() * 60000;
        const slot = Math.floor(local / (mins * 60000));
        if (this._lastSlot === null) {
            this._lastSlot = slot;
            return;
        }
        if (slot === this._lastSlot)
            return;
        this._lastSlot = slot;                       // set first (flash re-renders)
        if (Date.now() < this._flashUntil)
            return;                                  // don't cut off a status message
        const idx = ((slot % THOUGHTS.length) * STRIDE) % THOUGHTS.length;
        this._flash(THOUGHTS[idx], 'thought', null, this._int('thought-seconds') * 1000);
    }

    _render() {
        const h = new Date().getHours();
        if (this._lastHour !== h) {
            const first = this._lastHour === null;
            this._lastHour = h;                      // set first (flash re-renders)
            if (!first)
                this._flash(HOURLY[h], 'info', 'hourly');
        }
        this._checkThought();

        if (Date.now() < this._flashUntil)
            this._show(this._flashText, this._colorFor(this._flashKind));
        else
            this._show(`${greetingWord(h)}, ${this._str('name') || 'Umesh'}`, this._colorFor('greeting'));
    }

    // ------------------------------------------------ event sources
    _debounce(key, ms, fn) {
        if (this._deb[key])
            return;
        this._deb[key] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._deb[key] = 0;
            if (!this._destroyed)
                fn();
            return GLib.SOURCE_REMOVE;
        });
    }

    _subscribeDBus() {
        try {
            this._bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
        } catch (e) {
            this._bus = null;
            return;
        }
        const sub = (sender, iface, member, arg0, filterKey) => {
            const id = this._bus.signal_subscribe(
                sender, iface, member, null, arg0, Gio.DBusSignalFlags.NONE,
                (_c, _s, _p, _i, _sig, params) => {
                    if (filterKey) {
                        try {
                            if (!params.get_child_value(1).lookup_value(filterKey, null))
                                return;
                        } catch (e) { /* fall through and poll */ }
                    }
                    this._debounce('slow', 100, () => this._pollSlow());
                });
            this._subs.push(id);
        };
        const P = 'org.freedesktop.DBus.Properties';
        const NM = 'org.freedesktop.NetworkManager';
        sub('org.bluez', P, 'PropertiesChanged', 'org.bluez.Device1', 'Connected');
        sub('org.bluez', P, 'PropertiesChanged', 'org.bluez.Adapter1', 'Powered');
        sub(NM, P, 'PropertiesChanged', NM, null);
        sub(NM, NM, 'PropertiesChanged', null, null);
        sub(NM, `${NM}.Device`, 'StateChanged', null, null);
    }

    _startPactl() {
        try {
            this._pactl = new Gio.Subprocess({
                argv: ['pactl', 'subscribe'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            this._pactl.init(null);
            this._pactlIn = new Gio.DataInputStream({
                base_stream: this._pactl.get_stdout_pipe(),
                close_base_stream: true,
            });
            this._pactlOk = true;
            this._readPactl();
        } catch (e) {
            this._pactlOk = false;
        }
    }

    _readPactl() {
        if (this._destroyed || !this._pactlIn)
            return;
        this._pactlIn.read_line_async(GLib.PRIORITY_DEFAULT, null, (s, res) => {
            if (this._destroyed)
                return;
            try {
                const [line] = s.read_line_finish_utf8(res);
                if (line === null) {
                    this._pactlOk = false;   // pactl ended: fall back to polling
                    return;
                }
                if (/'change' on (sink|server)/.test(line))
                    this._debounce('vol', 60, () => this._pollVol());
                this._readPactl();
            } catch (e) {
                this._pactlOk = false;
            }
        });
    }

    // ------------------------------------------------ Wi-Fi + Bluetooth
    async _pollSlow() {
        if (this._destroyed)
            return;
        if (this._busy.slow) {
            this._pending.slow = true;
            return;
        }
        this._busy.slow = true;
        try {
            const [wifiRadio, wifiList, btShow, btDevs] = await Promise.all([
                run(['nmcli', 'radio', 'wifi']),
                run(['nmcli', '-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi']),
                run(['bluetoothctl', 'show']),
                run(['bluetoothctl', 'devices', 'Connected']),
            ]);
            if (this._destroyed)
                return;

            let wifi = {s: 'na', ssid: ''};
            if (wifiRadio.trim()) {
                if (wifiRadio.trim() !== 'enabled') {
                    wifi = {s: 'off', ssid: ''};
                } else {
                    wifi = {s: 'disconnected', ssid: ''};
                    for (const line of wifiList.split('\n')) {
                        if (line.startsWith('yes:')) {
                            wifi = {s: 'connected', ssid: line.slice(4).replace(/\\:/g, ':')};
                            break;
                        }
                    }
                }
            }

            let bt = {s: 'na', devs: []};
            if (btShow.trim()) {
                if (!btShow.includes('Powered: yes')) {
                    bt = {s: 'off', devs: []};
                } else {
                    const devs = [];
                    for (const line of btDevs.split('\n')) {
                        const m = line.trim().match(/^Device\s+[0-9A-F:]{17}\s+(.*)$/i);
                        if (m)
                            devs.push(m[1]);
                    }
                    bt = {s: 'on', devs};
                }
            }

            const prev = this._prevSlow;
            this._prevSlow = {wifi, bt};
            if (!prev)
                return;

            if (prev.bt.s !== bt.s) {
                if (bt.s === 'on')
                    this._flash('Bluetooth is ON', 'good', 'bluetooth');
                else if (bt.s === 'off')
                    this._flash('Bluetooth is OFF', 'bad', 'bluetooth');
            } else {
                const added = bt.devs.filter(d => !prev.bt.devs.includes(d));
                const gone = prev.bt.devs.filter(d => !bt.devs.includes(d));
                if (added.length)
                    this._flash(`Bluetooth is connected to ${added.join(', ')}`, 'good', 'bluetooth');
                else if (gone.length)
                    this._flash(`Bluetooth disconnected from ${gone.join(', ')}`, 'bad', 'bluetooth');
            }

            if (prev.wifi.s !== wifi.s || prev.wifi.ssid !== wifi.ssid) {
                if (wifi.s === 'connected')
                    this._flash(`Wi-Fi is connected to ${wifi.ssid}`, 'good', 'wifi');
                else if (wifi.s === 'disconnected')
                    this._flash('Wi-Fi disconnected', 'bad', 'wifi');
                else if (wifi.s === 'off')
                    this._flash('Wi-Fi is OFF', 'bad', 'wifi');
            }
        } catch (e) {
            console.error(`informer: ${e}`);
        } finally {
            this._busy.slow = false;
            if (this._pending.slow) {
                this._pending.slow = false;
                this._pollSlow();
            }
        }
    }

    // ------------------------------------------------ Volume
    async _pollVol() {
        if (this._destroyed)
            return;
        if (this._busy.vol) {
            this._pending.vol = true;
            return;
        }
        this._busy.vol = true;
        try {
            const [vol, mute] = await Promise.all([
                run(['pactl', 'get-sink-volume', '@DEFAULT_SINK@']),
                run(['pactl', 'get-sink-mute', '@DEFAULT_SINK@']),
            ]);
            if (this._destroyed)
                return;

            const vm = vol.match(/(\d+)%/);
            const cur = {pct: vm ? parseInt(vm[1]) : null, muted: mute.includes('yes')};
            const prev = this._prevVol;
            this._prevVol = cur;
            if (!prev || cur.pct === null || prev.pct === null)
                return;

            if (cur.muted !== prev.muted)
                this._flash(cur.muted ? 'Volume muted' : `Volume unmuted: ${cur.pct}%`,
                    cur.muted ? 'bad' : 'good', 'volume');
            else if (!cur.muted && cur.pct !== prev.pct)
                this._flash(`Volume: ${cur.pct}%`, cur.pct > prev.pct ? 'good' : 'bad', 'volume');
        } catch (e) {
            console.error(`informer: ${e}`);
        } finally {
            this._busy.vol = false;
            if (this._pending.vol) {
                this._pending.vol = false;
                this._pollVol();
            }
        }
    }

    // ------------------------------------------------ Battery
    _checkBattery() {
        const bat = readBattery();
        const prev = this._prevBat;
        this._prevBat = bat;
        if (!bat || !prev)
            return;

        if (bat.status !== prev.status) {
            if (bat.status === 'Charging')
                this._flash(`Charging: ${bat.pct}%`, 'good', 'battery');
            else if (bat.status === 'Discharging')
                this._flash(`Discharging: ${bat.pct}%`, 'bad', 'battery');
            else if (bat.status === 'Full')
                this._flash('Battery full: 100%', 'good', 'battery');
            else if (bat.status === 'Not charging')
                this._flash(`Plugged in, not charging: ${bat.pct}%`, 'info', 'battery');
        } else if (bat.status === 'Discharging') {
            for (const t of LOW_BATTERY) {
                if (prev.pct > t && bat.pct <= t) {
                    this._flash(`Battery low: ${bat.pct}%`, 'bad', 'battery');
                    break;
                }
            }
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        for (const k of Object.keys(this._deb)) {
            if (this._deb[k])
                GLib.source_remove(this._deb[k]);
        }
        if (this._bus) {
            for (const id of this._subs)
                this._bus.signal_unsubscribe(id);
        }
        this._subs = [];
        try {
            this._pactl?.force_exit();
        } catch (e) { /* ignore */ }
        this._pactl = null;
        this._pactlIn = null;
        if (this._sid) {
            this._s.disconnect(this._sid);
            this._sid = 0;
        }
        this._greet?.remove_all_transitions();
        super.destroy();
    }
});

export default class InformerExtension extends Extension {
    enable() {
        this._indicator = new InformerIndicator(this, this.getSettings());
        // index 0 in the right box = just left of the Wi-Fi/volume/battery menu
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
