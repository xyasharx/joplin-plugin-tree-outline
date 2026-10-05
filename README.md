# TreeOutline for Joplin

[![Joplin Plugin](https://img.shields.io/badge/Joplin-Plugin-blue?logo=joplin&logoColor=white)](https://joplinapp.org/)
[![Platforms](https://img.shields.io/badge/Platforms-Desktop%20%7C%20Mobile-green)](#-installation)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TreeOutline is an outline and table of contents panel for Joplin desktop and mobile. It parses note headings into a nested tree with collapsible branches, indentation guides, and live filtering.

---

## Features

- **Nested Tree Navigation:** Displays document structure from H1 through H6 with visual indent guides.
- **Collapsible Sections:** Fold or unfold sub-branches individually, or toggle the entire outline at once from the toolbar.
- **Live Search:** Filter headings in long notes with instant keyboard search.
- **Bi-directional Layout (RTL & LTR):** Automatically detects script direction per note. Right-to-left scripts (Persian, Arabic, Hebrew) display with guidelines, chevrons, and text correctly mirrored.
- **Editor & Viewer Sync:** Clicking any heading jumps to that line in the Markdown editor and scrolls to the anchor in the rendered preview.
- **Mobile Support:** Runs on Joplin for Android and iOS with touch-optimized targets and auto-dismiss on jump.
- **Lightweight:** Built without runtime frameworks or background processes.

---

## Installation

### From Joplin (Recommended)
1. Open Joplin and go to **Tools > Options > Plugins** (macOS: **Joplin > Preferences > Plugins**).
2. Search for `TreeOutline`.
3. Click **Install** and restart Joplin.

### Manual Installation
1. Download the latest `com.xyasharx.treeoutline.jpl` file from the [Releases](https://github.com/xyasharx/joplin-plugin-tree-outline/releases) page.
2. In Joplin, go to **Tools > Options > Plugins**.
3. Click the gear icon (`⚙`) next to *Manage your plugins* and choose **Install from file**.
4. Select the `.jpl` file and restart Joplin.

---

## Usage

- **Toggle Panel:** Toggle the outline view via **Tools > TreeOutline** or assign a custom shortcut under **Tools > Options > Keyboard Shortcuts**.
- **Rearrange Layout:** On desktop, use **View > Change application layout** to drag and dock the TreeOutline panel to the left sidebar, right sidebar, or alongside the note list.
- **Search Headings:** Click the magnifying glass icon in the header to filter headings. Press `Escape` or clear the input to restore the full view.
- **Collapse All:** Click the fold icon in the toolbar to collapse or expand all subheadings simultaneously.

---

## Building from Source

Requirements: Node.js (v20+) and npm.

```bash
# Clone the repository
git clone https://github.com/xyasharx/joplin-plugin-tree-outline.git
cd joplin-plugin-tree-outline

# Install dependencies
npm install

# Build the plugin archive
npm run dist
```

The compiled package will be created at `publish/com.xyasharx.treeoutline.jpl`.

---

## License

MIT
