'use strict';
/**
 * Unit tests for the SnapRender node (run against the build: npm test builds first).
 * The HTTP helper is mocked. Failed requests are thrown the way n8n core throws them: a NodeApiError wrapping an
 * AxiosError that carries response.status, response.headers and response.data.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NodeApiError, NodeOperationError } = require('n8n-workflow');
const { SnapRender } = require('../dist/nodes/SnapRender/SnapRender.node.js');

class AxiosError extends Error {}

const NODE = { name: 'SnapRender', type: 'n8n-nodes-snaprender.snapRender', typeVersion: 2, parameters: {} };

/**
 * An HTTP failure as n8n core's httpRequestWithAuthentication throws it. Current n8n (2.46) keeps the AxiosError as the
 * NodeApiError's native `cause`; older n8n-workflow versions (like the 2.9 dev dependency) drop it, so it is put back
 * here unless `legacy` asks for the older shape.
 */
function httpFailure(status, data, headers = {}, { legacy = false } = {}) {
	const axiosError = new AxiosError(`Request failed with status code ${status}`);
	axiosError.response = { status, headers, data };
	const error = new NodeApiError(NODE, axiosError);
	if (!legacy && error.cause !== axiosError) {
		Object.defineProperty(error, 'cause', { value: axiosError, configurable: true, writable: true });
	}
	if (legacy) error.cause = undefined;
	return error;
}

const apiBody = (code, message, status) => ({ error: { code, message, status } });

/**
 * Builds an IExecuteFunctions mock. `respond` gets the request options and returns the response or throws.
 * `onError` mirrors the node setting: 'stopWorkflow', 'continueRegularOutput' or 'continueErrorOutput'.
 */
function context({ version = 2, params = {}, items = [{ json: {} }], onError = 'stopWorkflow', respond }) {
	const node = { ...NODE, typeVersion: version, onError };
	const requests = [];
	const defaults = {
		resource: 'screenshot',
		operation: version >= 2 ? 'take' : 'screenshot',
		url: 'https://example.com',
		format: 'png',
		fullPage: false,
		device: '',
		darkMode: false,
		blockAds: true,
		blockCookieBanners: true,
		output: 'binary',
		additionalOptions: {},
		extractType: 'markdown',
		extractOptions: {},
		expiresIn: 86400,
		batchUrls: '["https://example.com"]',
		jobId: 'job-1',
		webhookUrl: 'https://hooks.example.com/x',
		webhookEvents: ['screenshot.completed'],
		webhookId: 'wh-1',
		returnAll: true,
		limit: 50,
	};
	return {
		requests,
		getInputData: () => items,
		getNode: () => node,
		getNodeParameter: (name, i) => {
			const value = typeof params === 'function' ? params(i)[name] : params[name];
			return value !== undefined ? value : defaults[name];
		},
		continueOnFail: () => onError !== 'stopWorkflow',
		helpers: {
			httpRequestWithAuthentication: {
				async call(_ctx, credentialType, options) {
					assert.equal(credentialType, 'snapRenderApi');
					requests.push(options);
					return respond(options, requests.length - 1);
				},
			},
			prepareBinaryData: async (buffer, fileName, mimeType) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
			}),
		},
	};
}

const run = (ctx) => new SnapRender().execute.call(ctx);

/**
 * How n8n 2.46.6 core (WorkflowExecute.handleNodeErrorOutput) decides that an item belongs on the error output when the
 * node's On Error setting is "Continue (using error output)".
 */
const routesToErrorOutput = (item) =>
	Boolean(
		item.error ||
			(item.json.error && Object.keys(item.json).every((key) => ['error', 'message', 'details'].includes(key))),
	);

/**
 * The json n8n 2.46.6 puts on the error output: the input item's fields under the node's json (handleNodeErrorOutput),
 * then normalizeNodeErrors, which replaces the json of any item carrying item.error with { error: message }.
 */
