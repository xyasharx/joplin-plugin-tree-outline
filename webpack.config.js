const path = require('path');
const fs = require('fs-extra');
const CopyPlugin = require('copy-webpack-plugin');
const tar = require('tar');

module.exports = (env) => {
  const config = env && (env.joplinPluginConfig || env['joplin-plugin-config']) 
    ? (env.joplinPluginConfig || env['joplin-plugin-config']) 
    : 'buildMain';

  const distDir = path.resolve(__dirname, 'dist');
  const publishDir = path.resolve(__dirname, 'publish');

  if (config === 'buildMain') {
    return {
      mode: 'production',
      target: 'node',
      entry: './src/index.ts',
      module: {
        rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }],
      },
      resolve: {
        alias: {
          api: path.resolve(__dirname, 'api'),
        },
        extensions: ['.tsx', '.ts', '.js'],
      },
      output: { filename: 'index.js', path: distDir },
      plugins: [
        new CopyPlugin({
          patterns: [
            { from: '**/*', to: distDir, context: 'src', globOptions: { ignore: ['**/*.ts', 'manifest.json'] } },
            { from: 'src/manifest.json', to: distDir },
          ],
        }),
      ],
    };
  }

  if (config === 'createArchive') {
    return {
      mode: 'production',
      entry: './src/index.ts',
      plugins: [
        {
          apply: (compiler) => {
            compiler.hooks.afterEmit.tapPromise('CreatePluginArchive', async () => {
              await fs.ensureDir(publishDir);
              const manifest = await fs.readJson(path.resolve(__dirname, 'src/manifest.json'));
              const pluginDist = path.resolve(__dirname, 'dist');
              const jplFilePath = path.resolve(publishDir, `${manifest.id}.jpl`);

              await tar.create(
                { strict: true, portable: true, file: jplFilePath, cwd: pluginDist },
                await fs.readdir(pluginDist)
              );
              await fs.copy(path.resolve(__dirname, 'src/manifest.json'), path.resolve(publishDir, 'manifest.json'));
              console.log(`\nCreated Joplin plugin bundle: ${jplFilePath}\n`);
            });
          },
        },
      ],
    };
  }

  // Fallback for buildExtraScripts
  return {
    mode: 'production',
    entry: {},
    output: { path: distDir },
  };
};
