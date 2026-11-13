// Informer - message queue with priorities (plain ES module, no gi:// imports).
//
// Rules:
//  * A message with a higher priority than the one on screen interrupts it.
//  * Equal or lower priority waits its turn: highest priority first, then oldest.
//  * A message with the same `key` replaces the older one (volume, caps lock ...).
//  * Waiting messages go stale: low ones quickly, critical ones never.
//  * An interrupted message that was barely seen (< graceMs) goes back in the queue.

export const MAX_AGE_MS = [15000, 30000, 60000, Infinity];   // by priority 0..3

export class MessageQueue {
    constructor({maxQueued = 8, graceMs = 1500} = {}) {
        this.maxQueued = maxQueued;
        this.graceMs = graceMs;
        this.cur = null;       // message on screen
        this.items = [];       // waiting messages, best first
    }

    // msg: {text, kind, prio (0-3), ms, key?}
    post(msg, now) {
        msg.born = now;
        if (msg.key) {
            this.items = this.items.filter(m => m.key !== msg.key);
            if (this.cur && this.cur.key === msg.key)
                this.cur = null;                      // replaced in place
        }
        this._insert(msg);
        return this.advance(now);
    }

    // Call on every post and whenever the current message may have expired.
    advance(now) {
        if (this.cur && now >= this.cur.until)
            this.cur = null;

        this.items = this.items.filter(
            m => m.prio >= 3 || now - m.born <= MAX_AGE_MS[m.prio]);

        const top = this.items[0];
        if (!top)
            return this.cur;

        if (!this.cur) {
            this.items.shift();
            this._start(top, now);
        } else if (top.prio > this.cur.prio) {
            const old = this.cur;
            this.items.shift();
            this.cur = null;
            if (old.prio > 0 && now - old.shownAt < this.graceMs)
                this._insert(old);
            this._start(top, now);
        }
        return this.cur;
    }

    clear() {
        this.cur = null;
        this.items = [];
    }

    _start(msg, now) {
        msg.shownAt = now;
        msg.until = now + msg.ms;
        this.cur = msg;
    }

    _insert(msg) {
        let i = this.items.findIndex(
            m => m.prio < msg.prio || (m.prio === msg.prio && m.born > msg.born));
        if (i < 0)
            i = this.items.length;
        this.items.splice(i, 0, msg);
        if (this.items.length > this.maxQueued)
            this.items.pop();                         // drop the weakest
    }
}
