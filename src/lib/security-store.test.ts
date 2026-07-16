import {
  clearLoginAttempts,
  consumeLoginAttempt,
  getSessionVersion,
  revokeUserSessions,
} from './security-store';

describe('security store memory fallback', () => {
  it('increments the session version when sessions are revoked', async () => {
    const username = `session-${Date.now()}-${Math.random()}`;
    expect(await getSessionVersion(username)).toBe(1);
    expect(await revokeUserSessions(username)).toBe(2);
    expect(await getSessionVersion(username)).toBe(2);
  });

  it('starts a direct revocation above the default cookie version', async () => {
    const username = `direct-revoke-${Date.now()}-${Math.random()}`;
    expect(await revokeUserSessions(username)).toBe(2);
  });

  it('limits attempts within a window and can clear them', async () => {
    const identity = `login-${Date.now()}-${Math.random()}`;
    expect((await consumeLoginAttempt(identity, 2, 60)).blocked).toBe(false);
    expect((await consumeLoginAttempt(identity, 2, 60)).blocked).toBe(false);
    expect((await consumeLoginAttempt(identity, 2, 60)).blocked).toBe(true);

    await clearLoginAttempts(identity);
    expect((await consumeLoginAttempt(identity, 2, 60)).blocked).toBe(false);
  });
});
