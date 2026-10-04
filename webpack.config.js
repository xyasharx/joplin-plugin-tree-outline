const path = require('path');
const fs = require('fs-extra');
const CopyPlugin = require('copy-webpack-plugin');
const tar = require('tar');

module.exports = () => {
  const distDir = path.resolve(__dirname, 'dist');
  const publishDir = path.resolve(__dirname, 'publish');

  return {
    mode: 'production',
    target: 'node',
    entry: './src/index.ts',
    resolve: {
      alias: {
        api: path.resolve(__dirname, 'api'),
      },
      extensions: ['.tsx', '.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          loader: 'esbuild-loader',
          options: {
            target: 'es2020',
            tsconfigRaw: require('./tsconfig.json'),
          },
          exclude: /node_modules/,
        },
      ],
    },
    output: {
      filename: 'index.js',
      path: distDir,
      globalObject: 'this', // Prevents Webpack from emitting bare 'global' references
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          {
            from: '**/*',
            to: distDir,
            context: 'src',
            globOptions: { ignore: ['**/*.ts', 'manifest.json'] },
          },
          { from: 'src/manifest.json', to: distDir },
        ],
      }),
      {
        apply: (compiler) => {
          compiler.hooks.afterEmit.tapPromise('CreatePluginArchive', async () => {
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
              await fs.readdir(distDir)
            );

            await fs.copy(
              path.resolve(__dirname, 'src/manifest.json'),
              path.resolve(publishDir, 'manifest.json')
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
};
