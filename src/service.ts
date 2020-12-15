import vm = require("vm");
import mkc = require("./mkc");
import downloader = require("./downloader");

const cdnUrl = "https://pxt.azureedge.net"

const prep = `
`

export interface HexInfo {
    hex: string[];
}

export interface ExtensionInfo {
    sha: string;
    compileData: string;
    skipCloudBuild?: boolean;
    hexinfo?: HexInfo;
    appVariant?: string;
}

export interface ExtensionTarget {
    extinfo: ExtensionInfo
    // target: CompileTarget
}

export interface CompileOptions {
    fileSystem: pxt.Map<string>;
    testMode?: boolean;
    sourceFiles?: string[];
    generatedFiles?: string[];
    jres?: pxt.Map<pxt.JRes>;
    noEmit?: boolean;
    forceEmit?: boolean;
    ast?: boolean;
    breakpoints?: boolean;
    trace?: boolean;
    justMyCode?: boolean;
    computeUsedSymbols?: boolean;
    name?: string;
    warnDiv?: boolean; // warn when emitting division operator
    bannedCategories?: string[];
    skipPxtModulesTSC?: boolean; // skip re-checking of pxt_modules/*
    skipPxtModulesEmit?: boolean; // skip re-emit of pxt_modules/*
    embedMeta?: string;
    embedBlob?: string; // base64

    extinfo?: ExtensionInfo;
    otherMultiVariants?: ExtensionTarget[];

}

export enum DiagnosticCategory {
    Warning = 0,
    Error = 1,
    Message = 2,
}
export interface LocationInfo {
    fileName: string;
    start: number;
    length: number;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
}
export interface DiagnosticMessageChain {
    messageText: string;
    category: DiagnosticCategory;
    code: number;
    next?: DiagnosticMessageChain;
}
export interface KsDiagnostic extends LocationInfo {
    code: number;
    category: DiagnosticCategory;
    messageText: string; // | DiagnosticMessageChain;
}

export interface CompileResult {
    outfiles: pxt.Map<string>;
    diagnostics: KsDiagnostic[];
    success: boolean;
    times: pxt.Map<number>;
    // breakpoints?: Breakpoint[];
    usedArguments?: pxt.Map<string[]>;
}

export interface ServiceUser {
    linkedPackage: (id: string) => Promise<pxt.Map<string>>
}

interface SimpleDriverCallbacks {
    cacheGet: (key: string) => Promise<string>
    cacheSet: (key: string, val: string) => Promise<void>
    httpRequestAsync?: (options: downloader.HttpRequestOptions) => Promise<downloader.HttpResponse>
    pkgOverrideAsync?: (id: string) => Promise<pxt.Map<string>>
}

export class Ctx {
    sandbox: vm.Context;
    lastUser: ServiceUser;
    private makerHw = false;
    supportsGhPkgs = false;

