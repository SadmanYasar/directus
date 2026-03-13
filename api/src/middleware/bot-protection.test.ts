import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { matchesRoute } from './bot-protection.js';

describe('matchesRoute', () => {
	test('should match exact route', () => {
		expect(matchesRoute('/auth/login', ['auth/login'])).toBe(true);
	});

	test('should match exact route with leading slash in pattern', () => {
		expect(matchesRoute('/auth/login', ['/auth/login'])).toBe(true);
	});

	test('should not match unrelated route', () => {
		expect(matchesRoute('/auth/refresh', ['auth/login'])).toBe(false);
	});

	test('should match wildcard pattern with /*', () => {
		expect(matchesRoute('/items/my_form', ['items/*'])).toBe(true);
	});

	test('should match wildcard pattern with /* for nested paths', () => {
		expect(matchesRoute('/items/my_form/sub', ['items/*'])).toBe(true);
	});

	test('should match the prefix itself when using /*', () => {
		expect(matchesRoute('/items', ['items/*'])).toBe(true);
	});

	test('should match wildcard pattern with *', () => {
		expect(matchesRoute('/items/my_form', ['items*'])).toBe(true);
	});

	test('should handle multiple patterns', () => {
		expect(matchesRoute('/auth/login', ['auth/login', 'users/register'])).toBe(true);
		expect(matchesRoute('/users/register', ['auth/login', 'users/register'])).toBe(true);
		expect(matchesRoute('/assets/image', ['auth/login', 'users/register'])).toBe(false);
	});

	test('should skip empty patterns', () => {
		expect(matchesRoute('/auth/login', ['', 'auth/login'])).toBe(true);
		expect(matchesRoute('/auth/login', [''])).toBe(false);
	});

	test('should handle path with no leading slash', () => {
		expect(matchesRoute('auth/login', ['auth/login'])).toBe(true);
	});
});

describe('bot-protection middleware', () => {
	function createMockReq(overrides: Partial<Request> = {}): Request {
		return {
			path: '/auth/login',
			method: 'POST',
			headers: {},
			body: {},
			accountability: null,
			...overrides,
		} as unknown as Request;
	}

	function createMockRes(): Response {
		return {} as unknown as Response;
	}

	function createMockNext(): NextFunction & { mock: { calls: unknown[][] } } {
		return vi.fn() as unknown as NextFunction & { mock: { calls: unknown[][] } };
	}

	// Note: Full integration tests for the middleware require mocking useEnv
	// which is complex due to module-level initialization. The matchesRoute
	// function is tested above. The verifyToken function is tested below.

	describe('verifyToken', () => {
		beforeEach(() => {
			vi.restoreAllMocks();
		});

		test('should return true when provider returns success', async () => {
			const { verifyToken } = await import('./bot-protection.js');

			const mockFetch = vi.fn().mockResolvedValue({
				json: () => Promise.resolve({ success: true }),
			});

			vi.stubGlobal('fetch', mockFetch);

			const result = await verifyToken('turnstile', 'test-secret', 'test-token', '127.0.0.1');
			expect(result).toBe(true);

			expect(mockFetch).toHaveBeenCalledWith(
				'https://challenges.cloudflare.com/turnstile/v0/siteverify',
				expect.objectContaining({
					method: 'POST',
				}),
			);

			vi.unstubAllGlobals();
		});

		test('should return false when provider returns failure', async () => {
			const { verifyToken } = await import('./bot-protection.js');

			const mockFetch = vi.fn().mockResolvedValue({
				json: () => Promise.resolve({ success: false }),
			});

			vi.stubGlobal('fetch', mockFetch);

			const result = await verifyToken('turnstile', 'test-secret', 'bad-token', '127.0.0.1');
			expect(result).toBe(false);

			vi.unstubAllGlobals();
		});

		test('should return false when fetch throws', async () => {
			const { verifyToken } = await import('./bot-protection.js');

			const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
			vi.stubGlobal('fetch', mockFetch);

			const result = await verifyToken('turnstile', 'test-secret', 'test-token', '127.0.0.1');
			expect(result).toBe(false);

			vi.unstubAllGlobals();
		});

		test('should use recaptcha URL for recaptcha provider', async () => {
			const { verifyToken } = await import('./bot-protection.js');

			const mockFetch = vi.fn().mockResolvedValue({
				json: () => Promise.resolve({ success: true }),
			});

			vi.stubGlobal('fetch', mockFetch);

			await verifyToken('recaptcha', 'test-secret', 'test-token', null);

			expect(mockFetch).toHaveBeenCalledWith(
				'https://www.google.com/recaptcha/api/siteverify',
				expect.anything(),
			);

			vi.unstubAllGlobals();
		});

		test('should throw for unsupported provider', async () => {
			const { verifyToken } = await import('./bot-protection.js');

			await expect(verifyToken('unknown', 'secret', 'token', null)).rejects.toThrow(
				'Unsupported bot protection provider',
			);
		});
	});
});
