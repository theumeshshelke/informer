// Informer - messages of version 8, phase 4 (plain ES module: no gi:// imports).
// Sound output, hotspot clients, wake from sleep, CPU overheat.
import {fmtHM} from './sysinfo.js';

// ---- sound output -------------------------------------------------------------------------
// json: text of `pactl --format=json list sinks`; name: output of `pactl get-default-sink`.
// Returns {text, headphones} or null when the sink is not found / the text is not usable.
export function soundOutInfo(json, name) {
    const want = `${name ?? ''}`.trim();
    let sinks;
    try {
        sinks = JSON.parse(json);
    } catch (e) {
        return null;
    }
    if (!want || !Array.isArray(sinks))
        return null;
    const s = sinks.find(x => x?.name === want);
    if (!s)
        return null;
    const active = typeof s.active_port === 'object' ? s.active_port?.name : s.active_port;
    const port = (s.ports ?? []).find(p => p?.name === active);
    const desc = `${s.description ?? ''}`.trim();
    const hay = `${active ?? ''} ${port?.type ?? ''} ${port?.description ?? ''}`;
    let label;
    if (/^bluez/i.test(want))
        label = desc || 'Bluetooth';           // the Bluetooth device's own name
    else if (/head(phone|set)/i.test(hay))
        label = 'Headphones';
    else if (/hdmi|display ?port/i.test(`${want} ${hay} ${desc}`))
        label = 'HDMI';
    else if (/speaker/i.test(hay))
        label = 'Speakers';
    else
        label = desc || want;
    return {text: `Sound: ${label}`, headphones: label === 'Headphones'};
}

// ---- hotspot clients ----------------------------------------------------------------------
// text: output of `ip neigh`. iface: the hotspot network interface ('' = unknown).
// Only entries that are really there count (not FAILED or INCOMPLETE). Without an interface
// name we fall back to NetworkManager's own hotspot network (10.42.x.x).
const NEIGH_OK = /\b(REACHABLE|STALE|DELAY|PROBE|PERMANENT)\s*$/;

export function countClients(text, iface) {
    const macs = new Set();
    for (const line of `${text ?? ''}`.split('\n')) {
        const f = line.trim().split(/\s+/);
        if (!f[0] || !NEIGH_OK.test(line.trim()))
            continue;
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(f[0]))
            continue;                                  // skip IPv6 neighbours: one phone has many
        const di = f.indexOf('dev');
        const dev = di >= 0 ? f[di + 1] : '';
        if (iface ? dev !== iface : !f[0].startsWith('10.42.'))
            continue;
        const li = f.indexOf('lladdr');
        macs.add(li >= 0 ? f[li + 1] : f[0]);
    }
    return macs.size;
}

export function hotspotMessage(n) {
    if (!Number.isInteger(n) || n < 0)
        return null;
    if (n === 0)
        return {text: 'No devices on your hotspot', kind: 'info'};
    return {text: `${n} ${n === 1 ? 'device' : 'devices'} on your hotspot`, kind: 'good'};
}

// ---- wake from sleep ----------------------------------------------------------------------
// startMs / endMs come from the clock (Date.now()), not from the signal. Under 1 minute: nothing.
export function wakeText(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs))
        return null;
    const sec = Math.round((endMs - startMs) / 1000);
    if (sec < 60)
        return null;
    return `Welcome back, slept ${fmtHM(sec)}`;
}

// ---- CPU overheat -------------------------------------------------------------------------
// Watches core_throttle_count. It only goes up. A message at most once per `gapMs`.
export class ThrottleWatch {
    constructor(gapMs = 10 * 60 * 1000) {
        this.gapMs = gapMs;
        this.last = null;          // last count seen (null = not read yet, the first one is silent)
        this.said = -Infinity;     // when we last gave a message
    }

    // text: contents of the file. Returns true when a message is due.
    feed(text, nowMs) {
        const n = parseInt(`${text ?? ''}`.trim());
        if (!Number.isFinite(n) || n < 0) {
            this.last = null;      // file went away or is unreadable: start fresh later
            return false;
        }
        const prev = this.last;
        this.last = n;
        if (prev === null || n <= prev)
            return false;
        if (nowMs - this.said < this.gapMs)
            return false;
        this.said = nowMs;
        return true;
    }
}
