# Shop Sentinel Backend Server

A proxy backend server for the Shop Sentinel Chrome extension that handles external API calls (like WHOIS lookups for Domain Trust Check) to keep API keys secure and avoid CORS issues.

## Features

- **WHOIS API Proxy**: Securely handles WHOIS API calls for Domain Trust Check feature
- **CORS Protection**: Only allows requests from Chrome extensions and localhost
- **Input Validation**: Validates domain formats before API calls
- **Error Handling**: Comprehensive error handling with sanitized responses

## Setup

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env and add your WHOIS API key
   ```

3. **Get WHOIS API Key:**
   - Sign up at [APILayer WHOIS API](https://apilayer.com/marketplace/whois-api)
   - Add your API key to the `.env` file

4. **Start the server:**
   ```bash
   # Development mode (with auto-restart)
   npm run dev

   # Production mode
   npm start
   ```

## API Endpoints

### Health Check
```
GET /health
```
Returns server status and timestamp.

### WHOIS Lookup
```
GET /api/whois/:domain
```
Fetches WHOIS information for the specified domain.

**Example:**
```bash
curl http://localhost:3001/api/whois/example.com
```

**Response:**
```json
{
  "success": true,
  "domain": "example.com",
  "data": {
    "creation_date": "1992-01-01 00:00:00",
    "registrar": "IANA",
    "expiration_date": "2026-08-13 04:00:00",
    ...
  },
  "timestamp": "2025-10-25T10:30:00.000Z"
}
```

## Security Features

- **CORS protection**: Only allows requests from Chrome extensions and localhost
- **Helmet security headers**: Protects against common web vulnerabilities
- **Input validation**: Validates domain format before API calls
- **Error handling**: Sanitized error responses without exposing sensitive information

## Development

The server includes:
- Request logging
- Error handling middleware
- CORS configuration for Chrome extension
- Environment-based configuration

## Deployment

For production deployment, ensure:
- Set `NODE_ENV=production`
- Use a process manager like PM2
- Set up proper environment variables
- Configure reverse proxy (nginx) if needed</content>
<parameter name="filePath">/Users/maverickrajeev/Desktop/shop-sentinel/backend/README.md