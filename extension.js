// Informer - GNOME Shell extension (GNOME 45+ ESM style)
// Top bar shows the live network speed (or the greeting, your choice) plus
// the temperature. Changes (Bluetooth, Wi-Fi, charging, volume, USB, internet,
// weather ...) slide in as a coloured message, a good thought slides in every
// few minutes, then the idle line returns. Messages can slide in from the
// side, roll up / down, flip, or pick a random one.
//
// Left click = details dropdown (or settings, see the left-click setting).
// Right click = settings. Middle click = show the next good thought now.
//
// Messages have priorities (Low / Normal / High / Critical, set per kind of
// message in the settings). A higher priority interrupts the one on screen,
// the rest wait in a queue, best first. Critical ignores quiet hours.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {CATEGORIES, HIGH, HOURLY, LOW, NORMAL, CRITICAL, THOUGHTS} from './data.js';
import {MessageQueue} from './queue.js';
import {levelColor, speedLevel} from './speedlogic.js';
import {UsageTracker} from './usage.js';
import {RingBuffer, graphPoints, hexToRgb} from './sparkline.js';
import {batteryTime, fmtHM, parseLocalIp, parseWifi} from './sysinfo.js';
import {Pomodoro, eventText, fmtClock, labelFor} from './pomodoro.js';
import {placeText} from './publicip.js';
import {clip, fmtBytes, listDir, readFile, run} from './util.js';
import {
    CalendarSource, CameraSource, InternetSource, KeyboardSource,
    ClipboardSource, FilesSource, LayoutSource, MediaSource, NotifySource, PingSource, PublicIpSource,
    ReminderSource, SystemSource, UsbSource, WeatherSource,
} from './sources.js';

// ---------------- look & feel (code-level settings) ----------------
const SLIDE_PX = 60;        // how far the text slides sideways
const SLIDE_MS = 250;       // slide speed (smaller = faster)
const ROLL_PX = 22;         // how far the text travels up / down (about the bar height)
const ROLL_OUT_MS = 150;    // old text leaving (up / down / flip)
const ROLL_IN_MS = 280;     // new text arriving (up / down / flip)
const IDLE_MIN_EM = 14;     // minimum width of the speed line, so the bar does not jitter
const IDLE_MIN_EM_TEMP = 19;   // same, when the temperature is shown too
const ICON_PX = 18;         // icon size in the bar
const GRAPH_W = 60;         // speed graph size in the bar (fixed, so the row never changes size)
const GRAPH_H = 16;
const GRAPH_N = 60;         // graph shows the last 60 seconds
const DND_SCHEMA = 'org.gnome.desktop.notifications';   // GNOME Do Not Disturb lives here
const WHITE = '#ffffff';    // fallback only - colours are set in the Informer settings
const UNPLUG_REPEAT_MS = 10 * 60 * 1000;   // repeat "unplug the charger" this often
const LOW_REPEAT_MS = 3 * 60 * 1000;       // repeat very-low-battery warnings this often
// --------------------------------------------------------------------

const CAT = new Map(CATEGORIES.map(c => [c.key, c]));

function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
}

// pick item i so that the order looks shuffled but nothing repeats early
function pick(list, i) {
    let stride = 7;
    while (gcd(stride, list.length) !== 1)
        stride++;
    return list[(i * stride) % list.length];
}

// ---- animations -----------------------------------------------------------
const ANIM_MODES = ['right-to-left', 'left-to-right', 'top-to-bottom', 'bottom-to-top', 'flip'];
const ROLLING = new Set(['top-to-bottom', 'bottom-to-top', 'flip']);   // old text leaves first

// where the new text starts from
function enterFrom(mode) {
    switch (mode) {
    case 'left-to-right': return {translation_x: -SLIDE_PX};
    case 'top-to-bottom': return {translation_y: -ROLL_PX};   // drops in from above
    case 'bottom-to-top': return {translation_y: ROLL_PX};    // rises from below
    case 'flip': return {rotation_angle_x: -90};
    default: return {translation_x: SLIDE_PX};
    }
}

// where the old text goes (rolling modes only)
function exitTo(mode) {
    switch (mode) {
    case 'top-to-bottom': return {translation_y: ROLL_PX};
    case 'bottom-to-top': return {translation_y: -ROLL_PX};
    default: return {rotation_angle_x: 90};
    }
}

// ---- network speed --------------------------------------------------------
// Skip loopback and virtual interfaces so traffic is not counted twice
// (a VPN tunnel carries the same bytes as the real Wi-Fi / Ethernet card).
const VIRTUAL_IF = /^(lo|docker|veth|br-|virbr|vmnet|vboxnet|tun|tap|wg|tailscale|zt|ifb|dummy)/;

// {iface: {rx, tx}} total bytes since boot
function readNetBytes() {
    const out = {};
    const lines = readFile('/proc/net/dev').split('\n').slice(2);   // 2 header lines
    for (const line of lines) {
        const i = line.indexOf(':');
        if (i < 0)
            continue;
        const name = line.slice(0, i).trim();
        if (VIRTUAL_IF.test(name))
            continue;
        const f = line.slice(i + 1).trim().split(/\s+/);
        out[name] = {rx: Number(f[0]) || 0, tx: Number(f[8]) || 0};
    }
    return out;
}

// Is any real network interface up? (virtual ones are skipped, like in readNetBytes)
function linkIsUp(names) {
    for (const n of names) {
        if (readFile(`/sys/class/net/${n}/operstate`) === 'up')
            return true;
    }
    return false;
}

function fmtSpeed(bytesPerSec) {
    return `${fmtBytes(bytesPerSec)}/s`;
}

