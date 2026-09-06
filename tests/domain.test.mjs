import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateExternalUrl, openArguments } from '../js/UrlSafety.mjs';
import { resource, indexResource, buildSearchIndex, buildCategoryView, attachIndex, persistIndex, searchResources, correctToken, normalizeSearchText, plainText } from '../js/Resources.mjs';
import { parseDocument, downloadArguments, fetchPlan } from '../js/FmhySource.mjs';
import { buildSafetyIndex, safetyFor } from '../js/Safety.mjs';
import { diffResources } from '../js/Diff.mjs';
import { parseCache, parseUserState } from '../js/Storage.mjs';

const make = (title, fields = {}) => resource({ title, url: 'https://' + title.toLowerCase().replace(/\W/g, '') + '.example/', source: 'system-tools.md', ...fields });
const run = (rows, q = '', tab = 'All', saved = {}) => searchResources(buildSearchIndex(rows.map(indexResource)), q, tab, saved).rows;

for (const url of ['https://example.com', 'http://example.com/path?q=hello#test', 'HTTPS://EXAMPLE.COM:443/a', 'https://xn--caf-dma.example/', 'https://example.com/a%20b', 'https://example.com/a(b)', 'https://example.com/;rm-rf', 'https://example.com/${HOME}']) {
  test('URL allows unambiguous HTTP URL: ' + url, () => {
    const parsed = validateExternalUrl(url);
    assert.ok(parsed);
    assert.equal(parsed.hostname, new URL(url).hostname);
    assert.equal(new URL(parsed.url).href, new URL(url).href);
    assert.deepEqual(openArguments(url), ['xdg-open', parsed.url]);
  });
}
for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///home/user/.ssh/id_ed25519', 'qrc:/x', 'command:hi',
  'https://', '//example.com', 'https:example.com', 'https://good.com@evil.com', 'https://user:pass@example.com',
  'https://example.com\\@evil.com', 'https://example.com\n', ' https://example.com', 'https://example.com/a b',
  'https://example.com/%0a', 'https://example.com/%00', 'https://example.com/%5c', 'https://example.com/%ZZ',
  'https://%65xample.com/', 'https://example.com./', 'https://example..com/', 'https://-example.com',
  'https://example.com:0', 'https://example.com:65536', 'https://127.1', 'https://0x7f.0.0.1',
  'https://example.0x12', 'https://[::1]/', 'https://example.com/../a', 'https://example.com/%2e%2e/a',
  'https://example.com/"$(touch /tmp/pwned)"', 'https://example.com/;rm -rf ...', 'https://例子.com', 'https://example.com/`command`']) {
  test('URL rejects ambiguous or unsafe input: ' + JSON.stringify(url), () => {
    assert.equal(validateExternalUrl(url), null);
    assert.equal(openArguments(url), null);
  });
}

