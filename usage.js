// Informer - data used today (pure logic, no gi:// imports)

export function dayKey(d = new Date()) {
    const p = n => `${n}`.padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class UsageTracker {
    constructor(json = '', today = dayKey()) {
        this.day = today;
        this.rx = 0;
        this.tx = 0;
        try {
            const o = JSON.parse(json);
            if (o && o.day === today && o.rx >= 0 && o.tx >= 0) {
                this.rx = Number(o.rx);
                this.tx = Number(o.tx);
            }
        } catch (e) { /* empty or bad: start fresh */ }
    }

    // add the bytes moved since the last tick (deltas only, never raw counters)
    add(rx, tx, today = dayKey()) {
        if (today !== this.day) {       // midnight passed
            this.day = today;
            this.rx = 0;
            this.tx = 0;
        }
        this.rx += Math.max(0, rx);
        this.tx += Math.max(0, tx);
    }

    toJSON() {
        return JSON.stringify({day: this.day, rx: Math.round(this.rx), tx: Math.round(this.tx)});
    }
}