    constructor(public editor: mkc.DownloadedEditor) {
        const cachePref = "c-" // TODO should this be editor-dependent?
        this.sandbox = {
            eval: (str: string) => vm.runInContext(str, this.sandbox, {
                filename: "eval"
            }),
            Function: undefined,
            setTimeout: setTimeout,
            clearInterval: clearInterval,
            clearTimeout: clearTimeout,
            setInterval: setInterval,
            clearImmediate: clearImmediate,
            setImmediate: setImmediate,
            Buffer: Buffer,
            pxtTargetBundle: {},
            scriptText: {},
            global: null,
            console: {
                log: (s: string) => mkc.log(s),
                debug: (s: string) => mkc.debug(s),
                warn: (s: string) => mkc.error(s),
            }
        };

        this.sandbox.global = this.sandbox;
        vm.createContext(this.sandbox, {
            codeGeneration: {
                strings: false,
                wasm: false
            }
        });

        const ed = this.editor
        ed.targetJson.compile.keepCppFiles = true
        this.sandbox.pxtTargetBundle = ed.targetJson
        this.runScript(ed.pxtWorkerJs, ed.website + "/pxtworker.js")
        this.runScript(prep, "prep")
        const callbacks: SimpleDriverCallbacks = {
            cacheGet: (key: string) =>
                editor.cache.getAsync(cachePref + key)
                    .then(buf => buf ? buf.toString("utf8") : null),
            cacheSet: (key: string, val: string) =>
                editor.cache.setAsync(cachePref + key, Buffer.from(val, "utf8")),
            httpRequestAsync: (options: downloader.HttpRequestOptions) =>
                downloader.nodeHttpRequestAsync(options, u => {
                    if (u.protocol != "https:")
                        throw new Error("only https: supported")
                    if (u.method != "GET")
                        throw new Error("only GET supported")
                    if (!options.url.startsWith(cdnUrl + "/"))
                        throw new Error("only CDN URLs support: " + cdnUrl)
                    mkc.log("GET " + options.url)
                }),
            pkgOverrideAsync: id => {
                if (this.lastUser && this.lastUser.linkedPackage)
                    return this.lastUser.linkedPackage(id)
                else return Promise.resolve(null)
            }
        }
        this.runFunctionSync("pxt.setupSimpleCompile", [callbacks])
        // disable packages config for now; otherwise we do a HTTP request on every compile
        this.runSync("pxt.packagesConfigAsync = () => Promise.resolve(undefined)")
        this.runFunctionSync("pxt.setupWebConfig", [{
            "cdnUrl": "https://pxt.azureedge.net"
        }])
        this.supportsGhPkgs = !!this.runSync("pxt.simpleInstallPackagesAsync")
    }

    runScript(content: string, filename: string) {
        const scr = new vm.Script(content, {
            filename: filename
        })
        scr.runInContext(this.sandbox)
    }

    private runWithCb(code: string, cb: (err: any, res: any) => void) {
        this.sandbox._gcb = cb;
        const src = "(() => { const _cb = _gcb; _gcb = null; " + code + " })()"
        const scr = new vm.Script(src)
        scr.runInContext(this.sandbox)
    }

    runAsync(code: string) {
        const src = `Promise.resolve().then(() => ${code})` +
            `.then(v => _cb(null, v), err => _cb(err.stack || "" + err, null))`
        return new Promise<any>((resolve, reject) =>
            this.runWithCb(src, (err, res) => err ? reject(new Error(err)) : resolve(res)))
    }

    runSync(code: string): any {
        const src = `try { _cb(null, ${code}) } ` +
            `catch (err) { _cb(err.stack || "" + err, null) }`
        let errRes = null
        let normRes = null
        this.runWithCb(src, (err, res) => err ? errRes = err : normRes = res)
        if (errRes)
            throw new Error(errRes)
        return normRes
    }

    async setUserAsync(user: ServiceUser) {
        if (this.lastUser !== user) {
            this.lastUser = user
            if (user)
                this.serviceOp("reset", {})
        }
    }


    private async compileExtInfo(extinfo: ExtensionInfo) {
        let existing = await this.editor.cache.getAsync("cpp-" + extinfo.sha)
        if (!existing) {
            const url = this.editor.cdnUrl + "/compile/" + extinfo.sha + ".hex"
            const resp = await downloader.requestAsync({ url }).then(r => r, err => null)
            if (resp == null) {
                mkc.log(`compiling C++; this can take a while`);
                const cdata = extinfo.compileData
                const cdataObj: any = JSON.parse(Buffer.from(cdata, "base64").toString())
                if (!cdataObj.config)
                    throw new Error(`Compile config missing in C++; compile variant likely misconfigured`)
                // writeFileSync("compilereq.json", JSON.stringify(JSON.parse(Buffer.from(cdata, "base64").toString()), null, 4))
                const cresp = await downloader.requestAsync({
                    url: "https://www.makecode.com/api/compile/extension",
                    data: { data: cdata },
                    allowGzipPost: true
                })
                const hexurl = cresp.json.hex
                const jsonUrl = hexurl.replace(/\.hex/, ".json")
                for (let i = 0; i < 100; ++i) {
                    const jresp = await downloader.requestAsync({ url: jsonUrl }).then(r => r, e => null)
                    if (jresp) {
                        const json = jresp.json
                        mkc.log(`build log ${jsonUrl.replace(/\.json$/, ".log")}`);
                        if (!json.success) {
                            mkc.error(`C++ build failed`);
                            if (json.mbedresponse && json.mbedresponse.result && json.mbedresponse.result.exception)
                                mkc.error(json.mbedresponse.result.exception);
                            throw new Error("C++ build failed")
                        }
                        else {
                            const hexresp = await downloader.requestAsync({ url: hexurl })
                            existing = hexresp.buffer
                            break
                        }
                    }
                }
            } else {
                existing = resp.buffer
            }
            await this.editor.cache.setAsync("cpp-" + extinfo.sha, existing)
        }
        extinfo.hexinfo = { hex: existing.toString("utf8").split(/\r?\n/) }
    }

