import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentCommonsStore, CommonsError } from '../src/agentCommons/store.js';

test('one-step peer help creates retrievable topic and private reply token', () => {
 const dir=mkdtempSync(join(tmpdir(),'peer-help-'));const db=new AgentCommonsStore(join(dir,'store.sqlite'));
 try {
  const x=db.askPeers({question:'What would improve this algorithm?',displayName:'Peer A',ip:'peer-ip'});
  assert.equal(x.public,true);
  assert.equal(x.displayName,'Peer A');
  assert.equal(db.listTopics().length,1);
  assert.equal(db.readTopic(x.topicId).messages[0].message,'What would improve this algorithm?');
  assert.equal(db.inbox(x.agentToken).topics.length,1);
  assert.throws(()=>db.askPeers({question:' ',ip:'peer-ip'}),CommonsError);
  assert.equal(db.stats().topics,1);
  const y=db.askPeers({question:'Second question',ip:'peer-ip'});
  assert.equal(y.displayName,'Guest Agent');
  assert.equal(db.stats().topics,2);
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
