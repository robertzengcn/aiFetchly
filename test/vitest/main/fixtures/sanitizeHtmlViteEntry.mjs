import sanitizeHtml from "sanitize-html";

const cleaned = sanitizeHtml("<img src=x onerror=alert(1)><b>ok</b>", {
  allowedTags: ["b"],
});

if (!cleaned.includes("ok") || cleaned.includes("onerror")) {
  throw new Error(`sanitize-html bundle produced unexpected output: ${cleaned}`);
}

console.log("sanitize-html-vite-ok");
