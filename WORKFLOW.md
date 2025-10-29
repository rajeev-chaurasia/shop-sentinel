# Shop Sentinel Job Workflow

This document describes the complete flow from user initiating a scan to receiving analysis results via webhooks.

## Architecture Overview

The system has three main components:

1. **Chrome Extension** - Local analysis engine (popup + content scripts)
2. **Backend Server** - Job coordination and persistence  
3. **User's Webhook Endpoint** - Receives completion notifications

## Complete Workflow

### Phase 1: User Initiates Scan

1. User clicks extension icon → popup opens
2. User clicks "Scan Page" button
3. Popup sends message to content script with URL to analyze

```javascript
// Extension popup triggers analysis
await MessagingService.sendToTab(tabId, 'ANALYZE_PAGE', {
  useAI: true,
  useWhoisVerification: true,
  url: currentUrl
});
```

### Phase 2: Job Creation at Backend

1. Extension creates job at backend: `POST /api/jobs`
2. Backend generates unique `jobId` and stores in database
3. Backend responds with job record

```bash
POST /api/jobs
Content-Type: application/json

{ "url": "https://example.com", "options": { "sessionId": "..." } }

Response: { "job": { "id": "uuid", "status": "pending", "progress": 0, ... } }
```

**Database Record Created:**
```sql
INSERT INTO jobs (id, url, status, progress, session_id, created_at, updated_at)
VALUES ('uuid', 'https://example.com', 'pending', 0, 'sessionId', NOW(), NOW());
```

### Phase 3: Local Analysis Execution

1. Extension performs analysis locally using Chrome's Gemini Nano AI model
2. Extension may call domain verification: `GET /whois/{domain}` (optional)
3. Extension generates risk score, detects dark patterns, finds policies

**Timeline:** 15-30 seconds depending on page size

### Phase 4: Progress Updates

During analysis, extension sends progress updates:

```bash
PATCH /api/jobs/{jobId}
Content-Type: application/json

{ 
  "progress": 50, 
  "message": "Analyzing content patterns..." 
}
```

**Database Updated:**
```sql
UPDATE jobs 
SET progress = 50, message = '...', updated_at = NOW()
WHERE id = 'jobId';
```

**Real-time Notification:** Backend broadcasts to WebSocket clients:
```javascript
// Broadcast to all connected clients
broadcastJobUpdate({ id, progress: 50, status: 'analyzing', ... });
```

### Phase 5: Job Completion

When analysis finishes, extension marks job complete:

```bash
PATCH /api/jobs/{jobId}
Content-Type: application/json

{ 
  "status": "completed",
  "progress": 100,
  "result": {
    "riskScore": 45,
    "issues": [...],
    "darkPatterns": [...],
    "policies": {...}
  }
}
```

**Database Updated:**
1. Job marked complete
2. Results stored in job_results table

```sql
UPDATE jobs SET status = 'completed', progress = 100, updated_at = NOW() WHERE id = 'jobId';

INSERT INTO job_results (job_id, result_data, created_at)
VALUES ('jobId', '{"riskScore": 45, ...}', NOW());
```

### Phase 6: Webhook Triggering

When `status = 'completed'`, backend:

1. Queries all active webhooks filtered for `analysis_complete` event
2. Generates HMAC-SHA256 signature of payload
3. Sends POST to webhook URL with headers:
   - `X-Webhook-Signature` - HMAC signature for verification
   - `X-Webhook-Delivery` - Unique delivery ID for tracking

```bash
POST {webhook.url}
Content-Type: application/json
X-Webhook-Signature: sha256=abcd1234...
X-Webhook-Delivery: uuid

{
  "event": "analysis_complete",
  "jobId": "uuid",
  "result": { "riskScore": 45, ... },
  "timestamp": 1704067200000
}
```

**Database Record Created:**
```sql
INSERT INTO webhook_deliveries (id, webhook_id, job_id, event_type, payload, status, response_status, delivered_at)
VALUES ('delivery-uuid', 'webhook-id', 'job-id', 'analysis_complete', '{...}', 'delivered', 200, NOW());
```

### Phase 7: Extension Receives Completion

1. Extension polls backend for job updates (every 1500ms)
2. Or receives WebSocket update if connected
3. Displays results in popup UI
4. Caches results locally for offline access

## API Reference

### Jobs

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/jobs` | Create new analysis job |
| `GET` | `/api/jobs/:jobId` | Get job status |
| `GET` | `/api/jobs` | List recent jobs |
| `PATCH` | `/api/jobs/:jobId` | Update job (progress/status/result) |

### Webhooks

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/webhooks` | Register webhook endpoint |
| `GET` | `/api/webhooks` | List active webhooks |
| `DELETE` | `/api/webhooks/:webhookId` | Deactivate webhook |
| `GET` | `/api/webhooks/deliveries` | View delivery history (debugging) |

### Health

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/health` | Server health check |

### Domain Verification (Optional)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/whois/:domain` | WHOIS lookup via APILayer |

