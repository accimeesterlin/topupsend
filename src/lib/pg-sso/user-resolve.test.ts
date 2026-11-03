/**
 * @jest-environment node
 */
import mongoose from 'mongoose';
import { UserRole } from '@topupsend/types';

jest.mock('@topupsend/db', () => ({
  User: { findOne: jest.fn(), updateOne: jest.fn(), create: jest.fn() },
  Org: { findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn() },
  UserOrganization: { create: jest.fn() },
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { Org, User, UserOrganization } from '@topupsend/db';
import { resolvePgUser } from './user-resolve';
import type { PgIdentityClaims } from './client';

const userMock = User as unknown as {
  findOne: jest.Mock;
  updateOne: jest.Mock;
  create: jest.Mock;
};
const orgMock = Org as unknown as {
  findOne: jest.Mock;
  create: jest.Mock;
  deleteOne: jest.Mock;
};
const userOrgMock = UserOrganization as unknown as { create: jest.Mock };

interface FakeUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  isActive: boolean;
  twoFactorEnabled?: boolean;
  roles?: string[];
  orgId?: mongoose.Types.ObjectId;
  passwordHash?: string;
  pgUserId?: string;
  pgAuthId?: string;
}

interface FakeOrg {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
}

const db = {
  users: [] as FakeUser[],
  orgs: [] as FakeOrg[],
  userOrgs: [] as Array<Record<string, unknown>>,
  raceMode: false,
  emailLookups: 0,
};

/** A chainable, thenable stand-in for a mongoose query. */
function chain<T>(doc: T) {
  const q: Record<string, unknown> = {
    select: () => q,
    lean: () => Promise.resolve(doc),
    populate: () => q,
    sort: () => q,
    then: (onFulfilled: unknown, onRejected: unknown) =>
      Promise.resolve(doc).then(
        onFulfilled as (v: T) => unknown,
        onRejected as (e: unknown) => unknown
      ),
  };
  return q;
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return true;
    const actual = doc[key];
    if (value instanceof mongoose.Types.ObjectId) {
      return actual instanceof mongoose.Types.ObjectId && actual.equals(value);
    }
    return actual === value;
  });
}

function seedUser(overrides: Partial<FakeUser> = {}): FakeUser {
  const doc: FakeUser = {
    _id: new mongoose.Types.ObjectId(),
    email: 'owner@example.com',
    isActive: true,
    ...overrides,
  };
  db.users.push(doc);
  return doc;
}

function claims(overrides: Partial<PgIdentityClaims> = {}): PgIdentityClaims {
  return {
    pgAuthId: 'auth-id-1',
    pgUserId: 'pg-user-1',
    email: 'owner@example.com',
    emailVerified: true,
    name: 'Olivia Owner',
    givenName: 'Olivia',
    familyName: 'Owner',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.users = [];
  db.orgs = [];
  db.userOrgs = [];
  db.raceMode = false;
  db.emailLookups = 0;

  userMock.findOne.mockImplementation((filter: Record<string, unknown>) => {
    if (db.raceMode && filter.email && !filter._id) {
      db.emailLookups += 1;
      if (db.emailLookups === 1) return chain(null);
    }
    return chain(
      db.users.find((doc) => matchesFilter(doc as unknown as Record<string, unknown>, filter)) ??
        null
    );
  });
  userMock.updateOne.mockImplementation(
    (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
      const doc = db.users.find((d) =>
        matchesFilter(d as unknown as Record<string, unknown>, filter)
      );
      if (doc) Object.assign(doc, update.$set);
      return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
    }
  );
  userMock.create.mockImplementation((input: Record<string, unknown>) => {
    if (db.raceMode || db.users.some((d) => d.email === input.email)) {
      return Promise.reject(Object.assign(new Error('duplicate key'), { code: 11000 }));
    }
    const doc = { _id: new mongoose.Types.ObjectId(), ...input } as unknown as FakeUser;
    db.users.push(doc);
    return Promise.resolve(doc);
  });
  orgMock.findOne.mockImplementation((filter: Record<string, unknown>) =>
    chain(
      db.orgs.find((doc) => matchesFilter(doc as unknown as Record<string, unknown>, filter)) ??
        null
    )
  );
  orgMock.create.mockImplementation((input: Record<string, unknown>) => {
    const doc = { _id: new mongoose.Types.ObjectId(), ...input } as unknown as FakeOrg;
    db.orgs.push(doc);
    return Promise.resolve(doc);
  });
  orgMock.deleteOne.mockImplementation((filter: Record<string, unknown>) => {
    const idx = db.orgs.findIndex((doc) =>
      matchesFilter(doc as unknown as Record<string, unknown>, filter)
    );
    if (idx >= 0) db.orgs.splice(idx, 1);
    return Promise.resolve({ deletedCount: idx >= 0 ? 1 : 0 });
  });
  userOrgMock.create.mockImplementation((input: Record<string, unknown>) => {
    db.userOrgs.push(input);
    return Promise.resolve(input);
  });
});

