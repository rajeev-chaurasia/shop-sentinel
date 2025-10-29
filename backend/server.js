#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);

// Middleware
app.use(helmet());
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Database connection
let dbClient = null;

async function getDbConnection() {
  if (dbClient) return dbClient;
  
  try {
    const client = new Client({
      connectionString: process.env.DATABASE_URL
    });
    await client.connect();
    dbClient = client;
    console.log('✅ Database connected');
    return client;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
}

// WHOIS API configuration
const WHOIS_API_KEY = process.env.WHOIS_API_KEY;
const WHOIS_API_BASE_URL = 'https://api.apilayer.com/whois/query';

/**
 * Database initialization on startup
 */
async function initializeDatabase() {
  try {
    console.log('🔧 Initializing database...');
    const client = await getDbConnection();
    
    // Read schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      console.warn('⚠️ schema.sql not found, skipping initialization');
      return;
    }
    
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const statements = schema.split(';').filter(s => s.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        await client.query(statement);
      }
    }
    
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
  }
}

/**
 * Job Management Endpoints
 */

// Create job
app.post('/api/jobs', async (req, res) => {
  try {
    const { url, options } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    const client = await getDbConnection();
    const jobId = uuidv4();
    const query = `
      INSERT INTO jobs (id, url, status, progress, session_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await client.query(query, [jobId, url, 'pending', 0, options?.sessionId]);
    console.log(`✅ Job created: ${jobId}`);
    res.json({ success: true, job: result.rows[0] });
  } catch (error) {
    console.error('❌ Job creation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get job status
app.get('/api/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const client = await getDbConnection();
    const query = 'SELECT * FROM jobs WHERE id = $1';
    const result = await client.query(query, [jobId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({ success: true, job: result.rows[0] });
  } catch (error) {
    console.error('❌ Get job failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// List jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const client = await getDbConnection();
    const query = 'SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2';
    const result = await client.query(query, [limit, offset]);
    res.json({ success: true, jobs: result.rows });
  } catch (error) {
    console.error('❌ List jobs failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update job progress
app.patch('/api/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { progress, status, message, result } = req.body;
    const client = await getDbConnection();
    
    const updateQuery = `
      UPDATE jobs
      SET progress = COALESCE($1, progress),
          status = COALESCE($2, status),
          message = COALESCE($3, message),
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;
    
    const updateResult = await client.query(updateQuery, [progress ?? null, status ?? null, message ?? null, jobId]);
    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Store results if provided
    if (result) {
      const resultQuery = `
        INSERT INTO job_results (job_id, result_data, created_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (job_id) DO UPDATE SET result_data = $2
      `;
      await client.query(resultQuery, [jobId, JSON.stringify(result)]);
    }
    
    // Trigger webhooks if completed
    if (status === 'completed') {
      triggerWebhooks(jobId, result).catch(err => console.error('Webhook error:', err));
    }
    
    // Broadcast to WebSocket clients
    broadcastJobUpdate(updateResult.rows[0]);
    
    console.log(`✅ Job updated: ${jobId} → ${status} (${progress}%)`);
    res.json({ success: true, job: updateResult.rows[0] });
  } catch (error) {
    console.error('❌ Update job failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Webhook Management Endpoints
 */

// Register webhook
app.post('/api/webhooks', async (req, res) => {
  try {
    const { url, events, secret } = req.body;
    if (!url || !events) {
      return res.status(400).json({ error: 'URL and events required' });
    }
    
    const client = await getDbConnection();
    const webhookId = uuidv4();
    const webhookSecret = secret || crypto.randomBytes(32).toString('hex');
    
    const query = `
      INSERT INTO webhooks (id, url, secret, events, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, true, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await client.query(query, [webhookId, url, webhookSecret, events]);
    console.log(`✅ Webhook registered: ${webhookId}`);
    res.json({ success: true, webhook: result.rows[0] });
  } catch (error) {
    console.error('❌ Webhook registration failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// List webhooks
app.get('/api/webhooks', async (req, res) => {
  try {
    const client = await getDbConnection();
    const query = 'SELECT * FROM webhooks WHERE is_active = true ORDER BY created_at DESC';
    const result = await client.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ List webhooks failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete webhook
app.delete('/api/webhooks/:webhookId', async (req, res) => {
  try {
    const { webhookId } = req.params;
    const client = await getDbConnection();
    const query = 'UPDATE webhooks SET is_active = false WHERE id = $1 RETURNING *';
    const result = await client.query(query, [webhookId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    console.log(`✅ Webhook deleted: ${webhookId}`);
    res.json({ success: true, webhook: result.rows[0] });
  } catch (error) {
    console.error('❌ Delete webhook failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get webhook deliveries (for debugging/monitoring)
app.get('/api/webhooks/deliveries', async (req, res) => {
  try {
    const client = await getDbConnection();
    const query = `
      SELECT * FROM webhook_deliveries 
      ORDER BY delivered_at DESC NULLS LAST
      LIMIT 50
    `;
    const result = await client.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Get deliveries failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Trigger webhooks on job completion
 */
async function triggerWebhooks(jobId, result) {
  try {
    const client = await getDbConnection();
    const webhooksQuery = 'SELECT * FROM webhooks WHERE is_active = true';
    const webhooksResult = await client.query(webhooksQuery);
    
    for (const webhook of webhooksResult.rows) {
      if (!webhook.events.includes('analysis_complete')) continue;
      
      const deliveryId = uuidv4();
      const payload = { event: 'analysis_complete', jobId, result, timestamp: Date.now() };
      const signature = crypto
        .createHmac('sha256', webhook.secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Delivery': deliveryId
          },
          body: JSON.stringify(payload),
          timeout: 10000
        });
        
        const deliveryQuery = `
          INSERT INTO webhook_deliveries (id, webhook_id, job_id, event_type, payload, status, response_status, delivered_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `;
        await client.query(deliveryQuery, [
          deliveryId, webhook.id, jobId, 'analysis_complete',
          JSON.stringify(payload), response.ok ? 'delivered' : 'failed', response.status
        ]);
        
        console.log(`✅ Webhook delivered: ${webhook.url}`);
      } catch (error) {
        const failedDeliveryQuery = `
          INSERT INTO webhook_deliveries (id, webhook_id, job_id, event_type, payload, status, error_message)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        await client.query(failedDeliveryQuery, [
          deliveryId, webhook.id, jobId, 'analysis_complete',
          JSON.stringify(payload), 'pending', error.message
        ]);
        console.error(`⚠️ Webhook delivery failed: ${webhook.url}`);
      }
    }
  } catch (error) {
    console.error('❌ Webhook trigger failed:', error);
  }
}

/**
 * WebSocket for Real-Time Job Updates
 */

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const connectedClients = new Set();

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          if (data.action === 'subscribe') {
            ws.jobId = data.jobId;
            console.log(`📡 Client subscribed to job: ${data.jobId}`);
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });
      connectedClients.add(ws);
      ws.on('close', () => connectedClients.delete(ws));
    });
  }
});

