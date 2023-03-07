import { Host, HttpRequestOptions, HttpResponse } from "makecode-core/built/host";
import { glob } from "glob"
import * as fs from "fs"
import * as util from "util"
import * as http from "http"
import * as https from "https"
import * as url from "url"
import * as zlib from "zlib"
import * as events from "events"

import { NodeLanguageService } from "./languageService";
import { getDeployDrivesAsync } from "./deploy";

export function createNodeHost(): Host {
    return {
        readFileAsync: util.promisify(fs.readFile),
        writeFileAsync: util.promisify(fs.writeFile),
        mkdirAsync: util.promisify(fs.mkdir),
        rmdirAsync: util.promisify(fs.rmdir),
        existsAsync: util.promisify(fs.exists),
        unlinkAsync: util.promisify(fs.unlink),
        symlinkAsync: util.promisify(fs.symlink),
        listFilesAsync: async (directory, filename) =>
            glob.sync(directory + "/**/" + filename),
        requestAsync: nodeHttpRequestAsync,
        createLanguageServiceAsync: async (editor) => new NodeLanguageService(editor),
        getDeployDrivesAsync,
        getEnvironmentVariable: key => process.env[key],
        exitWithStatus: code => process.exit(code),
        cwdAsync: async () => process.cwd(),
        bufferToString: buffer => new util.TextDecoder("utf8").decode(buffer),
        stringToBuffer: (str, encoding) => Buffer.from(str, encoding)
    }
}

function clone<T>(v: T): T {
    if (!v) return v
    return JSON.parse(JSON.stringify(v))
}

function nodeHttpRequestAsync(
    options: HttpRequestOptions,
    validate?: (protocol: string, method: string) => void
): Promise<HttpResponse> {
    let isHttps = false

    let u = <http.RequestOptions>(<any>url.parse(options.url))

    if (u.protocol == "https:") isHttps = true
    /* tslint:disable:no-http-string */ else if (u.protocol == "http:")
        isHttps = false
    /* tslint:enable:no-http-string */ else
        return Promise.reject("bad protocol: " + u.protocol)

    u.headers = clone(options.headers) || {}
    let data = options.data
    u.method = options.method || (data == null ? "GET" : "POST")

    if (validate) validate(u.protocol, u.method)

    let buf: Buffer = null

    u.headers["accept-encoding"] = "gzip"
    u.headers["user-agent"] = "MakeCode-CLI"

    let gzipContent = false

    if (data != null) {
        if (Buffer.isBuffer(data)) {
            buf = data
        } else if (typeof data == "object") {
            buf = Buffer.from(JSON.stringify(data), "utf8")
            u.headers["content-type"] = "application/json; charset=utf8"
            if (options.allowGzipPost) gzipContent = true
        } else if (typeof data == "string") {
            buf = Buffer.from(data, "utf8")
            if (options.allowGzipPost) gzipContent = true
        } else {
            throw new Error("bad data")
        }
    }

    if (gzipContent) {
        buf = zlib.gzipSync(buf)
        u.headers["content-encoding"] = "gzip"
    }

    if (buf) u.headers["content-length"] = buf.length

    return new Promise<HttpResponse>((resolve, reject) => {
        const handleResponse = (res: http.IncomingMessage) => {
            let g: events.EventEmitter = res
            if (/gzip/.test(res.headers["content-encoding"])) {
                let tmp = zlib.createUnzip()
                res.pipe(tmp)
                g = tmp
            }

            resolve(
                readResAsync(g).then(buf => {
                    let text: string = null
                    try {
                        text = buf.toString("utf8")
                    } catch (e) {}
                    let resp: HttpResponse = {
                        statusCode: res.statusCode,
                        headers: res.headers,
                        buffer: buf,
                        text: text,
                    }
                    return resp
                })
            )
        }

        const req = isHttps
            ? https.request(u, handleResponse)
            : http.request(u, handleResponse)
        req.on("error", (err: any) => reject(err))
        req.end(buf)
    })
}

function readResAsync(g: events.EventEmitter) {
    return new Promise<Buffer>((resolve, reject) => {
        let bufs: Buffer[] = []
        g.on("data", (c: any) => {
            if (typeof c === "string") bufs.push(Buffer.from(c, "utf8"))
            else bufs.push(c)
        })

        g.on("error", (err: any) => reject(err))

        g.on("end", () => resolve(Buffer.concat(bufs)))
    })
}

