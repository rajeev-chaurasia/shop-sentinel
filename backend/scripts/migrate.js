// Database migration script for Shop Sentinel
// Creates the required tables for the current schema:
// - jobs: Analysis job tracking
// - job_results: Analysis results storage
// - webhooks: Webhook configurations
// - webhook_deliveries: Webhook delivery tracking
require('dotenv').config();
const { Client } = require('pg');

async function runMigrations() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_Rr5zFnwYj0yc@ep-twilight-grass-afg62ax2-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  });

  try {
    await client.connect();
    console.log('🚀 Starting database migrations for Shop Sentinel backend...');

    // Create jobs table for tracking analysis jobs
    await client.query(`
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
    `);

    // Create job_results table for storing analysis results
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_results (
        job_id VARCHAR(255) PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        result_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create webhooks table for storing webhook configurations
    await client.query(`
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
    `);

    // Create webhook_deliveries table for tracking webhook attempts
    await client.query(`
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
    `);

    // Create indexes for better performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_session_id ON jobs(session_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_webhooks_session_id ON webhooks(session_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(is_active);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_job_id ON webhook_deliveries(job_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);`);

    console.log('✅ Database migrations completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations().then(() => {
    console.log('🎉 Migration script completed');
    process.exit(0);
  }).catch((error) => {
    console.error('💥 Migration script failed:', error);
    process.exit(1);
  });
}

module.exports = { runMigrations };