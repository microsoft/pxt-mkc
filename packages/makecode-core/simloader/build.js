const fs = require("fs");
const root = "simloader/";

const outFile = "src/simloaderfiles.ts";

if (process.argv[2] === "clean") {
    clean()
}
else {
    build();
}

function build() {
    let res = "export const simloaderFiles: Record<string, string> = {\n";
    function addFile(id, fn) {
        const f = fs.readFileSync(root + fn, "utf8");
        res += `"${id}": \`` + f.replace(/[\\`$]/g, x => "\\" + x) + "`,\n";
    }

    addFile("loader.js", "built/loader.js");
    addFile("index.html", "index.html");
    addFile("custom.js", "custom.js");

    res += "}\n";
    console.log(`generate ${outFile}; ${res.length} bytes`);
    fs.writeFileSync(outFile, res);
}

function clean() {
    try {
        fs.unlinkSync(outFile);
    }
    catch (e) {
        // ignore
    }
}

