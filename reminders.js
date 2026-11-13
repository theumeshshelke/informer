// Informer - reminder logic (pure, no gi:// imports)
// A reminder: {id, label, time: 'HH:MM', days: bitmask (Mon=1 ... Sun=64), repeat, enabled}

export const DAYS_ALL = 127;
export const GRACE_MIN = 2;      // still fire up to 2 minutes late (e.g. after a short sleep)

export function parseReminders(json) {
    let raw;
    try {
        raw = JSON.parse(json);
    } catch (e) {
        return [];
    }
    if (!Array.isArray(raw))
        return [];
    const out = [];
    raw.forEach((r, i) => {
        if (!r || typeof r !== 'object')
            return;
        const m = `${r.time ?? ''}`.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        const label = `${r.label ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!m || !label)
            return;
        out.push({
            id: `${r.id ?? `r${i}`}`,
            label,
            time: `${m[1].padStart(2, '0')}:${m[2]}`,
            days: Number.isInteger(r.days) && r.days >= 0 && r.days <= 127 ? r.days : DAYS_ALL,
            repeat: r.repeat !== false,
            enabled: r.enabled !== false,
        });
    });
    return out;
}

export function serializeReminders(list) {
    return JSON.stringify(list);
}

export function dayBit(date) {
    const d = date.getDay();             // 0 = Sunday
    return d === 0 ? 64 : 1 << (d - 1);
}

export function dateKey(date) {
    const p = n => `${n}`.padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// Reminders that should fire now and were not fired yet. `fired` is a Set of keys;
// the caller adds the returned keys to it. Never fires twice for the same day and time.
export function dueReminders(list, now, fired) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const today = dateKey(now);
    const due = [];
    for (const r of list) {
        if (!r.enabled || !(r.days & dayBit(now)))
            continue;
        const [h, m] = r.time.split(':').map(Number);
        const diff = nowMin - (h * 60 + m);
        const key = `${r.id}|${today}|${r.time}`;
        if (diff >= 0 && diff <= GRACE_MIN && !fired.has(key))
            due.push({reminder: r, key});
    }
    return due;
}

// forget keys from earlier days
export function pruneFired(fired, now) {
    const today = dateKey(now);
    for (const k of [...fired]) {
        if (k.split('|')[1] !== today)
            fired.delete(k);
    }
}