const errorOutputJson = (item, inputJson) =>
	item.error ? { error: item.error.message } : { ...inputJson, ...item.json };

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Every operation in both node versions, with a successful response for each. */
const OPERATIONS = [
	{ v1: 'screenshot', v2: ['screenshot', 'take'], ok: { body: pngBytes, headers: {}, statusCode: 200 } },
	{ v1: 'signUrl', v2: ['screenshot', 'sign'], ok: { url: 'https://app.snap-render.com/v1/s/abc' } },
	{ v1: 'checkCache', v2: ['screenshot', 'checkCache'], ok: { cached: false } },
	{ v1: 'batch', v2: ['screenshot', 'createBatch'], ok: { jobId: 'job-1' } },
	{ v1: 'getBatchStatus', v2: ['screenshot', 'getBatch'], ok: { status: 'done' } },
	{ v1: 'extract', v2: ['content', 'extract'], ok: { content: '# Example' } },
	{ v1: 'createWebhook', v2: ['webhook', 'create'], ok: { id: 'wh-1' } },
	{ v1: 'deleteWebhook', v2: ['webhook', 'delete'], ok: '' },
	{ v1: 'listWebhooks', v2: ['webhook', 'getAll'], ok: [{ id: 'wh-1' }] },
	{ v1: 'testWebhook', v2: ['webhook', 'test'], ok: { delivered: true } },
	{ v1: 'getUsage', v2: ['account', 'getUsage'], ok: { used: 1 } },
];

function operationParams(op, version) {
	return version >= 2 ? { resource: op.v2[0], operation: op.v2[1] } : { operation: op.v1 };
}

const unreachable = () =>
	httpFailure(
		422,
		apiBody('TARGET_UNREACHABLE', 'The target website could not be reached.', 422),
		{ 'x-error-code': 'TARGET_UNREACHABLE', 'x-error-message': 'The target website could not be reached.' },
	);

// --- Bug 1: "Continue (using error output)" ---

for (const version of [1, 2]) {
	for (const op of OPERATIONS) {
		const name = version >= 2 ? op.v2.join('.') : op.v1;

		test(`v${version} ${name}: Continue (using error output) routes the failed item to the error output`, async () => {
			const ctx = context({
				version,
				params: operationParams(op, version),
				onError: 'continueErrorOutput',
				respond: () => {
					throw unreachable();
				},
			});
			const [out] = await run(ctx);
			assert.equal(out.length, 1);
			const item = out[0];
			assert.ok(routesToErrorOutput(item), 'n8n would route this item to the success output');
			assert.deepEqual(item.pairedItem, { item: 0 });
			assert.deepEqual(errorOutputJson(item, { row: 7 }), {
				row: 7,
				error: 'TARGET_UNREACHABLE: The target website could not be reached.',
				details: { errorCode: 'TARGET_UNREACHABLE', httpCode: 422 },
			});
		});

		test(`v${version} ${name}: Continue (regular output) still returns json.error with code and status`, async () => {
			const ctx = context({
				version,
				params: operationParams(op, version),
				onError: 'continueRegularOutput',
				respond: () => {
					throw unreachable();
				},
			});
			const [out] = await run(ctx);
			assert.equal(out.length, 1);
			assert.deepEqual(out[0].json, {
				error: 'TARGET_UNREACHABLE: The target website could not be reached.',
				errorCode: 'TARGET_UNREACHABLE',
				httpCode: 422,
			});
			assert.equal(out[0].error, undefined, 'n8n would replace the json of an item carrying item.error');
			assert.deepEqual(out[0].pairedItem, { item: 0 });
		});

		test(`v${version} ${name}: Stop workflow throws NodeApiError with the SnapRender code and message`, async () => {
			const ctx = context({
				version,
				params: operationParams(op, version),
				respond: () => {
					throw unreachable();
				},
			});
			await assert.rejects(run(ctx), (error) => {
				assert.ok(error instanceof NodeApiError);
				assert.equal(error.message, 'TARGET_UNREACHABLE: The target website could not be reached.');
				assert.equal(error.httpCode, '422');
				assert.equal(error.context.itemIndex, 0);
				return true;
			});
		});

		test(`v${version} ${name}: success output unchanged`, async () => {
			const ctx = context({ version, params: operationParams(op, version), respond: () => op.ok });
			const [out] = await run(ctx);
			assert.ok(out.length >= 1);
			for (const item of out) {
				assert.equal(item.error, undefined);
				assert.ok(!routesToErrorOutput(item));
				assert.deepEqual(item.pairedItem, { item: 0 });
			}
		});
	}
}

test('mixed items: only the failed one goes to the error output, pairedItem points at its input', async () => {
	const ctx = context({
		items: [{ json: { u: 'a' } }, { json: { u: 'b' } }, { json: { u: 'c' } }],
		params: { output: 'json' },
		onError: 'continueErrorOutput',
		respond: (_options, index) => {
			if (index === 1) throw unreachable();
			return { image: 'data:image/png;base64,AA==', remainingCredits: 10 };
		},
	});
	const [out] = await run(ctx);
	assert.deepEqual(
		out.map((item) => routesToErrorOutput(item)),
		[false, true, false],
	);
	assert.deepEqual(out[1].pairedItem, { item: 1 });
});

