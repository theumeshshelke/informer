// Informer - data used today / this week (pure logic, no gi:// imports)

export function dayKey(d = new Date()) {
    const p = n => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = k => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
const goodDay = h => h && typeof h.day === 'string' && DAY_RE.test(h.day) &&
    Number.isFinite(+h.rx) && Number.isFinite(+h.tx) && +h.rx >= 0 && +h.tx >= 0;

export class UsageTracker {
    constructor(json = '', today = dayKey()) {
        this.day = today;
        this.rx = 0;
        this.tx = 0;
        this.hist = [];                 // finished days: [{day, rx, tx}], at most 6
        try {
            const o = JSON.parse(json);
            if (o && typeof o === 'object') {
                if (Array.isArray(o.hist)) {
                    for (const h of o.hist) {
                        if (goodDay(h))
                            this.hist.push({day: h.day, rx: +h.rx, tx: +h.tx});
                    }
                }
                if (o.day === today && o.rx >= 0 && o.tx >= 0) {
                    this.rx = Number(o.rx);
                    this.tx = Number(o.tx);
                } else if (goodDay(o)) {
                    this._keep(o.day, +o.rx, +o.tx);     // the saved day is over: keep it for the week
                }
            }
        } catch (e) { /* empty or bad: start fresh */ }
        this._prune(today);
    }

    _keep(day, rx, tx) {
        this.hist = this.hist.filter(h => h.day !== day);
        this.hist.push({day, rx, tx});
    }

    // keep the 6 days before today, oldest first
    _prune(today) {
        this.hist = this.hist
            .filter(h => {
                const d = (dayMs(today) - dayMs(h.day)) / 86400000;
                return d >= 1 && d <= 6;
            })
            .sort((a, b) => (a.day < b.day ? -1 : 1));
    }

    // add the bytes moved since the last tick (deltas only, never raw counters)
    add(rx, tx, today = dayKey()) {
        if (today !== this.day) {       // midnight passed
            this._keep(this.day, this.rx, this.tx);
            this.day = today;
            this.rx = 0;
            this.tx = 0;
            this._prune(today);
        }
        this.rx += Math.max(0, rx);
        this.tx += Math.max(0, tx);
    }

    // today plus the 6 days before it
    week() {
        let rx = this.rx;
        let tx = this.tx;
        for (const h of this.hist) {
            rx += h.rx;
            tx += h.tx;
        }
        return {rx, tx};
    }

    toJSON() {
        return JSON.stringify({
            day: this.day, rx: Math.round(this.rx), tx: Math.round(this.tx),
            hist: this.hist.map(h => ({day: h.day, rx: Math.round(h.rx), tx: Math.round(h.tx)})),
        });
    }
}

// Focus sessions finished today (kept as {day, n}; starts again at midnight)
export class DayCounter {
    constructor(json = '', today = dayKey()) {
        this.day = today;
        this.n = 0;
        try {
            const o = JSON.parse(json);
            if (o && o.day === today && Number.isInteger(o.n) && o.n >= 0)
                this.n = o.n;
        } catch (e) { /* start fresh */ }
    }

    inc(today = dayKey()) {
        if (today !== this.day) {
            this.day = today;
            this.n = 0;
        }
        return ++this.n;
    }

    toJSON() {
        return JSON.stringify({day: this.day, n: this.n});
    }
}
