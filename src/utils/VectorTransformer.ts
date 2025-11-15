import { ValueTransformer } from "typeorm";

/**
 * Transforms a Float32Array (vector) into a Buffer (BLOB) for the database,
 * and transforms a Buffer (BLOB) from the database back into a Float32Array.
 * 
 * Based on sqlite-vec merge guide
 */
export class VectorTransformer implements ValueTransformer {
    /**
     * Used to marshal data when writing to the database.
     */
    to(value: Float32Array | number[] | null | undefined): Buffer | null {
        if (!value) {
            return null;
        }
        
        // Convert number[] to Float32Array if needed
        const float32Array = value instanceof Float32Array 
            ? value 
            : new Float32Array(value);
        
        // Float32Array.buffer returns an ArrayBuffer.
        // Buffer.from() can wrap this ArrayBuffer.
        return Buffer.from(float32Array.buffer, float32Array.byteOffset, float32Array.byteLength);
    }

    /**
     * Used to unmarshal data when reading from the database.
     */
    from(value: Buffer | null | undefined): Float32Array | null {
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

