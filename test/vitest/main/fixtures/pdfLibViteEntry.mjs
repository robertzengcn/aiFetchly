import { PDFDocument } from "pdf-lib";

async function main() {
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = await doc.save();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
    throw new Error(
      `pdf-lib returned unexpected save payload: ${Object.prototype.toString.call(bytes)}`
    );
  }
  console.log("pdf-lib-vite-ok", bytes.byteLength);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