// ---- icons (files in icons/, one per kind of message) ------------------------
// m: the queued message {text, kind, cat, key}. Returns an icon name or null.
function iconFor(m) {
    const good = m.kind === 'good';
    const pct = parseInt((m.text.match(/(\d+)%/) ?? [])[1] ?? '100');
    switch (m.cat) {
    case 'wifi':
    case 'internet': return good ? 'wifi-on' : 'wifi-off';
    case 'bluetooth': return 'bluetooth';
    case 'volume': return good ? 'volume-up' : 'volume-down';
    case 'battery':
        if (/^Charging/.test(m.text))
            return 'battery-charging';
        return pct <= 30 && /^Discharging/.test(m.text) ? 'battery-low' : 'battery-full';
    case 'batterywarn': return m.key === 'unplug' ? 'battery-full' : 'battery-low';
    case 'modes':
        if (m.key === 'dnd')
            return 'dnd';
        return m.key === 'airplane' ? 'airplane' : m.key === 'hotspot' ? 'wifi-on' : null;
    case 'layout': return 'keyboard';
    case 'media': return 'music';
    case 'updates': return 'update';
    case 'thought': return 'thought';
    case 'weather': return 'sun';
    case 'weatheralert': return 'alert';
    case 'pomodoro': return 'timer';
    case 'clipboard': return 'clipboard';
    case 'screenshot': return 'screenshot';
    case 'download': return 'down';
    case 'reminder':
    case 'notifications': return 'alert';
    case 'latency': return 'alert';
    case 'datausage': return 'down';
    case 'syswarn':
    case 'calendar': return 'alert';
    default: return m.kind === 'warn' ? 'alert' : null;
    }
}

function greetingWord(h) {
    if (h >= 5 && h < 12) return 'Good Morning';
    if (h >= 12 && h < 17) return 'Good Afternoon';
    if (h >= 17 && h < 21) return 'Good Evening';
    return 'Good Night';
}

function readBattery() {
    for (const b of ['BAT0', 'BAT1', 'BATT']) {
        const cap = readFile(`/sys/class/power_supply/${b}/capacity`);
        if (cap)
            return {pct: parseInt(cap), status: readFile(`/sys/class/power_supply/${b}/status`)};
    }
    return null;
}

// Battery details for the dropdown: {pct, status, sec} (sec = seconds left, or null)
function readBatteryDetail() {
    for (const b of ['BAT0', 'BAT1', 'BATT']) {
        const base = `/sys/class/power_supply/${b}`;
        const cap = readFile(`${base}/capacity`);
        if (!cap)
            continue;
        const status = readFile(`${base}/status`);
        const n = f => Number(readFile(`${base}/${f}`));
        const sec = batteryTime(status, {
            tte: n('time_to_empty_now'), ttf: n('time_to_full_now'),
            energyNow: n('energy_now'), energyFull: n('energy_full'), powerNow: n('power_now'),
            chargeNow: n('charge_now'), chargeFull: n('charge_full'), currentNow: n('current_now'),
        });
        return {pct: parseInt(cap), status, sec};
    }
    return null;
}

// Airplane mode = every radio (Wi-Fi, Bluetooth, mobile) is blocked.
// Returns null when the machine has no rfkill switches.
function readAirplane() {
    let total = 0;
    let blocked = 0;
    for (const d of listDir('/sys/class/rfkill')) {
        const base = `/sys/class/rfkill/${d}`;
        if (!['wlan', 'bluetooth', 'wwan'].includes(readFile(`${base}/type`)))
            continue;
        total++;
        if (readFile(`${base}/soft`) === '1' || readFile(`${base}/hard`) === '1')
            blocked++;
    }
    return total > 0 ? blocked === total : null;
}

