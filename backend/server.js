#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const EventEmitter = require('events');
require('dotenv').config();

// Import simplified parallelization services
const ConcurrencyControl = require('./services/concurrencyControl');
const TaskScheduler = require('./services/analysisTasks');
const JobQueue = require('./services/jobQueue');
const MonitoringService = require('./services/monitoringService');

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);

// Global service instances
let pool = null;
let concurrencyControl = null;
let taskScheduler = null;
let jobQueue = null;
let monitoringService = null;

// Database connection pool management
async function getDbConnection() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20, // Maximum number of connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Handle pool errors to prevent unhandled rejections
    pool.on('error', (err) => {
      console.error('❌ Unexpected error on idle client in pool:', err);
      // Pool will handle reconnection automatically
    });

    console.log('✅ Database pool created');
  }
  
  return pool;
}

// Middleware
app.use(helmet());
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// WHOIS API configuration
const WHOIS_API_KEY = process.env.WHOIS_API_KEY;
const WHOIS_API_BASE_URL = 'https://api.apilayer.com/whois/query';

/**
 * Database initialization on startup
 */
async function initializeDatabase() {
  try {
    console.log('🔧 Initializing database...');
    const pool = await getDbConnection();
    
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
        await pool.query(statement);
      }
    }
    
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  }
}

/**
 * Initialize simplified parallelization services
 */
async function initializeParallelizationServices() {
  try {
    console.log('⚙️ Initializing parallelization services...');

    // Lightweight in-memory concurrency control
    concurrencyControl = new ConcurrencyControl({
      staleTimeout: 60000 // 60 seconds before stale cleanup
    });
    console.log('✅ Concurrency Control initialized');

    // Task scheduler (in-memory, no database)
    taskScheduler = new TaskScheduler();
    console.log('✅ Task Scheduler initialized');

    // Simple monitoring service
    monitoringService = new MonitoringService({
      historySize: 500
    });
    console.log('✅ Monitoring Service initialized');

    // Job queue with simple execution model
    jobQueue = new JobQueue(taskScheduler, concurrencyControl, {
      maxWorkers: parseInt(process.env.MAX_WORKERS || '4'),
      taskTimeout: 30000
    });
    console.log('✅ Job Queue initialized');

    // Listen to queue events for monitoring
    jobQueue.on('batch_completed', (data) => {
      console.log(`📦 Batch ${data.batchIndex + 1}/${data.totalBatches} completed`);
    });

    jobQueue.on('job_completed', (data) => {
      monitoringService.recordJobCompletion(data.jobId, data.duration);
      console.log(`✅ Job completed: ${data.jobId} (${data.duration}ms)`);
      broadcastJobUpdate({ id: data.jobId, status: 'completed', duration: data.duration });
    });

    jobQueue.on('job_failed', (data) => {
      console.error(`❌ Job failed: ${data.jobId} - ${data.error}`);
      broadcastJobUpdate({ id: data.jobId, status: 'failed', error: data.error });
    });

    console.log('✅ All parallelization services initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize parallelization services:', error.message);
    throw error;
  }
}

/**
 * Job Management Endpoints
 */

// Create job
app.post('/api/jobs', async (req, res) => {
  let client;
  try {
    const { url, pageType, options } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    const pool = await getDbConnection();
    client = await pool.connect();
    const jobId = uuidv4();
    const query = `
      INSERT INTO jobs (id, url, page_type, status, progress, session_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
    `;
    
    const result = await client.query(query, [jobId, url, pageType || 'home', 'pending', 0, options?.sessionId]);
    console.log(`✅ Job created: ${jobId} (${pageType || 'home'})`);

    // Check for duplicates using concurrency control
    const isAnalyzing = concurrencyControl.checkIfAnalyzing(url);
    if (isAnalyzing) {
      console.log(`⚠️ Analysis already in progress for ${url}`);
      return res.json({ 
        success: true, 
        job: result.rows[0],
        status: 'already_running',
        message: 'Analysis already in progress for this URL'
      });
    }

    // Start job execution in background (don't wait)
    const includeAI = options?.includeAI !== false;
    setImmediate(async () => {
      let bgClient;
      try {
        bgClient = await pool.connect();
        await jobQueue.executeJob(jobId, url, { pageType, ...options }, includeAI);
        
        // Update job status to completed
        await bgClient.query(
          'UPDATE jobs SET status = $1, progress = $2, updated_at = NOW() WHERE id = $3',
          ['completed', 100, jobId]
        );
      } catch (error) {
        console.error(`Job execution failed: ${error.message}`);
        try {
          if (bgClient) {
            await bgClient.query(
              'UPDATE jobs SET status = $1, message = $2, updated_at = NOW() WHERE id = $3',
              ['failed', error.message, jobId]
            );
          }
        } catch (updateError) {
          console.error('Failed to update job status:', updateError.message);
        }
      } finally {
        if (bgClient) bgClient.release();
      }
    });

    res.json({ success: true, job: result.rows[0] });
  } catch (error) {
    console.error('❌ Job creation failed:', error);
    res.status(500).json({ error: error.message });
  } finally {
    if (client) client.release();
  }
});

