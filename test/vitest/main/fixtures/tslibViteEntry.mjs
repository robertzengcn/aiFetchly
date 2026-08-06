import { __extends } from "tslib";

class Base {}

class Child extends Base {}

if (typeof __extends !== "function") {
  throw new Error(`__extends is not a function: ${typeof __extends}`);
}

if (!(new Child() instanceof Base)) {
  throw new Error("class extends Base failed after Vite CJS bundling of tslib");
}

console.log("tslib-vite-ok");
