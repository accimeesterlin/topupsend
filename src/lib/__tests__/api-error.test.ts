/**
 * @jest-environment node
 *
 * (Node environment: this suite imports `next/server`, whose web
 * spec-extension modules need the `Request` global — absent under
 * jsdom, where the suite fails to load with "Request is not
 * defined". Same annotation pattern as auth-hardening.test.ts.)
 */
import { NextResponse } from 'next/server';
import {
  ApiException,
  ApiErrors,
  createErrorResponse,
  handleApiError,
} from '../api-error';

describe('ApiException', () => {
  it('should create an exception with all properties', () => {
    const exception = new ApiException(
      400,
      'bad-request',
      'Bad Request',
      'Invalid input provided',
      '/api/test',
      { field: 'email' }
    );

    expect(exception.status).toBe(400);
    expect(exception.type).toBe('bad-request');
    expect(exception.title).toBe('Bad Request');
    expect(exception.detail).toBe('Invalid input provided');
    expect(exception.instance).toBe('/api/test');
    expect(exception.extensions).toEqual({ field: 'email' });
    expect(exception.name).toBe('ApiException');
  });

  it('should create an exception with minimal properties', () => {
    const exception = new ApiException(404, 'not-found', 'Not Found');

    expect(exception.status).toBe(404);
    expect(exception.type).toBe('not-found');
    expect(exception.title).toBe('Not Found');
    expect(exception.detail).toBeUndefined();
    expect(exception.instance).toBeUndefined();
    expect(exception.extensions).toBeUndefined();
  });

  it('should convert to JSON correctly with all fields', () => {
    const exception = new ApiException(
      400,
      'bad-request',
      'Bad Request',
      'Invalid input',
      '/api/test',
      { field: 'email', code: 'INVALID_EMAIL' }
    );

    const json = exception.toJSON();

    expect(json).toEqual({
      type: 'bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'Invalid input',
      instance: '/api/test',
      field: 'email',
      code: 'INVALID_EMAIL',
    });
  });

  it('should convert to JSON correctly without optional fields', () => {
    const exception = new ApiException(404, 'not-found', 'Not Found');
    const json = exception.toJSON();

    expect(json).toEqual({
      type: 'not-found',
      title: 'Not Found',
      status: 404,
      detail: undefined,
      instance: undefined,
    });
  });

  it('should use detail as message if provided', () => {
    const exception = new ApiException(400, 'bad-request', 'Bad Request', 'Custom detail');
    expect(exception.message).toBe('Custom detail');
  });

  it('should use title as message if detail not provided', () => {
    const exception = new ApiException(400, 'bad-request', 'Bad Request');
    expect(exception.message).toBe('Bad Request');
  });
});

