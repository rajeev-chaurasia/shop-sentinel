# Shop Sentinel Backend

Job coordination server for the Shop Sentinel extension. Tracks analysis jobs, provides real-time WebSocket updates, and stores results in PostgreSQL.

## Overview

The backend handles:
- Job creation and tracking
- WebSocket updates for real-time progress
- Result persistence across sessions
- WHOIS API proxy for domain verification
- Webhook delivery for analysis results

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
DATABASE_URL=postgresql://user:pass@localhost/shop_sentinel
WHOIS_API_KEY=your_api_key_here
PORT=3002
NODE_ENV=development
```

### 3. Database

```bash
# Run migrations to create tables
node scripts/migrate.js
```

Or manually run `schema.sql` in your PostgreSQL client.

### 4. Start Server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:3002`

## API Endpoints

### Jobs
- `POST /api/jobs` - Create new job
- `GET /api/jobs/:jobId` - Get job status
- `PUT /api/jobs/:jobId` - Update job
- `POST /api/jobs/:jobId/complete` - Mark complete
- `POST /api/jobs/:jobId/progress` - Update progress

### Health
- `GET /health` - Server health check

## WebSocket

Connect at `ws://localhost:3002` for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3002');

ws.send(JSON.stringify({
  type: 'subscribe_job',
  jobId: 'your-job-id'
}));

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Update:', data);
};
```

## Testing

```bash
# Health check
curl http://localhost:3002/health

# Create job
curl -X POST http://localhost:3002/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Update progress
curl -X POST http://localhost:3002/api/jobs/{jobId}/progress \
  -H "Content-Type: application/json" \
  -d '{"progress": 50, "message": "Analyzing..."}'

# Complete job
curl -X POST http://localhost:3002/api/jobs/{jobId}/complete \
  -H "Content-Type: application/json" \
  -d '{"result": {"risk": "low"}}'
```

## Database Schema

See `schema.sql` for complete schema. Main tables:

- `jobs` - Analysis jobs
- `job_results` - Job results
- `webhooks` - Webhook configurations
- `webhook_deliveries` - Webhook delivery history</content>
<parameter name="filePath">/Users/maverickrajeev/Desktop/shop-sentinel/backend/README.md