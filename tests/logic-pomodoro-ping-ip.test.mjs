import assert from 'node:assert/strict';
import {Pomodoro, fmtClock, eventText, labelFor} from '../pomodoro.js';
import {PingHistory} from '../pinglogic.js';
import * as ip from '../publicip.js';
const cfg={focus:25,short:5,long:15}; const p=new Pomodoro(()=>cfg);
assert.equal(p.tick(0),null); p.start(0); assert.equal(p.state,'focus'); assert.equal(fmtClock(p.left(0)),'25:00');
assert.equal(p.tick(1499000),null);
p.pause(600000); assert.equal(p.running,false); assert.equal(p.tick(9e9),null);
p.start(1000000); assert.equal(p.left(1000000),900000);
let ev=p.tick(1000000+900000); assert.deepEqual(ev,{from:'focus',to:'short',minutes:5}); assert.equal(eventText(ev),'Focus done. Take a 5 min break.');
ev=p.tick(1900000+300000); assert.equal(ev.to,'idle'); assert.equal(p.state,'idle'); assert.equal(eventText(ev),'Break over. Ready to focus?');
// 4th focus -> long
for(let i=0;i<2;i++){p.start(0); p.skip(0); p.skip(0);} p.start(0); ev=p.skip(0); assert.equal(ev.to,'long'); assert.equal(p.done,4);
p.reset(); assert.equal(p.state,'idle'); assert.equal(p.skip(0),null); assert.equal(labelFor(p),'');
assert.equal(fmtClock(18*60000+42000),'18:42');
// ping
const h=new PingHistory(); h.push(10);h.push(500);assert.equal(h.median3(),null);h.push(600);
assert.equal(h.median3(),500); assert.equal(h.shouldWarn(1000,300,600000),true); assert.equal(h.shouldWarn(2000,300,600000),false); assert.equal(h.shouldWarn(700000,300,600000),true);
h.push(5);h.push(5);assert.equal(h.shouldWarn(9e9,300,1),false); h.push(null);h.push(-1); assert.equal(h.last,5);
for(let i=0;i<100;i++)h.push(i); assert.equal(h.list.length,60);
// ip
assert.equal(ip.maskIp('185.12.34.56'),'185.12.x.x'); assert.equal(ip.maskIp('2001:db8:1::1'),'2001:db8::x');
assert.equal(ip.parseIpwho({success:false}),null); assert.deepEqual(ip.parseIpwho({ip:'1.2.3.4',city:'Frankfurt',country:'Germany'}),{ip:'1.2.3.4',city:'Frankfurt',country:'Germany'});
assert.equal(ip.placeText({city:'Frankfurt',country:'Germany'}),'Frankfurt, Germany'); assert.equal(ip.isStale(null,0),true); assert.equal(ip.isStale({at:0},1000),false);
console.log('phase C1/C3/C4 logic tests pass');
