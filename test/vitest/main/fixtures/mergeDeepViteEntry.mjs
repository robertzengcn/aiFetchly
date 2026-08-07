import merge from "merge-deep";

const result = merge({ a: 1 }, { b: 2, c: { d: 3 } }, { c: { e: 4 } });

if (
  result.a !== 1 ||
  result.b !== 2 ||
  result.c.d !== 3 ||
  result.c.e !== 4
) {
  throw new Error(
    `merge-deep returned unexpected result: ${JSON.stringify(result)}`
  );
}

console.log("merge-deep-vite-ok");