// Get job status
app.get('/api/jobs/:jobId', async (req, res) => {
  let client;
  try {
    const { jobId } = req.params;
    const pool = await getDbConnection();
    client = await pool.connect();
    const query = 'SELECT * FROM jobs WHERE id = $1';
    const result = await client.query(query, [jobId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({ success: true, job: result.rows[0] });
  } catch (error) {
    console.error('❌ Get job failed:', error);
    res.status(500).json({ error: error.message });
  } finally {
    if (client) client.release();
  }
});

// List jobs
app.get('/api/jobs', async (req, res) => {
  let client;
  try {
    const { limit = 50, offset = 0 } = req.query;
    const pool = await getDbConnection();
    client = await pool.connect();
    const query = 'SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2';
    const result = await client.query(query, [limit, offset]);
    res.json({ success: true, jobs: result.rows });
  } catch (error) {
    console.error('❌ List jobs failed:', error);
    res.status(500).json({ error: error.message });
  } finally {
    if (client) client.release();
  }
});

// Update job progress
app.patch('/api/jobs/:jobId', async (req, res) => {
  let client;
  try {
    const { jobId } = req.params;
    const { progress, status, message, stage, result } = req.body;
    const pool = await getDbConnection();
    client = await pool.connect();
    
    const updateQuery = `
      UPDATE jobs
      SET progress = COALESCE($1, progress),
          status = COALESCE($2, status),
          current_stage = COALESCE($3, current_stage),
          message = COALESCE($4, message),
          started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END,
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `;
    
    const updateResult = await client.query(updateQuery, [progress ?? null, status ?? null, stage ?? null, message ?? null, jobId]);
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
    
    // Broadcast to WebSocket clients
    broadcastJobUpdate(updateResult.rows[0]);
    
    console.log(`✅ Job updated: ${jobId} → ${status} (${progress}%)`);
    res.json({ success: true, job: updateResult.rows[0] });
  } catch (error) {
    console.error('❌ Update job failed:', error);
    res.status(500).json({ error: error.message });
  } finally {
    if (client) client.release();
  }
});

// Check if analysis already cached
app.get('/api/jobs/cached', async (req, res) => {
  let client;
  try {
    const { url, pageType } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    const pool = await getDbConnection();
    client = await pool.connect();
    const query = `
      SELECT j.*, jr.result_data
      FROM jobs j
      LEFT JOIN job_results jr ON j.id = jr.job_id
      WHERE j.url = $1 
        AND j.page_type = $2 
        AND j.status = 'completed'
        AND j.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY j.created_at DESC 
      LIMIT 1
    `;
    
    const result = await client.query(query, [url, pageType || 'home']);
    
    if (result.rows.length > 0) {
      console.log(`✅ Cache hit for ${pageType || 'home'}: ${url}`);
      res.json({ 
        success: true, 
        cached: true, 
        analysis: result.rows[0],
        cacheAge: Math.floor((Date.now() - new Date(result.rows[0].created_at).getTime()) / 1000) // seconds
      });
    } else {
      res.json({ 
        success: true, 
        cached: false 
      });
    }
  } catch (error) {
    console.error('❌ Cache lookup failed:', error);
    res.status(500).json({ error: error.message });
  } finally {
    if (client) client.release();
  }
});

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

/**
 * Parallelization Monitoring Endpoints
 */

// Get queue statistics
app.get('/api/queue/stats', async (req, res) => {
  try {
    if (!jobQueue) {
      return res.status(503).json({ error: 'Queue service not initialized' });
    }

    const stats = jobQueue.getQueueStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('❌ Queue stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get performance stats
app.get('/api/monitoring/performance', async (req, res) => {
  try {
    if (!monitoringService) {
      return res.status(503).json({ error: 'Monitoring service not initialized' });
    }

    const stats = monitoringService.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('❌ Performance stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get monitoring summary
app.get('/api/monitoring/summary', async (req, res) => {
  try {
    if (!monitoringService) {
      return res.status(503).json({ error: 'Monitoring service not initialized' });
    }

    const summary = monitoringService.getSummary();
    res.json({ success: true, summary });
  } catch (error) {
    console.error('❌ Summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get task metrics
app.get('/api/monitoring/tasks', async (req, res) => {
  try {
    if (!monitoringService) {
      return res.status(503).json({ error: 'Monitoring service not initialized' });
    }

    const metrics = monitoringService.exportMetrics();
    res.json({ success: true, metrics });
  } catch (error) {
    console.error('❌ Task metrics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const poolStatus = pool ? 'ready' : 'not initialized';
    
    // Try to get a connection to verify pool works
    let isHealthy = false;
    try {
      if (pool) {
        const testClient = await pool.connect();
        testClient.release();
        isHealthy = true;
      }
    } catch (e) {
      console.warn('Health check: Pool connection failed:', e.message);
      isHealthy = false;
    }

    res.json({ 
      status: isHealthy ? 'ok' : 'degraded', 
      timestamp: new Date().toISOString(), 
      database: {
        status: poolStatus,
        healthy: isHealthy
      },
      services: {
        concurrencyControl: !!concurrencyControl,
        taskScheduler: !!taskScheduler,
        jobQueue: !!jobQueue,
        monitoringService: !!monitoringService
      }
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: 'error',
      error: error.message
    });
  }
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
    await initializeParallelizationServices();

    server.listen(PORT, () => {
      console.log(`🚀 Shop Sentinel Backend running on port ${PORT}`);
      console.log(`📊 Health: http://localhost:${PORT}/health`);
      console.log(`📋 Jobs: http://localhost:${PORT}/api/jobs`);
      console.log(`🔗 WebSocket: ws://localhost:${PORT}/ws`);
      console.log(`📈 Monitoring: http://localhost:${PORT}/api/monitoring/performance`);
      console.log(`📊 Queue Stats: http://localhost:${PORT}/api/queue/stats`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down...');
  
  // Graceful shutdown of services
  if (jobQueue) {
    await jobQueue.shutdown();
  }
  
  if (pool) {
    await pool.end();
    console.log('✅ Database pool closed');
  }
  
  server.close();
  process.exit(0);
});

module.exports = app;