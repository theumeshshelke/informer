// Informer - small helpers shared by extension.js and sources.js

// Run a command without blocking the shell. Always resolves to a string.


// File names inside a directory ([] if it does not exist).

// Keep long titles from pushing the other top-bar items around.
export function clip(text, max = 60) {
    const t = `${text ?? ''}`.replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}\u2026` : t;
}

export function fmtBytes(n) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function readFile(path) { return globalThis.__fs.files.get(path) ?? ''; }
export function listDir(path) { return globalThis.__fs.dirs.get(path) ?? []; }
export function run(argv) { return Promise.resolve(globalThis.__fs.run ? globalThis.__fs.run(argv) : ''); }
