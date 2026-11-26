import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { checkVersionParity } from '../scripts/check-version-parity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/** Matches bare/unguarded Node built-in require() calls (not lodash's try/catch `m.require("util")` probe). */
const UNGUARDED_NODE_BUILTIN_REQUIRE_RE =
  /(?<![.\w])require\(["'](?:node:)?(?:fs|path|crypto|child_process|os|http|https|net|tls|stream|zlib|worker_threads|util)["']\)/;

describe('P3 #9: Strict TypeScript, Mobile-Safe Minified Bundles & CI/CD Hardening', () => {
  it('enables strict TypeScript and isolatedModules in tsconfig.json', () => {
    const tsconfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tsconfig.json'), 'utf8'));
    assert.equal(tsconfig.compilerOptions.strict, true);
    assert.equal(tsconfig.compilerOptions.isolatedModules, true);
    assert.equal(tsconfig.compilerOptions.noUnusedLocals, true);
    assert.equal(tsconfig.compilerOptions.noUnusedParameters, true);
    assert.equal(tsconfig.compilerOptions.noFallthroughCasesInSwitch, true);
  });

  it('uses platform-neutral web target, output.clean, and EsbuildPlugin minification across all webpack compilers', () => {
    const webpackConfigFactory = (function loadWebpackConfig() {
      const code = fs.readFileSync(path.join(repoRoot, 'webpack.config.js'), 'utf8');
      assert.ok(code.includes('EsbuildPlugin'), 'webpack.config.js must configure EsbuildPlugin');
      assert.ok(code.includes('clean: true'), 'webpack.config.js must enable output.clean');
      assert.ok(!code.includes("target: 'node'"), 'Should use platform-neutral web/es2020 target for mobile safety');
      return code;
    })();
    assert.ok(webpackConfigFactory.length > 0);

    // Verify all emitted production bundles are minified and contain zero Node-only requires
    const distIndex = fs.readFileSync(path.join(repoRoot, 'dist', 'index.js'), 'utf8');
    const distWebview = fs.readFileSync(path.join(repoRoot, 'dist', 'webview', 'outline.js'), 'utf8');
    const distContentScript = fs.readFileSync(
      path.join(repoRoot, 'dist', 'contentScripts', 'codeMirrorScroller.js'),
      'utf8',
    );
    const distViewerPlugin = fs.readFileSync(
      path.join(repoRoot, 'dist', 'contentScripts', 'viewerScrollSpyPlugin.js'),
      'utf8',
    );
    const distViewerRuntime = fs.readFileSync(
      path.join(repoRoot, 'dist', 'contentScripts', 'viewerScrollSpyRuntime.js'),
      'utf8',
    );
    const distCss = fs.readFileSync(path.join(repoRoot, 'dist', 'webview', 'outline.css'), 'utf8');

    for (const [label, content] of [
      ['dist/index.js', distIndex],
      ['dist/webview/outline.js', distWebview],
      ['dist/contentScripts/codeMirrorScroller.js', distContentScript],
      ['dist/contentScripts/viewerScrollSpyPlugin.js', distViewerPlugin],
      ['dist/contentScripts/viewerScrollSpyRuntime.js', distViewerRuntime],
    ]) {
      assert.doesNotMatch(
        content,
        UNGUARDED_NODE_BUILTIN_REQUIRE_RE,
        `${label} must not emit unguarded Node-only built-in require() calls (breaks Joplin Mobile)`,
      );
    }

    // Runtime proof: execute dist/index.js in a pure mobile-like JS sandbox
    // with ZERO Node globals (no require, no module, no exports, no process, no Buffer).
    const posted = [];
    let pluginDef = null;
    let onMsg = null;
    const mobileSandbox = {
      console,
      setTimeout,
      clearTimeout,
      joplin: {
        plugins: { register: (p) => { pluginDef = p; } },
        versionInfo: async () => ({ platform: 'mobile', version: '3.2.0' }),
        settings: {
          registerSection: async () => {},
          registerSettings: async () => {},
          values: async () => ({ textWrapMode: 'auto', fontPreset: 'auto' }),
          value: async () => true,
          setValue: async () => {},
          onChange: async () => {},
        },
        contentScripts: { register: async () => {} },
        commands: { register: async () => {}, execute: async () => {} },
        views: {
          panels: {
            create: async () => 'mobile-panel',
            setHtml: async () => {},
            addScript: async () => {},
            show: async () => {},
            hide: async () => {},
            visible: async () => true,
            onMessage: async (_h, cb) => { onMsg = cb; },
            postMessage: (_h, msg) => { posted.push(JSON.parse(JSON.stringify(msg))); },
          },
          menuItems: { create: async () => {} },
          toolbarButtons: { create: async () => {} },
        },
        workspace: {
          selectedNote: async () => ({
            id: 'mobile-note-1',
            title: 'Mobile Emoji 🚀',
            body: '# 🚀 Launch Plan\n\n## مقدمة عربية\n',
            markup_language: 1,
          }),
          selectedNoteIds: async () => ['mobile-note-1'],
          onNoteSelectionChange: async () => {},
          onNoteChange: async () => {},
          onSyncComplete: async () => {},
        },
        data: { get: async () => null },
      },
    };
    vm.runInNewContext(distIndex, mobileSandbox, { filename: 'dist/index.js' });
    assert.ok(pluginDef && typeof pluginDef.onStart === 'function');
    return (async () => {
      await pluginDef.onStart();
      await onMsg({ type: 'ready' });
      const outline = posted.find((m) => m.type === 'outlineUpdate');
      assert.ok(outline, 'Mobile zero-Node sandbox must push outlineUpdate');
      assert.equal(outline.headings[0].slug, 'rocket-launch-plan');
      assert.equal(outline.headings[0].children[0].script, 'arabic');

      // Verify minification keeps all production bundles lean
      assert.ok(distIndex.length < 115_000, `Expected minified dist/index.js < 115KB, got ${distIndex.length}`);
      assert.ok(distWebview.length < 32_000, `Expected minified dist/webview/outline.js < 32KB, got ${distWebview.length}`);
      assert.ok(
        distContentScript.length < 5_000,
        `Expected minified dist/contentScripts/codeMirrorScroller.js < 5KB, got ${distContentScript.length}`,
      );
      assert.ok(distViewerPlugin.length < 1_500, `Expected minified viewerScrollSpyPlugin.js < 1.5KB, got ${distViewerPlugin.length}`);
      assert.ok(distViewerRuntime.length < 3_000, `Expected minified viewerScrollSpyRuntime.js < 3KB, got ${distViewerRuntime.length}`);
      assert.ok(distCss.length < 18_500, `Expected minified dist/webview/outline.css < 18.5KB, got ${distCss.length}`);

      // Verify .jpl archive contains only the clean production files
      const jplPath = path.join(repoRoot, 'publish', 'com.xyasharx.treeoutline.jpl');
      const entries = execFileSync('tar', ['-tf', jplPath], { encoding: 'utf8' })
        .trim()
        .split(/\r?\n/)
        .sort();
      assert.deepEqual(entries, [
        'contentScripts/',
        'contentScripts/codeMirrorScroller.js',
        'contentScripts/viewerScrollSpyPlugin.js',
        'contentScripts/viewerScrollSpyRuntime.js',
        'index.js',
        'manifest.json',
        'webview/',
        'webview/outline.css',
        'webview/outline.js',
      ]);
    })();
  });

  it('verifies package.json, src/manifest.json, and release tag parity accurately', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

    // Matching version & matching tag pass
    const okNoTag = checkVersionParity({ rootDir: repoRoot });
    assert.equal(okNoTag.ok, true);
    assert.equal(okNoTag.errors.length, 0);

    const okWithTag = checkVersionParity({ rootDir: repoRoot, tag: `v${pkg.version}` });
    assert.equal(okWithTag.ok, true);

    // Mismatched tag fails cleanly
    const badTag = checkVersionParity({ rootDir: repoRoot, tag: 'v9.9.9' });
    assert.equal(badTag.ok, false);
    assert.ok(badTag.errors.some((e) => e.includes('Release tag mismatch')));

    // CLI exits 0 on valid tag and non-zero on mismatched tag
    const scriptPath = path.join(repoRoot, 'scripts', 'check-version-parity.mjs');
    const passRun = spawnSync(process.execPath, [scriptPath, '--tag', `v${pkg.version}`], {
      encoding: 'utf8',
    });
    assert.equal(passRun.status, 0);

    const failRun = spawnSync(process.execPath, [scriptPath, '--tag', 'v0.0.0-mismatch'], {
      encoding: 'utf8',
    });
    assert.notEqual(failRun.status, 0);
    assert.ok(failRun.stderr.includes('Release tag mismatch'));
  });

  it('hardens both ci.yml and release.yml with check:version, typecheck, and test gates', () => {
    const ciYml = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const releaseYml = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');

    assert.ok(ciYml.includes('pull_request:'));
    assert.ok(ciYml.includes('npm run check:version'));
    assert.ok(ciYml.includes('npm run typecheck'));
    assert.ok(ciYml.includes('npm test'));

    // release.yml must run version parity, typecheck, and test BEFORE creating a release or publishing
    const checkIdx = releaseYml.indexOf('npm run check:version');
    const typecheckIdx = releaseYml.indexOf('npm run typecheck');
    const testIdx = releaseYml.indexOf('npm test');
    const ghReleaseIdx = releaseYml.indexOf('softprops/action-gh-release');
    const npmPublishIdx = releaseYml.indexOf('npm publish');

    assert.ok(checkIdx !== -1 && typecheckIdx !== -1 && testIdx !== -1);
    assert.ok(checkIdx < ghReleaseIdx && typecheckIdx < ghReleaseIdx && testIdx < ghReleaseIdx);
    assert.ok(ghReleaseIdx < npmPublishIdx);
  });
});
