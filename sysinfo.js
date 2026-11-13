// Informer - pure helpers for the dropdown (no gi:// imports, easy to test in Node)

export function parseCpu(statText) {
    const line = (statText ?? '').split('\n')[0] ?? '';
    const f = line.trim().split(/\s+/).slice(1, 9).map(Number);
    if (f.length < 5 || f.some(Number.isNaN))
        return null;
    return {total: f.reduce((a, b) => a + b, 0), idle: f[3] + f[4]};
}

// percent busy between two samples, or null
export function cpuPct(prev, cur) {
    if (!prev || !cur || cur.total <= prev.total)
        return null;
    return Math.round(100 * (1 - (cur.idle - prev.idle) / (cur.total - prev.total)));
}

export function ramPct(meminfo) {
    const total = parseInt((meminfo ?? '').match(/^MemTotal:\s+(\d+)/m)?.[1] ?? '0');
    const avail = parseInt((meminfo ?? '').match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? '0');
    return total && avail ? Math.round(100 * (1 - avail / total)) : null;
}

// o: numbers read from /sys/class/power_supply (missing ones are 0 or NaN)
// returns seconds, or null when the machine does not tell us
export function batteryTime(status, o) {
    const n = v => (Number.isFinite(v) && v > 0 ? v : 0);
    let sec = 0;
    if (status === 'Discharging') {
        sec = n(o.tte);
        if (!sec && n(o.energyNow) && n(o.powerNow))
            sec = o.energyNow / o.powerNow * 3600;
        else if (!sec && n(o.chargeNow) && n(o.currentNow))
            sec = o.chargeNow / o.currentNow * 3600;
    } else if (status === 'Charging') {
        sec = n(o.ttf);
        if (!sec && n(o.energyFull) && n(o.powerNow))
            sec = Math.max(0, o.energyFull - o.energyNow) / o.powerNow * 3600;
        else if (!sec && n(o.chargeFull) && n(o.currentNow))
            sec = Math.max(0, o.chargeFull - o.chargeNow) / o.currentNow * 3600;
    }
    return sec > 0 && sec < 100 * 3600 ? Math.round(sec) : null;
}

export function fmtHM(sec) {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${`${m % 60}`.padStart(2, '0')}m` : `${m}m`;
}

// nmcli -t -f ACTIVE,SSID,SIGNAL dev wifi  ->  {ssid, signal} or null
export function parseWifi(text) {
    for (const line of (text ?? '').split('\n')) {
        if (!line.startsWith('yes:'))
            continue;
        const m = line.slice(4).match(/^(.*):(\d+)$/);
        if (m)
            return {ssid: m[1].replace(/\\:/g, ':'), signal: Number(m[2])};
    }
    return null;
}

// ip -4 -o addr show scope global  ->  first address, or ''
export function parseLocalIp(text) {
    for (const line of (text ?? '').split('\n')) {
        const m = line.match(/inet (\d+\.\d+\.\d+\.\d+)\//);
        if (m)
            return m[1];
    }
    return '';
}
