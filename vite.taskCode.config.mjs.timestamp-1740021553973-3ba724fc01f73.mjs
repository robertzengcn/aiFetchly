// vite.taskCode.config.mjs
import { defineConfig, loadEnv } from "file:///home/robertzeng/project/toyproject/social_market/node_modules/vite/dist/node/index.js";
import alias from "file:///home/robertzeng/project/toyproject/social_market/node_modules/@rollup/plugin-alias/dist/es/index.js";
import * as path from "path";

// vite-plugin-close.ts
function ClosePlugin() {
  return {
    name: "ClosePlugin",
    // required, will show up in warnings and errors
    // use this to catch errors when building
    buildEnd(error) {
      if (error) {
        console.error("Error bundling");
        console.error(error);
      } else {
        console.log("Build ended");
      }
    },
    // use this to catch the end of a build without errors
    closeBundle(id) {
      console.log("Bundle closed");
    }
  };
}

// vite.taskCode.config.mjs
import checker from "file:///home/robertzeng/project/toyproject/social_market/node_modules/vite-plugin-checker/dist/esm/main.js";
import { nodeResolve } from "file:///home/robertzeng/project/toyproject/social_market/node_modules/@rollup/plugin-node-resolve/dist/es/index.js";
import sourcemaps from "file:///home/robertzeng/project/toyproject/social_market/node_modules/rollup-plugin-sourcemaps/dist/index.js";
var __vite_injected_original_dirname = "/home/robertzeng/project/toyproject/social_market";
var vite_taskCode_config_default = ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
  return defineConfig({
    //include: ['node_modules/@puppeteer/browsers/node_modules/yargs/build/*.cjs'],
    plugins: [
      alias(),
      // nodePolyfills(
      //     {globals: { global: true, process: true }}
      // ),
      nodeResolve(),
      //typescript(),
      // commonjs({
      //     //strictRequires:true,
      //     //dynamicRequireTargets: ['node_modules/@puppeteer/browsers/node_modules/yargs/build/*.cjs'],
      //      include: ['node_modules/@puppeteer/browsers/node_modules/yargs/build/*.cjs',
      //      ],
      //     //include: 'node_modules/**',
      //     // exclude: ['node_modules/@colors/colors/lib/colors.js','node_modules/winston/dist/winston/config/index.js'],
      // }),
      //requireTransform({fileRegex:/.ts$|.tsx$|.js$|.cjs$/}),
      // copy({
      //     targets: [
      //         { src: 'node_modules/@puppeteer/browsers/node_modules/yargs/build', dest: '.vite/build/' }   
      //     ]  
      // }),
      sourcemaps(),
      ClosePlugin(),
      checker({
        // e.g. use TypeScript check
        typescript: true
      })
      // nodePolyfills()
    ],
    resolve: {
      alias: {
        "@": path.resolve(__vite_injected_original_dirname, "./src")
        // "ws": './node_modules/ws/index.js',
        // "bufferutil": path.resolve(__dirname, "./node_modules/bufferutil"),
        // "utf-8-validate": path.resolve(__dirname, "./node_modules/utf-8-validate"),
      }
    },
    optimizeDeps: {
      // disabled:false,
      include: ["winston-transport", "bufferutil", "utf-8-validate"]
    },
    build: {
      // target: 'es6',
      sourcemap: true,
      ssr: true,
      commonjsOptions: {
        transformMixedEsModules: true
        // include:[]   
      },
      // commonjsOptions: {
      //     include: ["node_modules/@puppeteer/browsers/node_modules/yargs/build/index.cjs"],
      //   },
      // rollupOptions: {
      //     plugins: [
      //         alias({
      //             entries: [
      //               { find: '@', replacement: path.resolve(__dirname, 'src') }
      //             ]
      //           }),
      //         // nodeResolve({
      //         //     extensions: ['.js', '.jsx', '.ts', '.tsx', '.cjs']
      //         //   }), 
      //     ]
      // },
      external: [
        "sqlite3"
      ]
    },
    test: {
      include: ["test/vitest/taskCode/*.test.ts"]
    }
  });
};
export {
  vite_taskCode_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS50YXNrQ29kZS5jb25maWcubWpzIiwgInZpdGUtcGx1Z2luLWNsb3NlLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL2hvbWUvcm9iZXJ0emVuZy9wcm9qZWN0L3RveXByb2plY3Qvc29jaWFsX21hcmtldFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvcm9iZXJ0emVuZy9wcm9qZWN0L3RveXByb2plY3Qvc29jaWFsX21hcmtldC92aXRlLnRhc2tDb2RlLmNvbmZpZy5tanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2hvbWUvcm9iZXJ0emVuZy9wcm9qZWN0L3RveXByb2plY3Qvc29jaWFsX21hcmtldC92aXRlLnRhc2tDb2RlLmNvbmZpZy5tanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tICd2aXRlJztcbmltcG9ydCBhbGlhcyBmcm9tIFwiQHJvbGx1cC9wbHVnaW4tYWxpYXNcIjtcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmltcG9ydCBDbG9zZVBsdWdpbiBmcm9tICcuL3ZpdGUtcGx1Z2luLWNsb3NlLmpzJ1xuXG5pbXBvcnQgY2hlY2tlciBmcm9tICd2aXRlLXBsdWdpbi1jaGVja2VyJ1xuXG4vL2ltcG9ydCBjb21tb25qcyBmcm9tICdAcm9sbHVwL3BsdWdpbi1jb21tb25qcyc7XG4vL2ltcG9ydCBjb3B5IGZyb20gJ3JvbGx1cC1wbHVnaW4tY29weSdcbmltcG9ydCB7IG5vZGVSZXNvbHZlIH0gZnJvbSAnQHJvbGx1cC9wbHVnaW4tbm9kZS1yZXNvbHZlJztcbi8vaW1wb3J0IHR5cGVzY3JpcHQgZnJvbSAncm9sbHVwLXBsdWdpbi10eXBlc2NyaXB0MidcbmltcG9ydCBzb3VyY2VtYXBzIGZyb20gJ3JvbGx1cC1wbHVnaW4tc291cmNlbWFwcyc7XG4vLyBpbXBvcnQge25vZGVQb2x5ZmlsbHN9IGZyb20gJ3ZpdGUtcGx1Z2luLW5vZGUtcG9seWZpbGxzJztcbmV4cG9ydCBkZWZhdWx0ICh7IG1vZGUgfSkgPT4ge1xuICAgIHByb2Nlc3MuZW52ID0geyAuLi5wcm9jZXNzLmVudiwgLi4ubG9hZEVudihtb2RlLCBwcm9jZXNzLmN3ZCgpKSB9O1xuICAgIC8vIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShwcm9jZXNzLCAnc3Rkb3V0Jywge1xuICAgIC8vICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgIC8vICAgICAgICAgcmV0dXJuIG51bGw7IC8vIFNldCB0aGUgZGVzaXJlZCBudW1iZXIgb2YgY29sdW1uc1xuICAgIC8vICAgICB9XG4gICAgLy8gfSk7XG4gICAgcmV0dXJuIGRlZmluZUNvbmZpZyh7XG4gICAgICAgIC8vaW5jbHVkZTogWydub2RlX21vZHVsZXMvQHB1cHBldGVlci9icm93c2Vycy9ub2RlX21vZHVsZXMveWFyZ3MvYnVpbGQvKi5janMnXSxcbiAgICAgICAgcGx1Z2luczogW2FsaWFzKCksXG4gICAgICAgIC8vIG5vZGVQb2x5ZmlsbHMoXG4gICAgICAgIC8vICAgICB7Z2xvYmFsczogeyBnbG9iYWw6IHRydWUsIHByb2Nlc3M6IHRydWUgfX1cbiAgICAgICAgLy8gKSxcbiAgICAgICAgbm9kZVJlc29sdmUoKSxcbiAgICAgICAgLy90eXBlc2NyaXB0KCksXG4gICAgICAgIC8vIGNvbW1vbmpzKHtcbiAgICAgICAgLy8gICAgIC8vc3RyaWN0UmVxdWlyZXM6dHJ1ZSxcbiAgICAgICAgLy8gICAgIC8vZHluYW1pY1JlcXVpcmVUYXJnZXRzOiBbJ25vZGVfbW9kdWxlcy9AcHVwcGV0ZWVyL2Jyb3dzZXJzL25vZGVfbW9kdWxlcy95YXJncy9idWlsZC8qLmNqcyddLFxuICAgICAgICAvLyAgICAgIGluY2x1ZGU6IFsnbm9kZV9tb2R1bGVzL0BwdXBwZXRlZXIvYnJvd3NlcnMvbm9kZV9tb2R1bGVzL3lhcmdzL2J1aWxkLyouY2pzJyxcbiAgICAgICAgLy8gICAgICBdLFxuICAgICAgICAvLyAgICAgLy9pbmNsdWRlOiAnbm9kZV9tb2R1bGVzLyoqJyxcbiAgICAgICAgLy8gICAgIC8vIGV4Y2x1ZGU6IFsnbm9kZV9tb2R1bGVzL0Bjb2xvcnMvY29sb3JzL2xpYi9jb2xvcnMuanMnLCdub2RlX21vZHVsZXMvd2luc3Rvbi9kaXN0L3dpbnN0b24vY29uZmlnL2luZGV4LmpzJ10sXG4gICAgICAgIC8vIH0pLFxuICAgICAgICAvL3JlcXVpcmVUcmFuc2Zvcm0oe2ZpbGVSZWdleDovLnRzJHwudHN4JHwuanMkfC5janMkL30pLFxuICAgICAgICAvLyBjb3B5KHtcbiAgICAgICAgLy8gICAgIHRhcmdldHM6IFtcbiAgICAgICAgLy8gICAgICAgICB7IHNyYzogJ25vZGVfbW9kdWxlcy9AcHVwcGV0ZWVyL2Jyb3dzZXJzL25vZGVfbW9kdWxlcy95YXJncy9idWlsZCcsIGRlc3Q6ICcudml0ZS9idWlsZC8nIH0gICBcbiAgICAgICAgLy8gICAgIF0gIFxuICAgICAgICAvLyB9KSxcbiAgICAgICAgc291cmNlbWFwcygpLFxuICAgICAgICBDbG9zZVBsdWdpbigpLFxuICAgICAgICBjaGVja2VyKHtcbiAgICAgICAgICAgIC8vIGUuZy4gdXNlIFR5cGVTY3JpcHQgY2hlY2tcbiAgICAgICAgICAgIHR5cGVzY3JpcHQ6IHRydWUsXG4gICAgICAgIH0pLFxuICAgICAgICAvLyBub2RlUG9seWZpbGxzKClcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb2x2ZToge1xuICAgICAgICAgICAgYWxpYXM6IHtcbiAgICAgICAgICAgICAgICBcIkBcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyY1wiKSxcbiAgICAgICAgICAgICAgICAvLyBcIndzXCI6ICcuL25vZGVfbW9kdWxlcy93cy9pbmRleC5qcycsXG4gICAgICAgICAgICAgICAgLy8gXCJidWZmZXJ1dGlsXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9ub2RlX21vZHVsZXMvYnVmZmVydXRpbFwiKSxcbiAgICAgICAgICAgICAgICAvLyBcInV0Zi04LXZhbGlkYXRlXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9ub2RlX21vZHVsZXMvdXRmLTgtdmFsaWRhdGVcIiksXG4gICAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBvcHRpbWl6ZURlcHM6IHsgICAgXG4gICAgICAgICAgICAgICAgLy8gZGlzYWJsZWQ6ZmFsc2UsXG4gICAgICAgICAgICAgICAgaW5jbHVkZTogWyd3aW5zdG9uLXRyYW5zcG9ydCcsJ2J1ZmZlcnV0aWwnLCAndXRmLTgtdmFsaWRhdGUnXSAgICAgICAgICBcbiAgICAgICAgfSxcbiAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgIC8vIHRhcmdldDogJ2VzNicsXG4gICAgICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgICAgICBzc3I6dHJ1ZSxcbiAgICAgICAgICAgIGNvbW1vbmpzT3B0aW9uczp7XG4gICAgICAgICAgICAgICAgdHJhbnNmb3JtTWl4ZWRFc01vZHVsZXM6IHRydWUsXG4gICAgICAgICAgICAgICAgLy8gaW5jbHVkZTpbXSAgIFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIGNvbW1vbmpzT3B0aW9uczoge1xuICAgICAgICAgICAgLy8gICAgIGluY2x1ZGU6IFtcIm5vZGVfbW9kdWxlcy9AcHVwcGV0ZWVyL2Jyb3dzZXJzL25vZGVfbW9kdWxlcy95YXJncy9idWlsZC9pbmRleC5janNcIl0sXG4gICAgICAgICAgICAvLyAgIH0sXG4gICAgICAgICAgICAvLyByb2xsdXBPcHRpb25zOiB7XG4gICAgICAgICAgICAvLyAgICAgcGx1Z2luczogW1xuICAgICAgICAgICAgLy8gICAgICAgICBhbGlhcyh7XG4gICAgICAgICAgICAvLyAgICAgICAgICAgICBlbnRyaWVzOiBbXG4gICAgICAgICAgICAvLyAgICAgICAgICAgICAgIHsgZmluZDogJ0AnLCByZXBsYWNlbWVudDogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYycpIH1cbiAgICAgICAgICAgIC8vICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIC8vICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIC8vICAgICAgICAgLy8gbm9kZVJlc29sdmUoe1xuICAgICAgICAgICAgLy8gICAgICAgICAvLyAgICAgZXh0ZW5zaW9uczogWycuanMnLCAnLmpzeCcsICcudHMnLCAnLnRzeCcsICcuY2pzJ11cbiAgICAgICAgICAgIC8vICAgICAgICAgLy8gICB9KSwgXG4gICAgICAgICAgICAvLyAgICAgXVxuICAgICAgICAgICAgLy8gfSxcbiAgICAgICAgICAgIGV4dGVybmFsOiBbXG4gICAgICAgICAgICAgICAgJ3NxbGl0ZTMnXG4gICAgICAgICAgICBdXG5cbiAgICAgICAgfSxcbiAgICAgICAgdGVzdDoge1xuICAgICAgICAgICAgaW5jbHVkZTogWyd0ZXN0L3ZpdGVzdC90YXNrQ29kZS8qLnRlc3QudHMnXSxcbiAgICAgICAgfVxuICAgICAgXG4gICAgfSlcbn0iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9ob21lL3JvYmVydHplbmcvcHJvamVjdC90b3lwcm9qZWN0L3NvY2lhbF9tYXJrZXRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL3JvYmVydHplbmcvcHJvamVjdC90b3lwcm9qZWN0L3NvY2lhbF9tYXJrZXQvdml0ZS1wbHVnaW4tY2xvc2UudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2hvbWUvcm9iZXJ0emVuZy9wcm9qZWN0L3RveXByb2plY3Qvc29jaWFsX21hcmtldC92aXRlLXBsdWdpbi1jbG9zZS50c1wiO2V4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIENsb3NlUGx1Z2luKCkge1xuICAgIHJldHVybiB7XG4gICAgICAgIG5hbWU6ICdDbG9zZVBsdWdpbicsIC8vIHJlcXVpcmVkLCB3aWxsIHNob3cgdXAgaW4gd2FybmluZ3MgYW5kIGVycm9yc1xuXG4gICAgICAgIC8vIHVzZSB0aGlzIHRvIGNhdGNoIGVycm9ycyB3aGVuIGJ1aWxkaW5nXG4gICAgICAgIGJ1aWxkRW5kKGVycm9yKSB7XG4gICAgICAgICAgICBpZihlcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGJ1bmRsaW5nJylcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKVxuICAgICAgICAgICAgICAgIC8vIHByb2Nlc3MuZXhpdCgxKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnQnVpbGQgZW5kZWQnKVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuXG4gICAgICAgIC8vIHVzZSB0aGlzIHRvIGNhdGNoIHRoZSBlbmQgb2YgYSBidWlsZCB3aXRob3V0IGVycm9yc1xuICAgICAgICBjbG9zZUJ1bmRsZShpZCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ0J1bmRsZSBjbG9zZWQnKVxuICAgICAgICAgICAgLy9wcm9jZXNzLmV4aXQoMClcbiAgICAgICAgfSxcbiAgICB9XG59Il0sCiAgIm1hcHBpbmdzIjogIjtBQUF5VixTQUFTLGNBQWMsZUFBZTtBQUMvWCxPQUFPLFdBQVc7QUFDbEIsWUFBWSxVQUFVOzs7QUNGMFUsU0FBUixjQUErQjtBQUNuWCxTQUFPO0FBQUEsSUFDSCxNQUFNO0FBQUE7QUFBQTtBQUFBLElBR04sU0FBUyxPQUFPO0FBQ1osVUFBRyxPQUFPO0FBQ04sZ0JBQVEsTUFBTSxnQkFBZ0I7QUFDOUIsZ0JBQVEsTUFBTSxLQUFLO0FBQUEsTUFFdkIsT0FBTztBQUNILGdCQUFRLElBQUksYUFBYTtBQUFBLE1BQzdCO0FBQUEsSUFDSjtBQUFBO0FBQUEsSUFHQSxZQUFZLElBQUk7QUFDWixjQUFRLElBQUksZUFBZTtBQUFBLElBRS9CO0FBQUEsRUFDSjtBQUNKOzs7QURmQSxPQUFPLGFBQWE7QUFJcEIsU0FBUyxtQkFBbUI7QUFFNUIsT0FBTyxnQkFBZ0I7QUFadkIsSUFBTSxtQ0FBbUM7QUFjekMsSUFBTywrQkFBUSxDQUFDLEVBQUUsS0FBSyxNQUFNO0FBQ3pCLFVBQVEsTUFBTSxFQUFFLEdBQUcsUUFBUSxLQUFLLEdBQUcsUUFBUSxNQUFNLFFBQVEsSUFBSSxDQUFDLEVBQUU7QUFNaEUsU0FBTyxhQUFhO0FBQUE7QUFBQSxJQUVoQixTQUFTO0FBQUEsTUFBQyxNQUFNO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFJaEIsWUFBWTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BZ0JaLFdBQVc7QUFBQSxNQUNYLFlBQVk7QUFBQSxNQUNaLFFBQVE7QUFBQTtBQUFBLFFBRUosWUFBWTtBQUFBLE1BQ2hCLENBQUM7QUFBQTtBQUFBLElBRUQ7QUFBQSxJQUNBLFNBQVM7QUFBQSxNQUNMLE9BQU87QUFBQSxRQUNILEtBQVUsYUFBUSxrQ0FBVyxPQUFPO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFJeEM7QUFBQSxJQUNKO0FBQUEsSUFDQSxjQUFjO0FBQUE7QUFBQSxNQUVOLFNBQVMsQ0FBQyxxQkFBb0IsY0FBYyxnQkFBZ0I7QUFBQSxJQUNwRTtBQUFBLElBQ0EsT0FBTztBQUFBO0FBQUEsTUFFSCxXQUFXO0FBQUEsTUFDWCxLQUFJO0FBQUEsTUFDSixpQkFBZ0I7QUFBQSxRQUNaLHlCQUF5QjtBQUFBO0FBQUEsTUFFN0I7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQWdCQSxVQUFVO0FBQUEsUUFDTjtBQUFBLE1BQ0o7QUFBQSxJQUVKO0FBQUEsSUFDQSxNQUFNO0FBQUEsTUFDRixTQUFTLENBQUMsZ0NBQWdDO0FBQUEsSUFDOUM7QUFBQSxFQUVKLENBQUM7QUFDTDsiLAogICJuYW1lcyI6IFtdCn0K
