import test from 'node:test';
import assert from 'node:assert/strict';
import { documents } from '../js/FmhySource.mjs';
import { resource } from '../js/Resources.mjs';

const messages = [];
globalThis.WorkerScript = { sendMessage: message => messages.push(message) };
await import('../js/Worker.mjs');
const send = message => { messages.length = 0; WorkerScript.onMessage(message); return messages; };
const revision = 'a'.repeat(40) + ':' + 'b'.repeat(40);
const cache = { schema: 1, revision, synced: Date.now(), resources: Array.from({ length: 100 }, (_, index) =>
  resource({ title: 'Cached ' + index, url: 'https://cached' + index + '.example', source: 'misc.md' })),
  rules: { 'bad.example': {level: 'warning', reason: 'Flagged'} }, changes: [] };

test('worker only activates complete updates after atomic write acknowledgement', () => {
  assert.equal(send({kind:'load',text:JSON.stringify(cache)})[0].kind,'active');
  send({kind:'begin',revision});
  for (const name of documents) {
    const text = '# Resources\n' + Array.from({length:60},(_,i)=>'* [Tool '+i+'](https://'+name+i+'.example/) - A tool').join('\n');
    assert.equal(send({kind:'document',source:{kind:'catalog',name:name+'.md'},text})[0].kind,'next');
  }
  for (const [name,text] of [['sitelist.txt','bad.example'],['sitelist-plus.txt','iffy.example'],['filterlists-reasons.json','{}']]) {
    send({kind:'document',source:{kind:'safety',name},text});
  }
  const persisted=send({kind:'finish',seen:''})[0];
  assert.equal(persisted.kind,'persist');
  assert.equal(JSON.parse(persisted.text).resources.length,1440);
  assert.equal(send({kind:'query',query:'Cached',tab:'All',serial:1})[0].total,100);
  const committed=send({kind:'commit'});
  assert.equal(committed[0].kind,'active'); assert.equal(committed[0].count,1440);
  assert.equal(send({kind:'query',query:'Tool',tab:'All',serial:2})[0].total,1440);
});
test('worker abort preserves active data after incompatible update',()=>{
  send({kind:'begin',revision});
  assert.equal(send({kind:'document',source:{kind:'catalog',name:'misc.md'},text:'truncated'})[0].kind,'error');
  assert.equal(send({kind:'query',query:'Tool',tab:'All',serial:3})[0].total,1440);
});
test('worker keeps disappeared saves searchable without upstream cache mutation',()=>{
  const saved=resource({title:'Lost Tool',url:'https://lost.example'});
  send({kind:'saved',saved:{[saved.id]:saved}});
  const result=send({kind:'query',query:'Lost',tab:'Saved',serial:4})[0];
  assert.equal(result.total,1);assert.equal(result.rows[0].missing,true);
  assert.equal(send({kind:'query',query:'Lost',tab:'All',serial:5})[0].total,0);
});
test('worker rejects incomplete safety transaction',()=>{
  send({kind:'begin',revision});
  assert.equal(send({kind:'finish',seen:''})[0].kind,'error');
  assert.equal(send({kind:'query',query:'Tool',tab:'All',serial:6})[0].total,1440);
});
test('worker filters queries by category subtree and serves random picks',()=>{
  assert.equal(send({kind:'query',query:'Tool',tab:'All',serial:7,category:'Resources'})[0].total,1440);
  assert.equal(send({kind:'query',query:'Tool',tab:'All',serial:8,category:'Other'})[0].total,0);
  assert.equal(send({kind:'query',query:'',tab:'All',serial:9,category:'Resources'})[0].total,1440);
  const pick=send({kind:'random',serial:1});
  assert.equal(pick[0].kind,'random');
  assert.ok(pick[0].entry.title.length>0);
  assert.equal(pick[0].entry.safety.level,'listed');
});
