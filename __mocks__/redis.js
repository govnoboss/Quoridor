const EventEmitter = require('events');

class MockRedisClient extends EventEmitter {
    constructor() {
        super();
        this._data = new Map();
        this._lists = new Map();
        this._sortedSets = new Map();
        this._connected = false;
    }

    async connect() {
        this._connected = true;
        process.nextTick(() => this.emit('connect'));
    }

    async quit() {
        this._connected = false;
    }

    async ping() { return 'PONG'; }

    async get(key) {
        const entry = this._data.get(key);
        if (!entry) return null;
        if (entry.expiry && Date.now() > entry.expiry) {
            this._data.delete(key);
            return null;
        }
        return entry.value;
    }

    async set(key, value, ...args) {
        const opts = args.reduce((acc, arg, i) => {
            if (typeof arg === 'string' && arg.toUpperCase() === 'NX') acc.nx = true;
            else if (typeof arg === 'string' && arg.toUpperCase() === 'PX' && args[i + 1]) {
                acc.px = args[i + 1];
            } else if (typeof arg === 'object' && arg.EX) acc.ex = arg.EX;
            else if (typeof arg === 'object' && arg.NX) acc.nx = true;
            else if (typeof arg === 'object' && arg.PX) acc.px = arg.PX;
            return acc;
        }, {});

        if (opts.nx && this._data.has(key)) return null;

        const expiry = opts.px ? Date.now() + opts.px : opts.ex ? Date.now() + (opts.ex * 1000) : null;
        this._data.set(key, { value, expiry });
        return 'OK';
    }

    async setEx(key, ttl, value) {
        this._data.set(key, { value, expiry: Date.now() + (ttl * 1000) });
        return 'OK';
    }

    async del(...keys) {
        let count = 0;
        for (const key of keys) {
            if (this._data.delete(key)) count++;
            if (this._lists.delete(key)) count++;
            if (this._sortedSets.delete(key)) count++;
        }
        return count;
    }

    async keys(pattern) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return Array.from(this._data.keys()).filter(k => regex.test(k));
    }

    async rPush(key, value) {
        if (!this._lists.has(key)) this._lists.set(key, []);
        this._lists.get(key).push(value);
        return this._lists.get(key).length;
    }

    async lPop(key) {
        const list = this._lists.get(key);
        if (!list || list.length === 0) return null;
        return list.shift();
    }

    async lLen(key) {
        const list = this._lists.get(key);
        return list ? list.length : 0;
    }

    async lRange(key, start, stop) {
        const list = this._lists.get(key) || [];
        if (stop === -1) return list.slice(start);
        return list.slice(start, stop + 1);
    }

    async lRem(key, count, value) {
        const list = this._lists.get(key);
        if (!list) return 0;
        const idx = list.indexOf(value);
        if (idx === -1) return 0;
        list.splice(idx, 1);
        return 1;
    }

    async lPush(key, value) {
        if (!this._lists.has(key)) this._lists.set(key, []);
        this._lists.get(key).unshift(value);
        return this._lists.get(key).length;
    }

    async sAdd(key, value) {
        if (!this._lists.has(key)) this._lists.set(key, []);
        if (!this._lists.get(key).includes(value)) {
            this._lists.get(key).push(value);
            return 1;
        }
        return 0;
    }

    async sRem(key, value) {
        const list = this._lists.get(key);
        if (!list) return 0;
        const idx = list.indexOf(value);
        if (idx === -1) return 0;
        list.splice(idx, 1);
        return 1;
    }

    async sMembers(key) {
        return this._lists.get(key) || [];
    }

    async incr(key) {
        const entry = this._data.get(key);
        const val = entry ? parseInt(entry.value, 10) : 0;
        const newVal = val + 1;
        this._data.set(key, { value: String(newVal), expiry: null });
        return newVal;
    }

    async zAdd(key, entries) {
        if (!this._sortedSets.has(key)) this._sortedSets.set(key, []);
        const set = this._sortedSets.get(key);
        for (const { score, value } of entries) {
            const existing = set.findIndex(e => e.value === value);
            if (existing !== -1) {
                set[existing].score = score;
            } else {
                set.push({ score, value });
            }
        }
        return entries.length;
    }

    async zRem(key, value) {
        const set = this._sortedSets.get(key);
        if (!set) return 0;
        const idx = set.findIndex(e => e.value === value);
        if (idx === -1) return 0;
        set.splice(idx, 1);
        return 1;
    }

    async zRangeByScore(key, min, max) {
        const set = this._sortedSets.get(key);
        if (!set) return [];
        return set
            .filter(e => e.score >= min && e.score <= max)
            .map(e => e.value);
    }

    async zScore(key, value) {
        const set = this._sortedSets.get(key);
        if (!set) return null;
        const entry = set.find(e => e.value === value);
        return entry ? entry.score : null;
    }
}

function createClient(...args) {
    return new MockRedisClient();
}

module.exports = { createClient };
