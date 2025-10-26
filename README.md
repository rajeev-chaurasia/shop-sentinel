# Shop Sentinel

A powerful Chrome Extension built with modern web technologies to provide a seamless browser extension experience.

### Features

- **AI-Powered Analysis**: Uses Chrome's built-in Gemini Nano model for intelligent dark pattern detection
- **Domain Trust Check**: Optional WHOIS API integration to verify website age, registrar, and legitimacy
- **Real-time Analysis**: Progressive loading with live updates during analysis
- **Cross-tab Synchronization**: Share analysis results across browser tabs
- **Comprehensive Security Checks**: HTTPS validation, mixed content detection, and suspicious URL patterns
- **Policy Analysis**: Automated detection of return policies, shipping terms, and refund policies
- **Page Annotations**: Highlight detected issues directly on web pages
- **Offline Support**: Graceful degradation when AI features are unavailable

### Feature Flags

The extension includes feature flags to control resource-intensive operations:

- **AI Analysis**: Enable/disable AI-powered pattern detection (default: enabled)
- **Domain Trust Check**: Enable/disable WHOIS API calls for comprehensive domain verification (default: disabled)

When Domain Trust Check is disabled, domain analysis is skipped entirely to save processing time and avoid showing incomplete data.

## Tech Stack

- **Frontend Framework**: React 19
- **Build Tool**: Vite 7
- **Styling**: TailwindCSS 4
- **Language**: TypeScript 5
- **Extension API**: Chrome Extension Manifest V3

## Project Structure

```
shop-sentinel/
├── src/
│   ├── popup/           # Extension popup UI
│   │   ├── index.html   # Popup HTML entry point
│   │   ├── main.tsx     # Popup React entry point
│   │   ├── App.tsx      # Main popup component
│   │   └── index.css    # Popup styles with Tailwind
│   ├── content/         # Content scripts
│   │   └── content.ts   # Content script for page interaction
│   └── services/        # Shared services
│       ├── storage.ts   # Chrome storage service
│       ├── messaging.ts # Messaging service
│       └── index.ts     # Service exports
├── public/
│   └── icons/           # Extension icons
├── manifest.json        # Extension manifest (V3)
├── vite.config.ts       # Vite configuration
├── tailwind.config.js   # TailwindCSS configuration
├── tsconfig.json        # TypeScript configuration
└── package.json         # Project dependencies

```

## Backend Server

Shop Sentinel includes a proxy backend server that handles external API calls (like WHOIS lookups) to keep API keys secure and avoid CORS issues.

### Backend Features

- **WHOIS API Proxy**: Securely handles WHOIS API calls with API keys
- **CORS Protection**: Configured to only accept requests from the Chrome extension
- **Input Validation**: Validates domain formats and request parameters
- **Error Handling**: Comprehensive error handling with sanitized responses

### Setting Up the Backend

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env and add your WHOIS API key
   ```

4. **Get WHOIS API Key:**
   - Sign up at [APILayer WHOIS API](https://apilayer.com/marketplace/whois-api)
   - Add your API key to the `.env` file as `WHOIS_API_KEY`

5. **Start the backend server:**
   ```bash
   # Development mode (auto-restart)
   npm run dev

   # Production mode
   npm start
   ```

The backend will run on `http://localhost:3001` by default.

### Testing the Backend

To test that the backend server is working correctly:
```bash
npm run test:backend
```

This will test both the health endpoint and WHOIS API functionality.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Google Chrome browser

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd apex-radar
```

2. Install dependencies:
```bash
npm install
```

### Development

1. **Start the backend server** (in a separate terminal):
   ```bash
   cd backend
   npm run dev
   ```

2. **Build the extension:**
   ```bash
   npm run build
   ```

3. **Load the unpacked extension in Chrome:**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" using the toggle in the top right corner
   - Click "Load unpacked" button
   - Select the `dist` folder from your project directory
   - The extension should now appear in your Chrome toolbar

4. **For full development (backend + frontend):**
   ```bash
   npm run dev:full
   ```
   This runs both the backend server and frontend development server simultaneously.

### Building for Production

To create a production build:
```bash
npm run build
```

The built extension will be in the `dist` folder, ready to be packaged and distributed.

## Usage

## Usage

1. **Click the extension icon** in your browser toolbar to open the popup
2. **Configure feature flags** (optional):
   - **AI-Powered Analysis**: Enable for intelligent pattern detection using Chrome's AI model
   - **Domain Trust Check**: Enable for comprehensive website legitimacy verification using WHOIS data
3. **Click "Scan Page"** to analyze the current website
4. **View results** in the organized tabs (Overview, Issues, Policies)
5. **Use annotations** to highlight issues directly on the page

### Feature Flag Details

- **AI Analysis** (Default: ON): Uses Chrome's built-in AI model for advanced pattern detection. First use downloads the model.
- **Domain Trust Check** (Default: OFF): Performs comprehensive domain verification including age, registrar, and registration details. When disabled, domain analysis is skipped entirely to save time and resources.

### Analysis Results

The extension provides comprehensive analysis including:
- **Security Status**: HTTPS validation and mixed content detection
- **Risk Assessment**: Overall risk score with visual indicators
- **Issue Detection**: Dark patterns, deceptive practices, and policy concerns
- **Policy Analysis**: Return policies, shipping terms, and refund conditions
- **Domain Information**: Age, registrar, and registration details (only when Domain Trust Check is enabled)

## Development Tips

- **Hot Reload**: After code changes, rebuild the extension and click the reload button in `chrome://extensions/`
- **Debugging Popup**: Right-click the extension icon and select "Inspect popup"
- **Debugging Content Scripts**: Open DevTools on any webpage to see content script logs
- **Storage Inspection**: View stored data in DevTools → Application → Storage → Extension Storage

## Customization

### Changing Extension Name and Description

Edit the `manifest.json` file:
```json
{
  "name": "Your Extension Name",
  "description": "Your extension description"
}
```

### Adding Icons

Replace placeholder icons in `public/icons/` with your own:
- icon-16.png (16×16 pixels)
- icon-48.png (48×48 pixels)  
- icon-128.png (128×128 pixels)

### Modifying Permissions

Edit the `permissions` and `host_permissions` arrays in `manifest.json` based on your needs.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for your own extensions.
