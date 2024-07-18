const fs = require("fs");
const root = "worker/";

const outFile = "src/workerFiles.ts";

if (process.argv[2] === "clean") {
    clean()
}
else {
    build();
}

function build() {
    let res = "export const workerJs = `\n";

    const text = fs.readFileSync(root + "built/worker.js", "utf8");
    res += text.replace(/[\\`$]/g, x => "\\" + x);
    res += "`;\n";

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

