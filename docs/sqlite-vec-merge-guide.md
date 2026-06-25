Yes, it is definitely possible to make `sqlite-vec` work with TypeORM.

While there isn't a "plug-and-play" official integration, you can combine TypeORM's `better-sqlite3` driver, its custom `transformer` feature, and its ability to run raw queries to get the full power of `sqlite-vec`.

Here is a step-by-step guide on how to set it up.

-----

### 1\. Load the `sqlite-vec` Extension

The first step is to tell TypeORM to load the `sqlite-vec` extension when it connects to the database. You do this using the `prepareDatabase` option in your `DataSource` configuration.

First, install the required packages:

```bash
npm install typeorm better-sqlite3 sqlite-vec
npm install -D @types/better-sqlite3
```

Then, configure your `DataSource` (e.g., in `data-source.ts`):

```typescript
import { DataSource } from "typeorm";
import * as sqliteVec from "sqlite-vec";
import Database from "better-sqlite3";

export const AppDataSource = new DataSource({
  type: "better-sqlite3",
  database: "db.sqlite",
  entities: [/* your entities here */],
  synchronize: true,
  // This is the magic part:
  prepareDatabase: (db: Database.Database) => {
    // Load the sqlite-vec extension into the connection
    sqliteVec.load(db);
    console.log("sqlite-vec extension loaded.");
  },
});
```

When TypeORM initializes this `DataSource`, it will open the SQLite database using `better-sqlite3` and then immediately call `sqliteVec.load()`, making all the `sqlite-vec` functions available for that connection.

-----

### 2\. Create a Vector Transformer

`sqlite-vec` stores vectors as `BLOB` data in the database, but in your TypeScript code, you'll want to work with them as `Float32Array` or `number[]`. A TypeORM **transformer** is the perfect bridge.

You can create a simple `VectorTransformer` file.

**`src/VectorTransformer.ts`**

```typescript
import { ValueTransformer } from "typeorm";

/**
 * Transforms a Float32Array (vector) into a Buffer (BLOB) for the database,
 * and transforms a Buffer (BLOB) from the database back into a Float32Array.
 */
export class VectorTransformer implements ValueTransformer {
  /**
   * Used to marshal data when writing to the database.
   */
  to(value: Float32Array): Buffer {
    if (!value) {
      return null;
    }
    // Float32Array.buffer returns an ArrayBuffer.
    // Buffer.from() can wrap this ArrayBuffer.
    return Buffer.from(value.buffer);
  }

  /**
   * Used to unmarshal data when reading from the database.
   */
  from(value: Buffer): Float32Array {
    if (!value) {
      return null;
    }
    // Create a new Float32Array from the Buffer.
    // value.buffer is the underlying ArrayBuffer of the Node.js Buffer.
    // We need to use byteOffset and byteLength to get the correct view.
    return new Float32Array(
      value.buffer,
      value.byteOffset,
      value.byteLength / Float32Array.BYTES_PER_ELEMENT
    );
  }
}
```

-----

### 3\. Define Your Entity

Now, use this transformer in your entity. You'll define the column type as `blob` and attach the `transformer`.

**`src/entity/Document.ts`**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, BaseEntity } from "typeorm";
import { VectorTransformer } from "../VectorTransformer";

@Entity()
export class Document extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text")
  content: string;

  @Column({
    type: "blob", // Stored as a BLOB in SQLite
    transformer: new VectorTransformer(), // Use our custom transformer
    nullable: true,
  })
  embedding: Float32Array; // Used as Float32Array in our app
}
```

Now you can treat `document.embedding` just like a `Float32Array` in your code, and TypeORM will handle the `Buffer`/`BLOB` conversion automatically when you save or load.

**Example: Saving an Entity**

```typescript
import { Document } from "./entity/Document";
import { AppDataSource } from "./data-source";

// (assuming you have a function to generate embeddings)
// const embedding = await generateEmbedding("This is a document.");

const myVector = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);

const doc = new Document();
doc.content = "This is a document.";
doc.embedding = myVector;

await AppDataSource.manager.save(doc);
console.log("Document saved with vector!");
```

-----

### 4\. Querying with Vector Functions

For vector-specific searches (like similarity search), you cannot use standard TypeORM `find` methods. You must use raw SQL queries to access `sqlite-vec` functions like `vec_distance_l2` or the `knn_search` virtual table.

You can do this with `manager.query()` or the `QueryBuilder`.

**Example: Finding Similar Documents**

Let's find the 5 documents with the closest embeddings to a query vector.

```typescript
// Your query vector, perhaps from another embedding model
const queryVector = new Float32Array([0.11, 0.22, 0.31, 0.45, 0.53]);

// We must serialize it to a Buffer to safely pass it as a query parameter
const queryVectorBuffer = Buffer.from(queryVector.buffer);

const results = await AppDataSource.manager.query(
  `
  SELECT
    id,
    content,
    vec_distance_l2(embedding, ?) AS distance
  FROM
    document
  ORDER BY
    distance ASC
  LIMIT 5
`,
  [queryVectorBuffer] // Pass the buffer as a parameter
);

console.log(results);
// Output:
// [
//   { id: 1, content: 'This is a document.', distance: 0.0074000004679... },
//   { id: 3, content: 'Another similar doc.', distance: 0.12345... },
//   ...
// ]
```

By combining these four steps, you get the best of both worlds: the developer-friendly ORM features of TypeORM for your standard data and the high-performance vector search capabilities of `sqlite-vec`.