test('deceptive hostname remains the real destination', () => {
  assert.equal(validateExternalUrl('https://good-example.com.evil.tld').hostname, 'good-example.com.evil.tld');
  assert.equal(validateExternalUrl('https://evil.tld/#https://good-example.com').hostname, 'evil.tld');
});
test('exact title beats description and star', () => {
  assert.equal(run([make('Other', {description:'Editor',starred:true}), make('Editor')], 'editor')[0].title, 'Editor');
});
test('title prefix outranks title substring', () => {
  assert.equal(run([make('Better Editor'),make('Editor Pro')], 'editor')[0].title,'Editor Pro');
});
test('normalization handles case, punctuation, accents and spaces', () => {
  assert.equal(normalizeSearchText(' CAFÉ---Tools  '), 'cafe tools');
  assert.equal(run([make('Café Tools')], 'cafe.tools').length, 1);
});
test('resource descriptions drop parser separator residue',()=>{
  assert.equal(make('A',{description:', Alternative / GitHub'}).description,'Alternative / GitHub');
  assert.equal(make('B',{description:'/ GitHub'}).description,'GitHub');
});
test('hostname beats category and description', () => {
  assert.equal(run([make('Category', {category:'needle'}),make('Desc',{description:'needle'}),make('Host',{url:'https://needle.example'})], 'needle')[0].title,'Host');
});
test('category beats description', () => {
  assert.equal(run([make('Desc',{description:'needle',starred:true}),make('Category',{category:'needle'})], 'needle')[0].title,'Category');
});
test('title token beats hostname even with starred boost', () => {
  assert.equal(run([make('Other',{url:'https://needle.example',starred:true}),make('A Needle Tool')], 'needle')[0].title,'A Needle Tool');
});
test('query requires every token', () => assert.equal(run([make('Red'),make('Red Green')], 'red green').length, 1));
test('empty query is deterministic and prefers stars', () => {
  const rows=[make('Zulu'),make('Alpha'),make('Preferred',{starred:true})];
  assert.deepEqual(run(rows).map(r=>r.title),['Preferred','Alpha','Zulu']);
  assert.deepEqual(run(rows),run([...rows].reverse()));
});
test('saved and preferred filters are independent', () => {
  const a=make('A'),b=make('B',{starred:true});
  assert.deepEqual(run([a,b],'','Saved',{[a.id]:a}).map(r=>r.id),[a.id]);
  assert.deepEqual(run([a,b],'','Starred').map(r=>r.id),[b.id]);
});
test('result count is complete while payload is bounded', () => {
  const result=searchResources(buildSearchIndex(Array.from({length:500},(_,i)=>indexResource(make('Tool'+i)))),'','All',{},20);
  assert.equal(result.total,500); assert.equal(result.rows.length,20);
});
test('fragment token without exact words falls back to substring match', () => {
  assert.equal(run([make('Youtube Downloader'),make('Other')],'utub')[0].title,'Youtube Downloader');
  assert.equal(run([make('Name',{description:'downloads movies'})],'movie').length,1);
  assert.equal(run([make('Untold'),make('Toll')],'tol').length,2);
});
test('mixed fragment and word tokens union their candidates', () => {
  const rows=[make('Youtube Tool'),make('Other Tool'),make('Plain')];
  assert.equal(run(rows,'utub tool').length,1);
  assert.equal(run(rows,'utub tool')[0].title,'Youtube Tool');
});
test('word index keeps exact, prefix and field ranking semantics', () => {
  const rows=[make('Editor'),make('Editor Pro'),make('Better Editor'),make('Not'),make('Host',{description:'editor',starred:true})];
  assert.equal(run(rows,'editor')[0].title,'Editor');
  assert.equal(run(rows,'edito')[0].title,'Editor');
});
test('search index is deterministic regardless of insertion order', () => {
  const rows=[make('Zulu'),make('Alpha'),make('Beta',{starred:true})];
  assert.deepEqual(run(rows,'b'),run([...rows].reverse(),'b'));
  assert.deepEqual(run(rows).map(r=>r.title),['Beta','Alpha','Zulu']);
});
test('category browse counts subtrees and lists whole subtree',()=>{
  const rows=[make('AA',{category:'Linux'}),make('AB',{category:'Linux › Utilities'}),make('AC',{category:'Linux › Utilities'}),
    make('AD',{category:'Linux › Games'}),make('AE',{category:'Windows › Tools'})];
  const built=buildSearchIndex(rows.map(indexResource));
  const linux=built.categories.find(node=>node.name==='Linux');
  assert.equal(linux.count,4);
  assert.deepEqual(linux.children.map(sub=>[sub.path,sub.count]),[['Linux › Utilities',2],['Linux › Games',1]]);
  assert.equal(searchResources(built,'','All',{},200,'Linux').total,4);
  assert.equal(searchResources(built,'','All',{},200,'Linux › Utilities').total,2);
  assert.deepEqual(searchResources(built,'','All',{},200,'Linux › Utilities').rows.map(r=>r.title),['AB','AC']);
});
test('category construction rejects path explosions',()=>{
  const rows=Array.from({length:501},(_,i)=>indexResource(make('Tool '+i,{category:'Category '+i})));
  assert.throws(()=>buildCategoryView(rows),/too many category roots/);
});
test('searching within a category matches only its subtree',()=>{
  const rows=[make('Toolbox A',{category:'Linux › Utilities'}),make('Toolbox B',{category:'Linux › Games'}),
    make('Toolbox C',{category:'Windows'}),make('Toolbox D',{category:'Linux'})];
  const built=buildSearchIndex(rows.map(indexResource));
  assert.equal(searchResources(built,'toolbox','All',{},200,'Linux').total,3);
  assert.equal(searchResources(built,'toolbox','All',{},200,'Windows').rows[0].title,'Toolbox C');
  const starred=make('Starred A',{category:'Linux › Utilities',starred:true});
  const built2=buildSearchIndex([starred].map(indexResource));
  assert.equal(searchResources(built2,'','Starred',{},200,'Linux').total,1);
});
test('saved tab respects category filter',()=>{
  const a=make('A',{category:'Linux'}),b=make('B',{category:'Windows'});
  const built=buildSearchIndex([a,b].map(indexResource));
  const result=searchResources(built,'','Saved',{[a.id]:a,[b.id]:b},200,'Linux');
  assert.deepEqual(result.rows.map(r=>r.id),[a.id]);
});

