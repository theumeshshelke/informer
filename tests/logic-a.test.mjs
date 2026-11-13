import assert from 'node:assert/strict';
import {speedLevel, levelColor} from '../speedlogic.js';
import {UsageTracker} from '../usage.js';
import {rainSoon, weatherAlerts} from '../weatherlogic.js';
// A1
assert.equal(speedLevel(2e6,0,1024,20,true),'fast');
assert.equal(speedLevel(100e3,0,1024,20,true),'normal');
assert.equal(speedLevel(100,0,1024,20,true),'slow');
assert.equal(speedLevel(9e9,0,1024,20,false),'down');
assert.equal(levelColor('slow',{good:'g',warn:'w',bad:'b',normal:'n'}),'w');
// A2
const u=new UsageTracker('', '2026-11-13'); u.add(1000,500,'2026-11-13'); u.add(-5,10,'2026-11-13');
assert.deepEqual([u.rx,u.tx],[1000,510]);
const u2=new UsageTracker(u.toJSON(),'2026-11-13'); assert.equal(u2.rx,1000);
const u3=new UsageTracker(u.toJSON(),'2026-11-14'); assert.equal(u3.rx,0);
u.add(7,7,'2026-11-14'); assert.deepEqual([u.rx,u.tx],[7,7]);
assert.equal(new UsageTracker('junk').rx,0);
// A3
const h={precipitation_probability:[10,20,70,90]};
assert.deepEqual(rainSoon(h,60),{inHours:2,chance:70});
assert.equal(rainSoon({precipitation_probability:[0,0,0,90]},60),null);
let r=weatherAlerts({rain:false,hot:false,cold:false},{rain:{inHours:1,chance:70},temp:40,hotC:38,coldC:5,isF:false,unit:'C'});
assert.equal(r.alerts.length,2);
r=weatherAlerts(r.state,{rain:{inHours:1,chance:70},temp:40,hotC:38,coldC:5,isF:false,unit:'C'});
assert.equal(r.alerts.length,0);           // not repeated
r=weatherAlerts(r.state,{rain:null,temp:20,hotC:38,coldC:5,isF:false,unit:'C'});
r=weatherAlerts(r.state,{rain:{inHours:0,chance:80},temp:20,hotC:38,coldC:5,isF:false,unit:'C'});
assert.equal(r.alerts.length,1);           // new rain event
r=weatherAlerts({rain:false,hot:false,cold:false},{rain:null,temp:101,hotC:38,coldC:5,isF:true,unit:'F'});
assert.equal(r.alerts[0].key,'hot');       // 38C = 100.4F
console.log('all tests pass');
