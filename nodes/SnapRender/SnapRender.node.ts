import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

interface SnapRenderApiError {
	code: string;
	message: string;
	status?: number;
}

/**
 * Find the SnapRender error body ({ error: { code, message, status } }) inside an n8n HTTP error, so the user sees
 * "TARGET_UNREACHABLE: The target website could not be reached..." instead of n8n's generic text for the status code.
 * The body can sit on different properties depending on the n8n version, and it is a Buffer for binary requests.
 */
function findApiError(value: unknown, depth = 0, seen = new Set<unknown>()): SnapRenderApiError | undefined {
	if (value === null || value === undefined || depth > 5 || seen.has(value)) return undefined;
	if (typeof value === 'string' || value instanceof Uint8Array || value instanceof ArrayBuffer) {
		const text = typeof value === 'string' ? value : Buffer.from(value as Uint8Array).toString('utf8');
		if (!text.includes('"error"')) return undefined;
		try {
			return findApiError(JSON.parse(text), depth + 1, seen);
		} catch {
			return undefined;
		}
	}
	if (typeof value !== 'object') return undefined;
	seen.add(value);
	const err = (value as { error?: unknown }).error;
	if (err && typeof err === 'object') {
		const { code, message, status } = err as { code?: unknown; message?: unknown; status?: unknown };
		if (typeof code === 'string' && typeof message === 'string') {
			return { code, message, status: typeof status === 'number' ? status : undefined };
		}
	}
	for (const key of Object.getOwnPropertyNames(value)) {
		if (key === 'stack') continue;
		const found = findApiError((value as Record<string, unknown>)[key], depth + 1, seen);
		if (found) return found;
	}
	return undefined;
}

/** Version 1 shows one flat Operation list. Saved v1 workflows keep these values unchanged. */
const showV1 = { '@version': [1] };
/** Version 2 groups the same operations under resources. */
const showV2 = { '@version': [{ _cnd: { gte: 2 } }] };

/**
 * Maps a version 2 resource and operation to the version 1 operation that runs it, so both versions share one
 * implementation per operation. Version 2 operation values are unique across resources, which lets the shared fields
 * below show by operation alone.
 */
const V2_OPERATIONS: Record<string, Record<string, string>> = {
	account: { getUsage: 'getUsage' },
	content: { extract: 'extract' },
	screenshot: {
		checkCache: 'checkCache',
		createBatch: 'batch',
		getBatch: 'getBatchStatus',
		sign: 'signUrl',
		take: 'screenshot',
	},
	webhook: {
		create: 'createWebhook',
		delete: 'deleteWebhook',
		getAll: 'listWebhooks',
		test: 'testWebhook',
	},
};

/** Shows a field for the given version 1 operations and the version 2 operations that run them. */
function forOperations(...v1Operations: string[]): { show: { operation: string[] } } {
	const operation = [...v1Operations];
	for (const operations of Object.values(V2_OPERATIONS)) {
		for (const [v2Operation, v1Operation] of Object.entries(operations)) {
			if (v1Operations.includes(v1Operation) && !operation.includes(v2Operation)) operation.push(v2Operation);
		}
	}
	return { show: { operation } };
}

const captureOperations = ['screenshot', 'signUrl', 'batch'];

/**
 * The version 1 operation name for this item: version 1 reads it directly, version 2 maps resource and operation.
 */
function resolveOperation(context: IExecuteFunctions, itemIndex: number): string {
	const operation = context.getNodeParameter('operation', itemIndex) as string;
	if (context.getNode().typeVersion < 2) return operation;
	const resource = context.getNodeParameter('resource', itemIndex) as string;
	const mapped = V2_OPERATIONS[resource]?.[operation];
	if (!mapped) {
		throw new NodeOperationError(
			context.getNode(),
			`The operation "${operation}" is not supported for the resource "${resource}"`,
			{ itemIndex },
		);
	}
	return mapped;
}

