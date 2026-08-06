import Store from "electron-store";

const store = new Store({
  name: "aifetchly-bundle-test",
  cwd: process.cwd(),
});

store.set("k", "v");
if (store.get("k") !== "v") {
  throw new Error("electron-store bundle failed");
}

console.log("electron-store-taskcode-ok");
