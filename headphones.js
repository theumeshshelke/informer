// Informer - wired headphone detection (pure, no gi:// imports).
// Input: the text of `pactl --format=json list sinks`.
// Bluetooth sinks are skipped: the Bluetooth messages already tell about those.

// returns {connected: boolean} or null when the text is not usable
export function parseHeadphones(text) {
    let sinks;
    try {
        sinks = JSON.parse(text);
    } catch (e) {
        return null;
    }
    if (!Array.isArray(sinks))
        return null;
    for (const s of sinks) {
        if (/^bluez/i.test(`${s?.name ?? ''}`))
            continue;
        const active = typeof s?.active_port === 'object' ? s.active_port?.name : s?.active_port;
        if (!active)
            continue;
        const port = (s.ports ?? []).find(p => p?.name === active);
        const isHp = /head(phone|set)/i.test(`${active}`) || /^head(phones|set)$/i.test(`${port?.type ?? ''}`);
        if (isHp && port?.availability === 'available')
            return {connected: true};
    }
    return {connected: false};
}
