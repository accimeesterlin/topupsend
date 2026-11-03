/**
 * @jest-environment node
 */
import mongoose from 'mongoose';

jest.mock('@topupsend/db', () => ({
  User: { findOne: jest.fn(), updateOne: jest.fn() },
}));

import { User } from '@topupsend/db';
import { linkUserPgIdentity } from './user-link';

const userMock = User as unknown as {
  findOne: jest.Mock;
  updateOne: jest.Mock;
};

const USER_ID = '507f1f77bcf86cd799439012';

function storedUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(USER_ID),
    pgUserId: undefined,
    pgAuthId: undefined,
    ...overrides,
  };
}

function mockStored(doc: Record<string, unknown> | null) {
  userMock.findOne.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(doc) }),
  });
}

describe('linkUserPgIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userMock.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it('links both PG ids on first sign-in', async () => {
    mockStored(storedUser());
    const result = await linkUserPgIdentity({
      userId: USER_ID,
      pgUserId: 'pg-user-1',
      pgAuthId: 'auth-id-1',
    });
    expect(result).toEqual({ linked: true, linkedFields: ['pgUserId', 'pgAuthId'] });
    expect(userMock.updateOne.mock.calls[0][1]).toEqual({
      $set: { pgUserId: 'pg-user-1', pgAuthId: 'auth-id-1' },
    });
  });

  it('fills a still-empty pgAuthId without touching the stored pgUserId', async () => {
    mockStored(storedUser({ pgUserId: 'pg-user-1' }));
    const result = await linkUserPgIdentity({
      userId: USER_ID,
      pgUserId: 'pg-user-1',
      pgAuthId: 'auth-id-1',
    });
    expect(result).toEqual({ linked: true, linkedFields: ['pgAuthId'] });
  });

  it('refuses a different PG user id (first write wins) and writes nothing', async () => {
    mockStored(storedUser({ pgUserId: 'pg-user-1', pgAuthId: 'auth-id-1' }));
    const result = await linkUserPgIdentity({
      userId: USER_ID,
      pgUserId: 'pg-user-2',
      pgAuthId: 'auth-id-2',
    });
    expect(result.linked).toBe(false);
    expect(result.conflict).toEqual({
      field: 'pgUserId',
      existing: 'pg-user-1',
      incoming: 'pg-user-2',
    });
    expect(userMock.updateOne).not.toHaveBeenCalled();
  });

  it('refuses a different authId for the same user id', async () => {
    mockStored(storedUser({ pgUserId: 'pg-user-1', pgAuthId: 'auth-id-1' }));
    const result = await linkUserPgIdentity({
      userId: USER_ID,
      pgUserId: 'pg-user-1',
      pgAuthId: 'auth-id-2',
    });
    expect(result.conflict?.field).toBe('pgAuthId');
    expect(userMock.updateOne).not.toHaveBeenCalled();
  });

  it('links nothing without the pgUserId anchor', async () => {
    mockStored(storedUser());
    const result = await linkUserPgIdentity({ userId: USER_ID, pgAuthId: 'auth-id-1' });
    expect(result).toEqual({ linked: false, linkedFields: [] });
    expect(userMock.findOne).not.toHaveBeenCalled();
  });
});
