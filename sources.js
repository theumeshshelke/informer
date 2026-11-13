// Informer - extra event sources. Each one watches something and calls
// ctx.post({text, kind, cat, key?, boost?, ms?}) when there is news.
// kind: 'good' | 'bad' | 'warn' | 'info'
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {run, readFile, listDir, clip, fmtBytes, fmtDuration} from './util.js';

function getBus(type) {
    try {
        return Gio.bus_get_sync(type, null);
    } catch (e) {
        return null;
    }
}

// Base class: tracks timers and D-Bus subscriptions so destroy() cleans up.
class Source {
    constructor(ctx) {
        this.settings = ctx.settings;
        this.post = ctx.post;
        this.dead = false;
        this._timers = new Set();
        this._subs = [];
        this.session = getBus(Gio.BusType.SESSION);
        this.system = getBus(Gio.BusType.SYSTEM);
    }

    on(key) { return this.settings.get_boolean(key); }
    num(key) { return this.settings.get_int(key); }

    every(sec, fn) {
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, sec, () => {
            if (this.dead)
                return GLib.SOURCE_REMOVE;
            fn();
            return GLib.SOURCE_CONTINUE;
        });
        this._timers.add(id);
        return id;
    }

    after(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            if (!this.dead)
                fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
        return id;
    }

    cancel(id) {
        if (id && this._timers.delete(id))
            GLib.source_remove(id);
    }

    // cb(senderUniqueName, parameters)
    sub(bus, sender, iface, member, path, arg0, cb) {
        if (!bus)
            return;
        const id = bus.signal_subscribe(sender, iface, member, path, arg0,
            Gio.DBusSignalFlags.NONE, (_c, who, _p, _i, _sig, params) => {
                if (this.dead)
                    return;
                try {
                    cb(who, params);
                } catch (e) {
                    console.error(`informer: ${this.constructor.name}: ${e}`);
                }
            });
        this._subs.push([bus, id]);
    }

    destroy() {
        this.dead = true;
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
        for (const [bus, id] of this._subs)
            bus.signal_unsubscribe(id);
        this._subs = [];
    }
}

// ---------------------------------------------------------------- Now playing
// Any MPRIS player: Spotify, VLC, and browsers (YouTube Music, etc.).
export class MediaSource extends Source {
    constructor(ctx) {
        super(ctx);
        this._players = new Map();     // unique bus name -> {status, title, artist}
        this._announced = new Map();   // unique bus name -> last announced "title|artist"
        this._wait = new Map();        // unique bus name -> debounce timer
        this._fetching = new Set();

        this.sub(this.session, null, 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
            '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player',
            (who, params) => this._changed(who, params));

        // forget players that quit
        this.sub(this.session, 'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, (_who, params) => {
                const [name, oldOwner, newOwner] = params.deep_unpack();
                if (name.startsWith('org.mpris.MediaPlayer2.') && !newOwner) {
                    this._players.delete(oldOwner);
                    this._announced.delete(oldOwner);
                }
            });
    }

    _readMeta(st, meta) {
        st.title = `${meta['xesam:title'] ?? ''}`;
        const a = meta['xesam:artist'];
        st.artist = Array.isArray(a) ? a.join(', ') : `${a ?? ''}`;
    }

    _changed(who, params) {
        const changed = params.get_child_value(1).recursiveUnpack();
        const st = this._players.get(who) ?? {status: '', title: '', artist: ''};
        if ('PlaybackStatus' in changed)
            st.status = `${changed.PlaybackStatus}`;
        if ('Metadata' in changed)
            this._readMeta(st, changed.Metadata ?? {});
        this._players.set(who, st);

        // Playing but we never saw the track (player was already running): ask for it
        if (st.status === 'Playing' && !st.title)
            this._fetch(who);

        this.cancel(this._wait.get(who));
        // browsers send several signals per track change: wait for them to settle
        this._wait.set(who, this.after(700, () => this._evaluate(who)));
    }

    _fetch(who) {
        if (this._fetching.has(who))
            return;
        this._fetching.add(who);
        this.session.call(who, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
            'GetAll', new GLib.Variant('(s)', ['org.mpris.MediaPlayer2.Player']), null,
            Gio.DBusCallFlags.NONE, 2000, null, (conn, res) => {
                this._fetching.delete(who);
                if (this.dead)
                    return;
                try {
                    const [props] = conn.call_finish(res).recursiveUnpack();
                    const st = this._players.get(who);
                    if (st && props.Metadata) {
                        this._readMeta(st, props.Metadata);
                        this.cancel(this._wait.get(who));
                        this._wait.set(who, this.after(300, () => this._evaluate(who)));
                    }
                } catch (e) { /* player went away */ }
            });
    }

    _evaluate(who) {
        const st = this._players.get(who);
        if (!st || st.status !== 'Playing' || !st.title)
            return;
        const key = `${st.title}|${st.artist}`;
        if (this._announced.get(who) === key)
            return;                       // same song resumed after a pause
        this._announced.set(who, key);
        const text = `Now playing: ${clip(st.title, 48)}${st.artist ? ` - ${clip(st.artist, 28)}` : ''}`;
        this.post({text, kind: 'info', cat: 'media', key: 'media'});
    }
}

