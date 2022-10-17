const fs = require("fs")
const root = "simloader/"

let res = "export const simloaderFiles: Record<string, string> = {\n"

function addFile(id, fn) {
    const f = fs.readFileSync(root + fn, "utf8")
    res += `"${id}": \`` + f.replace(/[\\`$]/g, x => "\\" + x) + "`,\n"
}

addFile("loader.js", "built/loader.js")
addFile("index.html", "index.html")
addFile("custom.js", "custom.js")

res += "}\n"
const outfn = "src/simloaderfiles.ts"
console.log(`generate ${outfn}; ${res.length} bytes`)
fs.writeFileSync(outfn, res)
