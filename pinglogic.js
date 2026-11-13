// Informer - ping history and warning logic (pure, no gi:// imports)

export class PingHistory {
    constructor(max = 60) {
        this.max = max;
        this.list = [];             // ms values, newest last; failed pings are not stored
        this.lastWarn = -Infinity;
    }

    push(ms) {
        if (typeof ms !== "number" || !(ms >= 0))
            return;
        this.list.push(ms);
        if (this.list.length > this.max)
            this.list.shift();
    }

    get last() { return this.list.length ? this.list[this.list.length - 1] : null; }

    // median of the last 3 results (needs 3), or null
    median3() {
        if (this.list.length < 3)
            return null;
        return [...this.list.slice(-3)].sort((a, b) => a - b)[1];
    }

    // true at most once per cooldown while the median stays above the limit
    shouldWarn(now, limitMs, cooldownMs) {
        const m = this.median3();
        if (m === null || m <= limitMs || now - this.lastWarn < cooldownMs)
            return false;
        this.lastWarn = now;
        return true;
    }
}