function broadcastJobUpdate(job) {
  for (const client of connectedClients) {
    if (!client.jobId || client.jobId === job.id) {
      try {
        client.send(JSON.stringify({ type: 'job_update', job }));
      } catch (error) {
        console.error('Failed to send WebSocket message:', error);
      }
    }
  }
}

/**
 * WHOIS proxy endpoint (existing)
 */
app.get('/api/whois/:domain', async (req, res) => {
  try {
    const { domain } = req.params;
    if (!domain) {
      return res.status(400).json({ error: 'Domain parameter is required' });
    }

    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!domainRegex.test(domain)) {
      return res.status(400).json({ error: 'Invalid domain format' });
    }

    console.log(`🌐 Fetching WHOIS data for: ${domain}`);

    const response = await fetch(
      `${WHOIS_API_BASE_URL}?domain=${domain}`,
      { method: 'GET', headers: { 'apikey': WHOIS_API_KEY } }
    );

    if (!response.ok) {
      console.error(`WHOIS API error: ${response.status}`);
      return res.status(response.status).json({ error: `WHOIS API error: ${response.status}` });
    }

    const data = await response.json();
    if (!data.result) {
      console.warn(`No WHOIS result for: ${domain}`);
      return res.status(404).json({ error: 'No WHOIS data found' });
    }

    console.log(`✅ WHOIS data retrieved for: ${domain}`);
    res.json({ success: true, domain, data: data.result });
  } catch (error) {
    console.error('WHOIS proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), database: dbClient ? 'connected' : 'disconnected' });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const startServer = async () => {
  try {
    await initializeDatabase();
    server.listen(PORT, () => {
      console.log(`🚀 Shop Sentinel Backend running on port ${PORT}`);
      console.log(`📊 Health: http://localhost:${PORT}/health`);
      console.log(`� Jobs: http://localhost:${PORT}/api/jobs`);
      console.log(`🔗 WebSocket: ws://localhost:${PORT}/ws`);
      console.log(`🪝 Webhooks: http://localhost:${PORT}/api/webhooks`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down...');
  if (dbClient) await dbClient.end();
  server.close();
  process.exit(0);
});

module.exports = app;