// ---------------------------------------------------------------- USB storage
// Uses UDisks2, so pen drives / external disks / card readers (not mice or keyboards).
const UD = 'org.freedesktop.UDisks2';
const OM = 'org.freedesktop.DBus.ObjectManager';

export class UsbSource extends Source {
    constructor(ctx) {
        super(ctx);
        this._drives = new Map();      // drive object path -> {name, label}
        this._pending = new Map();     // drive path -> announce timer
        if (!this.system)
            return;

        // learn about drives that are already plugged in (no messages for these)
        this.system.call(UD, '/org/freedesktop/UDisks2', OM, 'GetManagedObjects', null, null,
            Gio.DBusCallFlags.NONE, 3000, null, (conn, res) => {
                if (this.dead)
                    return;
                try {
                    const [objs] = conn.call_finish(res).recursiveUnpack();
                    for (const [path, ifaces] of Object.entries(objs))
                        this._ingest(path, ifaces, false);
                } catch (e) { /* UDisks2 not installed */ }
            });

        this.sub(this.system, UD, OM, 'InterfacesAdded', '/org/freedesktop/UDisks2', null,
            (_who, params) => {
                const [path, ifaces] = params.recursiveUnpack();
                this._ingest(path, ifaces, true);
            });
        this.sub(this.system, UD, OM, 'InterfacesRemoved', '/org/freedesktop/UDisks2', null,
            (_who, params) => {
                const [path, ifaces] = params.recursiveUnpack();
                if (ifaces.includes(`${UD}.Drive`))
                    this._gone(path);
            });
    }

    _ingest(path, ifaces, announce) {
        const drive = ifaces[`${UD}.Drive`];
        if (drive && drive.ConnectionBus === 'usb') {
            const name = [drive.Vendor, drive.Model].filter(Boolean).join(' ')
                .replace(/\s+/g, ' ').trim() || 'USB drive';
            this._drives.set(path, {name, label: ''});
            if (announce) {
                // the filesystem label arrives a moment after the drive itself
                this._pending.set(path, this.after(1500, () => {
                    this._pending.delete(path);
                    const d = this._drives.get(path);
                    if (d)
                        this.post({text: `USB connected: ${clip(d.label || d.name, 40)}`,
                            kind: 'good', cat: 'usb', key: `usb:${path}`});
                }));
            }
        }
        const block = ifaces[`${UD}.Block`];
        if (block && block.Drive && block.IdLabel) {
            const d = this._drives.get(block.Drive);
            if (d && !d.label)
                d.label = `${block.IdLabel}`;
        }
    }

    _gone(path) {
        const d = this._drives.get(path);
        if (!d)
            return;
        this._drives.delete(path);
        const timer = this._pending.get(path);
        if (timer) {
            this.cancel(timer);
            this._pending.delete(path);
            return;                       // unplugged before we announced it
        }
        this.post({text: `USB removed: ${clip(d.label || d.name, 40)}`,
            kind: 'bad', cat: 'usb', key: `usb:${path}`});
    }
}

