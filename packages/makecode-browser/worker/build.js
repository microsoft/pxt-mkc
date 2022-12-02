const fs = require("fs");
const root = "worker/";

let res = "export const workerJs = `\n";

const text = fs.readFileSync(root + "built/worker.js", "utf8");
res += text.replace(/[\\`$]/g, x => "\\" + x);
res += "`;\n";

const outfn = "src/workerFiles.ts";
console.log(`generate ${outfn}; ${res.length} bytes`);
fs.writeFileSync(outfn, res);
