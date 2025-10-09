# Apex Radar

A powerful Chrome Extension built with modern web technologies to provide a seamless browser extension experience.

## Key Features

- **Modern Tech Stack**: Built with React 19, Vite, and TailwindCSS for fast development and optimal performance
- **Manifest V3**: Uses the latest Chrome Extension Manifest V3 specification for enhanced security and performance
- **TypeScript Support**: Fully typed codebase for better developer experience and code quality
- **Content Scripts**: Interact with web pages directly through content scripts
- **Storage API**: Persist data using Chrome's storage API with a clean service layer
- **Messaging System**: Built-in messaging service for communication between extension components
- **Hot Module Replacement**: Fast refresh during development with Vite's HMR
- **Tailwind CSS**: Utility-first CSS framework for rapid UI development

## Tech Stack

- **Frontend Framework**: React 19
- **Build Tool**: Vite 7
- **Styling**: TailwindCSS 4
- **Language**: TypeScript 5
- **Extension API**: Chrome Extension Manifest V3

## Project Structure

```
apex-radar/
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

1. Build the extension:
```bash
npm run build
```

2. Load the unpacked extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" using the toggle in the top right corner
   - Click "Load unpacked" button
   - Select the `dist` folder from your project directory
   - The extension should now appear in your Chrome toolbar

3. For development with hot reload:
```bash
npm run dev
```
Note: After making changes, you'll need to rebuild (`npm run build`) and reload the extension in Chrome.

### Building for Production

To create a production build:
```bash
npm run build
```

The built extension will be in the `dist` folder, ready to be packaged and distributed.

## Usage

1. Click the extension icon in your Chrome toolbar to open the popup
2. The popup displays a sample counter interface built with React and TailwindCSS
3. Content scripts automatically run on web pages (check the browser console)
4. Use the services in `src/services/` to interact with Chrome APIs

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
