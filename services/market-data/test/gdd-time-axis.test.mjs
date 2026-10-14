import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GDD_SESSION_TIMES,buildGddSessionAxis} from '../../../apps/web/src/trading-time-axis.mjs';

test('A-share axis spans 09:15 auction, 09:30-11:30, 13:00-15:00 and never includes lunch',()=>{
 assert.equal(GDD_SESSION_TIMES[0],'09:15');
 assert.ok(GDD_SESSION_TIMES.includes('09:25'));
 assert.ok(GDD_SESSION_TIMES.includes('09:30'));
 assert.ok(GDD_SESSION_TIMES.includes('11:30'));
 assert.ok(GDD_SESSION_TIMES.includes('13:00'));
 assert.equal(GDD_SESSION_TIMES.at(-1),'15:00');
 assert.equal(GDD_SESSION_TIMES.includes('12:00'),false);
 assert.equal(GDD_SESSION_TIMES.includes('09:27'),false);
 assert.equal(GDD_SESSION_TIMES.length,11+1+121+1+121);
});
test('Incomplete intraday data does not distort time axis or invent future prices',()=>{
 const rows=[
  {time:'09:15',price:10.1,avgPrice:10.1,volume:10},
  {time:'09:32',price:10.3,avgPrice:10.2,volume:20},
  {time:'13:10',price:10.8,avgPrice:10.5,volume:50}
 ];
 const axis=buildGddSessionAxis(rows);
 assert.equal(axis.actualMinutes,3);
 assert.equal(axis.labels[0],'09:15');
 assert.equal(axis.labels.at(-1),'15:00');
 const m=(t)=>axis.labels.indexOf(t);
 assert.equal(axis.auction[m('09:15')],10.1);
 assert.equal(axis.morning[m('09:32')],10.3);
 assert.equal(axis.afternoon[m('13:10')],10.8);
 assert.equal(axis.morning[m('14:00')],null);
 assert.equal(axis.afternoon[m('15:00')],null);
 assert.equal(axis.auction[m('13:10')],null);
 assert.equal(axis.morning[m('11:30')],null);
 assert.equal(axis.morning[m('午休')],null);
});