test('Continue (using error output) also routes errors raised before the request (bad batch URL list)', async () => {
	const ctx = context({
		params: { operation: 'createBatch', batchUrls: 'not json' },
		onError: 'continueErrorOutput',
		respond: () => assert.fail('no request expected'),
	});
	const [out] = await run(ctx);
	assert.ok(routesToErrorOutput(out[0]));
	assert.equal(out[0].json.error, 'URLs must be a valid JSON array of strings');
	assert.deepEqual(out[0].pairedItem, { item: 0 });
});

test('Stop workflow for an error raised before the request still throws (v0.2.8 behaviour)', async () => {
	const ctx = context({
		params: { operation: 'createBatch', batchUrls: 'not json' },
		respond: () => assert.fail('no request expected'),
	});
	await assert.rejects(run(ctx), (error) => {
		assert.ok(error instanceof NodeApiError || error instanceof NodeOperationError);
		assert.equal(error.message, 'URLs must be a valid JSON array of strings');
		return true;
	});
});

// --- Bug 2: response headers ---

const rateLimited = (retryAfter = '60') =>
	httpFailure(
		429,
		apiBody('DOMAIN_RATE_LIMITED', 'Too many requests to example.com. Max 10 per minute per domain.', 429),
		{
			'retry-after': retryAfter,
			'x-error-code': 'DOMAIN_RATE_LIMITED',
			'x-error-message': 'Too many requests to example.com. Max 10 per minute per domain.',
		},
	);

test('429 with Continue: retryAfter (seconds, number) and httpCode on the error item', async () => {
	const message = 'DOMAIN_RATE_LIMITED: Too many requests to example.com. Max 10 per minute per domain.';
	const fields = { errorCode: 'DOMAIN_RATE_LIMITED', httpCode: 429, retryAfter: 60 };

	const regular = context({
		onError: 'continueRegularOutput',
		respond: () => {
			throw rateLimited();
		},
	});
	const [regularOut] = await run(regular);
	assert.deepEqual(regularOut[0].json, { error: message, ...fields });
	assert.equal(typeof regularOut[0].json.retryAfter, 'number');

	const errorOutput = context({
		onError: 'continueErrorOutput',
		respond: () => {
			throw rateLimited();
		},
	});
	const [errorOut] = await run(errorOutput);
	assert.ok(routesToErrorOutput(errorOut[0]));
	assert.deepEqual(errorOutputJson(errorOut[0], { url: 'https://example.com' }), {
		url: 'https://example.com',
		error: message,
		details: fields,
	});
});

test('Continue (using error output) without HTTP details: just the error field', async () => {
	const ctx = context({
		onError: 'continueErrorOutput',
		respond: () => {
			throw new NodeApiError(NODE, Object.assign(new Error('getaddrinfo ENOTFOUND app.snap-render.com'), { code: 'ENOTFOUND' }));
		},
	});
	const [out] = await run(ctx);
	assert.ok(routesToErrorOutput(out[0]));
	assert.deepEqual(Object.keys(out[0].json), ['error']);
});

test('429 with Stop workflow: same message, the wait time in the description', async () => {
	const ctx = context({
		respond: () => {
			throw rateLimited('30');
		},
	});
	await assert.rejects(run(ctx), (error) => {
		assert.ok(error instanceof NodeApiError);
		assert.equal(error.message, 'DOMAIN_RATE_LIMITED: Too many requests to example.com. Max 10 per minute per domain.');
		assert.equal(error.httpCode, '429');
		assert.match(error.description, /30 seconds/);
		return true;
	});
});

test('Retry-After as an HTTP date becomes seconds from now', async () => {
	const when = new Date(Date.now() + 45_000).toUTCString();
	const ctx = context({
		onError: 'continueRegularOutput',
		respond: () => {
			throw rateLimited(when);
		},
	});
	const [out] = await run(ctx);
	assert.ok(out[0].json.retryAfter >= 43 && out[0].json.retryAfter <= 46, String(out[0].json.retryAfter));
});

test('Retry-After header name is matched case-insensitively; garbage is ignored', async () => {
	const ctx = context({
		onError: 'continueRegularOutput',
		respond: (_o, i) => {
			if (i === 0) throw httpFailure(429, apiBody('RATE_LIMITED', 'Too many requests.', 429), { 'Retry-After': '7' });
			throw httpFailure(429, apiBody('RATE_LIMITED', 'Too many requests.', 429), { 'retry-after': 'soon' });
		},
		items: [{ json: {} }, { json: {} }],
	});
	const [out] = await run(ctx);
	assert.equal(out[0].json.retryAfter, 7);
	assert.equal(out[1].json.retryAfter, undefined);
	assert.equal(out[1].json.httpCode, 429);
});

