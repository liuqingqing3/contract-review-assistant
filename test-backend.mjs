import assert from 'node:assert/strict';
import {validateInput,validateOutput,review,messagesFor,MODEL,usageSummary,ReviewError} from './backend/review.mjs';
const p=validateInput({mode:'review',role:'buyer',language:'zh',source:'买方支付全部款项。',second:'',attachment:'',consent:true});
const output=()=>({scope:'supported',limitations:['未联网核验法规。'],coverage:Array.from({length:12},(_,cat)=>({cat,status:'reviewed',note:'已检查，需人工复核。'})),items:[{cat:2,type:'commercial',title:'全额预付',evidence:[{source:'source',quote:p.source}],impact:'可能影响履约保障。',confirm:'是否有退款保障？',direction:'协商付款节点。',proposedWording:'付款比例为【待确认】。'}]});
assert.throws(()=>validateInput({...p,consent:false}));
assert.throws(()=>validateInput({...p,source:'x'.repeat(20001)}));
assert.throws(()=>validateInput({...p,role:'invalid'}));
assert.throws(()=>validateInput({...p,mode:'compare',second:''}));
let out=output();assert.equal(validateOutput(out,p).items[0].evidence[0].start,0);
out.items[0].evidence[0].quote='不存在的条款';assert.throws(()=>validateOutput(out,p),/引文/);
out=output();out.coverage.pop();assert.throws(()=>validateOutput(out,p),/覆盖/);
out=output();out.items[0].evidence=[];assert.equal(validateOutput(out,p).items[0].quotes.length,0);
const cp=validateInput({...p,mode:'compare',second:'Buyer pays all amounts.'});
out=output();out.coverage=[];out.items[0].evidence=[{source:'second',quote:cp.second}];assert.equal(validateOutput(out,cp).items[0].evidence[0].source,'second');
let calls=0;
const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(init.body);assert.equal(body.model,MODEL);assert.equal(body.max_tokens,8192);assert.deepEqual(body.thinking,{type:'disabled'});assert(!Object.hasOwn(body,'reasoning_effort'));assert.equal(body.response_format.type,'json_object');assert.equal(body.messages.length,2);assert.equal(init.headers.Authorization,'Bearer fake-test-key');return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output()),reasoning_content:'DO NOT SEND'}}],usage:{prompt_tokens:10000,completion_tokens:5000}})}};
const report=await review(p,'fake-test-key',fetcher);assert.equal(report.usage.estimatedCny,.225);assert(!JSON.stringify(report).includes('DO NOT SEND'));assert.equal(calls,1);
await assert.rejects(()=>review(p,'fake',async()=>({ok:false,status:402})),/余额/);
await assert.rejects(()=>review(p,'fake',async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})})),/完整/);
await assert.rejects(()=>review(p,'fake',async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:''}}]})})),/正文/);
assert(messagesFor(p)[0].content.includes('不可信合同材料'));
console.log('PASS: input limits/consent, coverage, exact source citations, missing clauses, bilingual evidence, request schema, cost estimate, no reasoning leakage, and safe failure. All provider calls mocked; no money spent.');
const usage={prompt_tokens:10000,completion_tokens:8192,completion_tokens_details:{reasoning_tokens:7000}};
assert.equal(usageSummary(usage).reasoning,7000);assert.equal(usageSummary(usage).estimatedCny,.3112);
assert.equal(usageSummary({}),null);assert.equal(usageSummary({...usage,prompt_tokens:-1}),null);
assert.equal(usageSummary({...usage,completion_tokens_details:{reasoning_tokens:9000}}).reasoning,null);
for(const [finish,code] of [['length','OUTPUT_LIMIT'],['insufficient_system_resource','RESOURCE_INTERRUPTED'],['content_filter','CONTENT_FILTERED'],['tool_calls','UNEXPECTED_TOOL_CALL'],['secret-contract-text','UNKNOWN_FINISH']]){
 let attempts=0;
 await assert.rejects(()=>review(p,'fake-private-key',async()=>{attempts++;return {ok:true,json:async()=>({choices:[{finish_reason:finish,message:{content:'private contract',reasoning_content:'private reasoning'}}],usage})}}),e=>{
  assert(e instanceof ReviewError);assert.equal(e.diagnostics.code,code);assert.equal(e.diagnostics.thinking,'disabled');assert.equal(e.diagnostics.usage.output,8192);assert.equal(e.diagnostics.usage.reasoning,7000);
  assert(!JSON.stringify(e.diagnostics).includes('private'));assert(!JSON.stringify(e.diagnostics).includes('secret-contract-text'));return true;
 });assert.equal(attempts,1);
}
for(const [name,code] of [['TimeoutError','TIMEOUT'],['Error','NETWORK_ERROR']])await assert.rejects(()=>review(p,'fake',async()=>{const e=Error('sensitive low-level details');e.name=name;throw e}),e=>e.diagnostics.code===code&&e.diagnostics.usage===null&&!e.message.includes('sensitive'));
for(const [content,code] of [['','EMPTY_OUTPUT'],['{','INVALID_JSON'],['{}','VALIDATION_FAILED']])await assert.rejects(()=>review(p,'fake',async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content}}],usage})})),e=>e.diagnostics.code===code&&e.diagnostics.usage.output===8192);
console.log('PASS: distinct failure reasons, usage retained on every post-response failure, no double-counting reasoning, missing usage stays unknown, no sensitive diagnostics, no retries.');
out=output();out.items[0].risk='high';out.items[0].riskReason='重大资金风险，需先复核';assert.equal(validateOutput(out,p).items[0].risk,'high');
delete out.items[0].riskReason;assert.equal(validateOutput(out,p).items[0].risk,'unrated');
out.items[0].risk='urgent';assert.throws(()=>validateOutput(out,p),/风险等级/);
assert(messagesFor(p)[0].content.includes('不把所有缺失条款判高风险'));
console.log('PASS: substantiated risk grade, invalid grade rejected, absent rationale conservatively unrated.');
const invalidCases=[
 ['ROOT_TYPE','report',()=>null],
 ['SCOPE_VALUE','scope',()=>({...output(),scope:'supported 或 unsupported'})],
 ['COVERAGE_MISSING','coverage',()=>({...output(),coverage:output().coverage.slice(0,1)})],
 ['COVERAGE_DUPLICATE','coverage[1].cat',()=>{const x=output();x.coverage[1].cat=0;return x}],
 ['COVERAGE_ROW','coverage[0]',()=>{const x=output();x.coverage[0]=null;return x}],
 ['CATEGORY_VALUE','items[0].cat',()=>{const x=output();x.items[0].cat='2';return x}],
 ['ITEM_OBJECT','items[0]',()=>({...output(),items:[null]})],
 ['FIELD_EMPTY','items[0].confirm',()=>{const x=output();x.items[0].confirm='';return x}],
 ['FIELD_TYPE','items[0].direction',()=>{const x=output();x.items[0].direction=[];return x}],
 ['EVIDENCE_SOURCE','items[0].evidence[0].source',()=>{const x=output();x.items[0].evidence[0].source='second';return x}],
 ['QUOTE_MISMATCH','items[0].evidence[0].quote',()=>{const x=output();x.items[0].evidence[0].quote='PRIVATE-INVENTED-QUOTE';return x}]
];
for(const [code,field,make] of invalidCases){let calls=0;
 await assert.rejects(()=>review(p,'PRIVATE-KEY',async()=>{calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(make())}}],usage})}}),e=>{
  assert.equal(e.diagnostics.code,'VALIDATION_FAILED');assert.equal(e.diagnostics.validation.code,code);assert.equal(e.diagnostics.validation.field,field);
  assert.equal(e.diagnostics.usage.output,8192);assert(!JSON.stringify(e.diagnostics).includes('PRIVATE-'));return true;
 });assert.equal(calls,1);
}
const template=JSON.parse(messagesFor(p)[0].content.split('\n').find(line=>line.startsWith('{"scope"')));
assert.equal(validateOutput(template,p).coverage.length,12);
console.log('PASS: 11 precise validation cases, privacy-safe diagnostics, valid full-coverage prompt template, no retries.');
for(const language of ['zh','en'])for(const status of ['not applicable','N/A','已检查','unknown',null,{},undefined]){
 const x=output();x.coverage[7].status=status;
 const before=JSON.stringify(x);let calls=0;
 const result=await review({...p,language},'fake',async()=>{calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(x)}}],usage})}});
 assert.equal(calls,1);assert.equal(result.coverage[7].status,'insufficient');assert.equal(result.items.length,1);
 assert(result.limitations[0].includes(language==='en'?'manual confirmation':'待人工确认'));
 assert(result.coverage[7].note.includes(language==='en'?'unverified':'待复核'));assert.equal(JSON.stringify(x),before);
 x.items[0].evidence[0].quote='invented quote';assert.throws(()=>validateOutput(x,p),/引文/);
}
console.log('PASS: unknown coverage status conservatively downgraded with visible ZH/EN warnings; quotes remain strictly checked; no extra requests.');
