import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentCommonsLive } from '../src/agentCommons/live.js';
import { AgentCommonsStore, CommonsError } from '../src/agentCommons/store.js';

test('rolling character and upload quotas apply to chat and mailbox', () => {
 const dir=mkdtempSync(join(tmpdir(),'commons-quota-'));
 const previous={...process.env};
 process.env.MCP_AGENT_COMMONS_CHARS_PER_WINDOW='12';
 process.env.MCP_AGENT_COMMONS_CHARS_PER_IP_WINDOW='20';
 process.env.MCP_AGENT_COMMONS_UPLOADS_PER_HOUR='1';
 process.env.MCP_AGENT_COMMONS_UPLOADS_PER_DAY='2';
 process.env.MCP_AGENT_COMMONS_UPLOADS_PER_IP_HOUR='2';
 process.env.MCP_AGENT_COMMONS_UPLOADS_GLOBAL_PER_DAY='3';
 let live: AgentCommonsLive | undefined;
 let board: AgentCommonsStore | undefined;
 try {
  live=new AgentCommonsLive(join(dir,'live.sqlite'));
  board=new AgentCommonsStore(join(dir,'board.sqlite'));
  const a=live.join('Alice','qa-a');
  const file={filename:'a.txt',base64:Buffer.from('abc').toString('base64')};
  const first=live.post({chatToken:a.chatToken,message:'12345678',attachment:file,clientMessageId:'m1',ip:'qa-a'});
  assert.equal(live.post({chatToken:a.chatToken,message:'12345678',attachment:file,clientMessageId:'m1',ip:'qa-a'}).messageId,first.messageId);
  assert.throws(()=>live!.post({chatToken:a.chatToken,message:'12345',ip:'qa-a'}), (e:unknown)=>e instanceof CommonsError && e.status===429);
  assert.throws(()=>live!.post({chatToken:a.chatToken,message:'ok',attachment:file,ip:'qa-a'}), (e:unknown)=>e instanceof CommonsError && e.status===429);
  live.post({chatToken:a.chatToken,message:'1234',ip:'qa-a'});
  assert.equal(live.read().messages.length,2);
  const b=board.register('Bob','','qa-b');
  const topic=board.post({token:b.agentToken,title:'A',message:'12345678',attachment:file,clientMessageId:'p1',ip:'qa-b'});
  assert.equal(board.post({token:b.agentToken,title:'A',message:'12345678',attachment:file,clientMessageId:'p1',ip:'qa-b'}).messageId,topic.messageId);
  assert.throws(()=>board!.post({token:b.agentToken,topicId:topic.topicId,message:'1234',ip:'qa-b'}), (e:unknown)=>e instanceof CommonsError&&e.status===429);
  assert.throws(()=>board!.post({token:b.agentToken,topicId:topic.topicId,message:'x',attachment:file,ip:'qa-b'}), (e:unknown)=>e instanceof CommonsError&&e.status===429);
  assert.equal(board.readTopic(topic.topicId).messages.length,1);
 } finally {
  live?.close();board?.close();
  for(const key of Object.keys(process.env)) if(!(key in previous))delete process.env[key];
  for(const [key,val] of Object.entries(previous))if(val!==undefined)process.env[key]=val;
  rmSync(dir,{recursive:true,force:true});
 }
});
