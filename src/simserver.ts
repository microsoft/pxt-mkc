import http = require("http")
import fs = require("fs")
import mkc = require("./mkc")
import { simloaderFiles } from "./simloaderfiles"

const mime: pxt.Map<string> = {
    js: "application/javascript",
    css: "text/css",
    html: "text/html",
}

export function startSimServer(
    ed: mkc.DownloadedEditor,
    port = 7001,
    forceLocal = false
) {
    http.createServer(async (request, response) => {
        let path = request.url
        if (path == "/") path = "/index.html"
        path = path.replace(/.*\//, "")
        path = path.replace(/\?.*/, "")

        let buf: Buffer = null

        if (path == "binary.js") {
            try {
                buf = fs.readFileSync("built/binary.js")
            } catch {}
        } else if (simloaderFiles.hasOwnProperty(path)) {
            if (forceLocal || path != "loader.js")
                try {
                    buf = fs.readFileSync("assets/" + path)
                } catch {
                    try {
                        buf = fs.readFileSync("assets/js/" + path)
                    } catch {}
                }
            if (!buf) buf = Buffer.from(simloaderFiles[path], "utf-8")
        } else if (/^[\w\.\-]+$/.test(path)) {
            buf = await ed.cache.getAsync(ed.website + "-" + path)
            if (!buf) buf = await ed.cache.getAsync(path)
        }

        if (buf) {
            const m =
                mime[path.replace(/.*\./, "")] || "application/octet-stream"
            response.writeHead(200, {
                "Content-type": m,
                "Cache-Control": "no-cache",
            })
            response.end(buf)
        } else {
            response.writeHead(404, { "Content-type": "text/plain" })
            response.end("Not found")
        }
    }).listen(port, "127.0.0.1")
}
