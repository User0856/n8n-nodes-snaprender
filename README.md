# n8n-nodes-snaprender

[n8n](https://n8n.io) community node for [SnapRender Screenshot API](https://snap-render.com). Capture website screenshots as PNG, JPEG, WebP, or PDF, and turn web pages into clean markdown or text, directly in your n8n workflows.

## Install

In your n8n instance:

1. Go to **Settings** > **Community Nodes**
2. Enter `n8n-nodes-snaprender`
3. Click **Install**

## Credentials

1. Sign up at [snap-render.com](https://snap-render.com/auth/signup) (free, no credit card)
2. Create an API key in your dashboard
3. In n8n, go to **Credentials** > **New** > **SnapRender API**
4. Paste your API key (starts with `sk_live_`)

## Operations

Operations are grouped by resource.

| Resource | Operations |
| --- | --- |
| Screenshot | Take, Sign URL, Check Cache, Create Batch, Get Batch Status |
| Content | Extract (markdown, plain text, HTML, article, links, metadata) |
| Webhook | Create, Delete, Get Many, Test |
| Account | Get Usage |

### Screenshot: Take

Capture any website as PNG, JPEG, WebP, or PDF.

- **URL**: website to capture
- **Format**: JPEG, PDF, PNG, or WebP
- **Full Page**: capture the entire scrollable page
- **Device**: iPad Pro, iPhone 14, iPhone 15 Pro, MacBook Pro, Pixel 7
- **Dark Mode**: enable dark mode CSS emulation
- **Block Ads**: remove advertisements
- **Block Cookie Banners**: remove cookie consent popups
- **Output**: Binary (image file) or JSON (base64 data URI)
- **Additional Options**: click selector, delay, height, hide selectors, quality, width

### Screenshot: Check Cache

Check if a screenshot is cached without capturing. Free, doesn't count against quota.

### Account: Get Usage

Get current month's screenshot usage statistics.

### Workflows built with older versions

Nodes added before version 0.2.6 keep their single Operation list and work unchanged. New nodes use the resource layout above.

## Example Workflow

1. **Trigger** (e.g., webhook, schedule, form)
2. **SnapRender** node: Screenshot > Take with the URL from the trigger
3. **Send Email** / **Save to S3** / **Slack**: use the binary output

## Free Tier

200 screenshots/month, no credit card required. Paid plans from $9/month.

## Links

- [SnapRender Website](https://snap-render.com)
- [API Documentation](https://snap-render.com/docs)
- [SnapRender on n8n](https://n8n.io/integrations/snaprender)
- [Setup guide and tested workflows](https://snap-render.com/integrations/n8n)
- [GitHub](https://github.com/User0856/n8n-nodes-snaprender)

## License

MIT

## Changelog

- 0.2.7: README describes content extraction and links the n8n integration page
- 0.2.6: operations grouped into Screenshot, Content, Webhook and Account resources (existing workflows unchanged), SVG icons with dark theme variants, alphabetized options, clearer error for invalid batch URL lists
- 0.2.5: failed requests show SnapRender's own error code and message
