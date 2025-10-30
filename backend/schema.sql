-- Database schema for Shop Sentinel
-- Run this in your Vercel Postgres database

-- Jobs table for tracking analysis jobs
CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(255) PRIMARY KEY,
  url TEXT NOT NULL,
  page_type VARCHAR(100) DEFAULT 'home',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  message TEXT,
  content_hash VARCHAR(255),
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
CREATE INDEX IF NOT EXISTS idx_jobs_url_page_type ON jobs(url, page_type);
CREATE INDEX IF NOT EXISTS idx_jobs_url_page_type_status ON jobs(url, page_type, status) WHERE status = 'completed';
