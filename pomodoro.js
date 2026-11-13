// Informer - Pomodoro state machine (pure logic, no gi:// imports)
// States: idle, focus, short, long. A focus phase ends in a break that starts
// by itself; a break ends in idle (waiting for Start). Every 4th break is long.

export function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${`${s % 60}`.padStart(2, '0')}`;
}

export class Pomodoro {
    // minutes: () => ({focus, short, long})
    constructor(minutes) {
        this._minutes = minutes;
        this.reset();
    }

    reset() {
        this.state = 'idle';
        this.running = false;
        this.endAt = 0;
        this.remaining = 0;
        this.done = 0;          // focus phases finished
    }

    get active() { return this.state !== 'idle'; }

    _begin(state, now) {
        this.state = state;
        this.remaining = this._minutes()[state] * 60000;
        this.endAt = now + this.remaining;
        this.running = true;
    }

    start(now) {
        if (this.state === 'idle')
            this._begin('focus', now);
        else if (!this.running)
            this.resume(now);
    }

    resume(now) {
        if (this.active && !this.running) {
            this.endAt = now + this.remaining;
            this.running = true;
        }
    }

    pause(now) {
        if (this.running) {
            this.remaining = Math.max(0, this.endAt - now);
            this.running = false;
        }
    }

    toggle(now) {
        if (this.running)
            this.pause(now);
        else
            this.start(now);
    }

    left(now) {
        return this.running ? Math.max(0, this.endAt - now) : this.remaining;
    }

    // Skip to the end of this phase. Returns the event or null.
    skip(now) {
        return this.active ? this._finish(now) : null;
    }

    // Call once a second while active. Returns an event {from, to, minutes} when a phase ended.
    tick(now) {
        return this.running && now >= this.endAt ? this._finish(now) : null;
    }

    _finish(now) {
        const from = this.state;
        if (from === 'focus') {
            this.done++;
            const to = this.done % 4 === 0 ? 'long' : 'short';
            this._begin(to, now);
            return {from, to, minutes: this._minutes()[to]};
        }
        this.state = 'idle';
        this.running = false;
        this.remaining = 0;
        return {from, to: 'idle', minutes: 0};
    }
}

export function eventText(ev) {
    if (ev.from === 'focus')
        return `Focus done. Take a ${ev.minutes} min break.`;
    return 'Break over. Ready to focus?';
}

export function labelFor(p) {
    if (p.state === 'idle')
        return '';
    const name = p.state === 'focus' ? 'Focus' : 'Break';
    return p.running ? name : `Paused`;
}
