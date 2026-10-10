import { z } from "zod/v4";

const schema = z.object({ value: z.string() });
schema.parse({ value: "ok" });
console.log("taskcode-zod-v4-ok");
