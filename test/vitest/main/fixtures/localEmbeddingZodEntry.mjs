import { z } from "zod";

const schema = z.object({ value: z.string() });
schema.parse({ value: "ok" });
console.log("local-embedding-zod-ok");
