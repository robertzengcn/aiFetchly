// vite.buckEmail.config.mjs
import { defineConfig, loadEnv } from "file:///home/robertzeng/project/toyproject/social_market/node_modules/vite/dist/node/index.js";
import alias from "file:///home/robertzeng/project/toyproject/social_market/node_modules/@rollup/plugin-alias/dist/es/index.js";
import * as path from "path";
import { nodePolyfills } from "file:///home/robertzeng/project/toyproject/social_market/node_modules/vite-plugin-node-polyfills/dist/index.js";

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

// vite.buckEmail.config.mjs
import checker from "file:///home/robertzeng/project/toyproject/social_market/node_modules/vite-plugin-checker/dist/esm/main.js";
import commonjs from "file:///home/robertzeng/project/toyproject/social_market/node_modules/@rollup/plugin-commonjs/dist/es/index.js";
import copy from "file:///home/robertzeng/project/toyproject/social_market/node_modules/rollup-plugin-copy/dist/index.commonjs.js";
import { nodeResolve } from "file:///home/robertzeng/project/toyproject/social_market/node_modules/@rollup/plugin-node-resolve/dist/es/index.js";
import sourcemaps from "file:///home/robertzeng/project/toyproject/social_market/node_modules/rollup-plugin-sourcemaps/dist/index.js";
var __vite_injected_original_dirname = "/home/robertzeng/project/toyproject/social_market";
var vite_buckEmail_config_default = ({ mode }) => {
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
  vite_buckEmail_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5idWNrRW1haWwuY29uZmlnLm1qcyIsICJ2aXRlLXBsdWdpbi1jbG9zZS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9ob21lL3JvYmVydHplbmcvcHJvamVjdC90b3lwcm9qZWN0L3NvY2lhbF9tYXJrZXRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL3JvYmVydHplbmcvcHJvamVjdC90b3lwcm9qZWN0L3NvY2lhbF9tYXJrZXQvdml0ZS5idWNrRW1haWwuY29uZmlnLm1qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS9yb2JlcnR6ZW5nL3Byb2plY3QvdG95cHJvamVjdC9zb2NpYWxfbWFya2V0L3ZpdGUuYnVja0VtYWlsLmNvbmZpZy5tanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tICd2aXRlJztcbmltcG9ydCBhbGlhcyBmcm9tIFwiQHJvbGx1cC9wbHVnaW4tYWxpYXNcIjtcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBub2RlUG9seWZpbGxzIH0gZnJvbSAndml0ZS1wbHVnaW4tbm9kZS1wb2x5ZmlsbHMnXG4vLyBpbXBvcnQgY29tbW9uanMgZnJvbSAndml0ZS1wbHVnaW4tY29tbW9uanMnXG5pbXBvcnQgQ2xvc2VQbHVnaW4gZnJvbSAnLi92aXRlLXBsdWdpbi1jbG9zZS5qcydcbi8vIGltcG9ydCB7IGVzYnVpbGRDb21tb25qcyB9IGZyb20gJ0BvcmlnaW5qcy92aXRlLXBsdWdpbi1jb21tb25qcydcbmltcG9ydCBjaGVja2VyIGZyb20gJ3ZpdGUtcGx1Z2luLWNoZWNrZXInXG4vL2ltcG9ydCB7IG5vZGVSZXNvbHZlIH0gZnJvbSAnQHJvbGx1cC9wbHVnaW4tbm9kZS1yZXNvbHZlJztcbi8vIGltcG9ydCByZXF1aXJlVHJhbnNmb3JtIGZyb20gJ3ZpdGUtcGx1Z2luLXJlcXVpcmUtdHJhbnNmb3JtJztcbmltcG9ydCBjb21tb25qcyBmcm9tICdAcm9sbHVwL3BsdWdpbi1jb21tb25qcyc7XG5pbXBvcnQgY29weSBmcm9tICdyb2xsdXAtcGx1Z2luLWNvcHknXG5pbXBvcnQgeyBub2RlUmVzb2x2ZSB9IGZyb20gJ0Byb2xsdXAvcGx1Z2luLW5vZGUtcmVzb2x2ZSc7XG4vLyBpbXBvcnQgdHlwZXNjcmlwdCBmcm9tICdyb2xsdXAtcGx1Z2luLXR5cGVzY3JpcHQyJ1xuaW1wb3J0IHNvdXJjZW1hcHMgZnJvbSAncm9sbHVwLXBsdWdpbi1zb3VyY2VtYXBzJztcblxuZXhwb3J0IGRlZmF1bHQgKHsgbW9kZSB9KSA9PiB7XG4gICAgcHJvY2Vzcy5lbnYgPSB7IC4uLnByb2Nlc3MuZW52LCAuLi5sb2FkRW52KG1vZGUsIHByb2Nlc3MuY3dkKCkpIH07XG4gICAgLy8gT2JqZWN0LmRlZmluZVByb3BlcnR5KHByb2Nlc3MsICdzdGRvdXQnLCB7XG4gICAgLy8gICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgLy8gICAgICAgICByZXR1cm4gbnVsbDsgLy8gU2V0IHRoZSBkZXNpcmVkIG51bWJlciBvZiBjb2x1bW5zXG4gICAgLy8gICAgIH1cbiAgICAvLyB9KTtcbiAgICByZXR1cm4gZGVmaW5lQ29uZmlnKHtcbiAgICAgICAgLy9pbmNsdWRlOiBbJ25vZGVfbW9kdWxlcy9AcHVwcGV0ZWVyL2Jyb3dzZXJzL25vZGVfbW9kdWxlcy95YXJncy9idWlsZC8qLmNqcyddLFxuICAgICAgICBwbHVnaW5zOiBbYWxpYXMoKSxcbiAgICAgICAgLy8gbm9kZVBvbHlmaWxscyhcbiAgICAgICAgLy8gICAgIHtnbG9iYWxzOiB7IGdsb2JhbDogdHJ1ZSwgcHJvY2VzczogdHJ1ZSB9fVxuICAgICAgICAvLyApLFxuICAgICAgICBub2RlUmVzb2x2ZSgpLFxuICAgICAgICAvL3R5cGVzY3JpcHQoKSxcbiAgICAgICAgLy8gY29tbW9uanMoe1xuICAgICAgICAvLyAgICAgLy9zdHJpY3RSZXF1aXJlczp0cnVlLFxuICAgICAgICAvLyAgICAgLy9keW5hbWljUmVxdWlyZVRhcmdldHM6IFsnbm9kZV9tb2R1bGVzL0BwdXBwZXRlZXIvYnJvd3NlcnMvbm9kZV9tb2R1bGVzL3lhcmdzL2J1aWxkLyouY2pzJ10sXG4gICAgICAgIC8vICAgICAgaW5jbHVkZTogWydub2RlX21vZHVsZXMvQHB1cHBldGVlci9icm93c2Vycy9ub2RlX21vZHVsZXMveWFyZ3MvYnVpbGQvKi5janMnLFxuICAgICAgICAvLyAgICAgIF0sXG4gICAgICAgIC8vICAgICAvL2luY2x1ZGU6ICdub2RlX21vZHVsZXMvKionLFxuICAgICAgICAvLyAgICAgLy8gZXhjbHVkZTogWydub2RlX21vZHVsZXMvQGNvbG9ycy9jb2xvcnMvbGliL2NvbG9ycy5qcycsJ25vZGVfbW9kdWxlcy93aW5zdG9uL2Rpc3Qvd2luc3Rvbi9jb25maWcvaW5kZXguanMnXSxcbiAgICAgICAgLy8gfSksXG4gICAgICAgIC8vcmVxdWlyZVRyYW5zZm9ybSh7ZmlsZVJlZ2V4Oi8udHMkfC50c3gkfC5qcyR8LmNqcyQvfSksXG4gICAgICAgIC8vIGNvcHkoe1xuICAgICAgICAvLyAgICAgdGFyZ2V0czogW1xuICAgICAgICAvLyAgICAgICAgIHsgc3JjOiAnbm9kZV9tb2R1bGVzL0BwdXBwZXRlZXIvYnJvd3NlcnMvbm9kZV9tb2R1bGVzL3lhcmdzL2J1aWxkJywgZGVzdDogJy52aXRlL2J1aWxkLycgfSAgIFxuICAgICAgICAvLyAgICAgXSAgXG4gICAgICAgIC8vIH0pLFxuICAgICAgICBzb3VyY2VtYXBzKCksXG4gICAgICAgIENsb3NlUGx1Z2luKCksXG4gICAgICAgIGNoZWNrZXIoe1xuICAgICAgICAgICAgLy8gZS5nLiB1c2UgVHlwZVNjcmlwdCBjaGVja1xuICAgICAgICAgICAgdHlwZXNjcmlwdDogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHJlc29sdmU6IHtcbiAgICAgICAgICAgIGFsaWFzOiB7XG4gICAgICAgICAgICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXG4gICAgICAgICAgICAgICAgXCJ3c1wiOiAnLi9ub2RlX21vZHVsZXMvd3MvaW5kZXguanMnLFxuICAgICAgICAgICAgICAgIFwiYnVmZmVydXRpbFwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vbm9kZV9tb2R1bGVzL2J1ZmZlcnV0aWxcIiksXG4gICAgICAgICAgICAgICAgXCJ1dGYtOC12YWxpZGF0ZVwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vbm9kZV9tb2R1bGVzL3V0Zi04LXZhbGlkYXRlXCIpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgb3B0aW1pemVEZXBzOiB7ICAgIFxuICAgICAgICAgICAgICAgIC8vIGRpc2FibGVkOmZhbHNlLFxuICAgICAgICAgICAgICAgIGluY2x1ZGU6IFsnd2luc3Rvbi10cmFuc3BvcnQnLCdidWZmZXJ1dGlsJywgJ3V0Zi04LXZhbGlkYXRlJ10gICAgICAgICAgXG4gICAgICAgIH0sXG4gICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICAvLyB0YXJnZXQ6ICdlczYnLFxuICAgICAgICAgICAgc291cmNlbWFwOiB0cnVlLFxuICAgICAgICAgICAgc3NyOnRydWUsXG4gICAgICAgICAgICBjb21tb25qc09wdGlvbnM6e1xuICAgICAgICAgICAgICAgIHRyYW5zZm9ybU1peGVkRXNNb2R1bGVzOiB0cnVlLFxuICAgICAgICAgICAgICAgIC8vIGluY2x1ZGU6W10gICBcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBjb21tb25qc09wdGlvbnM6IHtcbiAgICAgICAgICAgIC8vICAgICBpbmNsdWRlOiBbXCJub2RlX21vZHVsZXMvQHB1cHBldGVlci9icm93c2Vycy9ub2RlX21vZHVsZXMveWFyZ3MvYnVpbGQvaW5kZXguY2pzXCJdLFxuICAgICAgICAgICAgLy8gICB9LFxuICAgICAgICAgICAgLy8gcm9sbHVwT3B0aW9uczoge1xuICAgICAgICAgICAgLy8gICAgIHBsdWdpbnM6IFtcbiAgICAgICAgICAgIC8vICAgICAgICAgYWxpYXMoe1xuICAgICAgICAgICAgLy8gICAgICAgICAgICAgZW50cmllczogW1xuICAgICAgICAgICAgLy8gICAgICAgICAgICAgICB7IGZpbmQ6ICdAJywgcmVwbGFjZW1lbnQ6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMnKSB9XG4gICAgICAgICAgICAvLyAgICAgICAgICAgICBdXG4gICAgICAgICAgICAvLyAgICAgICAgICAgfSksXG4gICAgICAgICAgICAvLyAgICAgICAgIC8vIG5vZGVSZXNvbHZlKHtcbiAgICAgICAgICAgIC8vICAgICAgICAgLy8gICAgIGV4dGVuc2lvbnM6IFsnLmpzJywgJy5qc3gnLCAnLnRzJywgJy50c3gnLCAnLmNqcyddXG4gICAgICAgICAgICAvLyAgICAgICAgIC8vICAgfSksIFxuICAgICAgICAgICAgLy8gICAgIF1cbiAgICAgICAgICAgIC8vIH0sXG4gICAgICAgICAgICBleHRlcm5hbDogW1xuICAgICAgICAgICAgICAgICdzcWxpdGUzJ1xuICAgICAgICAgICAgXVxuXG4gICAgICAgIH0sXG4gICAgICAgIHRlc3Q6IHtcbiAgICAgICAgICAgIGluY2x1ZGU6IFsndGVzdC92aXRlc3QvdXRpbGl0eWNvZGUvKi50ZXN0LnRzJ10sXG4gICAgICAgIH1cbiAgICAgIFxuICAgIH0pXG59IiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9yb2JlcnR6ZW5nL3Byb2plY3QvdG95cHJvamVjdC9zb2NpYWxfbWFya2V0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9yb2JlcnR6ZW5nL3Byb2plY3QvdG95cHJvamVjdC9zb2NpYWxfbWFya2V0L3ZpdGUtcGx1Z2luLWNsb3NlLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3JvYmVydHplbmcvcHJvamVjdC90b3lwcm9qZWN0L3NvY2lhbF9tYXJrZXQvdml0ZS1wbHVnaW4tY2xvc2UudHNcIjtleHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBDbG9zZVBsdWdpbigpIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBuYW1lOiAnQ2xvc2VQbHVnaW4nLCAvLyByZXF1aXJlZCwgd2lsbCBzaG93IHVwIGluIHdhcm5pbmdzIGFuZCBlcnJvcnNcblxuICAgICAgICAvLyB1c2UgdGhpcyB0byBjYXRjaCBlcnJvcnMgd2hlbiBidWlsZGluZ1xuICAgICAgICBidWlsZEVuZChlcnJvcikge1xuICAgICAgICAgICAgaWYoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBidW5kbGluZycpXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcilcbiAgICAgICAgICAgICAgICAvLyBwcm9jZXNzLmV4aXQoMSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0J1aWxkIGVuZGVkJylcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICAvLyB1c2UgdGhpcyB0byBjYXRjaCB0aGUgZW5kIG9mIGEgYnVpbGQgd2l0aG91dCBlcnJvcnNcbiAgICAgICAgY2xvc2VCdW5kbGUoaWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdCdW5kbGUgY2xvc2VkJylcbiAgICAgICAgICAgIC8vcHJvY2Vzcy5leGl0KDApXG4gICAgICAgIH0sXG4gICAgfVxufSJdLAogICJtYXBwaW5ncyI6ICI7QUFBMlYsU0FBUyxjQUFjLGVBQWU7QUFDalksT0FBTyxXQUFXO0FBQ2xCLFlBQVksVUFBVTtBQUN0QixTQUFTLHFCQUFxQjs7O0FDSGtVLFNBQVIsY0FBK0I7QUFDblgsU0FBTztBQUFBLElBQ0gsTUFBTTtBQUFBO0FBQUE7QUFBQSxJQUdOLFNBQVMsT0FBTztBQUNaLFVBQUcsT0FBTztBQUNOLGdCQUFRLE1BQU0sZ0JBQWdCO0FBQzlCLGdCQUFRLE1BQU0sS0FBSztBQUFBLE1BRXZCLE9BQU87QUFDSCxnQkFBUSxJQUFJLGFBQWE7QUFBQSxNQUM3QjtBQUFBLElBQ0o7QUFBQTtBQUFBLElBR0EsWUFBWSxJQUFJO0FBQ1osY0FBUSxJQUFJLGVBQWU7QUFBQSxJQUUvQjtBQUFBLEVBQ0o7QUFDSjs7O0FEZEEsT0FBTyxhQUFhO0FBR3BCLE9BQU8sY0FBYztBQUNyQixPQUFPLFVBQVU7QUFDakIsU0FBUyxtQkFBbUI7QUFFNUIsT0FBTyxnQkFBZ0I7QUFkdkIsSUFBTSxtQ0FBbUM7QUFnQnpDLElBQU8sZ0NBQVEsQ0FBQyxFQUFFLEtBQUssTUFBTTtBQUN6QixVQUFRLE1BQU0sRUFBRSxHQUFHLFFBQVEsS0FBSyxHQUFHLFFBQVEsTUFBTSxRQUFRLElBQUksQ0FBQyxFQUFFO0FBTWhFLFNBQU8sYUFBYTtBQUFBO0FBQUEsSUFFaEIsU0FBUztBQUFBLE1BQUMsTUFBTTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BSWhCLFlBQVk7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQWdCWixXQUFXO0FBQUEsTUFDWCxZQUFZO0FBQUEsTUFDWixRQUFRO0FBQUE7QUFBQSxRQUVKLFlBQVk7QUFBQSxNQUNoQixDQUFDO0FBQUEsSUFDRDtBQUFBLElBQ0EsU0FBUztBQUFBLE1BQ0wsT0FBTztBQUFBLFFBQ0gsS0FBVSxhQUFRLGtDQUFXLE9BQU87QUFBQSxRQUNwQyxNQUFNO0FBQUEsUUFDTixjQUFtQixhQUFRLGtDQUFXLDJCQUEyQjtBQUFBLFFBQ2pFLGtCQUF1QixhQUFRLGtDQUFXLCtCQUErQjtBQUFBLE1BQzdFO0FBQUEsSUFDSjtBQUFBLElBQ0EsY0FBYztBQUFBO0FBQUEsTUFFTixTQUFTLENBQUMscUJBQW9CLGNBQWMsZ0JBQWdCO0FBQUEsSUFDcEU7QUFBQSxJQUNBLE9BQU87QUFBQTtBQUFBLE1BRUgsV0FBVztBQUFBLE1BQ1gsS0FBSTtBQUFBLE1BQ0osaUJBQWdCO0FBQUEsUUFDWix5QkFBeUI7QUFBQTtBQUFBLE1BRTdCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFnQkEsVUFBVTtBQUFBLFFBQ047QUFBQSxNQUNKO0FBQUEsSUFFSjtBQUFBLElBQ0EsTUFBTTtBQUFBLE1BQ0YsU0FBUyxDQUFDLG1DQUFtQztBQUFBLElBQ2pEO0FBQUEsRUFFSixDQUFDO0FBQ0w7IiwKICAibmFtZXMiOiBbXQp9Cg==
