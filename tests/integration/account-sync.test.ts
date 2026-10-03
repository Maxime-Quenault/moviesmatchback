import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

// Never send test emails or destructive account requests to a remote project.
const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1';
describe.skipIf(!enabled)('Local Supabase account and sync lifecycle', () => {
  it('verifies email, isolates accounts, persists deletions, recovers passwords and deletes accounts', async () => {
    const url = process.env.SUPABASE_API_URL ?? process.env.SUPABASE_URL ?? '';
    if (!/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(url)) {
      throw new Error('Integration tests require the isolated local Supabase stack');
    }
    const app = await buildApp();
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const ids: string[] = [];
    const received = new Set<string>();
    const password = 'Password123';
    const nonce = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const call = (path: string, payload?: unknown, token?: string) => app.inject({
      method: payload === undefined ? 'GET' : 'POST', url: path,
      ...(payload === undefined ? {} : { payload }),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    async function emailCode(email: string): Promise<string> {
      const mailbox = encodeURIComponent(email.split('@')[0]!);
      for (let attempt = 0; attempt < 80; attempt++) {
        const list = await fetch(`http://127.0.0.1:54324/api/v1/mailbox/${mailbox}`);
        const messages = await list.json() as { id: string }[];
        for (const message of messages) {
          if (received.has(`${mailbox}/${message.id}`)) continue;
          const response = await fetch(`http://127.0.0.1:54324/api/v1/mailbox/${mailbox}/${message.id}`);
          const mail = await response.json() as { body: { text?: string; html?: string } };
          const text = `${mail.body.text ?? ''} ${mail.body.html ?? ''}`.replace(/<[^>]*>/g, ' ');
          const code = text.match(/\b(\d{6})\b/)?.[1];
          if (code) { received.add(`${mailbox}/${message.id}`); return code; }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('No local verification email received');
    }
    async function signup(name: string) {
      const email = `${name}-${nonce}@example.test`;
      const response = await call('/v1/auth/signup', { email, password, preferredGenres: ['Action', 'Drame', 'Thriller'] });
      expect(response.statusCode).toBe(201);
      expect(response.json().confirmationRequired).toBe(true);
      const signin = await call('/v1/auth/signin', { email, password });
      expect(signin.statusCode).toBe(403);
      const verified = await call('/v1/auth/verify-email', { email, token: await emailCode(email) });
      expect(verified.statusCode).toBe(200);
      const data = verified.json();
      ids.push(data.user.id);
      return { email, id: data.user.id as string, token: data.session.accessToken as string };
    }
    try {
      const alice = await signup('alice');
      const bob = await signup('bob');
      const mutationId = '30000000-0000-0000-0000-000000000001';
      const item = { mediaKey: 'tmdb:movie:1', action: 'rejected', mutationId, updatedAt: new Date(Date.now() - 5000).toISOString() };
      const added = await call('/v1/me/media-actions/sync', { items: [item] }, alice.token);
      expect(added.statusCode).toBe(200);
      expect(added.json().items).toHaveLength(1);
      const own = createClient(url, process.env.SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${bob.token}` } }, auth: { persistSession: false } });
      const otherRows = await own.from('user_title_actions').select('*').eq('user_id', alice.id);
      expect(otherRows.error).toBeNull();
      expect(otherRows.data).toEqual([]);
      const deleted = await call('/v1/me/media-actions/sync', { items: [{
        mediaKey: item.mediaKey, deleted: true, mutationId: '30000000-0000-0000-0000-000000000002', updatedAt: new Date(Date.now() - 1000).toISOString(),
      }] }, alice.token);
      expect(deleted.json().items[0].deletedAt).toBeTruthy();
      const stale = await call('/v1/me/media-actions/sync', { items: [item] }, alice.token);
      expect(stale.json().items[0].deletedAt).toBeTruthy();
      expect((await call('/v1/me/media-actions', undefined, alice.token)).json().items).toEqual([]);
      expect((await call('/v1/me/media-actions', undefined, bob.token)).json().items).toEqual([]);
      expect((await call('/v1/auth/logout', {}, alice.token)).statusCode).toBe(200);
      await call('/v1/auth/forgot-password', { email: alice.email });
      const newPassword = 'NewPassword456';
      expect((await call('/v1/auth/reset-password', { email: alice.email, token: await emailCode(alice.email), password: newPassword })).statusCode).toBe(200);
      expect((await call('/v1/auth/signin', { email: alice.email, password })).statusCode).toBe(401);
      const newSession = await call('/v1/auth/signin', { email: alice.email, password: newPassword });
      expect(newSession.statusCode).toBe(200);
      expect((await call('/v1/auth/delete-account', { password: newPassword }, newSession.json().session.accessToken)).statusCode).toBe(200);
      const profile = await admin.from('profiles').select('*').eq('id', alice.id);
      expect(profile.data).toEqual([]);
    } finally {
      for (const id of ids) await admin.auth.admin.deleteUser(id);
      await app.close();
    }
  }, 60000);
});