// ---------------------------------------------------------------- Caps / Num Lock
function findKeymap() {
    const attempts = [
        () => global.stage.context.get_backend(),
        () => Clutter.get_default_backend(),
    ];
    for (const get of attempts) {
        try {
            const km = get().get_default_seat().get_keymap();
            if (km)
                return km;
        } catch (e) { /* try the next way */ }
    }
    return null;
}

export class KeyboardSource extends Source {
    constructor(ctx) {
        super(ctx);
        this._keymap = findKeymap();
        this._id = 0;
        if (!this._keymap) {
            console.warn('informer: could not find the keymap, Caps/Num Lock messages are off');
            return;
        }
        this._caps = this._keymap.get_caps_lock_state();
        this._num = this._keymap.get_num_lock_state();
        this._id = this._keymap.connect('state-changed', () => this._check());
    }

    _check() {
        const caps = this._keymap.get_caps_lock_state();
        const num = this._keymap.get_num_lock_state();
        if (caps !== this._caps) {
            this._caps = caps;
            this.post({text: caps ? 'Caps Lock is ON' : 'Caps Lock is OFF',
                kind: caps ? 'warn' : 'info', cat: 'keys', key: 'caps'});
        }
        if (num !== this._num) {
            this._num = num;
            this.post({text: num ? 'Num Lock is ON' : 'Num Lock is OFF',
                kind: 'info', cat: 'keys', key: 'num'});
        }
    }

    destroy() {
        if (this._id) {
            this._keymap.disconnect(this._id);
            this._id = 0;
        }
        super.destroy();
    }
}

// ---------------------------------------------------------------- Camera in use
// Looks for a process holding /dev/video* open (your own apps, browsers, Flatpaks).
export class CameraSource extends Source {
    constructor(ctx) {
        super(ctx);
        this._on = null;
        this._flips = 0;
        this._busy = false;
        this.every(4, () => this._poll());
    }

    async _poll() {
        if (this._busy || !this.on('show-camera'))
            return;
        this._busy = true;
        try {
            const out = await run(['sh', '-c',
                "find /proc/[0-9]*/fd -lname '/dev/video*' 2>/dev/null | head -n 1"]);
            if (this.dead)
                return;
            const on = out.trim().length > 0;
            if (this._on === null) {
                this._on = on;            // first look: no message
                return;
            }
            if (on === this._on) {
                this._flips = 0;
                return;
            }
            if (++this._flips < 2)
                return;                   // must hold for two looks (ignores blips)
            this._flips = 0;
            this._on = on;
            if (on)
                this.post({text: 'Camera is in use', kind: 'bad', cat: 'camera', key: 'camera'});
            else
                this.post({text: 'Camera is off', kind: 'good', cat: 'camera', key: 'camera'});
        } finally {
            this._busy = false;
        }
    }
}

// ---------------------------------------------------------------- Internet lost / back
// Wi-Fi can say "connected" while nothing works. NetworkManager's own connectivity
// check is used; if that is disabled, a quick TCP connect is the fallback.
export class InternetSource extends Source {
    constructor(ctx) {
        super(ctx);
        this._busy = false;
        this._fails = 0;
        this._down = false;
        this._downAt = 0;
        this.after(6000, () => this._poll());
        this.every(12, () => this._poll());
    }

    _probe() {
        return new Promise(resolve => {
            try {
                const client = new Gio.SocketClient({timeout: 4});
                client.connect_to_host_async('1.1.1.1:443', 443, null, (c, res) => {
                    try {
                        c.connect_to_host_finish(res).close(null);
                        resolve(true);
                    } catch (e) {
                        resolve(false);
                    }
                });
            } catch (e) {
                resolve(false);
            }
        });
    }