export class SnapRender implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SnapRender',
		name: 'snapRender',
		icon: { light: 'file:snaprender.svg', dark: 'file:snaprender-dark.svg' },
		group: ['transform'],
		version: [1, 2],
		defaultVersion: 2,
		subtitle:
			'={{ $parameter["resource"] ? $parameter["operation"] + ": " + $parameter["resource"] : $parameter["operation"] }}',
		description: 'Capture website screenshots as PNG, JPEG, WebP, or PDF and extract web page content',
		defaults: { name: 'SnapRender' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'snapRenderApi',
				required: true,
			},
		],
		properties: [
			// --- Version 1: flat operation list (kept for saved workflows) ---
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { ...showV1 } },
				options: [
					{
						name: 'Batch Screenshots',
						value: 'batch',
						description: 'Create a batch screenshot job for multiple URLs (1-50)',
						action: 'Create a batch screenshot job',
					},
					{
						name: 'Check Cache',
						value: 'checkCache',
						description: 'Check if a screenshot is cached (free, no quota cost)',
						action: 'Check if a screenshot is cached',
					},
					{
						name: 'Create Webhook',
						value: 'createWebhook',
						description: 'Register a webhook for event notifications',
						action: 'Create a webhook',
					},
					{
						name: 'Delete Webhook',
						value: 'deleteWebhook',
						description: 'Delete a webhook by ID',
						action: 'Delete a webhook',
					},
					{
						name: 'Extract Content',
						value: 'extract',
						description: 'Extract content from a web page (markdown, text, HTML, article, links, metadata)',
						action: 'Extract content from a web page',
					},
					{
						name: 'Get Batch Status',
						value: 'getBatchStatus',
						description: 'Get the status of a batch screenshot job',
						action: 'Get batch job status',
					},
					{
						name: 'Get Usage',
						value: 'getUsage',
						description: 'Get current month screenshot usage statistics',
						action: 'Get usage statistics',
					},
					{
						name: 'List Webhooks',
						value: 'listWebhooks',
						description: 'List all webhooks for the account',
						action: 'List webhooks',
					},
					{
						name: 'Sign URL',
						value: 'signUrl',
						description: 'Generate a signed screenshot URL (free, no quota cost)',
						action: 'Generate a signed screenshot URL',
					},
					{
						name: 'Take Screenshot',
						value: 'screenshot',
						description: 'Capture a screenshot of a website',
						action: 'Capture a screenshot of a website',
					},
					{
						name: 'Test Webhook',
						value: 'testWebhook',
						description: 'Send a test delivery to a webhook',
						action: 'Test a webhook',
					},
				],
				default: 'screenshot',
			},

			// --- Version 2: resources and their operations ---
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { ...showV2 } },
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Content', value: 'content' },
					{ name: 'Screenshot', value: 'screenshot' },
					{ name: 'Webhook', value: 'webhook' },
				],
				default: 'screenshot',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { ...showV2, resource: ['account'] } },
				options: [
					{
						name: 'Get Usage',
						value: 'getUsage',
						description: 'Get current month screenshot usage statistics',
						action: 'Get usage statistics',
					},
				],
				default: 'getUsage',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { ...showV2, resource: ['content'] } },
				options: [
					{
						name: 'Extract',
						value: 'extract',
						description: 'Extract content from a web page (markdown, text, HTML, article, links, metadata)',
						action: 'Extract content from a web page',
					},
				],
				default: 'extract',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { ...showV2, resource: ['screenshot'] } },
				options: [
					{
						name: 'Check Cache',
						value: 'checkCache',
						description: 'Check if a screenshot is cached (free, no quota cost)',
						action: 'Check if a screenshot is cached',
					},
					{
						name: 'Create Batch',
						value: 'createBatch',
						description: 'Create a batch screenshot job for multiple URLs (1-50)',
						action: 'Create a batch screenshot job',
					},
					{
						name: 'Get Batch Status',
						value: 'getBatch',
						description: 'Get the status of a batch screenshot job',
						action: 'Get batch job status',
					},
					{
						name: 'Sign URL',
						value: 'sign',
						description: 'Generate a signed screenshot URL (free, no quota cost)',
						action: 'Generate a signed screenshot URL',
					},
					{
						name: 'Take',
						value: 'take',
						description: 'Capture a screenshot of a website',
						action: 'Capture a screenshot of a website',
					},
				],
				default: 'take',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { ...showV2, resource: ['webhook'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Register a webhook for event notifications',
						action: 'Create a webhook',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a webhook by ID',
						action: 'Delete a webhook',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many webhooks of the account',
						action: 'Get many webhooks',
					},
					{
						name: 'Test',
						value: 'test',
						description: 'Send a test delivery to a webhook',
						action: 'Test a webhook',
					},
				],
				default: 'create',
			},

			// --- Screenshot, Sign, Cache Check, Extract params ---
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com',
				description: 'URL of the website to capture',
				displayOptions: forOperations('screenshot', 'signUrl', 'checkCache', 'extract'),
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				options: [
					{ name: 'JPEG', value: 'jpeg' },
					{ name: 'PDF', value: 'pdf' },
					{ name: 'PNG', value: 'png' },
					{ name: 'WebP', value: 'webp' },
				],
				default: 'png',
				description: 'Output image format',
				displayOptions: forOperations('screenshot', 'signUrl', 'checkCache', 'batch'),
			},

			// --- Sign URL params ---
			{
				displayName: 'Expires In (Seconds)',
				name: 'expiresIn',
				type: 'number',
				default: 86400,
				description: 'URL validity in seconds (60-2592000, default: 86400 = 1 day)',
				typeOptions: { minValue: 60, maxValue: 2592000 },
				displayOptions: forOperations('signUrl'),
			},

			// --- Extract params ---
			{
				displayName: 'Extraction Type',
				name: 'extractType',
				type: 'options',
				options: [
					{ name: 'Article', value: 'article' },
					{ name: 'HTML', value: 'html' },
					{ name: 'Links', value: 'links' },
					{ name: 'Markdown', value: 'markdown' },
					{ name: 'Metadata', value: 'metadata' },
					{ name: 'Plain Text', value: 'text' },
				],
				default: 'markdown',
				description: 'Type of content to extract',
				displayOptions: forOperations('extract'),
			},
			{
				displayName: 'Extract Options',
				name: 'extractOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: forOperations('extract'),
				options: [
					{
						displayName: 'Block Ads',
						name: 'blockAds',
						type: 'boolean',
						default: true,
						description: 'Whether to block advertisements and trackers',
					},
					{
						displayName: 'Block Cookie Banners',
						name: 'blockCookieBanners',
						type: 'boolean',
						default: true,
						description: 'Whether to remove cookie consent banners',
					},
					{
						displayName: 'Delay',
						name: 'delay',
						type: 'number',
						default: 0,
						description: 'Milliseconds to wait after page load (0-10000)',
						typeOptions: { minValue: 0, maxValue: 10000 },
					},
					{
						displayName: 'Max Length',
						name: 'maxLength',
						type: 'number',
						default: 100000,
						description: 'Maximum content length in characters (1-500000)',
						typeOptions: { minValue: 1, maxValue: 500000 },
					},
					{
						displayName: 'Selector',
						name: 'selector',
						type: 'string',
						default: '',
						description: 'CSS selector to scope extraction to a specific element',
					},
				],
			},

			// --- Batch params ---
			{
				displayName: 'URLs (JSON Array)',
				name: 'batchUrls',
				type: 'string',
				default: '',
				required: true,
				placeholder: '["https://example.com", "https://example.org"]',
				description: 'JSON array of URLs to capture (1-50)',
				displayOptions: forOperations('batch'),
			},

			// --- Batch Status params ---
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
				description: 'The batch job ID returned when the batch was created',
				displayOptions: forOperations('getBatchStatus'),
			},

			// --- Webhook params ---
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://your-server.com/webhooks/snaprender',
				description: 'Endpoint URL that will receive webhook deliveries',
				displayOptions: forOperations('createWebhook'),
			},
			{
				displayName: 'Events',
				name: 'webhookEvents',
				type: 'multiOptions',
				options: [
					{ name: 'Quota Exceeded (100%)', value: 'quota.exceeded' },
					{ name: 'Quota Warning (80%)', value: 'quota.warning' },
					{ name: 'Screenshot Completed', value: 'screenshot.completed' },
				],
				default: ['screenshot.completed'],
				required: true,
				description: 'Events to subscribe to',
				displayOptions: forOperations('createWebhook'),
			},
			{
				displayName: 'Webhook ID',
				name: 'webhookId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
				description: 'The webhook ID to operate on',
				displayOptions: forOperations('deleteWebhook', 'testWebhook'),
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { ...showV2, resource: ['webhook'], operation: ['getAll'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				description: 'Max number of results to return',
				typeOptions: { minValue: 1 },
				displayOptions: {
					show: { ...showV2, resource: ['webhook'], operation: ['getAll'], returnAll: [false] },
				},
			},

			// --- Capture params (Take Screenshot, Sign URL, Batch) ---
			{
				displayName: 'Full Page',
				name: 'fullPage',
				type: 'boolean',
				default: false,
				description: 'Whether to capture the entire scrollable page',
				displayOptions: forOperations(...captureOperations),
			},
			{
				displayName: 'Device',
				name: 'device',
				type: 'options',
				options: [
					{ name: 'Desktop (Default)', value: '' },
					{ name: 'iPad Pro', value: 'ipad_pro' },
					{ name: 'iPhone 14', value: 'iphone_14' },
					{ name: 'iPhone 15 Pro', value: 'iphone_15_pro' },
					{ name: 'MacBook Pro', value: 'macbook_pro' },
					{ name: 'Pixel 7', value: 'pixel_7' },
				],
				default: '',
				description: 'Device preset for viewport emulation',
				displayOptions: forOperations(...captureOperations),
			},
			{
				displayName: 'Dark Mode',
				name: 'darkMode',
				type: 'boolean',
				default: false,
				description: 'Whether to enable dark mode CSS emulation',
				displayOptions: forOperations(...captureOperations),
			},
			{
				displayName: 'Block Ads',
				name: 'blockAds',
				type: 'boolean',
				default: true,
				description: 'Whether to block advertisements and trackers',
				displayOptions: forOperations(...captureOperations),
			},
			{
				displayName: 'Block Cookie Banners',
				name: 'blockCookieBanners',
				type: 'boolean',
				default: true,
				description: 'Whether to remove cookie consent banners',
				displayOptions: forOperations(...captureOperations),
			},
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: forOperations(...captureOperations),
				options: [
					{
						displayName: 'Click Selector',
						name: 'clickSelector',
						type: 'string',
						default: '',
						description: 'CSS selector to click before capture',
					},
					{
						displayName: 'Delay',
						name: 'delay',
						type: 'number',
						default: 0,
						description: 'Milliseconds to wait after page load (0-10000)',
						typeOptions: { minValue: 0, maxValue: 10000 },
					},
					{
						displayName: 'Height',
						name: 'height',
						type: 'number',
						default: 800,
						description: 'Viewport height in pixels (200-10000)',
						typeOptions: { minValue: 200, maxValue: 10000 },
					},
					{
						displayName: 'Hide Selectors',
						name: 'hideSelectors',
						type: 'string',
						default: '',
						description: 'Comma-separated CSS selectors to hide before capture',
					},
					{
						displayName: 'Quality',
						name: 'quality',
						type: 'number',
						default: 90,
						description: 'Image quality for JPEG/WebP (1-100)',
						typeOptions: { minValue: 1, maxValue: 100 },
					},
					{
						displayName: 'Width',
						name: 'width',
						type: 'number',
						default: 1280,
						description: 'Viewport width in pixels (320-3840)',
						typeOptions: { minValue: 320, maxValue: 3840 },
					},
				],
			},

			// --- Output option ---
			{
				displayName: 'Output',
				name: 'output',
				type: 'options',
				options: [
					{ name: 'Binary (Image File)', value: 'binary' },
					{ name: 'JSON (Base64 Data URI)', value: 'json' },
				],
				default: 'binary',
				description: 'How to return the screenshot',
				displayOptions: forOperations('screenshot'),
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = resolveOperation(this, i);

				if (operation === 'getUsage') {
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'snapRenderApi',
						{
							method: 'GET',
							url: 'https://app.snap-render.com/v1/usage',
							json: true,
						},
					);
					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				} else if (operation === 'checkCache') {
					const url = this.getNodeParameter('url', i) as string;
					const format = this.getNodeParameter('format', i) as string;
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'snapRenderApi',
						{
							method: 'GET',
							url: 'https://app.snap-render.com/v1/screenshot/info',
							qs: { url, format },
							json: true,
						},
					);
					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				} else if (operation === 'signUrl') {
						const url = this.getNodeParameter('url', i) as string;
						const format = this.getNodeParameter('format', i) as string;
						const fullPage = this.getNodeParameter('fullPage', i) as boolean;
						const device = this.getNodeParameter('device', i) as string;
						const darkMode = this.getNodeParameter('darkMode', i) as boolean;
						const blockAds = this.getNodeParameter('blockAds', i) as boolean;
						const blockCookieBanners = this.getNodeParameter('blockCookieBanners', i) as boolean;
						const expiresIn = this.getNodeParameter('expiresIn', i) as number;
						const additionalOptions = this.getNodeParameter('additionalOptions', i) as IDataObject;

						const body: Record<string, unknown> = {
							url,
							format,
							expires_in: expiresIn,
							full_page: fullPage,
							dark_mode: darkMode,
							block_ads: blockAds,
							block_cookie_banners: blockCookieBanners,
						};
						if (device) body.device = device;
						if (additionalOptions.width) body.width = additionalOptions.width;
						if (additionalOptions.height) body.height = additionalOptions.height;
						if (additionalOptions.quality) body.quality = additionalOptions.quality;
						if (additionalOptions.delay) body.delay = additionalOptions.delay;
						if (additionalOptions.hideSelectors) body.hide_selectors = additionalOptions.hideSelectors;
						if (additionalOptions.clickSelector) body.click_selector = additionalOptions.clickSelector;

						const response = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'snapRenderApi',
							{
								method: 'POST',
								url: 'https://app.snap-render.com/v1/screenshot/sign',
								body,
								json: true,
							},
						);
						returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					} else if (operation === 'extract') {
						const url = this.getNodeParameter('url', i) as string;
						const extractType = this.getNodeParameter('extractType', i) as string;
						const extractOptions = this.getNodeParameter('extractOptions', i) as IDataObject;

						const body: Record<string, unknown> = {
							url,
							type: extractType,
						};
						if (extractOptions.selector) body.selector = extractOptions.selector;
						if (extractOptions.blockAds !== undefined) body.block_ads = extractOptions.blockAds;
						if (extractOptions.blockCookieBanners !== undefined) body.block_cookie_banners = extractOptions.blockCookieBanners;
						if (extractOptions.delay) body.delay = extractOptions.delay;
						if (extractOptions.maxLength) body.max_length = extractOptions.maxLength;

						const response = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'snapRenderApi',
							{
								method: 'POST',
								url: 'https://app.snap-render.com/v1/extract',
								body,
								json: true,
							},
						);
						returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					} else if (operation === 'batch') {
						const batchUrlsStr = this.getNodeParameter('batchUrls', i) as string;
						const format = this.getNodeParameter('format', i) as string;
						const fullPage = this.getNodeParameter('fullPage', i) as boolean;
						const device = this.getNodeParameter('device', i) as string;
						const darkMode = this.getNodeParameter('darkMode', i) as boolean;
						const blockAds = this.getNodeParameter('blockAds', i) as boolean;
						const blockCookieBanners = this.getNodeParameter('blockCookieBanners', i) as boolean;
						const additionalOptions = this.getNodeParameter('additionalOptions', i) as IDataObject;

						let urls: string[];
						try {
							urls = JSON.parse(batchUrlsStr) as string[];
						} catch {
							throw new NodeOperationError(this.getNode(), 'URLs must be a valid JSON array of strings', {
								itemIndex: i,
								description: 'Example: ["https://example.com", "https://example.org"]',
							});
						}

						const body: Record<string, unknown> = {
							urls,
							format,
							full_page: fullPage,
							dark_mode: darkMode,
							block_ads: blockAds,
							block_cookie_banners: blockCookieBanners,
						};
						if (device) body.device = device;
						if (additionalOptions.width) body.width = additionalOptions.width;
						if (additionalOptions.height) body.height = additionalOptions.height;
						if (additionalOptions.quality) body.quality = additionalOptions.quality;
						if (additionalOptions.delay) body.delay = additionalOptions.delay;
						if (additionalOptions.hideSelectors) body.hide_selectors = additionalOptions.hideSelectors;
						if (additionalOptions.clickSelector) body.click_selector = additionalOptions.clickSelector;

						const response = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'snapRenderApi',
							{
								method: 'POST',
								url: 'https://app.snap-render.com/v1/screenshot/batch',
								body,
								json: true,
							},
						);
						returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					} else if (operation === 'getBatchStatus') {
						const jobId = this.getNodeParameter('jobId', i) as string;
						const response = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'snapRenderApi',
							{
								method: 'GET',
								url: `https://app.snap-render.com/v1/screenshot/batch/${jobId}`,
								json: true,
							},
						);
						returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					} else if (operation === 'createWebhook') {
						const webhookUrl = this.getNodeParameter('webhookUrl', i) as string;
						const events = this.getNodeParameter('webhookEvents', i) as string[];
						const response = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'snapRenderApi',
							{
								method: 'POST',
								url: 'https://app.snap-render.com/v1/webhooks',
								body: { url: webhookUrl, events },
								json: true,
							},
						);
						returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					} else if (operation === 'listWebhooks') {
						const response = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'snapRenderApi',
							{
								method: 'GET',
								url: 'https://app.snap-render.com/v1/webhooks',
								json: true,
							},
						);
						if (Array.isArray(response)) {
							let webhooks = response as IDataObject[];
							if (this.getNode().typeVersion >= 2 && !(this.getNodeParameter('returnAll', i) as boolean)) {
								webhooks = webhooks.slice(0, this.getNodeParameter('limit', i) as number);
							}
							for (const wh of webhooks) {
								returnData.push({ json: wh, pairedItem: { item: i } });
							}
						} else {
							returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
						}
					} else if (operation === 'deleteWebhook') {
						const webhookId = this.getNodeParameter('webhookId', i) as string;
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'snapRenderApi',
							{
								method: 'DELETE',
								url: `https://app.snap-render.com/v1/webhooks/${webhookId}`,
							},
						);
						returnData.push({ json: { success: true, webhookId }, pairedItem: { item: i } });
					} else if (operation === 'testWebhook') {
						const webhookId = this.getNodeParameter('webhookId', i) as string;
						const response = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'snapRenderApi',
							{
								method: 'POST',
								url: `https://app.snap-render.com/v1/webhooks/${webhookId}/test`,
								json: true,
							},
						);
						returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					} else if (operation === 'screenshot') {
					const url = this.getNodeParameter('url', i) as string;
					const format = this.getNodeParameter('format', i) as string;
					const fullPage = this.getNodeParameter('fullPage', i) as boolean;
					const device = this.getNodeParameter('device', i) as string;
					const darkMode = this.getNodeParameter('darkMode', i) as boolean;
					const blockAds = this.getNodeParameter('blockAds', i) as boolean;
					const blockCookieBanners = this.getNodeParameter('blockCookieBanners', i) as boolean;
					const output = this.getNodeParameter('output', i) as string;
					const additionalOptions = this.getNodeParameter('additionalOptions', i) as IDataObject;

					const qs: Record<string, string | number | boolean> = {
						url,
						format,
						full_page: fullPage,
						dark_mode: darkMode,
						block_ads: blockAds,
						block_cookie_banners: blockCookieBanners,
					};

					if (device) qs.device = device;
					if (additionalOptions.width) qs.width = additionalOptions.width as number;
					if (additionalOptions.height) qs.height = additionalOptions.height as number;
					if (additionalOptions.quality) qs.quality = additionalOptions.quality as number;
					if (additionalOptions.delay) qs.delay = additionalOptions.delay as number;
					if (additionalOptions.hideSelectors)
						qs.hide_selectors = additionalOptions.hideSelectors as string;
					if (additionalOptions.clickSelector)
						qs.click_selector = additionalOptions.clickSelector as string;

					if (output === 'json') {
						qs.response_type = 'json';
						const response = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'snapRenderApi',
							{
								method: 'GET',
								url: 'https://app.snap-render.com/v1/screenshot',
								qs,
								json: true,
							},
						);
						returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					} else {
						const response = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'snapRenderApi',
							{
								method: 'GET',
								url: 'https://app.snap-render.com/v1/screenshot',
								qs,
								encoding: 'arraybuffer',
								returnFullResponse: true,
							},
						);

						const mimeTypes: Record<string, string> = {
							png: 'image/png',
							jpeg: 'image/jpeg',
							webp: 'image/webp',
							pdf: 'application/pdf',
						};

						const binaryData = await this.helpers.prepareBinaryData(
							Buffer.from((response as { body: Buffer }).body),
							`screenshot.${format === 'jpeg' ? 'jpg' : format}`,
							mimeTypes[format] || 'image/png',
						);

						returnData.push({
							json: {
								url,
								format,
								success: true,
							},
							binary: { data: binaryData },
							pairedItem: { item: i },
						});
					}
				}
			} catch (error) {
				const apiError = findApiError(error);
				const message = apiError ? `${apiError.code}: ${apiError.message}` : (error as Error).message;
				if (this.continueOnFail()) {
					const json: IDataObject = { error: message };
					if (apiError) {
						json.errorCode = apiError.code;
						if (apiError.status) json.httpCode = apiError.status;
					}
					returnData.push({ json, pairedItem: { item: i } });
				} else if (apiError) {
					// A fresh error from the API body: NodeApiError hands back an already wrapped error unchanged, which
					// would keep n8n's generic text for the status code.
					throw new NodeApiError(this.getNode(), { message, code: apiError.code } as JsonObject, {
						message,
						httpCode: apiError.status ? String(apiError.status) : undefined,
						itemIndex: i,
					});
				} else {
					throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
				}
			}
		}

		return [returnData];
	}
}
