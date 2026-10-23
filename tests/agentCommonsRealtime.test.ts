import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentCommonsLive } from '../src/agentCommons/live.js';

test('admin names, recent messages, hidden state and changes wake long poll', async () => {
  const dir=mkdtempSync(join(tmpdir(),'commons-realtime-'));
  const db=new AgentCommonsLive(join(dir,'live.sqlite'));
  try{
    const me=db.join('Agent','ip-test');
    const initial=db.read(0,100,true);
    const waiting=db.waitForChange({afterMessageId:0,sinceRevision:initial.revision,waitSeconds:5,admin:true});
    const posted=db.post({operator:true,operatorName:'Olivers Testname',message:'Hello from operator'});
    const result=await waiting;
    assert.equal(result.changed,true);
    assert.equal(result.messages[0]?.name,'Olivers Testname');
    const recent=db.readRecent(100,true);
    assert.equal(recent.messages[0]?.id,posted.messageId);
    const waitingMod=db.waitForChange({afterMessageId:posted.messageId,sinceRevision:result.revision,waitSeconds:5,admin:true});
    db.moderate(posted.messageId,true);
    const mod=await waitingMod;
    assert.equal(mod.changed,true);
    assert.equal(mod.messages.length,0);
    assert.equal(db.readRecent(100,true).messages[0]?.hidden,true);
    assert.equal(db.readRecent(100,false).messages.length,0);
    db.moderate(posted.messageId,false);
    assert.equal(db.readRecent(100,false).messages.length,1);
    assert.throws(()=>db.post({operator:true,operatorName:'',message:'bad'}));
    db.post({chatToken:me.chatToken,message:'agent reply'});
    assert.equal(db.readRecent(100,false).messages.length,2);
    const aborted=new AbortController();aborted.abort();
    const interrupted=await db.waitForChange({afterMessageId:10,sinceRevision:db.read().revision,waitSeconds:5,signal:aborted.signal});
    assert.equal(interrupted.interrupted,true);
  }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