describe('ApiErrors', () => {
  describe('BadRequest', () => {
    it('should create a 400 error', () => {
      const error = ApiErrors.BadRequest('Invalid data');

      expect(error.status).toBe(400);
      expect(error.type).toBe('bad-request');
      expect(error.title).toBe('Bad Request');
      expect(error.detail).toBe('Invalid data');
    });

    it('should accept extensions', () => {
      const error = ApiErrors.BadRequest('Invalid data', { field: 'email' });

      expect(error.extensions).toEqual({ field: 'email' });
    });
  });

  describe('Unauthorized', () => {
    it('should create a 401 error with default message', () => {
      const error = ApiErrors.Unauthorized();

      expect(error.status).toBe(401);
      expect(error.type).toBe('unauthorized');
      expect(error.title).toBe('Unauthorized');
      expect(error.detail).toBe('Authentication required');
    });

    it('should create a 401 error with custom message', () => {
      const error = ApiErrors.Unauthorized('Invalid token');

      expect(error.detail).toBe('Invalid token');
    });
  });

  describe('Forbidden', () => {
    it('should create a 403 error with default message', () => {
      const error = ApiErrors.Forbidden();

      expect(error.status).toBe(403);
      expect(error.type).toBe('forbidden');
      expect(error.title).toBe('Forbidden');
      expect(error.detail).toBe('Insufficient permissions');
    });

    it('should create a 403 error with custom message', () => {
      const error = ApiErrors.Forbidden('Admin access required');

      expect(error.detail).toBe('Admin access required');
    });
  });

  describe('NotFound', () => {
    it('should create a 404 error', () => {
      const error = ApiErrors.NotFound('Resource not found');

      expect(error.status).toBe(404);
      expect(error.type).toBe('not-found');
      expect(error.title).toBe('Not Found');
      expect(error.detail).toBe('Resource not found');
    });
  });

  describe('Conflict', () => {
    it('should create a 409 error', () => {
      const error = ApiErrors.Conflict('Email already exists');

      expect(error.status).toBe(409);
      expect(error.type).toBe('conflict');
      expect(error.title).toBe('Conflict');
      expect(error.detail).toBe('Email already exists');
    });
  });

  describe('UnprocessableEntity', () => {
    it('should create a 422 error', () => {
      const error = ApiErrors.UnprocessableEntity('Validation failed');

      expect(error.status).toBe(422);
      expect(error.type).toBe('unprocessable-entity');
      expect(error.title).toBe('Unprocessable Entity');
      expect(error.detail).toBe('Validation failed');
    });

    it('should accept extensions', () => {
      const error = ApiErrors.UnprocessableEntity('Validation failed', {
        errors: [{ field: 'email', message: 'Invalid email' }],
      });

      expect(error.extensions).toEqual({
        errors: [{ field: 'email', message: 'Invalid email' }],
      });
    });
  });

  describe('TooManyRequests', () => {
    it('should create a 429 error', () => {
      const error = ApiErrors.TooManyRequests('Rate limit exceeded');

      expect(error.status).toBe(429);
      expect(error.type).toBe('too-many-requests');
      expect(error.title).toBe('Too Many Requests');
      expect(error.detail).toBe('Rate limit exceeded');
    });
  });

  describe('InternalServerError', () => {
    it('should create a 500 error', () => {
      const error = ApiErrors.InternalServerError('Database connection failed');

      expect(error.status).toBe(500);
      expect(error.type).toBe('internal-server-error');
      expect(error.title).toBe('Internal Server Error');
      expect(error.detail).toBe('Database connection failed');
    });
  });

  describe('ServiceUnavailable', () => {
    it('should create a 503 error', () => {
      const error = ApiErrors.ServiceUnavailable('Service is down');

      expect(error.status).toBe(503);
      expect(error.type).toBe('service-unavailable');
      expect(error.title).toBe('Service Unavailable');
      expect(error.detail).toBe('Service is down');
    });
  });
});

describe('createErrorResponse', () => {
  it('should create a NextResponse with correct status', () => {
    const error = ApiErrors.BadRequest('Invalid input');
    const response = createErrorResponse(error);

    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(400);
  });

  it('should include problem+json content type', async () => {
    const error = ApiErrors.NotFound('Resource not found');
    const response = createErrorResponse(error);

    expect(response.headers.get('Content-Type')).toBe('application/problem+json');
  });

  it('should include error details in response body', async () => {
    const error = ApiErrors.BadRequest('Invalid email', { field: 'email' });
    const response = createErrorResponse(error);

    const body = await response.json();

    expect(body).toEqual({
      type: 'bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'Invalid email',
      instance: undefined,
      field: 'email',
    });
  });
});

describe('handleApiError', () => {
  // Spy on console.error to avoid cluttering test output
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should handle ApiException correctly', () => {
    const error = ApiErrors.BadRequest('Invalid input');
    const response = handleApiError(error);

    expect(response.status).toBe(400);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('should handle unknown errors as 500', () => {
    const error = new Error('Something went wrong');
    const response = handleApiError(error);

    expect(response.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Unhandled API error:', error);
  });

  it('should return generic error message for unknown errors', async () => {
    const error = new Error('Database connection failed');
    const response = handleApiError(error);

    const body = await response.json();

    expect(body.detail).toBe('An unexpected error occurred');
    expect(body.type).toBe('internal-server-error');
  });

  it('should handle string errors', () => {
    const error = 'Something went wrong';
    const response = handleApiError(error);

    expect(response.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Unhandled API error:', error);
  });

  it('should handle null/undefined errors', () => {
    const response1 = handleApiError(null);
    const response2 = handleApiError(undefined);

    expect(response1.status).toBe(500);
    expect(response2.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
  });
});
