import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

export class SnapRender implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SnapRender',
		name: 'snapRender',
		icon: 'file:snaprender.png',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Capture website screenshots as PNG, JPEG, WebP, or PDF',
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
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Take Screenshot',
						value: 'screenshot',
						description: 'Capture a screenshot of a website',
						action: 'Capture a screenshot of a website',
					},
					{
						name: 'Sign URL',
						value: 'signUrl',
						description: 'Generate a signed screenshot URL (free, no quota cost)',
						action: 'Generate a signed screenshot URL',
					},
					{
						name: 'Extract Content',
						value: 'extract',
						description: 'Extract content from a web page (markdown, text, HTML, article, links, metadata)',
						action: 'Extract content from a web page',
					},
					{
						name: 'Batch Screenshots',
						value: 'batch',
						description: 'Create a batch screenshot job for multiple URLs (1-50)',
						action: 'Create a batch screenshot job',
					},
					{
						name: 'Get Batch Status',
						value: 'getBatchStatus',
						description: 'Get the status of a batch screenshot job',
						action: 'Get batch job status',
					},
					{
						name: 'Create Webhook',
						value: 'createWebhook',
						description: 'Register a webhook for event notifications',
						action: 'Create a webhook',
					},
					{
						name: 'List Webhooks',
						value: 'listWebhooks',
						description: 'List all webhooks for the account',
						action: 'List webhooks',
					},
					{
						name: 'Delete Webhook',
						value: 'deleteWebhook',
						description: 'Delete a webhook by ID',
						action: 'Delete a webhook',
					},
					{
						name: 'Test Webhook',
						value: 'testWebhook',
						description: 'Send a test delivery to a webhook',
						action: 'Test a webhook',
					},
					{
						name: 'Check Cache',
						value: 'checkCache',
						description: 'Check if a screenshot is cached (free, no quota cost)',
						action: 'Check if a screenshot is cached',
					},
					{
						name: 'Get Usage',
						value: 'getUsage',
						description: 'Get current month screenshot usage statistics',
						action: 'Get usage statistics',
					},
				],
				default: 'screenshot',
			},

			// --- Screenshot, Sign, Cache Check params ---
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com',
				description: 'URL of the website to capture',
				displayOptions: {
					show: { operation: ['screenshot', 'signUrl', 'checkCache', 'extract'] },
				},
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				options: [
					{ name: 'PNG', value: 'png' },
					{ name: 'JPEG', value: 'jpeg' },
					{ name: 'WebP', value: 'webp' },
					{ name: 'PDF', value: 'pdf' },
				],
				default: 'png',
				description: 'Output image format',
				displayOptions: {
					show: { operation: ['screenshot', 'signUrl', 'checkCache', 'batch'] },
				},
			},

			// --- Sign URL params ---
			{
				displayName: 'Expires In (Seconds)',
				name: 'expiresIn',
				type: 'number',
				default: 86400,
				description: 'URL validity in seconds (60-2592000, default: 86400 = 1 day)',
				typeOptions: { minValue: 60, maxValue: 2592000 },
				displayOptions: { show: { operation: ['signUrl'] } },
			},

			// --- Extract params ---
			{
				displayName: 'Extraction Type',
				name: 'extractType',
				type: 'options',
				options: [
					{ name: 'Markdown', value: 'markdown' },
					{ name: 'Plain Text', value: 'text' },
					{ name: 'HTML', value: 'html' },
					{ name: 'Article', value: 'article' },
					{ name: 'Links', value: 'links' },
					{ name: 'Metadata', value: 'metadata' },
				],
				default: 'markdown',
				description: 'Type of content to extract',
				displayOptions: { show: { operation: ['extract'] } },
			},
			{
				displayName: 'Extract Options',
				name: 'extractOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['extract'] } },
				options: [
					{
						displayName: 'Selector',
						name: 'selector',
						type: 'string',
						default: '',
						description: 'CSS selector to scope extraction to a specific element',
					},
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
				displayOptions: { show: { operation: ['batch'] } },
			},

			// --- Batch Status params ---
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
				description: 'The batch job ID returned by Batch Screenshots',
				displayOptions: { show: { operation: ['getBatchStatus'] } },
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
				displayOptions: { show: { operation: ['createWebhook'] } },
			},
			{
				displayName: 'Events',
				name: 'webhookEvents',
				type: 'multiOptions',
				options: [
					{ name: 'Screenshot Completed', value: 'screenshot.completed' },
					{ name: 'Quota Warning (80%)', value: 'quota.warning' },
					{ name: 'Quota Exceeded (100%)', value: 'quota.exceeded' },
				],
				default: ['screenshot.completed'],
				required: true,
				description: 'Events to subscribe to',
				displayOptions: { show: { operation: ['createWebhook'] } },
			},
			{
				displayName: 'Webhook ID',
				name: 'webhookId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
				description: 'The webhook ID to operate on',
				displayOptions: { show: { operation: ['deleteWebhook', 'testWebhook'] } },
			},

			// --- Screenshot-only params ---
			{
				displayName: 'Full Page',
				name: 'fullPage',
				type: 'boolean',
				default: false,
				description: 'Whether to capture the entire scrollable page',
				displayOptions: { show: { operation: ['screenshot', 'signUrl', 'batch'] } },
			},
			{
				displayName: 'Device',
				name: 'device',
				type: 'options',
				options: [
					{ name: 'Desktop (Default)', value: '' },
					{ name: 'iPhone 14', value: 'iphone_14' },
					{ name: 'iPhone 15 Pro', value: 'iphone_15_pro' },
					{ name: 'Pixel 7', value: 'pixel_7' },
					{ name: 'iPad Pro', value: 'ipad_pro' },
					{ name: 'MacBook Pro', value: 'macbook_pro' },
				],
				default: '',
				description: 'Device preset for viewport emulation',
				displayOptions: { show: { operation: ['screenshot', 'signUrl', 'batch'] } },
			},
			{
				displayName: 'Dark Mode',
				name: 'darkMode',
				type: 'boolean',
				default: false,
				description: 'Whether to enable dark mode CSS emulation',
				displayOptions: { show: { operation: ['screenshot', 'signUrl', 'batch'] } },
			},
			{
				displayName: 'Block Ads',
				name: 'blockAds',
				type: 'boolean',
				default: true,
				description: 'Whether to block advertisements and trackers',
				displayOptions: { show: { operation: ['screenshot', 'signUrl', 'batch'] } },
			},
			{
				displayName: 'Block Cookie Banners',
				name: 'blockCookieBanners',
				type: 'boolean',
				default: true,
				description: 'Whether to remove cookie consent banners',
				displayOptions: { show: { operation: ['screenshot', 'signUrl', 'batch'] } },
			},
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['screenshot', 'signUrl', 'batch'] } },
				options: [
					{
						displayName: 'Width',
						name: 'width',
						type: 'number',
						default: 1280,
						description: 'Viewport width in pixels (320-3840)',
						typeOptions: { minValue: 320, maxValue: 3840 },
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
						displayName: 'Quality',
						name: 'quality',
						type: 'number',
						default: 90,
						description: 'Image quality for JPEG/WebP (1-100)',
						typeOptions: { minValue: 1, maxValue: 100 },
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
						displayName: 'Hide Selectors',
						name: 'hideSelectors',
						type: 'string',
						default: '',
						description: 'Comma-separated CSS selectors to hide before capture',
					},
					{
						displayName: 'Click Selector',
						name: 'clickSelector',
						type: 'string',
						default: '',
						description: 'CSS selector to click before capture',
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
				displayOptions: { show: { operation: ['screenshot'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

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
							throw new Error('URLs must be a valid JSON array of strings');
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
							for (const wh of response) {
								returnData.push({ json: wh as IDataObject, pairedItem: { item: i } });
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
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
				} else {
					throw new NodeApiError(this.getNode(), { message: (error as Error).message });
				}
			}
		}

		return [returnData];
	}
}