## Timing & Performance

| Step | Duration | Notes |
|------|----------|-------|
| Job creation | ~50ms | Fast database insert |
| Local analysis | 15-30s | Depends on page size & AI model |
| Progress polling | Every 1500ms | UI updates client-side |
| Webhook delivery | ~1-5s | Depends on user's webhook server |

## Error Handling

### Extension Failures
- If analysis fails: extension marks job as `failed` with error message
- Extension retries failed operations (max 2 retries with exponential backoff)
- User sees error in popup UI

### Backend Failures
- If job update fails: Extension queues for retry
- Max 2 retry attempts, exponential backoff (500ms, 1000ms)

### Webhook Failures
- If webhook endpoint unreachable/times out: status = `pending` (retry in future)
- If webhook endpoint returns non-2xx: status = `failed` with response code
- Failed webhooks not retried automatically (monitored via `/api/webhooks/deliveries`)

## Database Schema

### Jobs Table
```sql
id (uuid, PK)
url (text)
status (pending|analyzing|completed|failed)
progress (0-100)
message (optional error/status text)
session_id (optional, for multi-tab sync)
created_at, updated_at
```

### Job Results Table
```sql
job_id (uuid, PK, FK)
result_data (JSONB with analysis)
created_at
```

### Webhooks Table
```sql
id (uuid, PK)
url (text)
secret (HMAC key)
events (array: analysis_complete)
is_active (boolean)
failure_count (tracking)
session_id (optional)
created_at, updated_at
```

### Webhook Deliveries Table
```sql
id (uuid, PK)
webhook_id (FK)
job_id (FK)
event_type (analysis_complete)
payload (JSONB)
status (delivered|failed|pending)
response_status (HTTP code)
error_message (if failed)
created_at, delivered_at
```

## Configuration

### Environment Variables

**Backend:**
- `DATABASE_URL` - PostgreSQL connection string
- `WHOIS_API_KEY` - APILayer WHOIS API key (for optional domain verification)
- `PORT` - Server port (default: 3002)
- `NODE_ENV` - development/production

**Frontend:**
- `VITE_BACKEND_API_URL` - Backend API base URL (default: http://localhost:3002)
- `VITE_BACKEND_WS_URL` - WebSocket URL (default: ws://localhost:3002)

### Constants (Tuned in `src/config/constants.ts`)

- `POLL_INTERVAL` - 1500ms (extension checks job status every 1.5 seconds)
- `FALLBACK_CACHE_CHECK_TIMEOUT` - 8000ms (redundant check after 8 seconds)
- `REQUEST_TIMEOUT` - 10000ms (HTTP requests timeout after 10 seconds)
- `MESSAGE_TIMEOUT` - 30000ms (Inter-component messages timeout after 30 seconds)
- `MAX_RETRIES` - 2 (Operations retry up to 2 times)

## Webhook Integration Example

To receive analysis results, register a webhook:

```bash
curl -X POST http://localhost:3002/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.com/webhooks/analysis",
    "events": ["analysis_complete"],
    "secret": "your-secret-key"
  }'
```

Webhook server verifies signature and processes result:

```javascript
// Express webhook handler
app.post('/webhooks/analysis', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const deliveryId = req.headers['x-webhook-delivery'];
  const payload = req.body;
  
  // Verify HMAC signature
  const expectedSignature = crypto
    .createHmac('sha256', 'your-secret-key')
    .update(JSON.stringify(payload))
    .digest('hex');
  
  if (signature !== `sha256=${expectedSignature}`) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process result
  console.log('Analysis complete:', payload);
  res.json({ received: true });
});
```

## Monitoring & Debugging

### View Recent Jobs
```bash
curl http://localhost:3002/api/jobs?limit=10
```

### Check Webhook Deliveries
```bash
curl http://localhost:3002/api/webhooks/deliveries
```

### Monitor WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:3002/ws');
ws.send(JSON.stringify({ action: 'subscribe', jobId: 'job-uuid' }));
ws.onmessage = (event) => console.log('Update:', event.data);
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Configure `DATABASE_URL` to production PostgreSQL
3. Set `WHOIS_API_KEY` for domain verification
4. Configure webhook signing key (use strong secret)
5. Enable HTTPS for `/api/webhooks` endpoints
6. Set `VITE_BACKEND_API_URL` to production domain
7. Set `VITE_BACKEND_WS_URL` to production WebSocket URL (wss:// for HTTPS)

## Troubleshooting

### "Job not found" error
- Ensure backend is running on correct port
- Check `VITE_BACKEND_API_URL` in extension config
- Verify database is initialized

### Webhooks not firing
- Check webhook is registered: `GET /api/webhooks`
- View delivery history: `GET /api/webhooks/deliveries`
- Ensure webhook URL is publicly accessible
- Check webhook secret matches in signature verification

### Analysis stuck on "analyzing"
- Check extension service worker logs
- Verify AI model is available in Chrome (Settings → Experimental AI)
- Try disabling WHOIS verification if domain lookup is slow