    async _poll() {
        if (this._busy || !this.on('show-internet'))
            return;
        this._busy = true;
        try {
            const conn = (await run(['nmcli', '-t', 'networking', 'connectivity', 'check'])).trim();
            if (this.dead || !conn)
                return;                   // no nmcli: nothing to judge by
            if (conn === 'none') {        // no network at all: Wi-Fi messages cover that
                this._fails = 0;
                this._down = false;
                return;
            }
            let ok;
            if (conn === 'full')
                ok = true;
            else if (conn === 'limited' || conn === 'portal')
                ok = false;
            else
                ok = await this._probe();  // 'unknown': NM connectivity check is disabled
            if (this.dead)
                return;

            if (ok) {
                this._fails = 0;
                if (this._down) {
                    this._down = false;
                    this.post({text: `Internet is back (offline ${fmtDuration(Date.now() - this._downAt)})`,
                        kind: 'good', cat: 'internet', key: 'internet'});
                }
            } else if (++this._fails >= 2 && !this._down) {   // two bad looks in a row
                this._down = true;
                this._downAt = Date.now();
                this.post({text: conn === 'portal' ? 'Wi-Fi needs sign-in (no internet yet)' : 'Internet lost',
                    kind: 'bad', cat: 'internet', key: 'internet'});
            }
        } finally {
            this._busy = false;
        }
    }
}

// ---------------------------------------------------------------- System warnings + updates
const WARN_COOLDOWN_MS = 10 * 60 * 1000;
const DISK_COOLDOWN_MS = 60 * 60 * 1000;
const UPDATE_REPEAT_MS = 24 * 60 * 60 * 1000;

export class SystemSource extends Source {
    constructor(ctx) {
        super(ctx);
        this._cpuPrev = null;
        this._cpuHigh = 0;
        this._ramHigh = 0;
        this._tempHigh = 0;
        this._last = new Map();         // cooldown key -> time of last warning
        this._tempFiles = this._findTempFiles();
        this._updBusy = false;
        this._updCount = -1;
        this._updAt = 0;

        this.every(5, () => this._tick());
        this.after(25000, () => this._disk());
        this.every(600, () => this._disk());
        this.after(90000, () => this._updates());
        this.every(3 * 3600, () => this._updates());
    }

    _due(key, ms) {
        const now = Date.now();
        if (now - (this._last.get(key) ?? 0) < ms)
            return false;
        this._last.set(key, now);
        return true;
    }

    _warn(text, key, boost = 0) {
        this.post({text, kind: boost ? 'bad' : 'warn', cat: 'syswarn', key, boost});
    }

    _tick() {
        if (!this.on('show-syswarn')) {
            this._cpuPrev = null;
            this._cpuHigh = this._ramHigh = this._tempHigh = 0;
            return;
        }
        this._cpu();
        this._ram();
        this._temp();
    }

    _cpu() {
        const line = readFile('/proc/stat').split('\n')[0] ?? '';
        const f = line.trim().split(/\s+/).slice(1, 9).map(Number);
        if (f.length < 5 || f.some(Number.isNaN))
            return;
        const total = f.reduce((a, b) => a + b, 0);
        const idle = f[3] + f[4];
        const prev = this._cpuPrev;
        this._cpuPrev = {total, idle};
        if (!prev || total <= prev.total)
            return;
        const pct = Math.round(100 * (1 - (idle - prev.idle) / (total - prev.total)));
        this._cpuHigh = pct >= this.num('cpu-threshold') ? this._cpuHigh + 1 : 0;
        // about 15 seconds in a row, then at most once per 10 minutes
        if (this._cpuHigh >= 3 && this._due('cpu', WARN_COOLDOWN_MS))
            this._warn(`High CPU use: ${pct}%`, 'cpu');
    }

    _ram() {
        const txt = readFile('/proc/meminfo');
        const total = parseInt(txt.match(/^MemTotal:\s+(\d+)/m)?.[1] ?? '0');
        const avail = parseInt(txt.match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? '0');
        if (!total || !avail)
            return;
        const pct = Math.round(100 * (1 - avail / total));
        this._ramHigh = pct >= this.num('ram-threshold') ? this._ramHigh + 1 : 0;
        if (this._ramHigh >= 2 && this._due('ram', WARN_COOLDOWN_MS))
            this._warn(`High RAM use: ${pct}%`, 'ram');
    }

