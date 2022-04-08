import { createServer } from "http"

const fetch = require("node-fetch")

export function startBinariesServer(
    host: string,
    port: number,
    binaries: Record<string, Buffer | string>
) {
    createServer(async (req, res) => {
        // find file
        const k = req.url.toLowerCase().replace(/^\//, "").replace(/\/$/i, "")
        const data = binaries[k]
        if (data) {
            res.writeHead(200, {
                "Cache-Control": "no-cache",
                "Content-Type":
                    typeof data === "string"
                        ? "text/plain"
                        : "application/octet-stream",
            })
            res.end(data)
        } else if (k === "favicon.ico") {
            res.writeHead(404)
            res.end()
        } else {
            // display default path
            res.writeHead(200, {
                "Cache-Control": "no-cache",
                "Content-Type": "text/html",
            })
            const entries = Object.entries(binaries)
            res.end(`
<html>
<head>
${entries.length === 0 ? `<meta http-equiv="refresh" content="1">` : ""}
<style>
* { font-family: monospace; font-size: 16pt; }
@media (prefers-color-scheme: dark) { 
* { background: #2d2d2d; color: #fff; }
}  
</style>
</head>
<body>
<h1>MakeCode firmware files</h1>
${entries.length === 0 ? `<p>Waiting for first build...</p>` : ""}
<table>
${entries
    .map(
        ([key, value]) =>
            `<tr><td><a download="${key}" href="/${key}">${key}</a></td><td>${Math.ceil(
                value.length / 1e3
            )}Kb</td></tr>`
    )
    .join("\n")}
</table>
</body>
</html>`)
        }
    }).listen(port, host)
}