const InformerIndicator = GObject.registerClass(
class InformerIndicator extends PanelMenu.Button {
    _init(ext, settings) {
        super._init(0.0, 'Informer', false);  // false = has the details dropdown
        this._ext = ext;
        this._s = settings;

        // _row is what gets animated; _content (icons + labels) is centred inside it
        this._row = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
        this._row.set_pivot_point(0.5, 0.5);        // flip turns around the centre
        this._content = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._row.add_child(this._content);
        this.add_child(this._row);
        this._icons = new Map();        // "name|colour" -> Gio.BytesIcon (or null)
        this._sig = null;               // shape of what is drawn now
        this._items = [];

        this._menuRows = {};
        this._menuBusy = false;
        this._menuN = 0;
        this._wifiInfo = null;
        this._localIp = '';
        this._buildMenu();

        this._q = new MessageQueue();
        this._armedFor = null;
        this._expiry = 0;
        this._thoughtN = Math.floor(Math.random() * 1000);
        this._prevSlow = null;
        this._prevVol = null;
        this._prevMic = null;
        this._prevBat = null;
        this._lastHour = null;
        this._lastSlot = null;
        this._want = null;              // what should be on screen: {parts, color, minEm}
        this._wantKey = null;
        this._wantGroup = null;
        this._shown = false;            // has anything been drawn yet?
        this._rolling = false;          // old text is on its way out
        this._gen = 0;                  // cancels stale animation callbacks
        this._netPrev = null;
        this._speed = {down: 0, up: 0};
        this._linkUp = true;
        this._graph = new RingBuffer(GRAPH_N);   // last 60 download speeds (only filled while the graph is on)
        this._graphArea = null;         // the St.DrawingArea in the bar, while it is drawn
        this._graphSig = 0;
        this._graphColor = WHITE;
        this._layout = null;
        // focus timer state (ticked by the 1 s heartbeat only while it is active)
        this._pom = new Pomodoro(() => ({
            focus: this._int('pomodoro-focus-min'),
            short: this._int('pomodoro-short-min'),
            long: this._int('pomodoro-long-min'),
        }));
        this._usage = new UsageTracker(this._s.get_string('data-usage'));
        this._usageSaveN = 0;
        this._usageDue = Date.now() + this._int('data-usage-hours') * 3600000;
        this._busy = {};
        this._pending = {};
        this._deb = {};
        this._subs = [];
        this._apCache = new Map();        // connection uuid -> is it a hotspot?
        this._radioQuietUntil = 0;        // hide Wi-Fi/Bluetooth noise right after airplane mode
        this._unplugAt = 0;
        this._lowLevel = 0;
        this._lowAt = 0;
        this._pactlOk = false;
        this._destroyed = false;
        this._tick = 0;

        this._sid = this._s.connect('changed', () => {
            this._lastSlot = null;   // restart the thought timer on any change
            this._render();
        });

        this._initDnd();
        this._render();
        this._pollSlow();
        this._pollVol();
        this._pollMic();
        this._subscribeDBus();
        this._startPactl();

        // extra event sources (now playing, USB, internet, calendar ...)
        const ctx = {settings: this._s, post: o => this._flash(o.text, o.kind, o.cat, o)};
        this._sources = [];
        this._weather = null;
        this._sysSource = null;
        this._ping = null;
        this._pub = null;
        for (const S of [MediaSource, UsbSource, KeyboardSource, CameraSource,
            InternetSource, SystemSource, CalendarSource, WeatherSource, PingSource, PublicIpSource,
            ClipboardSource, FilesSource, ReminderSource, NotifySource, LayoutSource]) {
            try {
                const src = new S(ctx);
                this._sources.push(src);
                if (S === WeatherSource)
                    this._weather = src;        // the idle line shows its temperature
                if (S === SystemSource)
                    this._sysSource = src;      // the dropdown reads its snapshot()
                if (S === PingSource)
                    this._ping = src;           // idle line + dropdown
                if (S === PublicIpSource)
                    this._pub = src;            // dropdown + VPN location
                if (S === LayoutSource)
                    this._layout = src;         // the idle line can show the input language
            } catch (e) {
                console.error(`informer: ${S.name} could not start: ${e}`);
            }
        }

        // focus timer: no timer of its own, the 1 s heartbeat ticks it while it is active
        this._keyBound = false;
        try {
            Main.wm.addKeybinding('pomodoro-toggle', this._s, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL, () => this._pomDo('toggle'));
            this._keyBound = true;
        } catch (e) {
            console.error(`informer: shortcut: ${e}`);
        }

        // light 1-second heartbeat: battery + network speed file reads, render, safety-net polls
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._checkBattery();
            this._sampleNet();
            this._graphTick();
            this._render();
            this._pomTick();
            this._refreshMenu();
            this._tick = (this._tick + 1) % 3;
            if (this._tick === 0)
                this._pollSlow();            // safety net if an event was missed
            if (!this._pactlOk) {
                this._pollVol();             // fallback when pactl subscribe is unavailable
                this._pollMic();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    // left click = dropdown (or settings), right click = settings, middle = next good thought
    vfunc_event(event) {
        const t = event.type();
        if (t === Clutter.EventType.BUTTON_PRESS) {
            const b = event.get_button();
            if (b === Clutter.BUTTON_MIDDLE)
                this._showThought(true);
            else if (b === Clutter.BUTTON_SECONDARY || this._str('left-click') === 'settings')
                this._ext.openPreferences();
            else
                this.menu.toggle();
            return Clutter.EVENT_STOP;
        }
        if (t === Clutter.EventType.TOUCH_BEGIN) {
            if (this._str('left-click') === 'settings')
                this._ext.openPreferences();
            else
                this.menu.toggle();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // ------------------------------------------------ details dropdown
    // one info line: [icon] text (not clickable)
    _infoRow(id, iconName, symbolic) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const icon = new St.Icon({style_class: 'popup-menu-icon', icon_size: 16});
        if (symbolic)
            icon.icon_name = symbolic;
        else
            icon.gicon = this._gicon(iconName, '#dddddd');
        const label = new St.Label({y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        item.add_child(icon);
        item.add_child(label);
        this.menu.addMenuItem(item);
        this._menuRows[id] = {item, label};
        return item;
    }

    _buildMenu() {
        const m = this.menu;
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Weather'));
        this._infoRow('wx1', 'sun');
        this._infoRow('wx2', 'sun');
        this._infoRow('wx3', 'sun');
        this._infoRow('wx4', 'sun');
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Network'));
        this._infoRow('speed', 'down');
        this._infoRow('today', 'down');
        this._infoRow('wifi', 'wifi-on');
        this._infoRow('ip', null, 'network-wired-symbolic');
        this._infoRow('ping', null, 'network-transmit-receive-symbolic');
        this._infoRow('pub', null, 'network-server-symbolic');
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('System'));
        this._infoRow('cpu', null, 'utilities-system-monitor-symbolic');
        this._infoRow('ram', null, 'utilities-system-monitor-symbolic');
        this._infoRow('temp', null, 'temperature-symbolic');
        this._infoRow('disk', null, 'drive-harddisk-symbolic');
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Battery'));
        this._infoRow('bat', 'battery-full');
        this._infoRow('batt', 'battery-full');
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Focus timer'));
        this._infoRow('pom', 'timer');
        this._pomBtn = new PopupMenu.PopupMenuItem('Start focus timer');
        this._pomBtn.connect('activate', () => this._pomDo('toggle'));
        m.addMenuItem(this._pomBtn);
        const skipBtn = new PopupMenu.PopupMenuItem('Skip');
        skipBtn.connect('activate', () => this._pomDo('skip'));
        m.addMenuItem(skipBtn);
        const resetBtn = new PopupMenu.PopupMenuItem('Reset');
        resetBtn.connect('activate', () => this._pomDo('reset'));
        m.addMenuItem(resetBtn);
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const thought = new PopupMenu.PopupMenuItem('Next good thought');
        thought.connect('activate', () => this._showThought(true));
        m.addMenuItem(thought);
        const settings = new PopupMenu.PopupMenuItem('Settings');
        settings.connect('activate', () => this._ext.openPreferences());
        m.addMenuItem(settings);

        // refresh only while open: no timer of its own, the 1 s heartbeat does it
        this._menuSig = m.connect('open-state-changed', (_m, open) => {
            if (open) {
                this._menuN = 0;
                this._pub?.ensure();        // goes online only when the answer is 30+ minutes old
                this._refreshMenu();
                this._refreshMenuSlow();
            }
        });
    }

    _setRow(id, text) {
        const r = this._menuRows[id];
        if (!r)
            return;
        r.item.visible = !!text;
        if (text && r.label.text !== text)
            r.label.text = text;
    }

    // fast rows (file reads only), once a second while open
    _refreshMenu() {
        if (this._destroyed || !this.menu.isOpen)
            return;
        const w = this._weather?.current;
        const u = w?.unit ?? 'C';
        if (w) {
            this._setRow('wx1', `${w.city}: ${w.temp}\u00b0${u}, feels ${w.feels}\u00b0, ${w.desc}`);
            this._setRow('wx2', `Humidity ${w.humidity}%, wind ${w.wind} ${w.windUnit}`);
            this._setRow('wx3', Number.isFinite(w.hi) ? `Today ${w.hi}\u00b0 / ${w.lo}\u00b0, rain ${w.rain ?? 0}%` : '');
            this._setRow('wx4', w.tomorrow && Number.isFinite(w.tomorrow.hi)
                ? `Tomorrow ${w.tomorrow.hi}\u00b0 / ${w.tomorrow.lo}\u00b0, rain ${w.tomorrow.rain ?? 0}%` : '');
        } else {
            this._setRow('wx1', 'Weather: not available');
            for (const k of ['wx2', 'wx3', 'wx4'])
                this._setRow(k, '');
        }

        this._setRow('speed', `Speed: ${fmtSpeed(this._speed.down)} down, ${fmtSpeed(this._speed.up)} up`);
        this._setRow('today', this._usageText());
        this._setRow('wifi', this._wifiInfo ? `Wi-Fi: ${clip(this._wifiInfo.ssid, 24)} (${this._wifiInfo.signal}%)` : 'Wi-Fi: not connected');
        this._setRow('ip', this._localIp ? `Local IP: ${this._localIp}` : '');

        const lat = this._ping?.last;
        this._setRow('ping', lat != null ? `Ping: ${lat} ms` : '');
        const pub = this._pub?.info;
        this._setRow('pub', this._pub ? (pub ? `Public IP: ${pub.ip} (${clip(placeText(pub), 28)})` : 'Public IP: checking...') : '');

        const pm = this._pom;
        this._setRow('pom', pm.active ? `${pm.state === 'focus' ? 'Focus' : 'Break'}: ${fmtClock(pm.left(Date.now()))}${pm.running ? '' : ' (paused)'}` : 'Focus timer: off');
        this._pomBtn.label.text = pm.running ? 'Pause' : (pm.active ? 'Resume' : 'Start focus timer');

        const sys = this._sysSource?.snapshot();
        this._setRow('cpu', sys?.cpu != null ? `CPU: ${sys.cpu}%` : 'CPU: ...');
        this._setRow('ram', sys?.ram != null ? `RAM: ${sys.ram}%` : '');
        this._setRow('temp', sys?.temp ? `Temperature: ${Math.round(sys.temp)}\u00b0C` : '');
        this._setRow('disk', sys?.diskFree ? `Disk free: ${fmtBytes(sys.diskFree.free)}` : '');

        const bat = readBatteryDetail();
        this._setRow('bat', bat ? `Battery: ${bat.pct}%, ${bat.status.toLowerCase()}` : '');
        this._setRow('batt', bat?.sec ? `${bat.status === 'Charging' ? 'Full in' : 'Time left:'} ${fmtHM(bat.sec)}` : '');

        if (++this._menuN % 5 === 0)
            this._refreshMenuSlow();
    }

    // slower rows (small commands), on open and then every 5 seconds while open
    async _refreshMenuSlow() {
        if (this._menuBusy || this._destroyed)
            return;
        this._menuBusy = true;
        try {
            const [wifi, ip] = await Promise.all([
                run(['nmcli', '-t', '-f', 'ACTIVE,SSID,SIGNAL', 'dev', 'wifi']),
                run(['ip', '-4', '-o', 'addr', 'show', 'scope', 'global']),
            ]);
            if (this._destroyed)
                return;
            this._wifiInfo = parseWifi(wifi);
            this._localIp = parseLocalIp(ip);
        } finally {
            this._menuBusy = false;
        }
    }

    // ------------------------------------------------ focus timer
    _pomDo(what) {
        if (this._destroyed)
            return;
        const now = Date.now();
        let ev = null;
        if (what === 'toggle')
            this._pom.toggle(now);
        else if (what === 'skip')
            ev = this._pom.skip(now);
        else if (what === 'reset')
            this._pom.reset();
        if (ev)
            this._pomEvent(ev);
        this._render();
    }

    _pomTick() {
        if (!this._pom.active)
            return;
        const ev = this._pom.tick(Date.now());
        if (ev)
            this._pomEvent(ev);
    }

    _pomEvent(ev) {
        this._flash(eventText(ev), ev.from === 'focus' ? 'good' : 'info', 'pomodoro', {key: 'pomodoro'});
        if (this._bool('pomodoro-sound')) {
            try {
                global.display.get_sound_player().play_from_theme('complete', 'Focus timer', null);
            } catch (e) { /* no sound player: stay quiet */ }
        }
    }

    _str(k) { return this._s.get_string(k); }
    _int(k) { return this._s.get_int(k); }
    _bool(k) { return this._s.get_boolean(k); }

    // colour for a kind: 'greeting' | 'good' | 'bad' | 'warn' | 'info' | 'thought'
    _colorFor(kind) {
        return this._str(`color-${kind}`) || WHITE;
    }

    // ------------------------------------------------ priorities + queue
    _prioOf(cat, boost = 0) {
        const base = cat && CAT.has(cat) ? this._int(`priority-${cat}`) : NORMAL;
        return Math.max(LOW, Math.min(CRITICAL, base + boost));
    }

    // Quiet hours and fullscreen: only Critical messages get through.
    _quiet() {
        // GNOME Do Not Disturb is on (banners off)
        if (this._dnd && this._bool('quiet-follow-dnd') && !this._dnd.get_boolean('show-banners'))
            return true;
        if (this._bool('quiet-enabled')) {
            const h = new Date().getHours();
            const from = this._int('quiet-start');
            const to = this._int('quiet-end');
            if (from !== to && (from < to ? (h >= from && h < to) : (h >= from || h < to)))
                return true;
        }
        if (this._bool('quiet-fullscreen')) {
            try {
                if (Main.layoutManager.primaryMonitor?.inFullscreen)
                    return true;
            } catch (e) { /* ignore */ }
        }
        return false;
    }

    // kind: 'good' | 'bad' | 'warn' | 'info' | 'thought'
    // cat: category from data.js (decides the on/off switch and the priority) or null
    // opts: {key, boost, prio, ms, force}
    //   key   - a newer message with the same key replaces the older one
    //   boost - raise/lower the category priority for this message only
    //   force - ignore quiet hours (for things the person asked for)
    _flash(text, kind, cat = null, opts = {}) {
        if (this._destroyed)
            return;
        if (cat && CAT.get(cat)?.toggle && !this._bool(`show-${cat}`))
            return;
        const prio = opts.prio ?? this._prioOf(cat, opts.boost ?? 0);
        if (!opts.force && prio < CRITICAL && this._quiet())
            return;
        const base = this._int('flash-seconds') * 1000;
        const ms = opts.ms ?? Math.round(base * (prio >= CRITICAL ? 1.5 : 1));
        this._q.post({text, kind, prio, ms, key: opts.key ?? null, cat}, Date.now());
        this._sync();
    }

    // Let the queue decide what is on screen, then draw it.
    _sync() {
        const now = Date.now();
        const cur = this._q.advance(now);
        if (cur !== this._armedFor) {
            this._armedFor = cur;
            if (cur)
                this._armExpiry(cur.until - now);
        }
        this._paint(cur);
    }

    // wake up exactly when the message on screen is due to leave
    _armExpiry(ms) {
        if (this._expiry)
            GLib.source_remove(this._expiry);
        this._expiry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(50, ms + 30), () => {
            this._expiry = 0;
            if (!this._destroyed)
                this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ------------------------------------------------ network speed
    // null when icons are off (master switch) or off for this kind of message
    _iconFor(m) {
        if (!this._bool('show-icons'))
            return null;
        if (m.cat && CAT.has(m.cat) && !this._bool(`icon-${m.cat}`))
            return null;
        return iconFor(m);
    }

    // Bytes per second since the last tick, summed over the real interfaces.
    _sampleNet() {
        const now = GLib.get_monotonic_time() / 1e6;
        const cur = readNetBytes();
        const prev = this._netPrev;
        this._netPrev = {t: now, d: cur};
        if (!prev)
            return;
        const dt = now - prev.t;
        if (dt < 0.2)
            return;
        let rx = 0;
        let tx = 0;
        for (const [name, c] of Object.entries(cur)) {
            const p = prev.d[name];
            if (!p)
                continue;                       // interface just appeared
            rx += Math.max(0, c.rx - p.rx);     // counters can reset: never go negative
            tx += Math.max(0, c.tx - p.tx);
        }
        this._speed = {down: rx / dt, up: tx / dt};
        this._usage.add(rx, tx);          // deltas only: a reboot resets the counters, not the total
        if (this._bool('idle-show-graph'))
            this._graph.push(this._speed.down);
        else if (this._graph.length)
            this._graph.clear();          // switched off: forget the old samples
        if (this._bool('speed-colors'))
            this._linkUp = linkIsUp(Object.keys(cur));
        this._usageTick();
    }

    // ------------------------------------------------ data used today
    _usageText() {
        return `Today: ${fmtBytes(this._usage.rx)} down, ${fmtBytes(this._usage.tx)} up`;
    }

    // called once a second from _sampleNet: save at most once a minute, post every N hours
    _usageTick() {
        if (++this._usageSaveN >= 60) {
            this._usageSaveN = 0;
            this._saveUsage();
        }
        if (Date.now() >= this._usageDue) {
            this._usageDue = Date.now() + Math.max(1, this._int('data-usage-hours')) * 3600000;
            this._flash(this._usageText(), 'info', 'datausage', {key: 'datausage'});
        }
    }

    _saveUsage() {
        try {
            const j = this._usage.toJSON();
            if (j !== this._s.get_string('data-usage'))
                this._s.set_string('data-usage', j);
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------ display + animation
    _paint(cur) {
        if (cur) {
            const icon = this._iconFor(cur);
            this._show(icon ? [{icon}, {text: cur.text}] : [{text: cur.text}],
                this._colorFor(cur.kind), `msg:${cur.text}`);
            return;
        }
        const color = this._colorFor('greeting');
        if (this._pom.active) {
            const t = `${labelFor(this._pom)} ${fmtClock(this._pom.left(Date.now()))}`;
            const fc = this._colorFor('focus');
            const pomIcon = this._bool('show-icons') && this._bool('icon-pomodoro');
            this._show(pomIcon ? [{icon: 'timer', color: fc}, {text: t, color: fc}] : [{text: t, color: fc}],
                fc, 'idle:pomodoro', 8);
            return;
        }
        if (this._str('idle-display') === 'greeting') {
            const h = new Date().getHours();
            this._show([{text: `${greetingWord(h)}, ${this._str('name') || 'Umesh'}`}],
                color, 'idle:greeting');
            return;
        }
        // default: live network speed (+ temperature). Same group every second,
        // so the numbers change quietly and only the arrival is animated.
        const down = fmtSpeed(this._speed.down);
        const up = fmtSpeed(this._speed.up);
        const temp = this._bool('idle-show-temp') ? this._weather?.brief() : '';
        // speed colours: green fast, normal, amber slow, red link down (same group: no animation)
        let sc = color;
        if (this._bool('speed-colors')) {
            const level = speedLevel(this._speed.down, this._speed.up,
                this._int('speed-fast-kbps'), this._int('speed-slow-kbps'), this._linkUp);
            sc = levelColor(level, {
                good: this._colorFor('good'), warn: this._colorFor('warn'),
                bad: this._colorFor('bad'), normal: color,
            });
        }
        const pingMs = this._bool('idle-show-ping') ? this._ping?.last : null;
        const ping = pingMs != null ? `${pingMs} ms` : '';
        const graph = this._bool('idle-show-graph');
        // input language: only when more than one is set up (otherwise it is just noise)
        const lang = this._bool('idle-show-layout') && (this._layout?.count() ?? 0) > 1 ? this._layout.short() : '';
        let parts;
        if (this._bool('show-icons')) {
            parts = [{icon: 'down', color: sc}, {text: down, color: sc},
                {icon: 'up', gap: 12, color: sc}, {text: up, color: sc}];
            if (graph)
                parts.push({graph: true, gap: 12, color: sc});
            if (ping)
                parts.push({text: ping, gap: 14});
            if (lang)
                parts.push({text: lang, gap: 14});
            if (temp)
                parts.push({icon: 'sun', gap: 14}, {text: temp});
        } else {
            parts = [{text: `↓ ${down}   ↑ ${up}${ping ? `   ·   ${ping}` : ''}${lang ? `   ·   ${lang}` : ''}${temp ? `   ·   ${temp}` : ''}`}];
            if (graph)
                parts.push({graph: true, gap: 12, color: sc});
        }
        // own group for each extra (ping, language, graph): only its arrival animates, never a tick.
        // The graph has a fixed size and a fixed slot, so the row never changes size.
        const group = `idle:speed${ping ? '+ping' : ''}${lang ? '+layout' : ''}${graph ? '+graph' : ''}`;
        this._show(parts, this._bool('show-icons') ? color : sc, group,
            (temp ? IDLE_MIN_EM_TEMP : IDLE_MIN_EM) + (ping ? 5 : 0) + (lang ? 3 : 0) + (graph ? 5 : 0));
    }

    // parts: [{icon: 'name', gap?}, {text, gap?}] drawn left to right.
    // group: a change of group is animated; a change of text inside the same
    // group (the speed numbers) is just drawn.
    _show(parts, color, group, minEm = 0) {
        const key = JSON.stringify([parts, color, minEm]);
        if (key === this._wantKey)
            return;
        const newGroup = group !== this._wantGroup || !this._shown;
        this._want = {parts, color, minEm};
        this._wantKey = key;
        this._wantGroup = group;

        if (!newGroup) {
            if (!this._rolling)         // while the old text rolls out, the new one is drawn on arrival
                this._apply();
            return;
        }
        this._animate();
    }

    // icon file -> St-loadable icon, recoloured to the message colour
    // (the icon files use #ffffff for the parts that take the colour)
    _gicon(name, color) {
        const key = `${name}|${color}`;
        if (!this._icons.has(key)) {
            const svg = readFile(`${this._ext.path}/icons/${name}.svg`);
            let g = null;
            if (svg) {
                try {
                    g = new Gio.BytesIcon({
                        bytes: GLib.Bytes.new(new TextEncoder().encode(svg.replace(/#ffffff/gi, color))),
                    });
                } catch (e) {
                    console.error(`informer: icon ${name}: ${e}`);
                }
            }
            this._icons.set(key, g);
        }
        return this._icons.get(key);
    }

    // Rebuild the widgets only when the shape (which icons, which colour)
    // changes; otherwise just update the label texts in place.
    _apply() {
        const {parts, color, minEm} = this._want;
        this._row.set_style(minEm ? `min-width: ${minEm}em;` : '');
        const shown = parts.filter(p => p.graph || !p.icon || this._gicon(p.icon, p.color ?? color));
        const sig = `${color}|${shown.map(p => `${p.graph ? 'g' : (p.icon ?? 't')}${p.color ?? ''}`).join(',')}`;
        if (sig !== this._sig) {
            this._sig = sig;
            this._dropGraph();              // the old graph widget goes away with its children
            this._content.destroy_all_children();
            this._items = shown.map((p, i) => {
                const margin = (i > 0 && p.gap ? `margin-left: ${p.gap}px;` : '');
                let w;
                if (p.graph) {
                    w = this._makeGraph(p.color ?? color, margin);
                } else if (p.icon) {
                    w = new St.Icon({
                        gicon: this._gicon(p.icon, p.color ?? color),
                        icon_size: ICON_PX,
                        y_align: Clutter.ActorAlign.CENTER,
                        style: `${margin} margin-right: 4px;`,
                    });
                } else {
                    w = new St.Label({
                        y_align: Clutter.ActorAlign.CENTER,
                        style: `color: ${p.color ?? color}; font-weight: bold; ${margin}`,
                    });
                }
                this._content.add_child(w);
                return w;
            });
        }
        shown.forEach((p, i) => {
            if (!p.icon && !p.graph)
                this._items[i].set_text(p.text);
        });
    }

    // ------------------------------------------------ speed graph
    // fixed-size drawing area: last 60 download speeds as a small filled line
    _makeGraph(color, margin) {
        const area = new St.DrawingArea({
            width: GRAPH_W,
            height: GRAPH_H,
            y_align: Clutter.ActorAlign.CENTER,
            style: margin,
        });
        this._graphColor = color;
        this._graphSig = area.connect('repaint', () => this._drawGraph(area));
        this._graphArea = area;
        return area;
    }

    _dropGraph() {
        if (this._graphArea && this._graphSig) {
            try {
                this._graphArea.disconnect(this._graphSig);
            } catch (e) { /* already gone */ }
        }
        this._graphArea = null;
        this._graphSig = 0;
    }

    _drawGraph(area) {
        if (this._destroyed)
            return;
        const cr = area.get_context();
        try {
            const [w, h] = area.get_surface_size();
            const pts = graphPoints(this._graph.values(), GRAPH_N, w, h);
            if (pts.length < 2)
                return;
            const [r, g, b] = hexToRgb(this._graphColor);
            cr.setSourceRGBA(r, g, b, 0.28);          // soft fill under the line
            cr.moveTo(pts[0].x, h);
            for (const p of pts)
                cr.lineTo(p.x, p.y);
            cr.lineTo(pts[pts.length - 1].x, h);
            cr.closePath();
            cr.fill();
            cr.setSourceRGBA(r, g, b, 1);             // the line itself
            cr.setLineWidth(1.5);
            cr.moveTo(pts[0].x, pts[0].y);
            for (const p of pts.slice(1))
                cr.lineTo(p.x, p.y);
            cr.stroke();
        } finally {
            cr.$dispose();
        }
    }

    // once a second, only while the graph is on screen in the idle line
    // (not while a message, the focus timer or the greeting is shown)
    _graphTick() {
        if (this._graphArea && !this._rolling && this._wantGroup?.startsWith('idle:speed'))
            this._graphArea.queue_repaint();
    }

    // ------------------------------------------------ Do Not Disturb
    _initDnd() {
        this._dnd = null;
        this._dndSig = 0;
        this._dndOn = false;
        try {
            const schema = Gio.SettingsSchemaSource.get_default()?.lookup(DND_SCHEMA, true);
            if (!schema || !schema.has_key('show-banners'))
                return;                 // no such schema: DND sync stays off
            this._dnd = new Gio.Settings({schema_id: DND_SCHEMA});
            this._dndOn = !this._dnd.get_boolean('show-banners');
            this._dndSig = this._dnd.connect('changed::show-banners', () => this._dndChanged());
        } catch (e) {
            console.error(`informer: Do Not Disturb sync: ${e}`);
            this._dnd = null;
        }
    }

    _dndChanged() {
        if (this._destroyed || !this._dnd)
            return;
        const on = !this._dnd.get_boolean('show-banners');
        if (on === this._dndOn)
            return;
        this._dndOn = on;
        // force: the person just switched it, so say so even though it makes us quiet
        this._flash(on ? 'Do Not Disturb ON' : 'Do Not Disturb OFF', 'info', 'modes', {key: 'dnd', force: true});
    }

    _pickMode() {
        const d = this._str('direction');
        if (d === 'random')
            return ANIM_MODES[Math.floor(Math.random() * ANIM_MODES.length)];
        return ANIM_MODES.includes(d) ? d : 'right-to-left';
    }

    _animate() {
        const a = this._row;
        const gen = ++this._gen;
        const mode = this._pickMode();
        a.remove_all_transitions();
        this._rolling = false;
        // vertical movement is clipped to the bar so the text rolls in and out of it
        this.clip_to_allocation = mode === 'top-to-bottom' || mode === 'bottom-to-top';

        if (!this._shown || !ROLLING.has(mode)) {
            this._shown = true;
            this._apply();
            this._enter(mode);
            return;
        }

        // roll: old text leaves, then the new text arrives
        this._rolling = true;
        a.ease({
            ...exitTo(mode),
            opacity: 0,
            duration: ROLL_OUT_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (gen !== this._gen || this._destroyed)
                    return;                  // a newer message took over
                this._rolling = false;
                this._apply();
                this._enter(mode);
            },
        });
    }

    _enter(mode) {
        const a = this._row;
        a.translation_x = 0;
        a.translation_y = 0;
        a.rotation_angle_x = 0;
        Object.assign(a, enterFrom(mode));
        a.opacity = 0;
        a.ease({
            translation_x: 0,
            translation_y: 0,
            rotation_angle_x: 0,
            opacity: 255,
            duration: ROLLING.has(mode) ? ROLL_IN_MS : SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    // ------------------------------------------------ good thoughts
    _nextThought() {
        const mine = this._s.get_strv('thoughts').map(t => t.trim()).filter(Boolean);
        const n = this._thoughtN++;
        if (!mine.length)
            return pick(THOUGHTS, n);
        if (!this._bool('use-builtin-thoughts'))
            return pick(mine, n);
        // both lists: alternate, so your own thoughts show up regularly
        return n % 2 === 0 ? pick(mine, n >> 1) : pick(THOUGHTS, n >> 1);
    }

    _showThought(byClick) {
        // a click is something the person asked for: show it now, even in quiet hours
        this._flash(this._nextThought(), 'thought', 'thought', {
            ms: this._int('thought-seconds') * 1000,
            key: 'thought',
            force: byClick,
            prio: byClick ? HIGH : undefined,
        });
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
        this._showThought(false);
    }

    _render() {
        const h = new Date().getHours();
        if (this._lastHour !== h) {
            const first = this._lastHour === null;
            this._lastHour = h;                      // set first (flash re-renders)
            if (!first)
                this._flash(HOURLY[h], 'info', 'hourly', {key: 'hourly'});
        }
        this._checkThought();
        this._sync();
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

    // Run fn one at a time per name; if asked again meanwhile, run once more after.
    async _guarded(name, fn) {
        if (this._destroyed)
            return;
        if (this._busy[name]) {
            this._pending[name] = true;
            return;
        }
        this._busy[name] = true;
        try {
            await fn();
        } catch (e) {
            console.error(`informer: ${e}`);
        } finally {
            this._busy[name] = false;
            if (this._pending[name]) {
                this._pending[name] = false;
                this._guarded(name, fn);
            }
        }
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
        sub(NM, `${NM}.Connection.Active`, 'StateChanged', null, null);
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
                if (/'change' on (source|server)/.test(line))
                    this._debounce('mic', 80, () => this._pollMic());
                this._readPactl();
            } catch (e) {
                this._pactlOk = false;
            }
        });
    }

    // ------------------------------------------------ Wi-Fi, Bluetooth, VPN, hotspot, airplane
    _pollSlow() {
        return this._guarded('slow', () => this._doSlow());
    }

    // is this active Wi-Fi connection a hotspot (access-point mode)? Cached per connection.
    async _isHotspot(uuid) {
        if (!this._apCache.has(uuid)) {
            const mode = (await run(['nmcli', '-g', '802-11-wireless.mode',
                'connection', 'show', 'uuid', uuid])).trim();
            this._apCache.set(uuid, mode === 'ap');
        }
        return this._apCache.get(uuid);
    }

    async _doSlow() {
        const [wifiRadio, wifiList, btShow, btDevs, conns] = await Promise.all([
            run(['nmcli', 'radio', 'wifi']),
            run(['nmcli', '-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi']),
            run(['bluetoothctl', 'show']),
            run(['bluetoothctl', 'devices', 'Connected']),
            run(['nmcli', '-t', '-f', 'UUID,TYPE,NAME', 'connection', 'show', '--active']),
        ]);
        if (this._destroyed)
            return;

        // active connections: VPNs and hotspot
        const vpns = [];
        let hotspot = false;
        for (const line of conns.split('\n')) {
            const m = line.match(/^([0-9a-f-]{36}):([^:]*):(.*)$/i);
            if (!m)
                continue;
            const [, uuid, type, rawName] = m;
            if (type === 'vpn' || type === 'wireguard')
                vpns.push(rawName.replace(/\\:/g, ':'));
            else if (type === '802-11-wireless' && await this._isHotspot(uuid))
                hotspot = true;
        }
        if (this._destroyed)
            return;

        let wifi = {s: 'na', ssid: ''};
        if (wifiRadio.trim()) {
            if (wifiRadio.trim() !== 'enabled') {
                wifi = {s: 'off', ssid: ''};
            } else if (hotspot) {
                wifi = {s: 'hotspot', ssid: ''};     // sharing, not connected to a router
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

        const air = readAirplane();

        const prev = this._prevSlow;
        this._prevSlow = {wifi, bt, vpns, hotspot, air};
        if (!prev)
            return;
        if (prev.wifi.s !== wifi.s || prev.wifi.ssid !== wifi.ssid)
            this._pub?.invalidate();      // public IP is looked up again when the menu opens

        // airplane mode switches Wi-Fi and Bluetooth off too: say it once, not three times
        if (air !== null && prev.air !== null && air !== prev.air) {
            this._radioQuietUntil = Date.now() + 5000;
            this._flash(air ? 'Airplane mode is ON' : 'Airplane mode is OFF',
                air ? 'warn' : 'good', 'modes', {key: 'airplane'});
        }
        const hush = Date.now() < this._radioQuietUntil;

        if (!hush) {
            if (prev.bt.s !== bt.s) {
                if (bt.s === 'on')
                    this._flash('Bluetooth is ON', 'good', 'bluetooth', {key: 'bluetooth'});
                else if (bt.s === 'off')
                    this._flash('Bluetooth is OFF', 'bad', 'bluetooth', {key: 'bluetooth'});
            } else {
                const added = bt.devs.filter(d => !prev.bt.devs.includes(d));
                const gone = prev.bt.devs.filter(d => !bt.devs.includes(d));
                if (added.length)
                    this._flash(`Bluetooth is connected to ${added.join(', ')}`, 'good', 'bluetooth', {key: 'bluetooth'});
                else if (gone.length)
                    this._flash(`Bluetooth disconnected from ${gone.join(', ')}`, 'bad', 'bluetooth', {key: 'bluetooth'});
            }

            const wifiMoved = prev.wifi.s !== wifi.s || prev.wifi.ssid !== wifi.ssid;
            // hotspot turned off: the hotspot message already says it
            const afterHotspot = prev.wifi.s === 'hotspot' && wifi.s === 'disconnected';
            if (wifiMoved && !afterHotspot) {
                if (wifi.s === 'connected')
                    this._flash(`Wi-Fi is connected to ${wifi.ssid}`, 'good', 'wifi', {key: 'wifi'});
                else if (wifi.s === 'disconnected')
                    this._flash('Wi-Fi disconnected', 'bad', 'wifi', {key: 'wifi'});
                else if (wifi.s === 'off')
                    this._flash('Wi-Fi is OFF', 'bad', 'wifi', {key: 'wifi'});
            }

            if (prev.hotspot !== hotspot)
                this._flash(hotspot ? 'Hotspot is ON' : 'Hotspot is OFF',
                    hotspot ? 'good' : 'info', 'modes', {key: 'hotspot'});

            const vpnOn = vpns.filter(v => !prev.vpns.includes(v));
            const vpnOff = prev.vpns.filter(v => !vpns.includes(v));
            if (vpnOn.length) {
                this._flash(`VPN connected: ${vpnOn.join(', ')}`, 'good', 'modes', {key: 'vpn'});
                if (this._bool('show-vpnlocation'))
                    this._pub?.lookupSoon(vpnOn[0]);   // "VPN: Frankfurt, Germany (185.12.x.x)"
            }
            else if (vpnOff.length)
                this._flash(`VPN disconnected: ${vpnOff.join(', ')}`, 'bad', 'modes', {key: 'vpn'});
        }
    }

    // ------------------------------------------------ Volume + microphone
    _pollVol() {
        return this._guarded('vol', () => this._doVol());
    }

    async _doVol() {
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
                cur.muted ? 'bad' : 'good', 'volume', {key: 'volume'});
        else if (!cur.muted && cur.pct !== prev.pct)
            this._flash(`Volume: ${cur.pct}%`, cur.pct > prev.pct ? 'good' : 'bad', 'volume', {key: 'volume'});
    }

    _pollMic() {
        return this._guarded('mic', () => this._doMic());
    }

    async _doMic() {
        const out = await run(['pactl', 'get-source-mute', '@DEFAULT_SOURCE@']);
        if (this._destroyed || !out.trim())
            return;
        const muted = out.includes('yes');
        const prev = this._prevMic;
        this._prevMic = muted;
        if (prev === null || prev === muted)
            return;
        this._flash(muted ? 'Microphone muted' : 'Microphone is live',
            muted ? 'bad' : 'good', 'mic', {key: 'mic'});
    }

    // ------------------------------------------------ Battery
    _checkBattery() {
        const bat = readBattery();
        const prev = this._prevBat;
        this._prevBat = bat;
        if (!bat)
            return;
        const now = Date.now();

        // plugged in / unplugged / full
        if (prev && bat.status !== prev.status) {
            if (bat.status === 'Charging')
                this._flash(`Charging: ${bat.pct}%`, 'good', 'battery', {key: 'battery'});
            else if (bat.status === 'Discharging')
                this._flash(`Discharging: ${bat.pct}%`, 'bad', 'battery', {key: 'battery'});
            else if (bat.status === 'Full')
                this._flash('Battery full: 100%', 'good', 'battery', {key: 'battery'});
            else if (bat.status === 'Not charging')
                this._flash(`Plugged in, not charging: ${bat.pct}%`, 'info', 'battery', {key: 'battery'});
        }

        // "Unplug at 80%" reminder (protects the battery); repeats while still charging
        const limit = this._int('charge-limit');
        if (bat.status === 'Charging' && limit < 100 && bat.pct >= limit) {
            if (now - this._unplugAt > UNPLUG_REPEAT_MS) {
                this._unplugAt = now;
                this._flash(`Battery ${bat.pct}%: unplug the charger`, 'warn', 'batterywarn', {key: 'unplug'});
            }
        } else {
            this._unplugAt = 0;
        }

        // low battery: 20% once, 10% and 5% are critical and repeat every few minutes
        if (bat.status === 'Discharging') {
            const level = bat.pct <= 5 ? 5 : bat.pct <= 10 ? 10 : bat.pct <= 20 ? 20 : 0;
            const fresh = level !== this._lowLevel;
            if (level && (fresh || (level <= 10 && now - this._lowAt > LOW_REPEAT_MS))) {
                this._lowLevel = level;
                this._lowAt = now;
                if (level === 20)
                    this._flash(`Battery low: ${bat.pct}%. Plug in the charger.`, 'warn', 'batterywarn', {key: 'batlow'});
                else if (level === 10)
                    this._flash(`Battery very low: ${bat.pct}%. Plug in now!`, 'bad', 'batterywarn', {key: 'batlow', boost: 1});
                else
                    this._flash(`Battery critical: ${bat.pct}%! Plug in right now.`, 'bad', 'batterywarn',
                        {key: 'batlow', boost: 1, ms: 12000});
            } else if (!level) {
                this._lowLevel = 0;
            }
        } else {
            this._lowLevel = 0;
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        if (this._expiry) {
            GLib.source_remove(this._expiry);
            this._expiry = 0;
        }
        for (const k of Object.keys(this._deb)) {
            if (this._deb[k])
                GLib.source_remove(this._deb[k]);
        }
        for (const s of this._sources ?? []) {
            try {
                s.destroy();
            } catch (e) {
                console.error(`informer: ${e}`);
            }
        }
        this._sources = [];
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
        if (this._keyBound) {
            try {
                Main.wm.removeKeybinding('pomodoro-toggle');
            } catch (e) { /* ignore */ }
            this._keyBound = false;
        }
        if (this._menuSig) {
            this.menu.disconnect(this._menuSig);
            this._menuSig = 0;
        }
        if (this._dnd) {
            if (this._dndSig)
                this._dnd.disconnect(this._dndSig);
            this._dndSig = 0;
            this._dnd = null;
        }
        this._dropGraph();
        this._graph.clear();
        this._saveUsage();
        this._q.clear();
        this._gen++;
        this._row?.remove_all_transitions();
        this._icons.clear();
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
