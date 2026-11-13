// Informer - small file / notification filters (pure, no gi:// imports)

const TEMP_SUFFIX = /\.(crdownload|part|download|tmp|partial)$/i;

// A download that is still in progress, or a hidden file: do not announce it.
export function isTempName(name) {
    return !name || name.startsWith('.') || TEMP_SUFFIX.test(name);
}

// In the Screenshots folder any png counts; in the Pictures folder only names like "Screenshot ...".
export function isScreenshotName(name, inScreenshotsDir) {
    if (!/\.png$/i.test(name) || name.startsWith('.'))
        return false;
    return inScreenshotsDir || /^screenshot/i.test(name);
}

// empty list = every app
export function appAllowed(list, appName) {
    if (!list || list.length === 0)
        return true;
    const a = `${appName ?? ''}`.trim().toLowerCase();
    return list.some(x => `${x}`.trim().toLowerCase() === a);
}

// "file is done when its size has stayed the same for stableMs"
export class StableWatcher {
    constructor(stableMs = 2000, giveUpMs = 10 * 60 * 1000) {
        this.stableMs = stableMs;
        this.giveUpMs = giveUpMs;
        this.map = new Map();
    }

    get size() { return this.map.size; }
    names() { return [...this.map.keys()]; }
    add(name, now) {
        if (!this.map.has(name))
            this.map.set(name, {size: -1, changedAt: now, startedAt: now});
    }

    // returns 'done', 'wait' or 'drop'
    check(name, size, now) {
        const e = this.map.get(name);
        if (!e)
            return 'drop';
        if (size !== e.size) {
            e.size = size;
            e.changedAt = now;
        }
        if (size > 0 && now - e.changedAt >= this.stableMs) {
            this.map.delete(name);
            return 'done';
        }
        if (now - e.startedAt > this.giveUpMs) {
            this.map.delete(name);
            return 'drop';
        }
        return 'wait';
    }

    drop(name) { this.map.delete(name); }
}
