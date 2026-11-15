// Informer - simple timer: countdown or stopwatch (pure, no gi:// imports).
// Every method takes `now` (ms), so it is easy to test. It has no clock of its own:
// the bar's 1 second heartbeat calls tick().

export class SimpleTimer {
    constructor() {
        this.reset();
    }

    reset() {
        this.mode = null;       // null | 'countdown' | 'stopwatch'
        this.running = false;
        this.startAt = 0;
        this.base = 0;          // time used before the last pause
        this.total = 0;         // countdown length
    }

    get active() { return this.mode !== null; }

    startCountdown(ms, now) {
        this.mode = 'countdown';
        this.total = ms;
        this.base = 0;
        this.startAt = now;
        this.running = true;
    }

    startStopwatch(now) {
        this.mode = 'stopwatch';
        this.total = 0;
        this.base = 0;
        this.startAt = now;
        this.running = true;
    }

    pause(now) {
        if (this.running) {
            this.base += Math.max(0, now - this.startAt);
            this.running = false;
        }
    }

    resume(now) {
        if (this.active && !this.running) {
            this.startAt = now;
            this.running = true;
        }
    }

    toggle(now) {
        if (this.running)
            this.pause(now);
        else
            this.resume(now);
    }

    elapsed(now) {
        return this.base + (this.running ? Math.max(0, now - this.startAt) : 0);
    }

    // what the bar shows: time left (countdown) or time used (stopwatch)
    shown(now) {
        return this.mode === 'countdown'
            ? Math.max(0, this.total - this.elapsed(now))
            : this.elapsed(now);
    }

    // Call once a second while active. Returns {total} when a countdown ends (and resets), else null.
    tick(now) {
        if (this.mode === 'countdown' && this.running && this.elapsed(now) >= this.total) {
            const ev = {total: this.total};
            this.reset();
            return ev;
        }
        return null;
    }
}

// 04:10, or 1:02:03 after an hour. A countdown rounds up (so it shows 00:01 until it is really over).
export function fmtTimer(ms, countdown) {
    const s = Math.max(0, countdown ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
    const p = n => `${n}`.padStart(2, '0');
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

export function timerLabel(t) {
    if (!t.active)
        return '';
    if (!t.running)
        return 'Paused';
    return t.mode === 'countdown' ? 'Timer' : 'Stopwatch';
}

export function timerDoneText(totalMs) {
    const s = Math.round(totalMs / 1000);
    return s >= 60 && s % 60 === 0 ? `Timer done: ${s / 60} min` : `Timer done: ${fmtTimer(totalMs, true)}`;
}
