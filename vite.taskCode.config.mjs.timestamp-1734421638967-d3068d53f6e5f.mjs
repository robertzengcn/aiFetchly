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
import commonjs from "file:///home/robertzeng/project/toyproject/social_market/node_modules/@rollup/plugin-commonjs/dist/es/index.js";
import copy from "file:///home/robertzeng/project/toyproject/social_market/node_modules/rollup-plugin-copy/dist/index.commonjs.js";
import { nodeResolve } from "file:///home/robertzeng/project/toyproject/social_market/node_modules/@rollup/plugin-node-resolve/dist/es/index.js";
import typescript from "file:///home/robertzeng/project/toyproject/social_market/node_modules/rollup-plugin-typescript2/dist/rollup-plugin-typescript2.cjs.js";
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
      commonjs({
        //strictRequires:true,
        //dynamicRequireTargets: ['node_modules/@puppeteer/browsers/node_modules/yargs/build/*.cjs'],
        include: [
          "node_modules/@puppeteer/browsers/node_modules/yargs/build/*.cjs"
        ]
        //include: 'node_modules/**',
        // exclude: ['node_modules/@colors/colors/lib/colors.js','node_modules/winston/dist/winston/config/index.js'],
      }),
      //requireTransform({fileRegex:/.ts$|.tsx$|.js$|.cjs$/}),
      copy({
        targets: [
          { src: "node_modules/@puppeteer/browsers/node_modules/yargs/build", dest: ".vite/build/" }
        ]
      }),
      sourcemaps(),
      ClosePlugin(),
      checker({
        // e.g. use TypeScript check
        typescript: true
      })
    ],
    resolve: {
      alias: {
        "@": path.resolve(__vite_injected_original_dirname, "./src"),
        "ws": "./node_modules/ws/index.js",
        "bufferutil": path.resolve(__vite_injected_original_dirname, "./node_modules/bufferutil"),
        "utf-8-validate": path.resolve(__vite_injected_original_dirname, "./node_modules/utf-8-validate")
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
      include: ["test/vitest/utilitycode/*.test.ts"]
    }
  });
};
export {
  vite_taskCode_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS50YXNrQ29kZS5jb25maWcubWpzIiwgInZpdGUtcGx1Z2luLWNsb3NlLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL2hvbWUvcm9iZXJ0emVuZy9wcm9qZWN0L3RveXByb2plY3Qvc29jaWFsX21hcmtldFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvcm9iZXJ0emVuZy9wcm9qZWN0L3RveXByb2plY3Qvc29jaWFsX21hcmtldC92aXRlLnRhc2tDb2RlLmNvbmZpZy5tanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2hvbWUvcm9iZXJ0emVuZy9wcm9qZWN0L3RveXByb2plY3Qvc29jaWFsX21hcmtldC92aXRlLnRhc2tDb2RlLmNvbmZpZy5tanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tICd2aXRlJztcbmltcG9ydCBhbGlhcyBmcm9tIFwiQHJvbGx1cC9wbHVnaW4tYWxpYXNcIjtcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmltcG9ydCBDbG9zZVBsdWdpbiBmcm9tICcuL3ZpdGUtcGx1Z2luLWNsb3NlLmpzJ1xuXG5pbXBvcnQgY2hlY2tlciBmcm9tICd2aXRlLXBsdWdpbi1jaGVja2VyJ1xuXG5pbXBvcnQgY29tbW9uanMgZnJvbSAnQHJvbGx1cC9wbHVnaW4tY29tbW9uanMnO1xuaW1wb3J0IGNvcHkgZnJvbSAncm9sbHVwLXBsdWdpbi1jb3B5J1xuaW1wb3J0IHsgbm9kZVJlc29sdmUgfSBmcm9tICdAcm9sbHVwL3BsdWdpbi1ub2RlLXJlc29sdmUnO1xuaW1wb3J0IHR5cGVzY3JpcHQgZnJvbSAncm9sbHVwLXBsdWdpbi10eXBlc2NyaXB0MidcbmltcG9ydCBzb3VyY2VtYXBzIGZyb20gJ3JvbGx1cC1wbHVnaW4tc291cmNlbWFwcyc7XG5cbmV4cG9ydCBkZWZhdWx0ICh7IG1vZGUgfSkgPT4ge1xuICAgIHByb2Nlc3MuZW52ID0geyAuLi5wcm9jZXNzLmVudiwgLi4ubG9hZEVudihtb2RlLCBwcm9jZXNzLmN3ZCgpKSB9O1xuICAgIC8vIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShwcm9jZXNzLCAnc3Rkb3V0Jywge1xuICAgIC8vICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgIC8vICAgICAgICAgcmV0dXJuIG51bGw7IC8vIFNldCB0aGUgZGVzaXJlZCBudW1iZXIgb2YgY29sdW1uc1xuICAgIC8vICAgICB9XG4gICAgLy8gfSk7XG4gICAgcmV0dXJuIGRlZmluZUNvbmZpZyh7XG4gICAgICAgIC8vaW5jbHVkZTogWydub2RlX21vZHVsZXMvQHB1cHBldGVlci9icm93c2Vycy9ub2RlX21vZHVsZXMveWFyZ3MvYnVpbGQvKi5janMnXSxcbiAgICAgICAgcGx1Z2luczogW2FsaWFzKCksXG4gICAgICAgIC8vIG5vZGVQb2x5ZmlsbHMoXG4gICAgICAgIC8vICAgICB7Z2xvYmFsczogeyBnbG9iYWw6IHRydWUsIHByb2Nlc3M6IHRydWUgfX1cbiAgICAgICAgLy8gKSxcbiAgICAgICAgbm9kZVJlc29sdmUoKSxcbiAgICAgICAgLy90eXBlc2NyaXB0KCksXG4gICAgICAgIGNvbW1vbmpzKHtcbiAgICAgICAgICAgIC8vc3RyaWN0UmVxdWlyZXM6dHJ1ZSxcbiAgICAgICAgICAgIC8vZHluYW1pY1JlcXVpcmVUYXJnZXRzOiBbJ25vZGVfbW9kdWxlcy9AcHVwcGV0ZWVyL2Jyb3dzZXJzL25vZGVfbW9kdWxlcy95YXJncy9idWlsZC8qLmNqcyddLFxuICAgICAgICAgICAgIGluY2x1ZGU6IFsnbm9kZV9tb2R1bGVzL0BwdXBwZXRlZXIvYnJvd3NlcnMvbm9kZV9tb2R1bGVzL3lhcmdzL2J1aWxkLyouY2pzJyxcbiAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgLy9pbmNsdWRlOiAnbm9kZV9tb2R1bGVzLyoqJyxcbiAgICAgICAgICAgIC8vIGV4Y2x1ZGU6IFsnbm9kZV9tb2R1bGVzL0Bjb2xvcnMvY29sb3JzL2xpYi9jb2xvcnMuanMnLCdub2RlX21vZHVsZXMvd2luc3Rvbi9kaXN0L3dpbnN0b24vY29uZmlnL2luZGV4LmpzJ10sXG4gICAgICAgIH0pLFxuICAgICAgICAvL3JlcXVpcmVUcmFuc2Zvcm0oe2ZpbGVSZWdleDovLnRzJHwudHN4JHwuanMkfC5janMkL30pLFxuICAgICAgICBjb3B5KHtcbiAgICAgICAgICAgIHRhcmdldHM6IFtcbiAgICAgICAgICAgICAgICB7IHNyYzogJ25vZGVfbW9kdWxlcy9AcHVwcGV0ZWVyL2Jyb3dzZXJzL25vZGVfbW9kdWxlcy95YXJncy9idWlsZCcsIGRlc3Q6ICcudml0ZS9idWlsZC8nIH0gICBcbiAgICAgICAgICAgIF0gIFxuICAgICAgICB9KSxcbiAgICAgICAgc291cmNlbWFwcygpLFxuICAgICAgICBDbG9zZVBsdWdpbigpLFxuICAgICAgICBjaGVja2VyKHtcbiAgICAgICAgICAgIC8vIGUuZy4gdXNlIFR5cGVTY3JpcHQgY2hlY2tcbiAgICAgICAgICAgIHR5cGVzY3JpcHQ6IHRydWUsXG4gICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICByZXNvbHZlOiB7XG4gICAgICAgICAgICBhbGlhczoge1xuICAgICAgICAgICAgICAgIFwiQFwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjXCIpLFxuICAgICAgICAgICAgICAgIFwid3NcIjogJy4vbm9kZV9tb2R1bGVzL3dzL2luZGV4LmpzJyxcbiAgICAgICAgICAgICAgICBcImJ1ZmZlcnV0aWxcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL25vZGVfbW9kdWxlcy9idWZmZXJ1dGlsXCIpLFxuICAgICAgICAgICAgICAgIFwidXRmLTgtdmFsaWRhdGVcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL25vZGVfbW9kdWxlcy91dGYtOC12YWxpZGF0ZVwiKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIG9wdGltaXplRGVwczogeyAgICBcbiAgICAgICAgICAgICAgICAvLyBkaXNhYmxlZDpmYWxzZSxcbiAgICAgICAgICAgICAgICBpbmNsdWRlOiBbJ3dpbnN0b24tdHJhbnNwb3J0JywnYnVmZmVydXRpbCcsICd1dGYtOC12YWxpZGF0ZSddICAgICAgICAgIFxuICAgICAgICB9LFxuICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgLy8gdGFyZ2V0OiAnZXM2JyxcbiAgICAgICAgICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICAgICAgICAgIHNzcjp0cnVlLFxuICAgICAgICAgICAgY29tbW9uanNPcHRpb25zOntcbiAgICAgICAgICAgICAgICB0cmFuc2Zvcm1NaXhlZEVzTW9kdWxlczogdHJ1ZSxcbiAgICAgICAgICAgICAgICAvLyBpbmNsdWRlOltdICAgXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLy8gY29tbW9uanNPcHRpb25zOiB7XG4gICAgICAgICAgICAvLyAgICAgaW5jbHVkZTogW1wibm9kZV9tb2R1bGVzL0BwdXBwZXRlZXIvYnJvd3NlcnMvbm9kZV9tb2R1bGVzL3lhcmdzL2J1aWxkL2luZGV4LmNqc1wiXSxcbiAgICAgICAgICAgIC8vICAgfSxcbiAgICAgICAgICAgIC8vIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgICAgIC8vICAgICBwbHVnaW5zOiBbXG4gICAgICAgICAgICAvLyAgICAgICAgIGFsaWFzKHtcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgIGVudHJpZXM6IFtcbiAgICAgICAgICAgIC8vICAgICAgICAgICAgICAgeyBmaW5kOiAnQCcsIHJlcGxhY2VtZW50OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjJykgfVxuICAgICAgICAgICAgLy8gICAgICAgICAgICAgXVxuICAgICAgICAgICAgLy8gICAgICAgICAgIH0pLFxuICAgICAgICAgICAgLy8gICAgICAgICAvLyBub2RlUmVzb2x2ZSh7XG4gICAgICAgICAgICAvLyAgICAgICAgIC8vICAgICBleHRlbnNpb25zOiBbJy5qcycsICcuanN4JywgJy50cycsICcudHN4JywgJy5janMnXVxuICAgICAgICAgICAgLy8gICAgICAgICAvLyAgIH0pLCBcbiAgICAgICAgICAgIC8vICAgICBdXG4gICAgICAgICAgICAvLyB9LFxuICAgICAgICAgICAgZXh0ZXJuYWw6IFtcbiAgICAgICAgICAgICAgICAnc3FsaXRlMydcbiAgICAgICAgICAgIF1cblxuICAgICAgICB9LFxuICAgICAgICB0ZXN0OiB7XG4gICAgICAgICAgICBpbmNsdWRlOiBbJ3Rlc3Qvdml0ZXN0L3V0aWxpdHljb2RlLyoudGVzdC50cyddLFxuICAgICAgICB9XG4gICAgICBcbiAgICB9KVxufSIsICJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL2hvbWUvcm9iZXJ0emVuZy9wcm9qZWN0L3RveXByb2plY3Qvc29jaWFsX21hcmtldFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvcm9iZXJ0emVuZy9wcm9qZWN0L3RveXByb2plY3Qvc29jaWFsX21hcmtldC92aXRlLXBsdWdpbi1jbG9zZS50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS9yb2JlcnR6ZW5nL3Byb2plY3QvdG95cHJvamVjdC9zb2NpYWxfbWFya2V0L3ZpdGUtcGx1Z2luLWNsb3NlLnRzXCI7ZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQ2xvc2VQbHVnaW4oKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZTogJ0Nsb3NlUGx1Z2luJywgLy8gcmVxdWlyZWQsIHdpbGwgc2hvdyB1cCBpbiB3YXJuaW5ncyBhbmQgZXJyb3JzXG5cbiAgICAgICAgLy8gdXNlIHRoaXMgdG8gY2F0Y2ggZXJyb3JzIHdoZW4gYnVpbGRpbmdcbiAgICAgICAgYnVpbGRFbmQoZXJyb3IpIHtcbiAgICAgICAgICAgIGlmKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgYnVuZGxpbmcnKVxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpXG4gICAgICAgICAgICAgICAgLy8gcHJvY2Vzcy5leGl0KDEpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdCdWlsZCBlbmRlZCcpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgLy8gdXNlIHRoaXMgdG8gY2F0Y2ggdGhlIGVuZCBvZiBhIGJ1aWxkIHdpdGhvdXQgZXJyb3JzXG4gICAgICAgIGNsb3NlQnVuZGxlKGlkKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnQnVuZGxlIGNsb3NlZCcpXG4gICAgICAgICAgICAvL3Byb2Nlc3MuZXhpdCgwKVxuICAgICAgICB9LFxuICAgIH1cbn0iXSwKICAibWFwcGluZ3MiOiAiO0FBQXlWLFNBQVMsY0FBYyxlQUFlO0FBQy9YLE9BQU8sV0FBVztBQUNsQixZQUFZLFVBQVU7OztBQ0YwVSxTQUFSLGNBQStCO0FBQ25YLFNBQU87QUFBQSxJQUNILE1BQU07QUFBQTtBQUFBO0FBQUEsSUFHTixTQUFTLE9BQU87QUFDWixVQUFHLE9BQU87QUFDTixnQkFBUSxNQUFNLGdCQUFnQjtBQUM5QixnQkFBUSxNQUFNLEtBQUs7QUFBQSxNQUV2QixPQUFPO0FBQ0gsZ0JBQVEsSUFBSSxhQUFhO0FBQUEsTUFDN0I7QUFBQSxJQUNKO0FBQUE7QUFBQSxJQUdBLFlBQVksSUFBSTtBQUNaLGNBQVEsSUFBSSxlQUFlO0FBQUEsSUFFL0I7QUFBQSxFQUNKO0FBQ0o7OztBRGZBLE9BQU8sYUFBYTtBQUVwQixPQUFPLGNBQWM7QUFDckIsT0FBTyxVQUFVO0FBQ2pCLFNBQVMsbUJBQW1CO0FBQzVCLE9BQU8sZ0JBQWdCO0FBQ3ZCLE9BQU8sZ0JBQWdCO0FBWnZCLElBQU0sbUNBQW1DO0FBY3pDLElBQU8sK0JBQVEsQ0FBQyxFQUFFLEtBQUssTUFBTTtBQUN6QixVQUFRLE1BQU0sRUFBRSxHQUFHLFFBQVEsS0FBSyxHQUFHLFFBQVEsTUFBTSxRQUFRLElBQUksQ0FBQyxFQUFFO0FBTWhFLFNBQU8sYUFBYTtBQUFBO0FBQUEsSUFFaEIsU0FBUztBQUFBLE1BQUMsTUFBTTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BSWhCLFlBQVk7QUFBQTtBQUFBLE1BRVosU0FBUztBQUFBO0FBQUE7QUFBQSxRQUdKLFNBQVM7QUFBQSxVQUFDO0FBQUEsUUFDVjtBQUFBO0FBQUE7QUFBQSxNQUdMLENBQUM7QUFBQTtBQUFBLE1BRUQsS0FBSztBQUFBLFFBQ0QsU0FBUztBQUFBLFVBQ0wsRUFBRSxLQUFLLDZEQUE2RCxNQUFNLGVBQWU7QUFBQSxRQUM3RjtBQUFBLE1BQ0osQ0FBQztBQUFBLE1BQ0QsV0FBVztBQUFBLE1BQ1gsWUFBWTtBQUFBLE1BQ1osUUFBUTtBQUFBO0FBQUEsUUFFSixZQUFZO0FBQUEsTUFDaEIsQ0FBQztBQUFBLElBQ0Q7QUFBQSxJQUNBLFNBQVM7QUFBQSxNQUNMLE9BQU87QUFBQSxRQUNILEtBQVUsYUFBUSxrQ0FBVyxPQUFPO0FBQUEsUUFDcEMsTUFBTTtBQUFBLFFBQ04sY0FBbUIsYUFBUSxrQ0FBVywyQkFBMkI7QUFBQSxRQUNqRSxrQkFBdUIsYUFBUSxrQ0FBVywrQkFBK0I7QUFBQSxNQUM3RTtBQUFBLElBQ0o7QUFBQSxJQUNBLGNBQWM7QUFBQTtBQUFBLE1BRU4sU0FBUyxDQUFDLHFCQUFvQixjQUFjLGdCQUFnQjtBQUFBLElBQ3BFO0FBQUEsSUFDQSxPQUFPO0FBQUE7QUFBQSxNQUVILFdBQVc7QUFBQSxNQUNYLEtBQUk7QUFBQSxNQUNKLGlCQUFnQjtBQUFBLFFBQ1oseUJBQXlCO0FBQUE7QUFBQSxNQUU3QjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BZ0JBLFVBQVU7QUFBQSxRQUNOO0FBQUEsTUFDSjtBQUFBLElBRUo7QUFBQSxJQUNBLE1BQU07QUFBQSxNQUNGLFNBQVMsQ0FBQyxtQ0FBbUM7QUFBQSxJQUNqRDtBQUFBLEVBRUosQ0FBQztBQUNMOyIsCiAgIm5hbWVzIjogW10KfQo=
