import {
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  createSessionCookie,
  clearSessionCookie,
  type SessionPayload,
} from '../auth';
import { UserRole } from '@topupsend/types';

describe('Password Hashing', () => {
  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'test-password-123';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should create different hashes for the same password', async () => {
      const password = 'test-password-123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      // Bcrypt uses random salts, so hashes should be different
      expect(hash1).not.toBe(hash2);
    });

    it('should create bcrypt-compatible hash', async () => {
      const password = 'test-password-123';
      const hash = await hashPassword(password);

      // Bcrypt hashes start with $2a$, $2b$, or $2y$
      expect(hash).toMatch(/^\$2[aby]\$/);
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const password = 'test-password-123';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'test-password-123';
      const wrongPassword = 'wrong-password';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(wrongPassword, hash);

      expect(isValid).toBe(false);
    });

    it('should handle empty password', async () => {
      const password = '';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('should be case-sensitive', async () => {
      const password = 'TestPassword123';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword('testpassword123', hash);

      expect(isValid).toBe(false);
    });
  });
});

describe('JWT Token Management', () => {
  const mockPayload: SessionPayload = {
    userId: 'user-123',
    email: 'test@example.com',
    roles: [UserRole.ADMIN],
    orgId: 'org-456',
  };

  describe('createToken', () => {
    it('should create a valid JWT token', async () => {
      const token = await createToken(mockPayload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });

    it('should create different tokens for same payload', async () => {
      // Due to iat (issued at) timestamp, tokens should be different
      const token1 = await createToken(mockPayload);
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
      const token2 = await createToken(mockPayload);

      expect(token1).not.toBe(token2);
    });

    it('should handle different user roles', async () => {
      const payloadWithMultipleRoles: SessionPayload = {
        ...mockPayload,
        roles: [UserRole.ADMIN, UserRole.OPERATOR],
      };

      const token = await createToken(payloadWithMultipleRoles);
      expect(token).toBeDefined();
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode valid token', async () => {
      const token = await createToken(mockPayload);
      const decoded = await verifyToken(token);

      expect(decoded).toBeDefined();
      expect(decoded?.userId).toBe(mockPayload.userId);
      expect(decoded?.email).toBe(mockPayload.email);
      expect(decoded?.orgId).toBe(mockPayload.orgId);
      expect(decoded?.roles).toEqual(mockPayload.roles);
    });

    it('should return null for invalid token', async () => {
      const invalidToken = 'invalid.token.here';
      const decoded = await verifyToken(invalidToken);

      expect(decoded).toBeNull();
    });

    it('should return null for malformed token', async () => {
      const malformedToken = 'not-a-jwt-token';
      const decoded = await verifyToken(malformedToken);

      expect(decoded).toBeNull();
    });

    it('should return null for empty token', async () => {
      const decoded = await verifyToken('');

      expect(decoded).toBeNull();
    });

    it('should handle token with all user roles', async () => {
      const payloadWithAllRoles: SessionPayload = {
        ...mockPayload,
        roles: [UserRole.ADMIN, UserRole.OPERATOR, UserRole.VIEWER],
      };

      const token = await createToken(payloadWithAllRoles);
      const decoded = await verifyToken(token);

      expect(decoded?.roles).toEqual(payloadWithAllRoles.roles);
    });
  });

  describe('Token expiration', () => {
    it('should include expiration time in token', async () => {
      const token = await createToken(mockPayload);
      const decoded = await verifyToken(token);

      // Token should have exp claim
      expect((decoded as any)?.exp).toBeDefined();
      expect(typeof (decoded as any)?.exp).toBe('number');
    });

    it('should include issued at time in token', async () => {
      const token = await createToken(mockPayload);
      const decoded = await verifyToken(token);

      // Token should have iat claim
      expect((decoded as any)?.iat).toBeDefined();
      expect(typeof (decoded as any)?.iat).toBe('number');
    });
  });
});

describe('Session Cookie Management', () => {
  describe('createSessionCookie', () => {
    it('should create cookie string with token', () => {
      const token = 'test-token-123';
      const cookie = createSessionCookie(token);

      expect(cookie).toContain(`session=${token}`);
    });

    it('should include HttpOnly flag', () => {
      const cookie = createSessionCookie('test-token');

      expect(cookie).toContain('HttpOnly');
    });

    it('should include Path=/', () => {
      const cookie = createSessionCookie('test-token');

      expect(cookie).toContain('Path=/');
    });

    it('should include SameSite=Lax', () => {
      const cookie = createSessionCookie('test-token');

      expect(cookie).toContain('SameSite=Lax');
    });

    it('should include Max-Age (7 days)', () => {
      const cookie = createSessionCookie('test-token');
      const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds

      expect(cookie).toContain(`Max-Age=${maxAge}`);
    });

    it('should include Secure flag in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const cookie = createSessionCookie('test-token');

      expect(cookie).toContain('Secure');

      process.env.NODE_ENV = originalEnv;
    });

    it('should not include Secure flag in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const cookie = createSessionCookie('test-token');

      expect(cookie).not.toContain('Secure');

      process.env.NODE_ENV = originalEnv;
    });

    it('should not include Secure flag in test', () => {
      const cookie = createSessionCookie('test-token');

      // In test environment (NODE_ENV=test)
      expect(cookie).not.toContain('Secure');
    });
  });

  describe('clearSessionCookie', () => {
    it('should create cookie string with empty value', () => {
      const cookie = clearSessionCookie();

      expect(cookie).toContain('session=');
    });

    it('should include HttpOnly flag', () => {
      const cookie = clearSessionCookie();

      expect(cookie).toContain('HttpOnly');
    });

    it('should include Path=/', () => {
      const cookie = clearSessionCookie();

      expect(cookie).toContain('Path=/');
    });

    it('should include SameSite=Lax', () => {
      const cookie = clearSessionCookie();

      expect(cookie).toContain('SameSite=Lax');
    });

    it('should include Max-Age=0 to expire immediately', () => {
      const cookie = clearSessionCookie();

      expect(cookie).toContain('Max-Age=0');
    });
  });
});

describe('Integration: Full auth flow', () => {
  it('should complete full password hash and verify flow', async () => {
    const password = 'secure-password-123!@#';

    // Hash password
    const hash = await hashPassword(password);

    // Verify correct password
    const isCorrect = await verifyPassword(password, hash);
    expect(isCorrect).toBe(true);

    // Verify incorrect password
    const isIncorrect = await verifyPassword('wrong-password', hash);
    expect(isIncorrect).toBe(false);
  });

  it('should complete full token create and verify flow', async () => {
    const payload: SessionPayload = {
      userId: 'user-789',
      email: 'integration@example.com',
      roles: [UserRole.OPERATOR],
      orgId: 'org-101',
    };

    // Create token
    const token = await createToken(payload);

    // Verify token
    const decoded = await verifyToken(token);

    expect(decoded).toBeDefined();
    expect(decoded?.userId).toBe(payload.userId);
    expect(decoded?.email).toBe(payload.email);
    expect(decoded?.roles).toEqual(payload.roles);
    expect(decoded?.orgId).toBe(payload.orgId);
  });

  it('should complete full cookie creation and clearing flow', () => {
    const token = 'session-token-123';

    // Create session cookie
    const setCookie = createSessionCookie(token);
    expect(setCookie).toContain(`session=${token}`);
    expect(setCookie).toContain('HttpOnly');

    // Clear session cookie
    const clearCookie = clearSessionCookie();
    expect(clearCookie).toContain('session=');
    expect(clearCookie).toContain('Max-Age=0');
  });
});
