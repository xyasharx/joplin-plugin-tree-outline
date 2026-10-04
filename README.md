# TreeOutline for Joplin

An Obsidian-inspired hierarchical outline and Table of Contents (TOC) panel for [Joplin](https://joplinapp.org/).

Designed to bring the clean, minimalist aesthetic and fluid navigation of Obsidian's Outline pane directly into Joplin, complete with collapsible branches, vertical indentation guidelines, live heading filtering, and bidirectional RTL/LTR support.

---

## ✨ Features

- 🌿 **Obsidian Tree Design:** Clean hierarchy displaying H1–H6 with vertical indentation guide lines.
- ⮛ **Collapsible Headings:** Clickable chevrons to fold or expand subheadings.
- 🗂️ **Global Collapse / Expand:** Toggle all sections with one click from the top toolbar.
- 🔍 **Live Heading Search:** Instant filter bar to quickly locate sections in long documents.
- 📍 **Active Heading Indicator:** Automatically highlights the active heading pill corresponding to your reading or cursor location.
- 🌐 **Full RTL & LTR Support:** Built with CSS logical properties, rendering Persian, Arabic, Hebrew, and English heading trees smoothly.
- ⚡ **Dual-Mode Navigation:** Synchronously jumps both the CodeMirror Markdown editor and rendered HTML preview pane.

---

## 📸 Preview

<!-- Replace with your actual screenshot link in GitHub -->
![TreeOutline Screenshot](https://raw.githubusercontent.com/your-username/joplin-plugin-tree-outline/main/screenshot.png)

---

## 🚀 Installation

### Method 1: Via Joplin App (Recommended once listed)
1. Open Joplin and navigate to **Tools > Options > Plugins** (Windows/Linux) or **Joplin > Preferences > Plugins** (macOS).
2. Search for `TreeOutline` or `Obsidian Outline`.
3. Click **Install** and restart Joplin.

### Method 2: Manual Installation (.jpl file)
1. Download the latest `.jpl` release from the [Releases](https://github.com/your-username/joplin-plugin-tree-outline/releases) page.
2. In Joplin, go to **Tools > Options > Plugins**.
3. Click the gear icon (`⚙`) next to **Manage your plugins** and select **Install from file**.
4. Select the downloaded `.jpl` file and restart Joplin.

---

## 🛠️ Development & Building

```bash
# Clone the repository
git clone https://github.com/your-username/joplin-plugin-tree-outline.git
cd joplin-plugin-tree-outline

# Install dependencies
npm install

# Build production bundle (.jpl archive)
npm run dist
```

The compiled plugin will be generated at `publish/com.yourname.treeoutline.jpl`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
