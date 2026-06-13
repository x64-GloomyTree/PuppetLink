// mp3-to-ts.js
const fs = require("fs");
const path = require("path");

const inputPath = process.argv[2];
const exportName = process.argv[3] || "audioSrc";

if (!inputPath) {
  console.error("Usage: node mp3-to-ts.js <input.mp3> [exportName]");
  process.exit(1);
}

const absInput = path.resolve(inputPath);
const fileName = path.basename(absInput, path.extname(absInput));
const outPath = path.join(path.dirname(absInput), `${fileName}.ts`);

const fileBuffer = fs.readFileSync(absInput);
const base64 = Buffer.from(fileBuffer).toString("base64");
const dataUrl = `data:audio/mpeg;base64,${base64}`;

const tsContent = `const ${exportName} = ${JSON.stringify(dataUrl)};\n\nexport default ${exportName};\n`;

fs.writeFileSync(outPath, tsContent, "utf8");
console.log(`Wrote ${outPath}`);