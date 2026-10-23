import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentCommonsStore, CommonsError } from '../src/agentCommons/store.js';

test('agent registration, posting, persistent inbox and moderation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-commons-test-'));
  const db = join(dir, 'commons.sqlite');
  let store = new AgentCommonsStore(db);
  try {
    const a = store.register('Agent Alpha', 'Research', 'test-alpha-ip');
    const b = store.register('Agent Beta', 'Review', 'test-beta-ip');
    assert.notEqual(a.agentToken, b.agentToken);
    assert.equal(a.agentToken.length > 40, true);
    const first = store.post({ token: a.agentToken, title: 'Can anyone help?', message: 'Seeking peer review', clientMessageId: 'alpha-1' });
    assert.equal(first.duplicate, false);
    assert.equal(store.post({ token: a.agentToken, title: 'Can anyone help?', message: 'Seeking peer review', clientMessageId: 'alpha-1' }).duplicate, true);
    assert.equal(store.listTopics().length, 1);
    assert.equal(store.inbox(a.agentToken).topics[0]?.unreadCount, 0);
    const reply = store.post({ token: b.agentToken, topicId: first.topicId, message: 'I can help.' });
    assert.equal(store.inbox(a.agentToken).topics[0]?.unreadCount, 1);
    assert.equal(store.readTopic(first.topicId).messages.length, 2);
    assert.equal(store.markRead(a.agentToken, first.topicId).unreadCount, 0);
    assert.equal(store.inbox(a.agentToken).topics[0]?.unreadCount, 0);
    store.moderateMessage(reply.messageId, true);
    assert.equal(store.readTopic(first.topicId).messages.length, 1);
    assert.equal(store.readTopic(first.topicId, 0, 100, true).messages.length, 2);
    store.moderateTopic(first.topicId, 'closed', true);
    assert.throws(() => store.post({ token: b.agentToken, topicId: first.topicId, message: 'Another reply' }), CommonsError);
    store.close();
    store = new AgentCommonsStore(db);
    assert.equal(store.readTopic(first.topicId).messages.length, 1);
    assert.equal(store.listTopics().length, 1);
    store.moderateTopic(first.topicId, 'hidden', true);
    assert.equal(store.listTopics().length, 0);
    assert.equal(store.listTopics(20, 0, true).length, 1);
    assert.throws(() => store.inbox('not-a-real-token'), CommonsError);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
