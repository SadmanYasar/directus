import { useEnv } from '@directus/env';
import { ForbiddenError } from '@directus/errors';
import type { RequestHandler } from 'express';
import { useLogger } from '../logger/index.js';
import asyncHandler from '../utils/async-handler.js';

/**
 * Verification URLs for supported bot protection providers
 */
const PROVIDER_URLS: Record<string, string> = {
	turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
	recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
};

/**
 * Verify a bot protection token against the configured provider
 */
async function verifyToken(provider: string, secretKey: string, token: string, ip: string | null): Promise<boolean> {
	const verifyUrl = PROVIDER_URLS[provider];

	if (!verifyUrl) {
		throw new Error(`Unsupported bot protection provider: "${provider}"`);
	}

	const body = new URLSearchParams();
	body.append('secret', secretKey);
	body.append('response', token);

	if (ip) {
		body.append('remoteip', ip);
	}

	try {
		const response = await fetch(verifyUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		});

		const result = (await response.json()) as { success: boolean };
		return result.success === true;
	} catch {
		return false;
	}
}

/**
 * Check if a request path matches any of the configured bot protection route patterns.
 * Supports exact matching and wildcard (*) at the end of patterns.
 *
 * @example
 * matchesRoute('/auth/login', ['auth/login']) // true
 * matchesRoute('/items/my_form', ['items/*']) // true
 * matchesRoute('/items/my_form', ['auth/login']) // false
 */
function matchesRoute(requestPath: string, routePatterns: string[]): boolean {
	// Normalize: strip leading slash and /api prefix if present
	const normalizedPath = requestPath.replace(/^\/+/, '');

	for (const pattern of routePatterns) {
		const normalizedPattern = pattern.trim().replace(/^\/+/, '');

		if (!normalizedPattern) continue;

		if (normalizedPattern.endsWith('/*')) {
			const prefix = normalizedPattern.slice(0, -2);

			if (normalizedPath === prefix || normalizedPath.startsWith(prefix + '/')) {
				return true;
			}
		} else if (normalizedPattern.endsWith('*')) {
			const prefix = normalizedPattern.slice(0, -1);

			if (normalizedPath.startsWith(prefix)) {
				return true;
			}
		} else if (normalizedPath === normalizedPattern) {
			return true;
		}
	}

	return false;
}

let botProtection: RequestHandler = (_req, _res, next) => next();

const env = useEnv();

if (env['BOT_PROTECTION_ENABLED'] === true) {
	const logger = useLogger();
	const provider = (env['BOT_PROTECTION_PROVIDER'] as string) || 'turnstile';
	const secretKey = env['BOT_PROTECTION_SECRET_KEY'] as string;
	const routePatterns = env['BOT_PROTECTION_ROUTES'] as string[];
	const bypassAdmin = env['BOT_PROTECTION_BYPASS_ADMIN'] as boolean;
	const bypassRoles = env['BOT_PROTECTION_BYPASS_ROLES'] as string[];
	const tokenHeader = (env['BOT_PROTECTION_TOKEN_HEADER'] as string) || 'x-bot-protection-token';

	if (!secretKey) {
		logger.warn('BOT_PROTECTION_ENABLED is true but BOT_PROTECTION_SECRET_KEY is not set. Bot protection will not function.');
	}

	if (!routePatterns || routePatterns.length === 0 || (routePatterns.length === 1 && routePatterns[0] === '')) {
		logger.warn('BOT_PROTECTION_ENABLED is true but BOT_PROTECTION_ROUTES is empty. No routes will be protected.');
	}

	botProtection = asyncHandler(async (req, _res, next) => {
		// Only protect configured routes
		if (!routePatterns || routePatterns.length === 0) {
			return next();
		}

		if (!matchesRoute(req.path, routePatterns)) {
			return next();
		}

		// Only protect POST/PATCH/PUT/DELETE methods (not GET/HEAD/OPTIONS)
		if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
			return next();
		}

		// Check admin bypass
		if (bypassAdmin && req.accountability?.admin === true) {
			return next();
		}

		// Check role bypass
		if (bypassRoles && bypassRoles.length > 0 && req.accountability?.role) {
			if (bypassRoles.includes(req.accountability.role)) {
				return next();
			}
		}

		// Extract token from header or body
		const token = (req.headers[tokenHeader] as string) || req.body?.bot_protection_token;

		if (!token) {
			throw new ForbiddenError({ reason: 'Bot protection token is required' });
		}

		if (!secretKey) {
			throw new ForbiddenError({ reason: 'Bot protection is misconfigured' });
		}

		const ip = req.accountability?.ip ?? null;
		const isValid = await verifyToken(provider, secretKey, token, ip);

		if (!isValid) {
			throw new ForbiddenError({ reason: 'Bot protection verification failed' });
		}

		return next();
	});
}

export default botProtection;
export { matchesRoute, verifyToken };
