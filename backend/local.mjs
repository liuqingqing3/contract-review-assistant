import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {validateInput,review,ReviewError} from './review.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const runtime=join(root,'.private');mkdirSync(runtime,{recursive:true,mode:0o700});
// Exclusive lock deliberately fails closed after a crash. Do not run several copies against one budget.
const lock=join(runtime,'server.lock');
let lockFd;try{lockFd=openSync(lock,'wx',0o600);}catch{console.error('已有服务运行，或上次异常退出。请先确认旧服务已停止，再处理 .private/server.lock。');process.exit(1);}
const cleanup=()=>{try{closeSync(lockFd);unlinkSync(lock);}catch{}};
process.on('exit',cleanup);for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>process.exit(0));
const ledger=join(runtime,'attempts.json');
let attempts=0;if(existsSync(ledger)){try{attempts=JSON.parse(readFileSync(ledger,'utf8')).attempts;if(!Number.isInteger(attempts)||attempts<0)throw Error();}catch{console.error('次数记录异常，已停止以保护预算。');process.exit(1);}}
let apiKey='',busy=false,lastAttempt=0;
const token=randomBytes(32).toString('hex'),port=4317,host='127.0.0.1:'+port,origin='http://'+host;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"};
function send(res,status,data,type='application/json'){res.writeHead(status,{...headers,'Content-Type':type+'; charset=utf-8'});res.end(type==='application/json'?JSON.stringify(data):data);}
async function readBody(req){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>150000)throw Error('请求内容过大。');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('请求格式不正确。');}}
const server=http.createServer(async(req,res)=>{
 if(req.headers.host!==host)return send(res,403,{error:'只允许本机访问。'});
 try{
  if(req.method==='GET'&&['/','/index.html','/setup'].includes(req.url)){
   const file=req.url==='/setup'?'setup.html':'v3.html';
   return send(res,200,readFileSync(join(root,'public',file),'utf8').replace('<!--LOCAL_CONFIG-->','<script>window.CONTRACT_LOCAL='+JSON.stringify({token})+';</script>'),'text/html');
  }
  if(req.method==='GET'&&req.url==='/api/status')return send(res,200,{configured:!!apiKey,remaining:Math.max(0,20-attempts),busy,model:'deepseek-v4-pro'});
  if(req.method!=='POST'||!['/api/config','/api/review'].includes(req.url))return send(res,404,{error:'Not found'});
  if(req.headers.origin!==origin||req.headers['x-contract-token']!==token||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'请求来源未通过验证，请重新打开本地页面。'});
  const data=await readBody(req);
  if(req.url==='/api/config'){
   if(busy)return send(res,409,{error:'审查期间不能更换密钥。'});
   if(typeof data.key!=='string'||!/^sk-[A-Za-z0-9_-]{10,200}$/.test(data.key.trim()))return send(res,400,{error:'密钥格式不正确，请核对；不要发送给他人。'});
   apiKey=data.key.trim();return send(res,200,{ok:true});
  }
  if(!apiKey)return send(res,503,{error:'请先在本地配置页填写密钥。'});
  const p=validateInput(data);
  if(busy||Date.now()-lastAttempt<10000)return send(res,429,{error:'请等待当前审查完成，且两次请求至少间隔10秒。'});
  if(attempts>=20)return send(res,429,{error:'本阶段20次尝试已用完。请先核对平台账单，再决定是否增加额度。'});
  // Reserve before transmission. Failed/uncertain attempts remain counted; no automatic retry.
  writeFileSync(ledger,JSON.stringify({attempts:attempts+1}),{mode:0o600});attempts++;busy=true;lastAttempt=Date.now();
  try{return send(res,200,{report:await review(p,apiKey),remaining:20-attempts});}
  catch(e){const known=e instanceof ReviewError;return send(res,502,{error:known?e.message:'审查过程中出现异常，本次未生成报告；是否计费尚不确定。',diagnostics:known?e.diagnostics:{code:'INTERNAL_ERROR',usage:null,finishReason:null},remaining:20-attempts});}
  finally{busy=false;}
 }catch(e){return send(res,400,{error:e.message==='请求内容过大。'?e.message:'请求或本地记录处理失败，未继续调用模型。'});}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'本地端口已被占用，请检查是否已打开另一份程序。':'本地服务未能启动（'+e.code+'），当前运行环境可能限制本地网络服务。');process.exit(1);});
server.listen(port,'127.0.0.1',()=>console.log('合同审查助手已启动：'+origin+'\n密钥配置：'+origin+'/setup\n关闭此窗口将停止服务并清除内存中的密钥。'));