describe('resolvePgUser — matching', () => {
  it('resolves an existing user by pgAuthId', async () => {
    const stored = seedUser({ pgUserId: 'pg-user-1', pgAuthId: 'auth-id-1' });
    const result = await resolvePgUser({ claims: claims() });
    expect(result).toEqual({ outcome: 'signed-in', userId: stored._id.toString(), created: false });
  });

  it('resolves by verified email and links both PG ids', async () => {
    const stored = seedUser();
    const result = await resolvePgUser({ claims: claims() });
    expect(result).toEqual({ outcome: 'signed-in', userId: stored._id.toString(), created: false });
    expect(stored.pgUserId).toBe('pg-user-1');
    expect(stored.pgAuthId).toBe('auth-id-1');
  });

  it('refuses a deactivated account', async () => {
    seedUser({ isActive: false, pgUserId: 'pg-user-1', pgAuthId: 'auth-id-1' });
    const result = await resolvePgUser({ claims: claims() });
    expect(result).toEqual({ outcome: 'inactive' });
  });

  it('refuses a two-factor account (PG sign-in must not bypass the email code)', async () => {
    const stored = seedUser({ twoFactorEnabled: true });
    const result = await resolvePgUser({ claims: claims() });
    expect(result).toEqual({ outcome: 'two-factor' });
    // The identity link is still recorded — it is an association, not a session.
    expect(stored.pgUserId).toBe('pg-user-1');
  });
});

describe('resolvePgUser — conflicts hard-stop, nothing created', () => {
  it('refuses when the stored link names a different PG account', async () => {
    seedUser({ pgUserId: 'pg-user-OTHER', pgAuthId: 'auth-id-OTHER' });
    const result = await resolvePgUser({ claims: claims() });
    expect(result).toEqual({ outcome: 'conflict' });
    expect(db.users).toHaveLength(1);
    expect(userMock.create).not.toHaveBeenCalled();
    expect(orgMock.create).not.toHaveBeenCalled();
  });

  it('refuses when the PG ids match user A but the verified email belongs to user B', async () => {
    seedUser({ email: 'a@example.com', pgUserId: 'pg-user-1', pgAuthId: 'auth-id-1' });
    seedUser({ email: 'owner@example.com' });
    const result = await resolvePgUser({ claims: claims() });
    expect(result).toEqual({ outcome: 'conflict' });
    expect(db.users).toHaveLength(2);
    expect(userMock.create).not.toHaveBeenCalled();
  });
});

describe('resolvePgUser — auto-provisioning (mirrors the signup route)', () => {
  it('creates org + admin user + membership, with PG ids stamped', async () => {
    const result = await resolvePgUser({ claims: claims() });
    expect(result.outcome).toBe('signed-in');
    if (result.outcome !== 'signed-in') return;
    expect(result.created).toBe(true);

    expect(db.orgs).toHaveLength(1);
    expect(db.orgs[0].name).toBe("Olivia Owner's Organization");
    expect(db.orgs[0].slug).toBe('olivia-owner-s-organization');

    expect(db.users).toHaveLength(1);
    const created = db.users[0];
    expect(result.userId).toBe(created._id.toString());
    expect(created.email).toBe('owner@example.com');
    expect(created.roles).toEqual([UserRole.ADMIN]);
    expect(created.orgId?.toString()).toBe(db.orgs[0]._id.toString());
    expect(created.isActive).toBe(true);
    expect(created.pgUserId).toBe('pg-user-1');
    expect(created.pgAuthId).toBe('auth-id-1');

    // Password is a bcrypt hash of an unusable random credential.
    expect(created.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(created.passwordHash).not.toContain('owner');

    expect(db.userOrgs).toHaveLength(1);
    expect(db.userOrgs[0].roles).toEqual([UserRole.ADMIN]);
  });

  it('derives the org name from the email when PG sends no name claims', async () => {
    const result = await resolvePgUser({
      claims: claims({ name: undefined, givenName: undefined, familyName: undefined }),
    });
    expect(result.outcome).toBe('signed-in');
    expect(db.orgs[0].name).toBe("owner's Organization");
    expect(db.orgs[0].slug).toBe('owner-s-organization');
  });

  it('never creates on an unverified email', async () => {
    const result = await resolvePgUser({ claims: claims({ emailVerified: false }) });
    expect(result).toEqual({ outcome: 'unverified-email' });
    expect(db.users).toHaveLength(0);
    expect(db.orgs).toHaveLength(0);
    expect(userMock.create).not.toHaveBeenCalled();
    expect(orgMock.create).not.toHaveBeenCalled();
  });

  it('re-resolves instead of duplicating when creation loses a race, and removes its org', async () => {
    const stored = seedUser();
    db.raceMode = true;
    const result = await resolvePgUser({ claims: claims() });
    expect(result).toEqual({ outcome: 'signed-in', userId: stored._id.toString(), created: false });
    expect(db.users).toHaveLength(1);
    expect(db.orgs).toHaveLength(0);
    expect(orgMock.deleteOne).toHaveBeenCalled();
    expect(stored.pgUserId).toBe('pg-user-1');
  });
});
