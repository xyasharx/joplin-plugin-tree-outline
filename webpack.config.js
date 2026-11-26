const path = require('path');
const fs = require('fs-extra');
const CopyPlugin = require('copy-webpack-plugin');
const { EsbuildPlugin } = require('esbuild-loader');
const tar = require('tar');

const EXTERNAL_CONTENT_SCRIPT_LIBRARIES = [
  '@codemirror/view',
  '@codemirror/state',
  '@codemirror/search',
  '@codemirror/language',
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/highlight',
  '@codemirror/lint',
  '@codemirror/lang-html',
  '@codemirror/lang-markdown',
  '@codemirror/language-data',
  '@lezer/common',
  '@lezer/markdown',
  '@lezer/highlight',
];

module.exports = () => {
  const distDir = path.resolve(__dirname, 'dist');
  const publishDir = path.resolve(__dirname, 'publish');
  const tsconfigRaw = require('./tsconfig.json');

  const commonResolve = {
    alias: {
      api: path.resolve(__dirname, 'api'),
    },
    // Explicitly keep Node built-in polyfills disabled so mobile-incompatible
    // Node imports fail fast at build time rather than crashing on Android/iOS.
    fallback: {},
    extensions: ['.js', '.tsx', '.ts', '.json'],
  };

  const tsRule = {
    test: /\.tsx?$/,
    loader: 'esbuild-loader',
    options: {
      target: 'es2020',
      tsconfigRaw,
    },
    exclude: /node_modules/,
  };

  const contentScriptExternals = {};
  for (const library of EXTERNAL_CONTENT_SCRIPT_LIBRARIES) {
    contentScriptExternals[library] = { commonjs: library };
  }

  const mainConfig = {
    name: 'main',
    mode: 'production',
    // Platform-neutral ES2020 web target guarantees Desktop & Mobile compatibility
    // (Joplin executes index.js inside a sandboxed WebView script tag).
    target: ['web', 'es2020'],
    entry: './src/index.ts',
    resolve: commonResolve,
    optimization: {
      minimize: true,
      minimizer: [
        new EsbuildPlugin({
          target: 'es2020',
          css: true,
        }),
      ],
    },
    module: {
      rules: [
        tsRule,
        {
          test: /\.html$/,
          type: 'asset/source',
        },
      ],
    },
    output: {
      filename: 'index.js',
      path: distDir,
      globalObject: 'this',
      iife: true,
      clean: true,
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          {
            from: '**/*',
            to: distDir,
            context: 'src',
            globOptions: { ignore: ['**/*.ts', '**/*.tsx', '**/*.html', 'manifest.json'] },
          },
          { from: 'src/manifest.json', to: distDir },
        ],
      }),
    ],
  };

  const webviewConfig = {
    name: 'webview',
    dependencies: ['main'],
    mode: 'production',
    target: ['web', 'es2020'],
    entry: {
      'webview/outline': './src/webview/outline.ts',
      'contentScripts/viewerScrollSpyRuntime': './src/contentScripts/viewerScrollSpyRuntime.ts',
    },
    resolve: commonResolve,
    optimization: {
      minimize: true,
      minimizer: [
        new EsbuildPlugin({
          target: 'es2020',
        }),
      ],
    },
    module: {
      rules: [tsRule],
    },
    output: {
      filename: '[name].js',
      path: distDir,
      iife: true,
    },
  };

  const contentScriptConfig = {
    name: 'contentScript',
    dependencies: ['main', 'webview'],
    mode: 'production',
    target: ['web', 'es2020'],
    entry: {
      'contentScripts/codeMirrorScroller': './src/contentScripts/codeMirrorScroller.ts',
      'contentScripts/viewerScrollSpyPlugin': './src/contentScripts/viewerScrollSpyPlugin.ts',
    },
    resolve: commonResolve,
    externalsType: 'commonjs',
    externals: contentScriptExternals,
    optimization: {
      minimize: true,
      minimizer: [
        new EsbuildPlugin({
          target: 'es2020',
          // Preserve CommonJS exports.default for Joplin's PluginLoader
          // while keeping target: ['web', 'es2020'] to block Node-only imports.
          format: 'cjs',
        }),
      ],
    },
    module: {
      rules: [tsRule],
    },
    output: {
      filename: '[name].js',
      path: distDir,
      library: {
        name: 'default',
        type: 'commonjs',
        export: 'default',
      },
    },
    plugins: [
      {
        apply: (compiler) => {
          compiler.hooks.afterEmit.tapPromise('CreatePluginArchive', async (compilation) => {
            if (compilation.errors && compilation.errors.length > 0) {
              return;
            }
            await fs.ensureDir(publishDir);
            const manifest = await fs.readJson(path.resolve(__dirname, 'src/manifest.json'));
            const jplFilePath = path.resolve(publishDir, `${manifest.id}.jpl`);

            await tar.create(
              {
                strict: true,
                portable: true,
                file: jplFilePath,
                cwd: distDir,
              },
              await fs.readdir(distDir),
            );

            await fs.copy(
              path.resolve(__dirname, 'src/manifest.json'),
              path.resolve(publishDir, 'manifest.json'),
            );

            console.log(`\n==================================================`);
            console.log(`Successfully created Joplin plugin archive:`);
            console.log(jplFilePath);
            console.log(`==================================================\n`);
          });
        },
      },
    ],
  };

  return [mainConfig, webviewConfig, contentScriptConfig];
};
