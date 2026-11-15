// Informer - sunrise / sunset logic (pure, no gi:// imports)

// Open-Meteo gives local times of the place without a zone ("2026-11-15T17:42").
// utc_offset_seconds (also in the answer) turns them into real moments in time.
export function parseLocalIso(s, offsetSec = 0) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(`${s ?? ''}`);
    if (!m)
        return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offsetSec * 1000;
}

// daily: {sunrise: [...], sunset: [...]}  ->  [{kind, at}] sorted by time
export function sunEvents(daily, offsetSec = 0) {
    const out = [];
    for (const kind of ['sunrise', 'sunset']) {
        const list = daily?.[kind];
        if (!Array.isArray(list))
            continue;
        for (const s of list) {
            const at = parseLocalIso(s, offsetSec);
            if (at !== null)
                out.push({kind, at});
        }
    }
    return out.sort((a, b) => a.at - b.at);
}

// The next event, when it is within leadMin minutes and was not announced yet.
// Returns {key, text} or null. lastKey = key of the last announced event.
export function sunDue(events, now, leadMin, lastKey) {
    const ev = events.find(e => e.at > now);
    if (!ev)
        return null;
    const mins = Math.ceil((ev.at - now) / 60000);
    if (mins > leadMin)
        return null;
    const key = `${ev.kind}:${ev.at}`;
    if (key === lastKey)
        return null;
    return {key, text: `${ev.kind === 'sunset' ? 'Sunset' : 'Sunrise'} in ${mins} min`};
}
