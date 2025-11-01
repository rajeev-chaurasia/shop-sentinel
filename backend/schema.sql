-- Database Schema for Shop Sentinel

-- Jobs table: Core job tracking
-- Stores each analysis request
CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(255) PRIMARY KEY,
  url TEXT NOT NULL,
  page_type VARCHAR(100) DEFAULT 'home',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  current_stage VARCHAR(100),
  message TEXT,
  content_hash VARCHAR(255),
  session_id VARCHAR(255),
  started_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Job results table: Analysis results storage
-- Stores the final analysis output as JSON
CREATE TABLE IF NOT EXISTS job_results (
  job_id VARCHAR(255) PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  result_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_session_id ON jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_url_page_type ON jobs(url, page_type);
CREATE INDEX IF NOT EXISTS idx_jobs_url_page_type_status ON jobs(url, page_type, status) WHERE status = 'completed';
