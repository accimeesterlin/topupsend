// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock environment variables for tests
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.CUSTOMER_JWT_SECRET = 'test-customer-jwt-secret-key-for-testing-only';
process.env.JWT_EXPIRES_IN = '7d';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.MONGODB_DB_NAME = 'pg-prepaid-test';
process.env.NODE_ENV = 'test';
