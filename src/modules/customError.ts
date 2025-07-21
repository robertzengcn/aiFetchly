export class CustomError extends Error {
    code: number;

    constructor(message?: string, code?: number) {
        super(message); // Pass the message to the Error constructor
        this.code = code || 0; // Set the code. Default to 0 if no code is provided

        // This line is needed to restore the correct prototype chain. 
        // (see https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html)
        Object.setPrototypeOf(this, new.target.prototype);
    }
}