# Shop Sentinel

A Chrome Extension for analyzing e-commerce sites to detect dark patterns and security issues.

## Features

- **AI-Powered Analysis** - Uses Chrome's built-in Gemini Nano model to detect dark patterns
- **Domain Verification** - Optional WHOIS lookup to check website age and legitimacy
- **Security Checks** - HTTPS validation, mixed content detection, suspicious URL patterns
- **Policy Detection** - Finds return policies, shipping terms, and refund information
- **Page Highlighting** - Marks detected issues directly on the webpage
- **Offline Support** - Works without internet connection for local analysis

## Tech Stack

- React 19 - Frontend UI
- TypeScript 5 - Type safety
- Vite 7 - Build tool
- TailwindCSS 4 - Styling
- Chrome Extension Manifest V3

## Quick Start

### Prerequisites
- Node.js v18+
- Google Chrome

### 1. Setup Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env and add your WHOIS API key
npm run dev
```

Backend runs on `http://localhost:3002`

### 2. Build Extension

```bash
npm install
npm run build
```

### 3. Load in Chrome

- Go to `chrome://extensions/`
- Enable "Developer mode"
- Click "Load unpacked"
- Select the `dist` folder

## Usage

Click the extension icon to open the popup and scan the current website. Results show in tabs: Overview, Issues, Policies.
