import { Host, HttpRequestOptions, HttpResponse, LanguageService, SimpleDriverCallbacks } from "./host";
import { glob } from "glob"
import * as fs from "fs"
import * as util from "util"
import * as http from "http"
import * as https from "https"
import * as url from "url"
import * as zlib from "zlib"
import * as events from "events"

import vm = require("vm")
import mkc = require("./mkc")
import { WebConfig } from "./downloader";
import { CompileOptions } from "./service";

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
        createLanguageServiceAsync: async (editor) => new NodeLanguageService(editor)
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

class NodeLanguageService implements LanguageService {
    sandbox: vm.Context

    constructor(public editor: mkc.DownloadedEditor) {
        this.sandbox = {
            eval: (str: string) =>
                vm.runInContext(str, this.sandbox, {
                    filename: "eval",
                }),
            Function: undefined,
            setTimeout: setTimeout,
            clearInterval: clearInterval,
            clearTimeout: clearTimeout,
            setInterval: setInterval,
            clearImmediate: clearImmediate,
            setImmediate: setImmediate,
            TextEncoder: util.TextEncoder,
            TextDecoder: util.TextDecoder,
            Buffer: Buffer,
            pxtTargetBundle: {},
            scriptText: {},
            global: null,
            console: {
                log: (s: string) => mkc.log(s),
                debug: (s: string) => mkc.debug(s),
                warn: (s: string) => mkc.error(s),
            },
        };

        this.sandbox.global = this.sandbox
        vm.createContext(this.sandbox, {
            codeGeneration: {
                strings: false,
                wasm: false,
            },
        });

        const ed = this.editor
        ed.targetJson.compile.keepCppFiles = true
        this.sandbox.pxtTargetBundle = ed.targetJson
        this.runScript(ed.pxtWorkerJs, ed.website + "/pxtworker.js")
    }

    async registerDriverCallbacksAsync(callbacks: SimpleDriverCallbacks): Promise<void> {
        this.runFunctionSync("pxt.setupSimpleCompile", [callbacks]);
        // disable packages config for now;
        // otherwise we do a HTTP request on every compile
        this.runSync(
            "pxt.packagesConfigAsync = () => Promise.resolve({})"
        )
    }

    async setWebConfigAsync(config: WebConfig): Promise<void> {
        this.runFunctionSync("pxt.setupWebConfig", [
            config
        ])
    }

    async getWebConfigAsync(): Promise<mkc.downloader.WebConfig> {
        return this.runSync("pxt.webConfig")
    }

    async getAppTargetAsync(): Promise<any> {
        return this.runSync("pxt.appTarget");
    }

    async supportsGhPackagesAsync(): Promise<boolean> {
        return !!this.runSync("pxt.simpleInstallPackagesAsync")
    }

    async setHwVariantAsync(variant: string): Promise<void> {
        this.runFunctionSync("pxt.setHwVariant", [
            variant || "",
        ])
    }

    async getHardwareVariantsAsync(): Promise<pxt.PackageConfig[]> {
        return this.runSync(
            "pxt.getHwVariants()"
        )
    }

    async getBundledPackageConfigsAsync(): Promise<pxt.PackageConfig[]> {
        return this.runSync(
            "Object.values(pxt.appTarget.bundledpkgs).map(pkg => JSON.parse(pkg['pxt.json']))"
        );
    }

    async getCompileOptionsAsync(prj: mkc.Package, simpleOpts?: any): Promise<CompileOptions> {
        this.sandbox._opts = simpleOpts
        return this.runAsync(
            "pxt.simpleGetCompileOptionsAsync(_scriptText, _opts)"
        )
    }

    installGhPackagesAsync(projectFiles: pxt.Map<string>): Promise<any> {
        return this.runFunctionAsync("pxt.simpleInstallPackagesAsync", [
            projectFiles,
        ])
    }

    performOperationAsync(op: string, data: any): Promise<any> {
        return this.runFunctionSync("pxtc.service.performOperation", [op, data])
    }

    async setProjectTextAsync(projectFiles: pxt.Map<string>): Promise<void> {
        this.sandbox._scriptText = projectFiles;
    }

    async enableExperimentalHardwareAsync(): Promise<void> {
        this.runSync(
            "(() => { pxt.savedAppTheme().experimentalHw = true; pxt.reloadAppTargetVariant() })()"
        );
    }

    async enableDebugAsync(): Promise<void> {
        this.runSync("(() => { pxt.options.debug = 1 })()");
    }

    async setCompileSwitchesAsync(flags: string): Promise<void> {
        this.runSync(`(() => {
            pxt.setCompileSwitches(${JSON.stringify(flags)});
            if (pxt.appTarget.compile.switches.asmdebug)
                ts.pxtc.assembler.debug = 1
        })()`)
    }

    private runScript(content: string, filename: string) {
        const scr = new vm.Script(content, {
            filename: filename,
        })
        scr.runInContext(this.sandbox)
    }

    private runWithCb(code: string, cb: (err: any, res: any) => void) {
        this.sandbox._gcb = cb
        const src = "(() => { const _cb = _gcb; _gcb = null; " + code + " })()"
        const scr = new vm.Script(src)
        scr.runInContext(this.sandbox)
    }

    private runAsync(code: string) {
        const src =
            `Promise.resolve().then(() => ${code})` +
            `.then(v => _cb(null, v), err => _cb(err.stack || "" + err, null))`
        return new Promise<any>((resolve, reject) =>
            this.runWithCb(src, (err, res) =>
                err ? reject(new Error(err)) : resolve(res)
            )
        )
    }

    private  runSync(code: string): any {
        const src =
            `try { _cb(null, ${code}) } ` +
            `catch (err) { _cb(err.stack || "" + err, null) }`
        let errRes = null
        let normRes = null
        this.runWithCb(src, (err, res) =>
            err ? (errRes = err) : (normRes = res)
        )
        if (errRes) throw new Error(errRes)
        return normRes
    }

    private runFunctionSync(name: string, args: any[]) {
        return this.runSync(this.runFunctionCore(name, args))
    }

    private runFunctionAsync(name: string, args: any[]) {
        return this.runAsync(this.runFunctionCore(name, args))
    }

    private runFunctionCore(name: string, args: any[]) {
        let argString = ""
        for (let i = 0; i < args.length; ++i) {
            const arg = "_arg" + i
            this.sandbox[arg] = args[i]
            if (argString) argString += ", "
            argString += arg
        }
        return `${name}(${argString})`
    }
}