    _findTempFiles() {
        const files = [];
        const cpuLike = /x86_pkg_temp|cpu|soc|k10temp|coretemp|tctl|package/i;
        const zones = listDir('/sys/class/thermal').filter(z => z.startsWith('thermal_zone'));
        for (const z of zones) {
            if (cpuLike.test(readFile(`/sys/class/thermal/${z}/type`)))
                files.push(`/sys/class/thermal/${z}/temp`);
        }
        for (const h of listDir('/sys/class/hwmon')) {
            if (/coretemp|k10temp|zenpower|cpu_thermal/i.test(readFile(`/sys/class/hwmon/${h}/name`)))
                files.push(`/sys/class/hwmon/${h}/temp1_input`);
        }
        if (!files.length) {
            for (const z of zones)
                files.push(`/sys/class/thermal/${z}/temp`);
        }
        return files;
    }

    _temp() {
        let max = 0;
        for (const f of this._tempFiles) {
            const c = parseInt(readFile(f)) / 1000;
            if (c > 1 && c < 150 && c > max)
                max = c;
        }
        if (!max)
            return;
        const limit = this.num('temp-threshold');
        this._tempHigh = max >= limit ? this._tempHigh + 1 : 0;
        if (this._tempHigh >= 2 && this._due('temp', WARN_COOLDOWN_MS))
            this._warn(`High temperature: ${Math.round(max)}\u00b0C`, 'temp', max >= limit + 10 ? 1 : 0);
    }

    _disk() {
        if (!this.on('show-syswarn'))
            return;
        const seen = [];
        for (const path of new Set(['/', GLib.get_home_dir()])) {
            Gio.File.new_for_path(path).query_filesystem_info_async(
                'filesystem::size,filesystem::free', GLib.PRIORITY_DEFAULT, null, (file, res) => {
                    if (this.dead)
                        return;
                    try {
                        const info = file.query_filesystem_info_finish(res);
                        const size = info.get_attribute_uint64('filesystem::size');
                        const free = info.get_attribute_uint64('filesystem::free');
                        if (!size)
                            return;
                        // "/" and the home folder can be the same disk: warn once
                        if (seen.some(s => s.size === size && Math.abs(s.free - free) < 64 * 1048576))
                            return;
                        seen.push({size, free});
                        const pct = Math.round(100 * free / size);
                        if (pct < this.num('disk-free-percent') && this._due(`disk:${path}`, DISK_COOLDOWN_MS))
                            this._warn(`Low disk space on ${path === '/' ? '/' : 'home'}: ${fmtBytes(free)} free (${pct}%)`,
                                `disk:${path}`);
                    } catch (e) { /* ignore */ }
                });
        }
    }

    // ---- updates
    async _updates() {
        if (this._updBusy || !this.on('show-updates'))
            return;
        this._updBusy = true;
        try {
            let n = await this._packageKitUpdates();
            if (n === null)
                n = await this._commandUpdates();
            if (this.dead || n === null || n <= 0)
                return;
            const now = Date.now();
            if (n === this._updCount && now - this._updAt < UPDATE_REPEAT_MS)
                return;
            this._updCount = n;
            this._updAt = now;
            this.post({text: `${n} update${n === 1 ? '' : 's'} available`,
                kind: 'info', cat: 'updates', key: 'updates'});
        } finally {
            this._updBusy = false;
        }
    }

