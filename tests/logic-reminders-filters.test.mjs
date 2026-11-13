import assert from 'node:assert/strict';
import * as R from '../reminders.js';
import * as F from '../filters.js';
// parse
const list=R.parseReminders(JSON.stringify([
 {id:'a',label:'Drink water',time:'9:05',days:127,repeat:true},
 {id:'b',label:'  ',time:'10:00'}, {id:'c',label:'bad',time:'25:00'}, {label:'Stretch',time:'14:30',days:3,repeat:false}, 5]));
assert.equal(list.length,2); assert.equal(list[0].time,'09:05'); assert.equal(list[1].id,'r3'); assert.equal(R.parseReminders('junk').length,0);
// Mon 2026-11-16 09:05 (Nov 13 2026 is Friday)
const mon=new Date(2026,10,16,9,5,10); assert.equal(mon.getDay(),1); assert.equal(R.dayBit(mon),1);
assert.equal(R.dayBit(new Date(2026,10,15,0,0)),64);
const fired=new Set();
let due=R.dueReminders(list,mon,fired); assert.equal(due.length,1); due.forEach(d=>fired.add(d.key));
assert.equal(R.dueReminders(list,new Date(2026,10,16,9,5,40),fired).length,0);   // exactly once
assert.equal(R.dueReminders(list,new Date(2026,10,16,9,6,0),fired).length,0);
assert.equal(R.dueReminders(list,new Date(2026,10,16,9,4,59),new Set()).length,0);  // too early
assert.equal(R.dueReminders(list,new Date(2026,10,16,9,7,0),new Set()).length,1);   // late by 2 min ok
assert.equal(R.dueReminders(list,new Date(2026,10,16,9,8,0),new Set()).length,0);
// days mask: Stretch only Mon+Tue (3)
assert.equal(R.dueReminders(list,new Date(2026,10,16,14,30),new Set()).length,1);
assert.equal(R.dueReminders(list,new Date(2026,10,18,14,30),new Set()).length,0);   // Wednesday
// next day fires again, prune forgets old
const f2=new Set(['a|2026-11-15|09:05','a|2026-11-16|09:05']); R.pruneFired(f2,new Date(2026,10,16,12)); assert.equal(f2.size,1);
assert.equal(R.dueReminders([{...list[0],enabled:false}],mon,new Set()).length,0);
// filters
assert.equal(F.isTempName('a.pdf.crdownload'),true); assert.equal(F.isTempName('x.PART'),true); assert.equal(F.isTempName('.hidden'),true); assert.equal(F.isTempName('report.pdf'),false);
assert.equal(F.isScreenshotName('Screenshot from 2026.png',false),true); assert.equal(F.isScreenshotName('cat.png',false),false); assert.equal(F.isScreenshotName('cat.png',true),true); assert.equal(F.isScreenshotName('a.jpg',true),false);
assert.equal(F.appAllowed([], 'Any'),true); assert.equal(F.appAllowed(['whatsapp'],'WhatsApp'),true); assert.equal(F.appAllowed(['whatsapp'],'Mail'),false);
const w=new F.StableWatcher(2000); w.add('f.pdf',0);
assert.equal(w.check('f.pdf',100,0),'wait'); assert.equal(w.check('f.pdf',100,1500),'wait'); assert.equal(w.check('f.pdf',200,2000),'wait');   // grew
assert.equal(w.check('f.pdf',200,4100),'done'); assert.equal(w.size,0); assert.equal(w.check('f.pdf',200,5000),'drop');
w.add('z',0); assert.equal(w.check('z',0,5000),'wait'); assert.equal(w.check('z',0,700000),'drop');   // empty file never announced
console.log('phase C2/C5/C6/C7 logic tests pass');
