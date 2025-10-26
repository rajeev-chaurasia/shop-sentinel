const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: true, // Allow all origins for extension compatibility
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// WHOIS API configuration
const WHOIS_API_KEY = process.env.WHOIS_API_KEY;
const WHOIS_API_BASE_URL = 'https://api.apilayer.com/whois/query';

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WHOIS proxy endpoint
app.get('/api/whois/:domain', async (req, res) => {
  try {
    const { domain } = req.params;

    // Validate domain parameter
    if (!domain) {
      return res.status(400).json({
        error: 'Domain parameter is required'
      });
    }

    // Basic domain validation
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!domainRegex.test(domain)) {
      return res.status(400).json({
        error: 'Invalid domain format'
      });
    }

    console.log(`🌐 Fetching WHOIS data for: ${domain}`);

    // Make request to WHOIS API
    const response = await fetch(
      `${WHOIS_API_BASE_URL}?domain=${domain}`,
      {
        method: 'GET',
        headers: {
          'apikey': WHOIS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      console.error(`WHOIS API error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({
        error: `WHOIS API error: ${response.status} ${response.statusText}`
      });
    }

    const data = await response.json();

    // Check if API returned an error or no result
    if (!data.result) {
      console.warn(`No WHOIS result found for: ${domain}`);
      return res.status(404).json({
        error: 'No WHOIS data found for this domain'
      });
    }

    console.log(`✅ WHOIS data retrieved for: ${domain}`);

    // Return the WHOIS data
    res.json({
      success: true,
      domain,
      data: data.result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('WHOIS proxy error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Shop Sentinel Backend Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 WHOIS endpoint: http://localhost:${PORT}/api/whois/{domain}`);
});

module.exports = app;