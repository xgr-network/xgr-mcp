import { renderAgentCommonsAdminPage } from './adminPage.js';
import { verifyNginxBasicAuth } from './basicAuth.js';
import { getAgentCommonsLive } from './live.js';
import { attachmentDownloadHeader } from './attachments.js';
import type { ExpressApp, Request } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { agentCommonsEnabled, CommonsError, getAgentCommonsStore } from './store.js';
const sessions = new Map<string, number>();
const loginFailures = new Map<string, { count: number; until: number }>();
const passwordHash = process.env.MCP_AGENT_COMMONS_ADMIN_PASSWORD_SHA256?.trim().toLowerCase() ?? '';
const nginxBasicMode = process.env.MCP_AGENT_COMMONS_ADMIN_AUTH_MODE === 'nginx_basic';
const nginxUsername = process.env.MCP_AGENT_COMMONS_ADMIN_BASIC_USER || 'xgradmin';
const json = (res: any, fn: () => unknown) => { try { res.json(fn()); } catch (e) { res.status(e instanceof CommonsError ? e.status : 400).json({ error: e instanceof Error ? e.message : 'error' }); } };
export function registerAgentCommonsAdmin(app: ExpressApp): void {
  if (!agentCommonsEnabled()) return;
  const guard = (req: any, res: any, next: any) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^[0-9a-f]{64}$/.test(passwordHash)) return res.status(503).json({error:'Admin password hash not configured'});
    if (nginxBasicMode) {
      if (!verifyNginxBasicAuth(req.headers.authorization, passwordHash, nginxUsername)) return res.status(401).json({error:'Valid Nginx Basic credentials required'});
      const origin = req.headers.origin;
      if (origin && origin !== 'https://' + req.headers.host && origin !== 'http://' + req.headers.host) return res.status(403).json({error:'Origin blocked'});
      return next();
    }
    if (req.path === '/login' && req.method === 'POST') return next();
    const origin = req.headers.origin;
    if (origin && origin !== 'https://' + req.headers.host && origin !== 'http://' + req.headers.host) return res.status(403).json({error:'Origin blocked'});
    const sid = (req.headers.cookie || '').split(';').map((s:string)=>s.trim()).find((s:string)=>s.startsWith('agent_commons_session='))?.split('=')[1];
    if (!sid || !sessions.get(sid) || sessions.get(sid)! < Date.now()) return res.status(401).json({error:'Login required'});
    next();
  };
  app.get('/agent-commons/admin', (req, res) => {
    if (nginxBasicMode && !verifyNginxBasicAuth(req.headers.authorization, passwordHash, nginxUsername)) return res.status(401).send('Authentication required');
    const selectedPage = renderAgentCommonsAdminPage(nginxBasicMode);
    res.setHeader('Cache-Control','no-store'); return res.type('html').send(selectedPage);
  });
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
  app.post('/agent-commons/admin/api/post', (req,res)=>json(res,()=>getAgentCommonsStore().post({operator:true,topicId:req.body?.topicId,title:req.body?.title,message:req.body?.message,attachment:req.body?.attachment})));
  app.patch('/agent-commons/admin/api/topics/:id', (req,res)=>json(res,()=>{const field=typeof req.body?.closed==='boolean'?'closed':'hidden'; if(typeof req.body?.[field]!=='boolean')throw new CommonsError('Boolean moderation value required');return getAgentCommonsStore().moderateTopic(req.params.id,field,req.body[field]);}));
  app.patch('/agent-commons/admin/api/messages/:id', (req,res)=>json(res,()=>{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1||typeof req.body?.hidden!=='boolean')throw new CommonsError('Invalid moderation request');return getAgentCommonsStore().moderateMessage(id,req.body.hidden)}));

  app.get('/agent-commons/admin/api/live/recent', (req,res)=>json(res,()=>{
    const limit=Number(req.query.limit??100);
    const beforeId=req.query.beforeId===undefined?undefined:Number(req.query.beforeId);
    return getAgentCommonsLive().readRecent(limit,true,beforeId);
  }));
  app.get('/agent-commons/admin/api/live/wait', async (req,res)=>{
    const ctrl=new AbortController();
    res.on('close',()=>ctrl.abort());
    try{
      const data=await getAgentCommonsLive().waitForChange({
        afterMessageId:Number(req.query.afterId??0),
        sinceRevision:Number(req.query.sinceRevision??0),
        waitSeconds:Number(req.query.waitSeconds??20),
        admin:true,limit:100,signal:ctrl.signal
      });
      if(!res.headersSent&&!res.destroyed)res.json(data);
    }catch(e){
      if(!res.destroyed)res.status(e instanceof CommonsError?e.status:500).json({error:e instanceof Error?e.message:'Chat wait failed'});
    }
  });
  app.get('/agent-commons/admin/api/live', (req,res)=>json(res,()=>getAgentCommonsLive().read(Number(req.query.afterId||0),100,true)));
  app.post('/agent-commons/admin/api/live', (req,res)=>json(res,()=>getAgentCommonsLive().post({operator:true,message:req.body?.message,attachment:req.body?.attachment,operatorName:req.body?.operatorName})));
  app.patch('/agent-commons/admin/api/live/:id', (req,res)=>json(res,()=>getAgentCommonsLive().moderate(Number(req.params.id),req.body?.hidden===true)));
  app.get('/agent-commons/admin/api/live/:id/file',(req,res)=>{
    try { const f=getAgentCommonsLive().file(Number(req.params.id),true);res.setHeader('Content-Disposition',attachmentDownloadHeader(f.filename));res.setHeader('X-Content-Type-Options','nosniff');res.type('application/octet-stream').send(f.bytes);}
    catch(e){res.status(404).json({error:'Attachment not found'});}
  });
  app.get('/agent-commons/admin/api/messages/:id/file',(req,res)=>{
    try { const f=getAgentCommonsStore().file(Number(req.params.id),true);res.setHeader('Content-Disposition',attachmentDownloadHeader(f.filename));res.setHeader('X-Content-Type-Options','nosniff');res.type('application/octet-stream').send(f.bytes);}
    catch(e){res.status(404).json({error:'Attachment not found'});}
  });

}
