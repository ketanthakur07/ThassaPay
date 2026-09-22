import { storage } from '../src/services/storage';

describe('Storage Service & Session Handling', () => {
  beforeEach(async () => {
    await storage.clear();
  });

  it('should store and retrieve access token', async () => {
    expect(await storage.getAccessToken()).toBeNull();
    await storage.setAccessToken('sample_jwt_token_999');
    expect(await storage.getAccessToken()).toBe('sample_jwt_token_999');
  });

  it('should store and retrieve user session data', async () => {
    const user = {
      id: 'usr_1',
      name: 'Hosteller Ketan',
      hostelBlock: 'Block A',
      roomNo: '402',
    };
    await storage.setUserSession(user);
    const session = await storage.getUserSession();
    expect(session).toEqual(user);
  });

  it('should clear all session tokens upon logout', async () => {
    await storage.setAccessToken('token_to_remove');
    await storage.setUserSession({ name: 'Ketan' });

    await storage.removeAccessToken();
    await storage.removeUserSession();

    expect(await storage.getAccessToken()).toBeNull();
    expect(await storage.getUserSession()).toBeNull();
  });
});
