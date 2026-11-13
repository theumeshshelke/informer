import assert from 'node:assert/strict';
import {RingBuffer, graphPoints, hexToRgb} from '../sparkline.js';
import * as S from '../settingsio.js';

// ---- ring buffer
const r = new RingBuffer(3);
assert.deepEqual(r.values(), []);
r.push(1); r.push(2);
assert.deepEqual(r.values(), [1, 2]); assert.equal(r.length, 2);
r.push(3); r.push(4); r.push(5);                       // wraps: oldest dropped, order kept
assert.deepEqual(r.values(), [3, 4, 5]); assert.equal(r.length, 3);
r.push(-7); r.push(NaN); r.push('x');                   // bad samples become 0
assert.deepEqual(r.values(), [0, 0, 0]);
r.clear(); assert.deepEqual(r.values(), []); r.push(9); assert.deepEqual(r.values(), [9]);
const big = new RingBuffer(60); for (let i = 1; i <= 100; i++) big.push(i);
assert.equal(big.length, 60); assert.equal(big.values()[0], 41); assert.equal(big.values()[59], 100);

// ---- points
assert.deepEqual(graphPoints([], 60, 60, 16), []);
let p = graphPoints([0, 5000, 0], 60, 59, 16);          // quiet line: stays low (floor 10 KB/s)
assert.equal(p.length, 3);
assert.equal(p[2].x, 59);                               // newest sample is on the right edge
assert.equal(p[0].x, 57); assert.equal(p[1].x, 58);     // not full yet: starts part-way along
assert.equal(p[0].y, 15);                               // zero sits on the bottom line
assert.ok(p[1].y > 8 && p[1].y < 15);                   // 5000 of 10240 is below half height... roughly
p = graphPoints([1000000, 500000], 2, 10, 16);          // peak scales the line
assert.equal(p[0].y, 1); assert.ok(Math.abs(p[1].y - 8) < 0.01);
p = graphPoints(Array(60).fill(20000), 60, 60, 16);
assert.equal(p[0].x, 0); assert.equal(p[59].x, 60);     // full ring fills the width
assert.ok(p.every(q => q.y >= 0 && q.y <= 15));
assert.deepEqual(graphPoints([1], 60, 0, 16), []);
// hex colours
assert.deepEqual(hexToRgb('#ff0000'), [1, 0, 0]); assert.deepEqual(hexToRgb('#0f0'), [0, 1, 0]);
assert.deepEqual(hexToRgb('nope'), [1, 1, 1]); assert.deepEqual(hexToRgb(null), [1, 1, 1]);

// ---- settings check
const spec = [
    {name: 'show-icons', type: 'b', range: null},
    {name: 'flash-seconds', type: 'i', range: {kind: 'range', min: 2, max: 30}},
    {name: 'name', type: 's', range: null},
    {name: 'direction', type: 's', range: {kind: 'enum', values: ['flip', 'random']}},
    {name: 'thoughts', type: 'as', range: null},
    {name: 'data-usage', type: 's', range: null},
    {name: 'weird', type: 'd', range: null},
];
let v = S.validateSettings(spec, {
    'show-icons': false, 'flash-seconds': 10, name: 'Ann', direction: 'flip', thoughts: ['a', 'b'],
});
assert.equal(Object.keys(v.valid).length, 5); assert.equal(v.invalid.length, 0);
v = S.validateSettings(spec, {
    'show-icons': 'yes',           // wrong type
    'flash-seconds': 99,           // out of range
    name: 5,                       // wrong type
    direction: 'spin',             // not in the list
    thoughts: ['a', 3],            // list with a non-text item
    'data-usage': '{"x":1}',       // never imported
    unknown: true,                 // not in the schema
    weird: 1.5,                    // type not supported
});
assert.equal(Object.keys(v.valid).length, 0); assert.equal(v.invalid.length, 8);
const why = Object.fromEntries(v.invalid.map(i => [i.key, i.reason]));
assert.match(why['flash-seconds'], /between 2 and 30/); assert.equal(why['data-usage'], 'not imported');
assert.equal(why.unknown, 'unknown setting'); assert.equal(why.weird, 'type not supported');
assert.match(why.direction, /flip, random/);
// whole numbers only, int32 only
assert.ok(S.checkValue('i', 1.5)); assert.ok(S.checkValue('i', 2 ** 31)); assert.equal(S.checkValue('i', -5), null);
assert.ok(S.checkValue('i', '5')); assert.ok(S.checkValue('b', 1)); assert.ok(S.checkValue('as', 'a'));
// mixed file: good keys still come through, bad ones are listed
v = S.validateSettings(spec, {'show-icons': true, 'flash-seconds': 1, nope: 1});
assert.deepEqual(Object.keys(v.valid), ['show-icons']); assert.equal(v.invalid.length, 2);
// not an object
for (const bad of [null, [], 'x', 5])
    assert.equal(S.validateSettings(spec, bad).invalid.length, 1);
// __proto__ cannot sneak in
v = S.validateSettings(spec, JSON.parse('{"__proto__": {"show-icons": true}, "constructor": 1}'));
assert.equal(Object.keys(v.valid).length, 0); assert.equal(v.invalid.length, 2);
assert.equal(({}).polluted, undefined);

// ---- export / import round trip
const text = S.buildExport({'show-icons': true, 'data-usage': 'secret', name: 'Ann', 'flash-seconds': 7});
assert.ok(!text.includes('secret') && !text.includes('data-usage'));
const back = S.parseImport(text); assert.equal(back.ok, true);
assert.deepEqual(back.settings, {'flash-seconds': 7, name: 'Ann', 'show-icons': true});   // sorted keys
assert.equal(S.parseImport('{oops').ok, false);
assert.equal(S.parseImport('{"format":"other","settings":{}}').ok, false);
assert.equal(S.parseImport('{"format":"informer-settings","settings":[]}').ok, false);
assert.equal(S.parseImport('{"format":"informer-settings","version":99,"settings":{}}').ok, false);
assert.equal(S.parseImport('null').ok, false);
// a file that has data-usage in it is refused for that key only
v = S.validateSettings(spec, S.parseImport('{"format":"informer-settings","version":1,"settings":{"data-usage":"x","name":"Bo"}}').settings);
assert.deepEqual(v.valid, {name: 'Bo'}); assert.equal(v.invalid[0].key, 'data-usage');
// toast text
assert.equal(S.summary(1, []), 'Imported 1 setting');
assert.equal(S.summary(5, [{key: 'a'}, {key: 'b'}, {key: 'c'}, {key: 'd'}, {key: 'e'}]), 'Imported 5 settings. Skipped 5: a, b, c and 2 more');
console.log('graph + settingsio: ok');
