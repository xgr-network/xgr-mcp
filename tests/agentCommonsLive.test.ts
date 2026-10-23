import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentCommonsLive } from '../src/agentCommons/live.js';
import { decodeCommonsAttachment } from '../src/agentCommons/attachments.js';
import { AgentCommonsStore } from '../src/agentCommons/store.js';
test('nickname-only live chat, persistence, attachment, moderation', () => {
  const dir=mkdtempSync(join(tmpdir(),'commons-live-test-'));
  let live=new AgentCommonsLive(join(dir,'live.sqlite'));
  try {
    const alpha=live.join('Alpha','ip-a'), beta=live.join('Beta','ip-b');
    const attachment={filename:'note.txt',mimeType:'text/plain',base64:Buffer.from('hello from agent').toString('base64')};
    const one=live.post({chatToken:alpha.chatToken,message:'hello',attachment,clientMessageId:'abc',ip:'ip-a'});
    const again=live.post({chatToken:alpha.chatToken,message:'hello',attachment,clientMessageId:'abc',ip:'ip-a'});
    assert.equal(again.duplicate,true);
    assert.equal(one.messageId,again.messageId);
    assert.equal(live.file(one.messageId).bytes.toString(),'hello from agent');
    assert.equal(live.read().messages[0]?.attachment?.sizeBytes,16);
    live.post({chatToken:beta.chatToken,message:'reply',ip:'ip-b'});
    assert.equal(live.read(one.messageId).messages.length,1);
    live.close(); live=new AgentCommonsLive(join(dir,'live.sqlite'));
    assert.equal(live.read().messages.length,2);
    live.moderate(one.messageId,true);
    assert.equal(live.read().messages.length,1);
    assert.throws(()=>live.file(one.messageId));
    assert.equal(live.file(one.messageId,true).filename,'note.txt');
  } finally { live.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('1 MiB exact cap and reject larger uploads in both chat and mailbox', () => {
  const ok={filename:'binary.bin',base64:Buffer.alloc(1048576,1).toString('base64')};
  assert.equal(decodeCommonsAttachment(ok)?.bytes.length,1048576);
  assert.throws(()=>decodeCommonsAttachment({filename:'big.bin',base64:Buffer.alloc(1048577,1).toString('base64')}));
  const dir=mkdtempSync(join(tmpdir(),'commons-mailbox-test-'));
  const store=new AgentCommonsStore(join(dir,'mail.sqlite'));
  try {
    const a=store.register('Agent A','','mail-test');
    const post=store.post({token:a.agentToken,title:'Documentation',message:'Attached',attachment:{filename:'a.txt',base64:Buffer.from('abc').toString('base64')}});
    const msg=store.readTopic(post.topicId).messages[0];
    assert.equal(msg.attachment?.sizeBytes,3);
    assert.equal(store.file(msg.id).bytes.toString(),'abc');
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
