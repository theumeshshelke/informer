// Informer - small helpers shared by extension.js and sources.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Run a command without blocking the shell. Always resolves to a string.
export function run(argv) {
    return new Promise(resolve => {
        try {
            const proc = new Gio.Subprocess({
                argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, out] = p.communicate_utf8_finish(res);
                    resolve(out ?? '');
                } catch (e) {
                    resolve('');
                }
            });
        } catch (e) {
            resolve('');
        }
    });
}

export function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : '';
    } catch (e) {
        return '';
    }
}

// File names inside a directory ([] if it does not exist).
export function listDir(path) {
    const names = [];
    try {
        const en = Gio.File.new_for_path(path).enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)) !== null)
            names.push(info.get_name());
        en.close(null);
    } catch (e) { /* missing or unreadable */ }
    return names;
}

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
