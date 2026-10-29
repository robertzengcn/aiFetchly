import { e2eTest as test, expect } from '../fixtures/base';

test('workspace email card remains above composer and sends only after approval', async ({ aiApp }) => {
  await aiApp.mainWindow.getByTestId('workspace-new-chat').click();
  await expect(aiApp.mainWindow.getByTestId('ai-chat-composer')).toBeVisible();
  // Controlled delivery ports: this UI journey must never send real email.
  await aiApp.electronApp.evaluate(({ ipcMain }) => {
    let sent = false;
    for (const channel of ['email:reply:draft:detail', 'email:reply:draft:approve', 'email:reply:send']) ipcMain.removeHandler(channel);
    ipcMain.handle('email:reply:draft:detail', () => ({ status: true, data: {
      id: 42, status: sent ? 'sent' : 'draft', currentRevisionId: 1,
      recipientAddress: 'customer@example.com', subject: 'Review this reply',
      bodyText: Array.from({ length: 30 }, (_, i) => `Reply line ${i}`).join('\n'), requiresHumanReview: false,
    } }));
    ipcMain.handle('email:reply:draft:approve', () => ({ status: true, data: { token: 'ui-test-token', revisionId: 1 } }));
    ipcMain.handle('email:reply:send', (_event, raw: unknown) => {
      const input = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { approvalToken?: string };
      if (input.approvalToken !== 'ui-test-token') throw new Error('Approval required');
      sent = true;
      return { status: true, data: { status: 'sent', attemptId: 1, sentAt: '', requestCorrelationId: 'ui-test' } };
    });
  });
  await aiApp.mainWindow.evaluate(() => {
    type Store = { messages: Array<Record<string, unknown>> };
    const app = document.querySelector('#app') as Element & { __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, Store> } } } } };
    const store = app.__vue_app__.config.globalProperties.$pinia._s.get('selectedConversation');
    if (!store) throw new Error('Selected conversation store missing');
    store.messages.push({ id: 'email-review-test', role: 'assistant', content: '', messageType: 'tool_result', conversationId: 'test', metadata: { toolName: 'create_email_reply_draft', toolCallId: 'reply-test', toolResult: { operationStatus: 'success', draftId: 42 } } });
  });
  const card = aiApp.mainWindow.getByTestId('email-reply-review');
  await expect(card).toContainText('customer@example.com');
  const approve = card.getByRole('button', { name: 'Approve and send' });
  await approve.scrollIntoViewIfNeeded();
  const buttonBox = await approve.boundingBox();
  const stripBox = await aiApp.mainWindow.getByTestId('chat-workspace-strip').boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(stripBox).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(stripBox!.y);
  await approve.click();
  await expect(card).toContainText('Email sent');
  await expect(approve).toHaveCount(0);
});
