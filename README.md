# Log Viewer Plus - VS Code Extension

A VS Code extension for monitoring and filtering log files in real-time.

## 🚀 Features

- **Real-time monitoring** - Watch files using glob patterns
- **Intelligent log filtering** - Filter by level (ERROR, WARN, INFO, DEBUG, TRACE)
- **Pattern search** - Search for specific text or regular expressions
- **Clean format** - Display only relevant messages, removing timestamps and metadata
- **Large file handling** - Only loads the last 64KB (configurable)
- **Auto-follow tail** - Automatically follows new log lines
- **Multi-encoding** - Support for multiple encodings via iconv-lite
- **Group organization** - Organize watches hierarchically
- **Integrated status bar** - Visual indicators for filter status
- **Multi-workspace** - Support for multi-folder workspaces

## ⚙️ Configuration

### Basic Watches

Define files to monitor in `settings.json`:

```json
{
  "logViewerPlus.watch": [
    // Simple pattern
    "/path/to/logs/**/*.log",
    
    // With options
    {
      "title": "Error Log",
      "pattern": "/opt/logs/error*.log",
      "options": {
        "fileCheckInterval": 500,
        "encoding": "utf8"
      }
    },
    
    // Watch group
    {
      "groupName": "Logs",
      "watches": [
        "/opt/logs/error.log",
        "/opt/logs/access.log"
      ]
    }
  ]
}
```

### Global Options

```json
{
  "logViewerPlus.options": {
    "fileCheckInterval": 500,      // ms to check changes in current file
    "fileListInterval": 2000,      // ms to search for new files
    "ignorePattern": "(node_modules|.git)",  // Patterns to ignore
    "encoding": "utf8"             // Default encoding
  }
}
```

### Supported Variables

You can use variables in patterns:

- `${userHome}` - User's home directory
- `${workspaceFolder}` - Workspace root folder
- `${workspaceFolderBasename}` - Workspace folder name
- `${env:VAR}` - Environment variable
- `~` - Shortcut for home

Example:
```json
{
  "pattern": "${workspaceFolder}/logs/*.log"
}
```

## 🎯 Log Filters

### Filter Configuration

```json
{
  "logViewerPlus.filter": {
    "enabled": true,
    "minLevel": "WARN",           // ERROR, WARN, INFO, DEBUG, TRACE
    "searchPattern": "Exception", // Text or regex to search
    "cleanFormat": true,          // Show only messages without metadata
    "excludePatterns": [          // Patterns to exclude
      "HealthCheck",
      "JcrResourceListener"
    ],
    "includePatterns": []         // If defined, only show matching lines
  }
}
```

### Log Levels

Levels are processed hierarchically:

- **ERROR** - Only critical errors
- **WARN** - Warnings and errors
- **INFO** - Info, warnings and errors (default)
- **DEBUG** - Debug and all above
- **TRACE** - All logs

### Log Format

The extension recognizes the standard format:
```
DD.MM.YYYY HH:MM:SS.mmm *LEVEL* [thread] message
```

**Example:**

With `cleanFormat: false`:
```
13.02.2026 16:04:23.089 *INFO* [FelixLogListener] Events.Service UNREGISTERING
```

With `cleanFormat: true`:
```
Events.Service UNREGISTERING
```

## 🎮 Commands

Access commands with **Ctrl+Shift+P** (Cmd+Shift+P on Mac):

### Log Management

