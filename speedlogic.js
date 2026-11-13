// Informer - pure speed logic (no gi:// imports, so it can be unit-tested in Node)

// 'down' | 'fast' | 'normal' | 'slow'
export function speedLevel(downBps, upBps, fastKbps, slowKbps, linkUp) {
    if (!linkUp)
        return 'down';
    const kbps = Math.max(downBps, upBps) / 1024;
    if (kbps >= fastKbps)
        return 'fast';
    if (kbps < slowKbps)
        return 'slow';
    return 'normal';
}

// colours = {good, warn, bad, normal}
export function levelColor(level, colors) {
    switch (level) {
    case 'fast': return colors.good;
    case 'slow': return colors.warn;
    case 'down': return colors.bad;
    default: return colors.normal;
    }
}