test('binary error body: code and message still come from the body (Buffer)', async () => {
	const ctx = context({
		onError: 'continueRegularOutput',
		respond: () => {
			throw httpFailure(
				422,
				Buffer.from(JSON.stringify(apiBody('TARGET_UNREACHABLE', 'The target website could not be reached.', 422))),
			);
		},
	});
	const [out] = await run(ctx);
	assert.equal(out[0].json.errorCode, 'TARGET_UNREACHABLE');
	assert.equal(out[0].json.httpCode, 422);
});

test('no SnapRender body: X-Error-Code / X-Error-Message headers give the code and message', async () => {
	const ctx = context({
		onError: 'continueRegularOutput',
		respond: () => {
			throw httpFailure(503, 'upstream unavailable', {
				'x-error-code': 'SERVICE_UNAVAILABLE',
				'x-error-message': 'Service temporarily unavailable. Please try again later.',
			});
		},
	});
	const [out] = await run(ctx);
	assert.deepEqual(out[0].json, {
		error: 'SERVICE_UNAVAILABLE: Service temporarily unavailable. Please try again later.',
		errorCode: 'SERVICE_UNAVAILABLE',
		httpCode: 503,
	});
});

test('no SnapRender body or headers (e.g. a proxy 502): the HTTP status is still on the item', async () => {
	const ctx = context({
		onError: 'continueRegularOutput',
		respond: () => {
			throw httpFailure(502, 'error code: 502');
		},
	});
	const [out] = await run(ctx);
	assert.equal(out[0].json.httpCode, 502);
	assert.equal(typeof out[0].json.error, 'string');
	assert.equal(out[0].json.errorCode, undefined);
});

test('older n8n without the response on the error: code, message and status from the body, no retryAfter', async () => {
	const ctx = context({
		onError: 'continueRegularOutput',
		respond: () => {
			throw httpFailure(
				429,
				apiBody('RATE_LIMITED', 'Too many requests.', 429),
				{ 'retry-after': '60' },
				{ legacy: true },
			);
		},
	});
	const [out] = await run(ctx);
	assert.deepEqual(out[0].json, { error: 'RATE_LIMITED: Too many requests.', errorCode: 'RATE_LIMITED', httpCode: 429 });
});

test('a non-HTTP error (network) keeps the plain error field only', async () => {
	const ctx = context({
		onError: 'continueRegularOutput',
		respond: () => {
			throw new NodeApiError(NODE, Object.assign(new Error('getaddrinfo ENOTFOUND app.snap-render.com'), { code: 'ENOTFOUND' }));
		},
	});
	const [out] = await run(ctx);
	assert.deepEqual(Object.keys(out[0].json), ['error']);
});

test('binary capture: remainingCredits from X-Remaining-Credits is added, existing fields unchanged', async () => {
	const ctx = context({
		respond: () => ({ body: pngBytes, headers: { 'x-remaining-credits': '199816' }, statusCode: 200 }),
	});
	const [out] = await run(ctx);
	assert.deepEqual(out[0].json, { url: 'https://example.com', format: 'png', success: true, remainingCredits: 199816 });
	assert.equal(out[0].binary.data.mimeType, 'image/png');
});

test('binary capture without the header: json exactly as before', async () => {
	const ctx = context({ respond: () => ({ body: pngBytes, headers: {}, statusCode: 200 }) });
	const [out] = await run(ctx);
	assert.deepEqual(out[0].json, { url: 'https://example.com', format: 'png', success: true });
});

test('JSON capture output is the API response unchanged (it already carries remainingCredits)', async () => {
	const body = { image: 'data:image/png;base64,AA==', remainingCredits: 5, cache: 'MISS' };
	const ctx = context({ params: { output: 'json' }, respond: () => body });
	const [out] = await run(ctx);
	assert.deepEqual(out[0].json, body);
	assert.equal(ctx.requests[0].returnFullResponse, undefined);
});

test('requests are unchanged: no new options sent to the API', async () => {
	const ctx = context({
		params: { additionalOptions: {} },
		respond: () => ({ body: pngBytes, headers: {}, statusCode: 200 }),
	});
	await run(ctx);
	assert.deepEqual(ctx.requests[0], {
		method: 'GET',
		url: 'https://app.snap-render.com/v1/screenshot',
		qs: {
			url: 'https://example.com',
			format: 'png',
			full_page: false,
			dark_mode: false,
			block_ads: true,
			block_cookie_banners: true,
		},
		encoding: 'arraybuffer',
		returnFullResponse: true,
	});
});