- `Log Viewer Plus: Clear log view` - Clears the current view (doesn't modify the file)
- `Log Viewer Plus: Reset log view` - Restores full content
- `Log Viewer Plus: Open current log file` - Opens the file in editor
- `Log Viewer Plus: Open the last changed watch` - Opens the last modified watch
- `Log Viewer Plus: Unwatch all` - Stops all watches
- `Log Viewer Plus: Stop watching` - Stops the current watch

### View Control

- `Log Viewer Plus: Toggle follow tail` - Enables/disables auto-scroll
- `Log Viewer Plus: Show extension logs` - Shows extension logs

### Filters

- `Log Viewer Plus: Configure filters` - **Main filter menu** 🎯
- `Log Viewer Plus: Toggle log filtering` - Enables/disables filters
- `Log Viewer Plus: Set filter level` - Selects minimum level (ERROR, WARN, INFO, etc.)
- `Log Viewer Plus: Set search pattern` - Defines search pattern
- `Log Viewer Plus: Clear search pattern` - Clears search pattern
- `Log Viewer Plus: Toggle clean format` - Toggles between full and clean format

## 💡 Usage

### 1. Open a Log

1. Click on the **Log Viewer Plus** icon in the sidebar
2. Expand the **Watches** view
3. Click on the watch you want to see
4. The file will open automatically and update in real-time

### 2. Configure Filters

**Option A: Quick command**
1. Press **Ctrl+Shift+P**
2. Type: `Configure filters`
3. Select the desired option

**Option B: Status bar**
1. Open a log file
2. Click on the filter icon in the status bar (bottom right)
3. Configure options

### 3. Search in Logs

```json
{
  "logViewerPlus.filter": {
    "enabled": true,
    "searchPattern": "OutOfMemoryError"  // Search for this text
  }
}
```

Or using regex:
```json
{
  "searchPattern": "Error.*Exception"
}
```

### 4. Filter by Severity Level

To see only critical errors:
```json
{
  "logViewerPlus.filter": {
    "enabled": true,
    "minLevel": "ERROR",
    "cleanFormat": true
  }
}
```

### 5. Exclude Unnecessary Logs

```json
{
  "logViewerPlus.filter": {
    "enabled": true,
    "excludePatterns": [
      "HealthCheck",
      "HeartBeat",
      "PeriodicCheck"
    ]
  }
}
```

## 📋 Additional Settings

### Chunk Size

Controls how many KB from the end of the file are loaded:

```json
{
  "logViewerPlus.chunkSizeKb": 64  // Default: 64KB
}
```

### Follow Tail Mode

```json
{
  "logViewerPlus.followTailMode": "auto"  // "auto" or "manual"
}
```

- **auto**: Automatically follows when you reach the end
- **manual**: You must activate/deactivate manually with the command

### Notifications

Shows a notification in the status bar when a watch changes:

```json
{
  "logViewerPlus.showStatusBarItemOnChange": true  // Default: false
}
```

### Extension Logs

Logging level to debug the extension:

```json
{
  "logViewerPlus.logLevel": "error"  // "trace", "debug", "info", "warn", "error"
}
```

## 🗂️ Project Structure

```
src/
├── extension.ts         # Entry point
├── core/               # Core functionality
│   ├── logProvider.ts  # File provider and watch management
│   ├── logUri.ts       # Custom URI handling
│   └── logWatcher.ts   # File watcher with glob patterns
├── filters/            # Filtering system
│   ├── logFilter.ts      # Parser and filters for logs
│   └── filterCommands.ts    # Filter commands and UI
├── ui/                 # Interface components
│   ├── logExplorer.ts  # Watches tree view
│   └── statusBar.ts    # Status bar items
├── types/              # Types and configuration
│   ├── config.ts       # Configuration interfaces
│   ├── configService.ts # Configuration service
│   ├── vscodeTypes.ts  # Types for testing
│   └── picomatch.d.ts  # Type definitions
└── utils/              # Utilities
    ├── container.ts    # Dependency injection
    ├── fileSystem.ts   # File operations
    ├── fsWalker.ts     # Directory traversal
    ├── logger.ts       # Logging interface
    ├── vscodeLogger.ts # VS Code implementation
    ├── mmUtil.ts       # Picomatch utilities
    ├── pathPattern.ts  # Path pattern handling
    └── util.ts         # General utilities
```

## 🛠️ Development

### Requirements

- Node.js 16+
- VS Code 1.70.0+
- npm or pnpm

### Available Scripts

```bash
# Compile
npm run compile

# Watch mode (auto-recompile)
npm run watch

# Check types
npm run check-types

# Lint
npm run lint

# Tests
npm run test

# Package extension
npm run vsce
```

### Debugging

1. Open the project in VS Code
2. Press **F5** or go to **Run → Start Debugging**
3. A new window will open with the extension loaded
4. Breakpoints will work automatically

### Testing

```bash
# All tests
npm test

# Tests without VS Code
npm run test:vscodefree
```

## 📝 Supported Glob Patterns

The extension uses [picomatch](https://github.com/micromatch/picomatch) for glob patterns:

- `*` - Any character except `/`
- `**` - Any character including `/`
- `?` - One character
- `[abc]` - One of the characters
- `{a,b}` - One of the options

### Examples

```json
{
  "logViewerPlus.watch": [
    "/logs/**/*.log",                    // All .log recursively
    "/var/log/app-{dev,prod}.log",      // app-dev.log or app-prod.log
    "/logs/error-202[0-9]*.log",        // error-2020*.log through error-2029*.log
    "~/Documents/logs/**",              // From user's home
    "${workspaceFolder}/dist/logs/*.log" // Relative to workspace
  ]
}
```

## 🐛 Troubleshooting

### Log doesn't update

1. Verify the glob pattern is correct
2. Check `fileCheckInterval` and `fileListInterval` options
3. Check file permissions
4. Verify log level with: `Show extension logs`

### Slow performance with large files

1. Reduce `chunkSizeKb`:
```json
{
  "logViewerPlus.chunkSizeKb": 32
}
```

2. Increase intervals:
```json
{
  "logViewerPlus.options": {
    "fileCheckInterval": 1000,
    "fileListInterval": 5000
  }
}
```

### Filters don't work

1. Verify that `enabled: true` is active
3. Review the search pattern (can be regex)
4. Use the `Configure filters` command to adjust visually

### Wrong encoding

Specify the correct encoding:
```json
{
  "logViewerPlus.options": {
    "encoding": "latin1"  // or "utf16le", "iso-8859-1", etc.
  }
}
```

See supported encodings: https://github.com/ashtuchkin/iconv-lite/wiki/Supported-Encodings

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

## 🎓 Usage Examples

### Case 1: Monitor logs in development

```json
{
  "logViewerPlus.watch": [
    {
      "groupName": "Local",
      "watches": [
        {
          "title": "Error Log",
          "pattern": "/opt/logs/error.log"
        },
        {
          "title": "Access Log",
          "pattern": "/opt/logs/access.log"
        }
      ]
    }
  ],
  "logViewerPlus.filter": {
    "enabled": true,
    "minLevel": "WARN",
    "cleanFormat": true
  }
}
```

### Case 2: Search for specific exceptions

```json
{
  "logViewerPlus.filter": {
    "enabled": true,
    "searchPattern": "(OutOfMemory|NullPointer|SQLException)",
    "minLevel": "ERROR",
    "cleanFormat": false
  }
}
```

### Case 3: Ignore noisy logs

```json
{
  "logViewerPlus.filter": {
    "enabled": true,
    "excludePatterns": [
      "HealthCheck",
      "JcrResourceListener", 
      "SlingRequestProgressTracker",
      "HeartBeat"
    ],
    "minLevel": "INFO"
  }
}
```

### Case 4: Monitor multiple servers

```json
{
  "logViewerPlus.watch": [
    {
      "groupName": "Production",
      "watches": [
        "\\\\server1\\logs\\app*.log",
        "\\\\server2\\logs\\app*.log"
      ]
    },
    {
      "groupName": "Staging",
      "watches": [
        "\\\\staging\\logs\\app*.log"
      ]
    }
  ]
}
```
