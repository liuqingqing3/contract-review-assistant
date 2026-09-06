const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const {validateInput,ReviewError}=await import('./backend/review.mjs');
 const files=new Map(),listeners={};let handler,calls=0,now=100000;
 const context={http:{createServer(fn){handler=fn;return {on(){},listen(){}}}},
  readFileSync(p){if(files.has(p))return files.get(p);return '<!--LOCAL_CONFIG-->'},
  writeFileSync(p,s){files.set(p,s)},mkdirSync(){},existsSync:p=>files.has(p),
  openSync(p){if(files.has(p))throw Error('locked');files.set(p,'lock');return 1},closeSync(){},unlinkSync:p=>files.delete(p),
  dirname:path.dirname,join:path.join,fileURLToPath:()=>'/test/backend/local.mjs',randomBytes:()=>({toString:()=> 'csrf-token'}),
  process:{on(n,fn){listeners[n]=fn},exit(){throw Error('EXIT')}},console,Buffer,
  Date:{now:()=>now},validateInput,ReviewError,review:async()=>{calls++;if(calls===1)throw new ReviewError('OUTPUT_LIMIT','报告未完整生成。',{usage:{input:10,output:8192,reasoning:7000,estimatedCny:.2213},finishReason:'length'});return {kind:'ai'}}};
 let src=fs.readFileSync('backend/local.mjs','utf8').replace(/^import .*;\n/gm,'').replace('import.meta.url','"test"');
 const boot=()=>vm.runInNewContext(src,{...context});boot();
 async function request(url,body,extra={}){
  let result;const req={method:'POST',url,headers:{host:'127.0.0.1:4317',origin:'http://127.0.0.1:4317','x-contract-token':'csrf-token','content-type':'application/json',...extra},async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(body))}};
  const res={writeHead(status,headers){result={status,headers}},end(s){result.data=JSON.parse(s)}};
  await handler(req,res);return result;
 }
 const p={mode:'review',role:'buyer',language:'zh',source:'合同',second:'',attachment:'',consent:true};
 assert.equal((await request('/api/review',p)).status,503);
 assert.equal((await request('/api/config',{key:'sk-test-123456789'},{host:'evil.com'})).status,403);
 assert.equal((await request('/api/config',{key:'sk-test-123456789'},{origin:'https://evil.com'})).status,403);
 assert.equal((await request('/api/config',{key:'sk-test-123456789'},{'x-contract-token':'wrong'})).status,403);
 assert.equal((await request('/api/config',{key:'sk-test-123456789'})).status,200);assert.equal(calls,0);
 assert.equal((await request('/api/review',{...p,consent:false})).status,400);assert.equal(calls,0);
 const failed=await request('/api/review',p);assert.equal(failed.status,502);assert.equal(failed.data.diagnostics.code,'OUTPUT_LIMIT');assert.equal(failed.data.diagnostics.usage.reasoning,7000);assert.equal(failed.data.remaining,19);assert.equal(calls,1);
 assert.equal((await request('/api/review',p)).status,429);
 for(let i=1;i<20;i++){now+=11000;assert.equal((await request('/api/review',p)).status,200);}
 now+=11000;assert.equal((await request('/api/review',p)).status,429);assert.equal(calls,20);
 assert(!Array.from(files.values()).join('').includes('sk-test'));
 listeners.exit();boot();assert.equal((await request('/api/review',p)).status,503);
 await request('/api/config',{key:'sk-test-123456789'});now+=11000;
 assert.equal((await request('/api/review',p)).status,429);assert.equal(calls,20);
 console.log('PASS: loopback host, same-origin/CSRF, memory-only key, configuration without paid calls, consent, interval and persistent 20-attempt limit after restart. HTTP/files mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