    async simpleCompileAsync(prj: mkc.Package, simpleOpts: any = {}): Promise<CompileResult> {
        const opts = await this.getOptions(prj, simpleOpts)

        if (simpleOpts.native && opts?.extinfo?.sha) {
            const infos = [opts.extinfo].concat((opts.otherMultiVariants || []).map(x => x.extinfo))
            for (const info of infos)
                await this.compileExtInfo(info)
        }

        // opts.breakpoints = true
        return this.serviceOp("compile", { options: opts })
    }

    private setHwVariant(prj: mkc.Package) {
        if (this.makerHw) {
            const tmp = Object.assign({}, prj.files)
            const cfg: pxt.PackageConfig = JSON.parse(tmp["pxt.json"])
            if (prj.mkcConfig.hwVariant)
                cfg.dependencies[prj.mkcConfig.hwVariant] = "*"
            tmp["pxt.json"] = JSON.stringify(cfg, null, 4)
            this.sandbox._scriptText = tmp
        } else {
            this.sandbox._scriptText = prj.files
            this.runFunctionSync("pxt.setHwVariant", [prj.mkcConfig.hwVariant || ""])
        }
    }

    getOptions(prj: mkc.Package, simpleOpts: any = {}): Promise<CompileOptions> {
        this.sandbox._opts = simpleOpts
        this.setHwVariant(prj)
        return this.runAsync("pxt.simpleGetCompileOptionsAsync(_scriptText, _opts)")

    }

    installGhPackages(prj: mkc.Package) {
        this.setHwVariant(prj)
        return this.runFunctionAsync("pxt.simpleInstallPackagesAsync", [prj.files])
    }

    private runFunctionCore(name: string, args: any[]) {
        let argString = ""
        for (let i = 0; i < args.length; ++i) {
            const arg = "_arg" + i
            this.sandbox[arg] = args[i]
            if (argString)
                argString += ", "
            argString += arg
        }
        return `${name}(${argString})`
    }

    runFunctionSync(name: string, args: any[]) {
        return this.runSync(this.runFunctionCore(name, args))
    }

    runFunctionAsync(name: string, args: any[]) {
        return this.runAsync(this.runFunctionCore(name, args))
    }

    serviceOp(op: string, data: any) {
        return this.runFunctionSync("pxtc.service.performOperation", [op, data])
    }

    get hwVariants() {
        let hwVariants: pxt.PackageConfig[] = this.runSync("pxt.getHwVariants()")

        if (hwVariants.length == 0) {
            hwVariants = this.runSync("Object.values(pxt.appTarget.bundledpkgs).map(pkg => JSON.parse(pkg['pxt.json']))")
            hwVariants = hwVariants.filter(pkg => !/prj/.test(pkg.name) && !!pkg.core)
            for (const pkg of hwVariants) {
                pkg.card = {
                    name: "",
                    description: pkg.description
                }
            }
            if (hwVariants.length > 1)
                this.makerHw = true
            else
                hwVariants = []
        }

        return hwVariants
    }
}
