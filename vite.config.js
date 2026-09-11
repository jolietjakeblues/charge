import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'inline-production-css',
    generateBundle(_options, bundle) {
      const cssAsset = Object.values(bundle).find(asset => asset.type === 'asset' && asset.fileName.endsWith('.css'));
      const htmlAsset = Object.values(bundle).find(asset => asset.type === 'asset' && asset.fileName === 'index.html');
      if (!cssAsset || !htmlAsset || typeof cssAsset.source !== 'string' || typeof htmlAsset.source !== 'string') return;
      const cssHref = cssAsset.fileName;
      htmlAsset.source = htmlAsset.source
        .replace(new RegExp(`<link rel="stylesheet"[^>]*href="/${cssHref}"[^>]*>`), `<style data-charge-styles>${cssAsset.source}</style>`);
      delete bundle[cssAsset.fileName];
    }
  }]
});
