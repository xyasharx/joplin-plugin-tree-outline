#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Official Joplin Plugin Store category allowlist (joplinapp.org/help/api/references/plugin_manifest/). */
export const VALID_JOPLIN_CATEGORIES = new Set([
  'appearance',
  'developer tools',
  'editor',
  'files',
  'integrations',
  'personal knowledge management',
  'productivity',
  'search',
  'tags',
  'themes',
  'viewer',
]);

function isValidPngFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(8);
    const bytesRead = fs.readSync(fd, buf, 0, 8, 0);
    return bytesRead === 8 && buf.equals(PNG_SIGNATURE);
  } finally {
    fs.closeSync(fd);
  }
}

function parseTagArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tag' && argv[i + 1]) {
      return argv[i + 1].trim();
    }
    if (argv[i].startsWith('--tag=')) {
      return argv[i].slice('--tag='.length).trim();
    }
  }
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME.trim();
  }
  return null;
}

export function checkVersionParity({ rootDir = repoRoot, tag = null } = {}) {
  const errors = [];

  const pkgPath = path.join(rootDir, 'package.json');
  const manifestPath = path.join(rootDir, 'src', 'manifest.json');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (!pkg.version || !SEMVER_RE.test(pkg.version)) {
    errors.push(`package.json version "${pkg.version}" is not valid SemVer.`);
  }

  if (!manifest.version || !SEMVER_RE.test(manifest.version)) {
    errors.push(`src/manifest.json version "${manifest.version}" is not valid SemVer.`);
  }

  if (pkg.version !== manifest.version) {
    errors.push(
      `Version mismatch: package.json (${pkg.version}) !== src/manifest.json (${manifest.version}).`,
    );
  }

  if (!pkg.name || !pkg.name.startsWith('joplin-plugin-')) {
    errors.push(
      `package.json name "${pkg.name}" must start with "joplin-plugin-" for Joplin plugin index compatibility.`,
    );
  }

  if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes('joplin-plugin')) {
    errors.push('package.json keywords must include "joplin-plugin".');
  }

  if (!manifest.id) {
    errors.push('src/manifest.json must declare a non-empty "id".');
  }

  if (
    typeof manifest.repository_url === 'string' &&
    manifest.repository_url.includes('your-username')
  ) {
    errors.push(
      `src/manifest.json repository_url still contains placeholder: ${manifest.repository_url}`,
    );
  }

  if (Array.isArray(manifest.categories)) {
    for (const cat of manifest.categories) {
      if (!VALID_JOPLIN_CATEGORIES.has(cat)) {
        errors.push(`src/manifest.json contains invalid Joplin Store category "${cat}".`);
      }
    }
  }

  if (manifest.icons && typeof manifest.icons === 'object') {
    for (const [size, relPath] of Object.entries(manifest.icons)) {
      if (typeof relPath !== 'string' || !relPath.toLowerCase().endsWith('.png')) {
        errors.push(`src/manifest.json icons["${size}"] must reference a PNG file (got "${relPath}").`);
      } else if (!isValidPngFile(path.join(rootDir, relPath))) {
        errors.push(`src/manifest.json icons["${size}"] PNG asset is missing or invalid: ${relPath}`);
      }
    }
  }

  if (Array.isArray(manifest.screenshots)) {
    for (let i = 0; i < manifest.screenshots.length; i++) {
      const shot = manifest.screenshots[i];
      if (!shot?.src || typeof shot.src !== 'string') {
        errors.push(`src/manifest.json screenshots[${i}] is missing "src".`);
        continue;
      }
      if (!shot.label || typeof shot.label !== 'string') {
        errors.push(`src/manifest.json screenshots[${i}] is missing accessible "label".`);
      }
      if (!/^https?:\/\//i.test(shot.src) && !fs.existsSync(path.join(rootDir, shot.src))) {
        errors.push(`src/manifest.json screenshots[${i}] file not found: ${shot.src}`);
      }
    }
  }

  if (manifest.promo_tile && typeof manifest.promo_tile === 'object') {
    const src = manifest.promo_tile.src;
    if (typeof src === 'string' && !/^https?:\/\//i.test(src)) {
      if (!fs.existsSync(path.join(rootDir, src))) {
        errors.push(`src/manifest.json promo_tile asset not found: ${src}`);
      }
    }
  }

  if (tag !== null) {
    const expectedTag = `v${pkg.version}`;
    if (tag !== expectedTag) {
      errors.push(
        `Release tag mismatch: tag "${tag}" does not match expected "${expectedTag}" from package.json / src/manifest.json.`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    version: pkg.version,
    manifestVersion: manifest.version,
    tag,
    errors,
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const tag = parseTagArg(process.argv.slice(2));
  const result = checkVersionParity({ tag });

  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`ERROR: ${err}`);
    }
    process.exit(1);
  }

  const tagSummary = tag ? ` and tag ${tag}` : '';
  console.log(
    `OK: Version parity verified (package.json == src/manifest.json == ${result.version}${tagSummary}).`,
  );
}
