const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  pages: {
    utilityCode:'src/utilityCode.ts',
  },
  transpileDependencies: true,
  configureWebpack: {
    devtool: 'source-map',
    externals: {
      child_process: 'child_process'
    },
    resolve: {
      fallback: {
        dgram: false,
        fs: false,
        net: false,
        tls: false,
        child_process: false
      }
    }
  

    //target:'electron-renderer',
  },
  pluginOptions: {
    electronBuilder: {
      preload: 'src/preload.ts',
      // nodeIntegration:true,
      // removeElectronJunk: false
      // Or, for multiple preload files:
      //preload: { preload: 'src/preload.js' }
    //mainProcessFile: 'src/utilityCode.js',
    }
  }
})
