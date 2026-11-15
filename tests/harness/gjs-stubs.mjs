
import {A} from './any.mjs';
// ---- GLib with a fake clock and a list of timers we can fire by hand
const timers = new Map(); let nextId = 1;
globalThis.__timers = timers;
const add = (sec) => (prio, t, cb) => { const id = nextId++; timers.set(id, {ms: sec ? t * 1000 : t, cb, id}); return id; };
export const GLib = new Proxy({
    timeout_add: add(false), timeout_add_seconds: add(true),
    source_remove: id => timers.delete(id),
    get_monotonic_time: () => globalThis.__now * 1000,
    PRIORITY_DEFAULT: 0, SOURCE_CONTINUE: true, SOURCE_REMOVE: false,
}, {get: (t, k) => (k in t ? t[k] : A)});
export const GObject = new Proxy({registerClass: (a, b) => b ?? a}, {get: (t, k) => (k in t ? t[k] : A)});
const lmHandlers = new Map(); let lmId = 1;
export const Main = {
    panel: A, wm: A, messageTray: A, inputMethod: A, sessionMode: A, overview: A, notify: () => {},
    layoutManager: {primaryMonitor: {inFullscreen: false}, monitors: [{}],
        connect(sig, cb) { const id = lmId++; lmHandlers.set(id, {sig, cb}); return id; },
        disconnect(id) { lmHandlers.delete(id); }},
};
globalThis.__lm = {handlers: lmHandlers, count: () => lmHandlers.size,
    set(n) { Main.layoutManager.monitors = Array.from({length: n}, () => ({})); for (const h of [...lmHandlers.values()]) if (h.sig === 'monitors-changed') h.cb(); }};
class Base { constructor(...a) { this._init(...a); } _init() { this.menu = new FakeMenu(); } }
class FakeMenu { constructor() { this.isOpen = false; this.items = []; }
    addMenuItem(i) { this.items.push(i); } connect() { return 1; } disconnect() {} toggle() {} }
Object.setPrototypeOf(Base.prototype, A);
export const PanelMenu = {Button: Base};
class Item { constructor(t) { this.label = {text: t}; this.visible = true; } connect() { return 1; } add_child() {} }
export const PopupMenu = {PopupBaseMenuItem: Item, PopupMenuItem: Item, PopupSeparatorMenuItem: Item};
export class Extension { constructor() { this.uuid = 'informer@umesh'; } getSettings() { return globalThis.__settings; } openPreferences() {} }

// ---- Gio: fake GSettings (other schemas) and a fake D-Bus, the rest is a stand-in.
// globalThis.__gs.schemas[schemaId] = {key: value}  -> that schema "exists"; __gs.set(...) changes a value and fires handlers.
// globalThis.__dbus.emit('system', path, iface, 'PropertiesChanged', params) fires a signal; __dbus.reply(dest, path, iface, method) answers calls.
const gsHandlers = new Map(); let gsId = 1;
globalThis.__gs = {
    schemas: {},
    count: () => gsHandlers.size,
    set(schema, key, value) {
        this.schemas[schema][key] = value;
        for (const h of [...gsHandlers.values()])
            if (h.gs.id === schema && (h.sig === `changed::${key}` || h.sig === 'changed')) h.cb(h.gs, key);
    },
};
class FakeGSettings {
    constructor({schema_id}) { this.id = schema_id; }
    get_boolean(k) { return globalThis.__gs.schemas[this.id][k]; }
    get_string(k) { return globalThis.__gs.schemas[this.id][k]; }
    connect(sig, cb) { const id = gsId++; gsHandlers.set(id, {gs: this, sig, cb}); return id; }
    disconnect(id) { gsHandlers.delete(id); }
}
const buses = {};
const mkBus = (name) => {
    const subs = new Map(); let n = 1;
    const bus = {
        name, subs,
        signal_subscribe(sender, iface, member, path, arg0, flags, cb) { const id = n++; subs.set(id, {iface, member, path, arg0, cb}); return id; },
        signal_unsubscribe(id) { subs.delete(id); },
        call(dest, path, iface, method, params, rt, flags, to, cancel, cb) {
            const r = globalThis.__dbus.reply?.(dest, path, iface, method, params);
            if (r !== undefined && cb) cb(bus, {r});
            return A;
        },
        call_finish(res) { if (res.r instanceof Error) throw res.r; return {recursiveUnpack: () => res.r}; },
    };
    return new Proxy(bus, {get: (t, k) => (k in t ? t[k] : A)});
};
buses.session = mkBus('session'); buses.system = mkBus('system');
globalThis.__dbus = {
    reply: null,
    count: () => buses.session.subs.size + buses.system.subs.size,
    emit(busName, path, iface, member, params) {
        for (const s of [...buses[busName].subs.values()])
            if (s.member === member && (!s.path || s.path === path) && (!s.arg0 || s.arg0 === iface)) s.cb(null, ':1.1', path, iface, member, params);
    },
};
// fake file monitors: __fm.emit(dir, event, basename) fires 'changed' on the monitors watching that dir
const activeMon = new Set();
globalThis.__fm = {
    active: activeMon,
    emit(dir, ev, name) {
        for (const m of [...activeMon]) if (m.path === dir)
            for (const cb of [...m.handlers.values()]) cb(m, {get_basename: () => name, get_path: () => `${dir}/${name}`}, null, ev);
    },
};
const fakeMonitor = (path) => {
    const m = {path, handlers: new Map(), n: 1,
        connect(sig, cb) { const id = this.n++; this.handlers.set(id, cb); return id; },
        disconnect(id) { this.handlers.delete(id); },
        cancel() { activeMon.delete(this); }};
    activeMon.add(m);
    return m;
};
export const Gio = new Proxy({
    File: new Proxy({new_for_path: (p) => new Proxy({monitor_directory: () => fakeMonitor(p), monitor_file: () => fakeMonitor(p)}, {get: (t, k) => (k in t ? t[k] : A)})},
        {get: (t, k) => (k in t ? t[k] : A)}),
    FileMonitorEvent: {CREATED: 'created', DELETED: 'deleted', CHANGED: 'changed', CHANGES_DONE_HINT: 'done', RENAMED: 'renamed', MOVED_IN: 'moved-in', MOVED_OUT: 'moved-out'},
    FileMonitorFlags: {NONE: 0, WATCH_MOVES: 1},
    Settings: FakeGSettings,
    SettingsSchemaSource: {get_default: () => ({lookup: (id) => (globalThis.__gs.schemas[id] ? {has_key: k => k in globalThis.__gs.schemas[id]} : null)})},
    BusType: {SESSION: 'session', SYSTEM: 'system'},
    bus_get_sync: (t) => buses[t],
    DBusSignalFlags: {NONE: 0}, DBusCallFlags: {NONE: 0},
}, {get: (t, k) => (k in t ? t[k] : A)});
