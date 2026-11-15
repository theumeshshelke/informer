// Informer - hardware messages of version 8 (plain ES module: no gi:// imports).
// Monitor count, Ethernet cable, game controllers, screen brightness.

// ---- monitors: prev / now are counts (null = unknown). Returns 'added', 'removed' or null.
export function monitorChange(prev, now) {
    if (!Number.isInteger(prev) || !Number.isInteger(now) || prev === now)
        return null;
    return now > prev ? 'added' : 'removed';
}

// ---- Ethernet: en* (enp3s0, eno1, ens33 ...) and eth*. Wi-Fi is wl*, so it never matches.
export const ETH_RE = /^(en|eth)[a-z0-9]*$/;

// entries: [{name, carrier}] with carrier as text from /sys/class/net/<name>/carrier ('1' = cable linked).
export function ethernetUp(entries) {
    return (entries ?? []).some(e => ETH_RE.test(e.name ?? '') && `${e.carrier ?? ''}`.trim() === '1');
}

// ---- game controllers: /dev/input/js0, js1 ...
export const JS_RE = /^js\d+$/;

export function gamepadMessage(added, name) {
    const n = `${name ?? ''}`.trim();
    const base = added ? 'Controller connected' : 'Controller removed';
    return n ? `${base}: ${n}` : base;
}

// ---- brightness
// entries: [{name, type}] from /sys/class/backlight. Same order the desktop uses: firmware, platform, raw.
export function pickBacklight(entries) {
    const rank = t => {
        const i = ['firmware', 'platform', 'raw'].indexOf(`${t ?? ''}`.trim());
        return i < 0 ? 3 : i;
    };
    let best = null;
    for (const e of entries ?? []) {
        if (!best || rank(e.type) < rank(best.type))
            best = e;
    }
    return best ? best.name : null;
}

// cur and max are text or numbers from the sysfs files. Returns 0..100 or null.
export function brightnessPct(cur, max) {
    const c = parseInt(cur);
    const m = parseInt(max);
    if (!Number.isFinite(c) || !Number.isFinite(m) || m <= 0 || c < 0)
        return null;
    return Math.min(100, Math.round(100 * c / m));
}
