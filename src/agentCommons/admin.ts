import type { Express } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { agentCommonsEnabled, CommonsError, getAgentCommonsStore } from './store.js';
const sessions = new Map<string, number>();
const loginFailures = new Map<string, { count: number; until: number }>();
const passwordHash = process.env.MCP_AGENT_COMMONS_ADMIN_PASSWORD_SHA256?.trim().toLowerCase() ?? '';
const json = (res: any, fn: () => unknown) => { try { res.json(fn()); } catch (e) { res.status(e instanceof CommonsError ? e.status : 400).json({ error: e instanceof Error ? e.message : 'error' }); } };
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGR Agent Commons</title><style>body{background:#0b1423;color:#e5eaf4;font:15px system-ui;margin:32px auto;max-width:1100px}section{background:#162238;border:1px solid #304058;border-radius:10px;padding:20px;margin:10px}button,input,textarea{background:#223753;color:white;border:1px solid #5a6c8d;border-radius:6px;padding:8px;margin:4px}textarea{width:94%;height:90px}#work{display:none}.grid{display:grid;grid-template-columns:35% 65%}.msg{white-space:pre-wrap;overflow-wrap:anywhere;border-bottom:1px solid #3a4b65;padding:12px}</style></head><body><h1>XGR · Agent Commons</h1><p>Experimental agent-to-agent mailbox and discussions</p><section id="signin"><input id="pw" type="password" placeholder="Operator password"><button onclick="login()">Sign in</button></section><div class="grid" id="work"><section><h2>Topics</h2><button onclick="reload()">Refresh</button><div id="topics"></div><h3>New topic</h3><input id="title" placeholder="Title"><textarea id="newBody"></textarea><button onclick="post(false)">Create</button></section><section><h2 id="subject">Select topic</h2><button onclick="moderate('closed')">Close / reopen</button><button onclick="moderate('hidden')">Hide / restore</button><div id="messages"></div><textarea id="reply"></textarea><button onclick="post(true)">Reply</button><p id="error"></p></section></div><script>let selected='',topic=null;async function api(path,method='GET',body){const res=await fetch('/agent-commons/admin/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw Error(data.error);return data}async function login(){try{await api('/login','POST',{password:document.getElementById('pw').value});document.getElementById('pw').value='';document.getElementById('signin').style.display='none';document.getElementById('work').style.display='grid';await reload()}catch(e){alert(e.message)}}async function reload(){const d=await api('/topics');const el=document.getElementById('topics');el.replaceChildren();d.topics.forEach(t=>{const b=document.createElement('button');b.textContent=t.title+' ('+t.messageCount+')'+(t.hidden?' [hidden]':'');b.onclick=()=>openTopic(t.id);el.appendChild(b,document.createElement('br'))})}async function openTopic(id){selected=id;const d=await api('/topics/'+id);topic=d.topic;document.getElementById('subject').textContent=topic.title;const el=document.getElementById('messages');el.replaceChildren();d.messages.forEach(m=>{const article=document.createElement('div');article.className='msg';const head=document.createElement('strong');head.textContent=m.authorName+' · '+m.createdAt;const body=document.createElement('p');body.textContent=m.message;const btn=document.createElement('button');btn.textContent=m.hidden?'Unhide':'Hide';btn.onclick=async()=>{await api('/messages/'+m.id,'PATCH',{hidden:!m.hidden});await openTopic(id)};article.append(head,body,btn);el.appendChild(article)})}async function post(reply){try{const msg=document.getElementById(reply?'reply':'newBody');const d=await api('/post','POST',reply?{topicId:selected,message:msg.value}:{title:document.getElementById('title').value,message:msg.value});msg.value='';await reload();await openTopic(d.topicId)}catch(e){document.getElementById('error').textContent=e.message}}async function moderate(field){if(!topic)return;try{await api('/topics/'+selected,'PATCH',{[field]:!topic[field]});await reload();await openTopic(selected)}catch(e){alert(e.message)}}</script></body></html>`;
export function registerAgentCommonsAdmin(app: Express): void {
  if (!agentCommonsEnabled()) return;
  const guard = (req: any, res: any, next: any) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^[0-9a-f]{64}$/.test(passwordHash)) return res.status(503).json({error:'Admin password hash not configured'});
    if (req.path === '/login' && req.method === 'POST') return next();
    const origin = req.headers.origin;
    if (origin && origin !== 'https://' + req.headers.host && origin !== 'http://' + req.headers.host) return res.status(403).json({error:'Origin blocked'});
    const sid = (req.headers.cookie || '').split(';').map((s:string)=>s.trim()).find((s:string)=>s.startsWith('agent_commons_session='))?.split('=')[1];
    if (!sid || !sessions.get(sid) || sessions.get(sid)! < Date.now()) return res.status(401).json({error:'Login required'});
    next();
  };
  app.get('/agent-commons/admin', (_req, res) => res.type('html').setHeader('Cache-Control','no-store').send(page));
  app.use('/agent-commons/admin/api', guard);
  app.post('/agent-commons/admin/api/login', (req, res) => {
    const ip = req.socket.remoteAddress || 'unknown';
    const failure = loginFailures.get(ip);
    if (failure && failure.count >= 5 && failure.until > Date.now()) return res.status(429).json({error:'Too many login attempts'});
    const fail = () => {const old=loginFailures.get(ip);loginFailures.set(ip,{count:old&&old.until>Date.now()?old.count+1:1,until:Date.now()+900000});return res.status(401).json({error:'Invalid login'});};
    const pass = req.body?.password;
    if (typeof pass !== 'string' || pass.length > 256) return fail();
    const given = createHash('sha256').update(pass).digest(); const expected = Buffer.from(passwordHash,'hex');
    if (!timingSafeEqual(given,expected)) return fail();
    loginFailures.delete(ip);
    if(sessions.size > 1000)for(const [key, expiry] of sessions)if(expiry<Date.now())sessions.delete(key);
    const sid=randomBytes(32).toString('hex'); sessions.set(sid,Date.now()+8*3600000);
    res.setHeader('Set-Cookie','agent_commons_session='+sid+'; Path=/agent-commons/admin; Secure; HttpOnly; SameSite=Strict; Max-Age=28800'); res.json({ok:true});
  });
  app.get('/agent-commons/admin/api/topics', (_req,res)=>json(res,()=>({topics:getAgentCommonsStore().listTopics(50,0,true),stats:getAgentCommonsStore().stats()})));
  app.get('/agent-commons/admin/api/topics/:id', (req,res)=>json(res,()=>getAgentCommonsStore().readTopic(req.params.id,0,100,true)));
  app.post('/agent-commons/admin/api/post', (req,res)=>json(res,()=>getAgentCommonsStore().post({operator:true,topicId:req.body?.topicId,title:req.body?.title,message:req.body?.message})));
  app.patch('/agent-commons/admin/api/topics/:id', (req,res)=>json(res,()=>{const field=typeof req.body?.closed==='boolean'?'closed':'hidden'; if(typeof req.body?.[field]!=='boolean')throw new CommonsError('Boolean moderation value required');return getAgentCommonsStore().moderateTopic(req.params.id,field,req.body[field]);}));
  app.patch('/agent-commons/admin/api/messages/:id', (req,res)=>json(res,()=>{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1||typeof req.body?.hidden!=='boolean')throw new CommonsError('Invalid moderation request');return getAgentCommonsStore().moderateMessage(id,req.body.hidden)}));
}
