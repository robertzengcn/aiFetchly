// Minimal stand-in for PortableMemoryFileScanner's `import yaml from "js-yaml"`
// (src/childprocess/aifetchly-config/PortableMemoryFileScanner.ts). Used by the
// packaging regression test that proves the workspace config worker bundle
// inlines js-yaml instead of emitting a bare require("js-yaml").
import yaml from "js-yaml";

const parsed = yaml.load("value: ok");

console.log(`workspace-config-js-yaml-${parsed.value}`);