const doc='# ► Linux\n## ▷ Utilities\n* ⭐ **[Tool](https://tool.example/a(b))** - Useful **tool** / [Docs](https://docs.example)\n';
test('parser extracts primary link, balanced parentheses, description, star and headings',()=>{
  const rows=parseDocument(doc,'linux-macos.md');assert.equal(rows.length,1);
  assert.equal(rows[0].title,'Tool');assert.equal(rows[0].url,'https://tool.example/a(b)');
  assert.equal(rows[0].description,'Useful tool / Docs');assert.equal(rows[0].category,'Linux › Utilities');assert.equal(rows[0].starred,true);
});
test('parser permits absent optional description',()=>assert.equal(parseDocument('# Heading\n* [A](https://a.example)','misc.md')[0].description,''));
test('parser deduplicates without losing preferred status',()=>assert.equal(parseDocument(doc+'* [Other](https://tool.example/a(b))','linux-macos.md').length,1));
test('parser skips malformed and non-HTTP resource',()=>assert.equal(parseDocument(doc+'* [Bad](javascript:alert(1))\n* [Unclosed](https://bad.example','linux-macos.md').length,1));
test('deep heading without parents is bounded',()=>assert.equal(parseDocument('###### X\n* [A](https://a.example)','misc.md')[0].category,'X'));
for(const text of ['', 'no recognizable structure', '* [A](https://a.example)', '# Heading\n* [Bad](file:///etc/passwd)']) {
  test('parser rejects incompatible document '+JSON.stringify(text),()=>assert.throws(()=>parseDocument(text,'misc.md')));
}
test('parser rejects oversized line',()=>assert.throws(()=>parseDocument(doc+'x'.repeat(12001),'misc.md')));
test('untrusted display text stays inert plain text',()=>{
  for(const text of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','$(command)','`command`','${HOME}']) assert.equal(plainText(text),text);
  assert.equal(resource({title:'<script>alert(1)</script>',url:'https://a.example'}).title,'<script>alert(1)</script>');
  const qml=readFileSync(new URL('../components/DeckText.qml',import.meta.url),'utf8');assert.match(qml,/textFormat: Text.PlainText/);
});

const rules=buildSafetyIndex('! Unsafe\nbad.example\n','! Caution\niffy.example\n','{"bad.example":"Known warning"}');
test('known warning includes upstream reason',()=>assert.deepEqual(safetyFor('https://bad.example',rules),{level:'warning',reason:'Known warning'}));
test('extended warning list is distinct',()=>assert.equal(safetyFor('https://iffy.example',rules).level,'caution'));
test('normal listed item never claims guaranteed safety',()=>{
  const result=safetyFor('https://normal.example',rules);assert.equal(result.level,'listed');assert.match(result.reason,/not a security guarantee/);
});
test('unencrypted HTTP destinations always require review',()=>{
  const result=safetyFor('http://normal.example/path',rules);
  assert.equal(result.level,'caution');assert.match(result.reason,/unencrypted HTTP/);
  assert.equal(safetyFor('http://bad.example',rules).level,'warning');
});
test('onion services get Tor guidance instead of a generic HTTP claim',()=>{
  const result=safetyFor('http://exampleaddress.onion/path',rules);
  assert.equal(result.level,'caution');assert.match(result.reason,/Tor-compatible browser/);
  assert.doesNotMatch(result.reason,/unencrypted/);
});
test('domain matching respects hostname boundaries',()=>{
  assert.equal(safetyFor('https://bad.example.evil.tld',rules).level,'listed');
  assert.equal(safetyFor('https://notbad.example',rules).level,'listed');
  assert.equal(safetyFor('https://sub.bad.example/path',rules).level,'warning');
  assert.equal(safetyFor('https://good.example/bad.example',rules).level,'listed');
});
test('domain rule applies to all paths, URL rules fail closed',()=>{
  assert.equal(safetyFor('https://bad.example/anything?q=ok',rules).level,'warning');
  assert.throws(()=>buildSafetyIndex('bad.example/path','iffy.example','{}'));
});
test('partial safety data aborts update',()=>{
  assert.throws(()=>buildSafetyIndex('','iffy.example','{}'));
  assert.throws(()=>buildSafetyIndex('bad.example','iffy.example','{'));
});
const a=make('Tool'),b=make('New',{starred:true});
test('new ordinary resources create no noise; preferred ones do',()=>{
  assert.equal(diffResources([a],[a,make('Ordinary')],{},rules,rules).length,0);
  assert.equal(diffResources([a],[a,b],{},rules,rules)[0].kind,'New preferred resource');
});
test('removed saved resources retained in change event',()=>{
  const result=diffResources([a],[],{[a.id]:a},rules,rules);assert.equal(result[0].kind,'Saved resource removed');assert.equal(result[0].resource.url,a.url);
  assert.equal(diffResources([a],[],{},rules,rules).length,0);
});
test('destination changes match unique name and source',()=>{
  const changed=make('Tool',{url:'https://new.example'});
  assert.equal(diffResources([a],[changed],{[a.id]:a},rules,rules)[0].kind,'Destination changed');
});
test('ambiguous names never automatically migrate saves',()=>{
  const other=make('Tool',{url:'https://other.example'}),next=make('Tool',{url:'https://new.example'});
  assert.equal(diffResources([a,other],[next],{[a.id]:a},rules,rules)[0].kind,'Saved resource removed');
});
test('title and formatting changes do not create radar noise',()=>{
  assert.equal(diffResources([a],[{...a,title:'Renamed',description:'New formatting',category:'Other'}],{[a.id]:a},rules,rules).length,0);
});
test('preferred state changes are detected',()=>assert.equal(diffResources([a],[{...a,starred:true}],{},rules,rules)[0].kind,'Preferred status changed'));
test('saved warning applies even when absent from catalog',()=>{
  const bad=make('Bad',{url:'https://bad.example'});assert.equal(diffResources([],[],{[bad.id]:bad},{},rules)[0].kind,'Saved resource warning');
});

test('saved state restores snapshots and rejects malformed state',()=>{
  assert.equal(parseUserState(JSON.stringify({schema:1,saved:[a],seen:'abc'})).saved[a.id].title,'Tool');
  assert.throws(()=>parseUserState('{'));assert.throws(()=>parseUserState('{"schema":2,"saved":[]}'));
  assert.throws(()=>parseUserState(JSON.stringify({schema:1,saved:[{...a,url:'file:///etc/passwd'}]})));
});
test('typo correction maps close misspellings to catalog words',()=>{
  const rows=[make('Firefox Video Player'),make('Other Tool')];
  const result=searchResources(buildSearchIndex(rows.map(indexResource)),'firfox','All',{});
  assert.equal(result.rows[0].title,'Firefox Video Player');
  assert.deepEqual(result.corrected,[{from:'firfox',to:'firefox'}]);
});
test('typo correction never fires for short or distant tokens',()=>{
  const rows=[make('Firefox'),make('Setup'),make('Editor')];
  const built=buildSearchIndex(rows.map(indexResource));
  assert.equal(searchResources(built,'fx','All',{}).corrected.length,0);
  assert.equal(searchResources(built,'firfoxxx','All',{}).corrected.length,0);
  assert.equal(searchResources(built,'firfox','All',{}).corrected[0].to,'firefox');
});
test('typo correction walks past crowded prefix families',()=>{
  const words=['firecrawl','fireflix','firefly','firefox','firefoxaddons','firefoxcss','firefoxextensions','firefoxpro','firehawk52','firejail'];
  assert.equal(correctToken(words,'firfox'),'firefox');
  const rows=[make('Firefox Addons'),make('Firefox CSS'),make('Firefox'),make('Firecrawl')];
  assert.equal(run(rows,'firfox')[0].title,'Firefox');
});
test('correction works inside multi-token queries and keeps other tokens required',()=>{
  const rows=[make('Firefox Video Player'),make('Firefox Editor'),make('Plain Video Player')];
  const result=searchResources(buildSearchIndex(rows.map(indexResource)),'firfox video','All',{});
  assert.equal(result.rows[0].title,'Firefox Video Player');
  assert.equal(result.total,1);
});
test('exact phrase in title outranks scattered word matches',()=>{
  const rows=[make('Any Tool'),make('Video Downloader Pro'),make('Downloader Video Tool')];
  const pages=searchResources(buildSearchIndex(rows.map(indexResource)),'video downloader','All',{});
  assert.equal(pages.rows[0].title,'Video Downloader Pro');
});
test('three-word queries tolerate one missing token and follow the section',()=>{
  const rows=[make('YouTube',{category:'Streaming Sites › Video Streaming'}),
    make('yt-dlp',{category:'Video Tools › Video Download',description:'download videos from youtube'}),
    make('HD Thumb',{category:'YouTube Tools › YouTube Downloaders',description:'download video thumbnails'}),
    make('Random Tool',{category:'Gaming'})];
  const result=searchResources(buildSearchIndex(rows.map(indexResource)),'youtube video download','All',{});
  const titles=result.rows.map(r=>r.title);
  assert.equal(result.total,3);
  assert.ok(titles[0]==='yt-dlp'||titles[0]==='HD Thumb');
  assert.ok(titles.indexOf('YouTube')>titles.indexOf('yt-dlp'));
  assert.ok(!titles.includes('Random Tool'));
});
test('two-word queries stay strict',()=>{
  const rows=[make('Firefox'),make('Firefox Video Player')];
  const result=searchResources(buildSearchIndex(rows.map(indexResource)),'firefox video','All',{});
  assert.equal(result.total,1);
});
test('four-word phrases tolerate two missing words',()=>{
  const rows=[make('Kdenlive',{category:'Video Tools › Video Editors',description:'video editors for linux'}),
    make('Random Thing',{category:'Gaming'})];
  const result=searchResources(buildSearchIndex(rows.map(indexResource)),'best free video editor','All',{});
  assert.deepEqual(result.rows.map(r=>r.title),['Kdenlive']);
});
test('section bonus never outweighs an exact title match',()=>{
  const rows=[make('Video Downloader Pro',{category:'Video Tools › Video Download'}),
    make('Some Tool',{category:'Video Tools › Video Download'})];
  const result=searchResources(buildSearchIndex(rows.map(indexResource)),'video downloader pro','All',{});
  assert.equal(result.rows[0].title,'Video Downloader Pro');
});
test('natural-language filler does not suppress useful results',()=>{
  const rows=[make('Kdenlive',{category:'Video Editing › Video Editors',description:'video editor'}),make('Unrelated')];
  assert.equal(run(rows,'best free video editor')[0].title,'Kdenlive');
});
test('prefixes and morphology resolve common category wording',()=>{
  const rows=[make('uBlock Origin',{category:'Adblocking',starred:true}),make('Block Posters',{category:'Images',description:'advertising poster blocks'})];
  const result=run(rows,'ad blocker');
  assert.deepEqual(result.map(row=>row.title),['uBlock Origin']);
});
test('plural -ies queries cover both movie and category word forms',()=>{
  const rows=[make('Movie Guide',{description:'movie index'}),make('Category Guide',{description:'category index'})];
  assert.equal(run(rows,'movies')[0].title,'Movie Guide');
  assert.equal(run(rows,'categories')[0].title,'Category Guide');
});
test('small intent aliases stay strict with the other query term',()=>{
  const rows=[make('Live Match',{category:'Live Sports',description:'football streams'}),make('Live News',{category:'Live TV'})];
  assert.deepEqual(run(rows,'watch football').map(row=>row.title),['Live Match']);
});
test('cache rejects truncation, duplicates, unsafe rules and schema changes',()=>{
  const cache={schema:1,revision:'a'.repeat(40)+':'+ 'b'.repeat(40),synced:Date.now(),resources:Array.from({length:100},(_,i)=>make('Tool'+i)),rules,changes:[]};
  assert.equal(parseCache(JSON.stringify(cache)).resources.length,100);
  assert.throws(()=>parseCache(JSON.stringify({...cache,schema:2})));
  assert.throws(()=>parseCache(JSON.stringify({...cache,resources:[a,a]})));
  assert.throws(()=>parseCache(JSON.stringify({...cache,rules:{'bad.example/path':{level:'warning',reason:'x'}}})));
  assert.throws(()=>parseCache(JSON.stringify(cache).slice(0,-10)));
});
test('persisted search index attaches onto load and survives JSON roundtrip',()=>{
  const rows=Array.from({length:120},(_,i)=>make('Tool '+i));
  const built=buildSearchIndex(rows.map(indexResource));
  const cache={schema:1,revision:'a'.repeat(40)+':'+ 'b'.repeat(40),synced:Date.now(),resources:rows,rules,changes:[],index:persistIndex(built)};
  const parsed=parseCache(JSON.stringify(cache));
  assert.ok(parsed.index);
  const attached=attachIndex(parsed.index,parsed.resources.map(indexResource));
  assert.deepEqual(searchResources(attached,'Tool 99','All',{}).rows,searchResources(built,'Tool 99','All',{}).rows);
  assert.deepEqual(searchResources(attached,'','Starred',{}).rows,searchResources(built,'','Starred',{}).rows);
});
test('corrupt index data falls back to a rebuild instead of breaking the cache',()=>{
  const rows=Array.from({length:120},(_,i)=>make('Tool '+i));
  const base={schema:1,revision:'a'.repeat(40)+':'+ 'b'.repeat(40),synced:Date.now(),resources:rows,rules,changes:[]};
  const order=Array.from({length:120},(_,i)=>i);
  for (const index of [
    {words:{'tool':[0,90]},order:[0],starredOrder:[]},                          // order length mismatch
    {words:{'tool':[0,90,999,25]},order,starredOrder:[]},                        // index out of range
    {words:{'tool':[0,7]},order,starredOrder:[]},                               // unknown weight
    {words:{'<script>':[0,90]},order,starredOrder:[]},                          // hostile token key
    null]) {
    assert.equal(parseCache(JSON.stringify({...base,index})).index,null);
  }
});
test('index tokens accept any-script words with combining marks only',()=>{
  const rows=Array.from({length:120},(_,i)=>make('Tool '+i));
  const base={schema:1,revision:'a'.repeat(40)+':'+ 'b'.repeat(40),synced:Date.now(),resources:rows,rules,changes:[],index:null};
  const order=Array.from({length:120},(_,i)=>i);
  const withWords=words => parseCache(JSON.stringify({...base,index:{words,order,starredOrder:[],categories:[],categoryIndex:{}}})).index;
  assert.ok(withWords({'বাংলা':[0,90]}));
  for (const hostile of ['\u0000','\u200b','a b',"a'b",'a\nb']) {
    assert.equal(withWords({[hostile]:[0,90]}),null);
  }
});
test('category tree in cache accepts legit paths but rejects control characters',()=>{
  const rows=Array.from({length:120},(_,i)=>make('Tool '+i,{category:'Linux › Utilities'}));
  const built=buildSearchIndex(rows.map(indexResource));
  const parsed=parseCache(JSON.stringify({schema:1,revision:'a'.repeat(40)+':'+ 'b'.repeat(40),synced:Date.now(),
    resources:rows,rules,changes:[],index:persistIndex(built)}));
  assert.ok(parsed.index);
  assert.equal(parsed.index.categories[0].name,'Linux');
  assert.equal(parsed.index.categories[0].count,120);
  const order=Array.from({length:120},(_,i)=>i);
  const categoryIndex={'Linux':order,'Linux › A':[0]};
  const withCategories=categories => parseCache(JSON.stringify({...{schema:1,revision:'a'.repeat(40)+':'+ 'b'.repeat(40),synced:Date.now(),
    resources:rows,rules,changes:[]},index:{words:{'tool':[0,90]},order,starredOrder:[],categories,categoryIndex}})).index;
  assert.equal(withCategories([{name:'Linux\u0000',count:1,children:[]}]),null);
  assert.equal(withCategories([{name:'Linux',count:1,children:[{path:'Linux › A\u0000B',count:1}]}]),null);
  assert.ok(withCategories([{name:'Linux',count:120,children:[{path:'Linux › A',count:1}]}]));
});test('fetch allowlist prevents arbitrary endpoints, redirects and shell invocation',()=>{
  const plan=fetchPlan('a'.repeat(40),'b'.repeat(40));assert.equal(plan.length,27);
  for(const item of plan){const args=downloadArguments(item.url);assert.equal(args[0],'curl');assert.ok(args.includes('--disable'));assert.equal(args[args.indexOf('--max-redirs')+1],'0');assert.equal(args.at(-1),item.url);}
  assert.throws(()=>downloadArguments('https://evil.example'));
  assert.throws(()=>fetchPlan('../main','main'));
});
