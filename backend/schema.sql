-- Database schema for Shop Sentinel
-- Run this in your Vercel Postgres database

-- Jobs table for tracking analysis jobs
CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(255) PRIMARY KEY,
  url TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  message TEXT,
  session_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Job results table for storing analysis results
CREATE TABLE IF NOT EXISTS job_results (
  job_id VARCHAR(255) PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  result_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_session_id ON jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

-- Optional: Clean up old jobs (run periodically)
-- DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '30 days';
-- DELETE FROM job_results WHERE created_at < NOW() - INTERVAL '30 days';

-- Webhooks table for storing webhook configurations
CREATE TABLE IF NOT EXISTS webhooks (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255),
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT[] DEFAULT ARRAY['analysis_complete'],
  is_active BOOLEAN DEFAULT true,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_triggered_at TIMESTAMP
);

-- Webhook deliveries table for tracking webhook attempts
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id VARCHAR(255) PRIMARY KEY,
  webhook_id VARCHAR(255) REFERENCES webhooks(id) ON DELETE CASCADE,
  job_id VARCHAR(255) REFERENCES jobs(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  response_status INTEGER,
  response_body TEXT,
  error_message TEXT,
  attempt_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMP
);

-- Indexes for webhook tables
CREATE INDEX IF NOT EXISTS idx_webhooks_session_id ON webhooks(session_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(is_active);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_job_id ON webhook_deliveries(job_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);