    // Works on Fedora, Ubuntu and most distros that ship PackageKit (GNOME Software uses it).
    _packageKitUpdates() {
        const PK = 'org.freedesktop.PackageKit';
        const bus = this.system;
        if (!bus)
            return Promise.resolve(null);
        return new Promise(resolve => {
            let done = false;
            let subId = 0;
            let timer = 0;
            const finish = value => {
                if (done)
                    return;
                done = true;
                if (subId)
                    bus.signal_unsubscribe(subId);
                this.cancel(timer);
                resolve(value);
            };
            timer = this.after(120000, () => finish(null));
            bus.call(PK, '/org/freedesktop/PackageKit', PK, 'CreateTransaction', null,
                new GLib.VariantType('(o)'), Gio.DBusCallFlags.NONE, 10000, null, (c, res) => {
                    let path;
                    try {
                        [path] = c.call_finish(res).deep_unpack();
                    } catch (e) {
                        finish(null);
                        return;
                    }
                    let count = 0;
                    subId = bus.signal_subscribe(PK, `${PK}.Transaction`, null, path, null,
                        Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, sig) => {
                            if (sig === 'Package')
                                count++;
                            else if (sig === 'Finished')
                                finish(count);
                            else if (sig === 'ErrorCode')
                                finish(null);
                        });
                    bus.call(PK, path, `${PK}.Transaction`, 'GetUpdates',
                        new GLib.Variant('(t)', [0]), null, Gio.DBusCallFlags.NONE, 10000, null,
                        (c2, res2) => {
                            try {
                                c2.call_finish(res2);
                            } catch (e) {
                                finish(null);
                            }
                        });
                });
        });
    }

    // Fallback without PackageKit: apt (Debian/Ubuntu) or checkupdates (Arch).
    async _commandUpdates() {
        const osr = readFile('/etc/os-release');
        const fam = `${osr.match(/^ID=(.*)$/m)?.[1] ?? ''} ${osr.match(/^ID_LIKE=(.*)$/m)?.[1] ?? ''}`;
        let cmd = null;
        if (/debian|ubuntu/i.test(fam))
            cmd = 'apt list --upgradable 2>/dev/null | grep -c upgradable';
        else if (/arch/i.test(fam))
            cmd = 'checkupdates 2>/dev/null | wc -l';
        if (!cmd)
            return null;
        const out = (await run(['sh', '-c', cmd])).trim();
        const n = parseInt(out);
        return Number.isNaN(n) ? null : n;
    }
}

// ---------------------------------------------------------------- Calendar events
// Listens (read-only) to GNOME Shell's own calendar service, the one behind the
// clock menu, so it needs no extra setup beyond having calendars in GNOME.
const CS = 'org.gnome.Shell.CalendarServer';

export class CalendarSource extends Source {
    constructor(ctx) {
        super(ctx);
        this._events = new Map();      // id -> {summary, start, end}  (milliseconds)
        this._told = new Set();
        this.sub(this.session, CS, CS, 'EventsAddedOrUpdated', '/org/gnome/Shell/CalendarServer',
            null, (_who, params) => this._added(params));
        this.sub(this.session, CS, CS, 'EventsRemoved', '/org/gnome/Shell/CalendarServer',
            null, (_who, params) => {
                const [ids] = params.recursiveUnpack();
                for (const id of ids)
                    this._events.delete(id);
            });
        this.every(20, () => this._check());
    }

    _added(params) {
        const [list] = params.recursiveUnpack();
        const ms = v => (Number(v) > 1e12 ? Number(v) : Number(v) * 1000);
        for (const ev of list) {
            const [id, summary, allDay, start, end] = ev;
            if (allDay)
                this._events.delete(id);
            else
                this._events.set(id, {summary: `${summary}`, start: ms(start), end: ms(end)});
        }
    }

    _check() {
        if (!this.on('show-calendar'))
            return;
        const now = Date.now();
        const lead = this.num('calendar-lead') * 60000;
        for (const [id, ev] of this._events) {
            if (ev.end < now - 3600000) {
                this._events.delete(id);
                continue;
            }
            const diff = ev.start - now;
            const title = clip(ev.summary || 'Event', 40);
            const soon = `${id}|${ev.start}|soon`;
            const nowKey = `${id}|${ev.start}|now`;
            if (diff > 60000 && diff <= lead && !this._told.has(soon)) {
                this._told.add(soon);
                this.post({text: `${title} in ${Math.round(diff / 60000)} min`,
                    kind: 'warn', cat: 'calendar', key: `cal:${id}`});
            } else if (diff <= 60000 && diff > -120000 && !this._told.has(nowKey)) {
                this._told.add(nowKey);
                this._told.add(soon);
                this.post({text: `${title} starts now`,
                    kind: 'warn', cat: 'calendar', key: `cal:${id}`, boost: 1});
            }
        }
    }
}
