const fs = require("fs");
const path = require("path");

const srcHtml = path.join(__dirname, "..", "src", "ui.html");
const srcJs = path.join(__dirname, "..", "build", "ui.js");
const dest = path.join(__dirname, "..", "build", "ui.html");

let html = fs.readFileSync(srcHtml, "utf8");
const js = fs.readFileSync(srcJs, "utf8");

// Replace external script reference with inlined JS.
html = html.replace(
  /<script src="\.?\/?ui\.js"><\/script>/,
  `<script>\n${js}\n</script>`
);

fs.writeFileSync(dest, html);
console.log("Copied ui.html to build/ui.html (with inlined ui.js)");
