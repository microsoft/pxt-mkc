import vm = require("vm");
import mkc = require("./mkc");
import downloader = require("./downloader");

const prep = `

`

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

export class Ctx {
    sandbox: any;
    lastUser: unknown;
    private makerHw = false;

    constructor(public editor: mkc.DownloadedEditor) {
        this.sandbox = {
            eval: undefined,
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
                log: (s: string) => console.log(s),
                debug: (s: string) => console.log(s),
                warn: (s: string) => console.log(s),
            }
        };

        this.sandbox.global = this.sandbox;
        (vm as any).createContext(this.sandbox, {
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
        this.runFunctionSync("pxt.setupSimpleCompile", [])
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

    async setUserAsync(user: unknown) {
        if (this.lastUser !== user) {
            this.lastUser = user
            if (user)
                this.serviceOp("reset", {})
        }
    }

    async simpleCompileAsync(prj: mkc.Package, simpleOpts: any = {}): Promise<CompileResult> {
        const opts = await this.getOptions(prj, simpleOpts)

        const cppsha: string = (opts as any).extinfo ? (opts as any).extinfo.sha : null
        if (simpleOpts.native && cppsha) {
            let existing = await this.editor.cache.getAsync("cpp-" + cppsha)
            if (!existing) {
                const url = this.editor.cdnUrl + "/compile/" + (opts as any).extinfo.sha + ".hex"
                const resp = await downloader.requestAsync({ url }).then(r => r, err => null)
                if (resp == null) {
                    console.log(`compiling C++; this can take a while`);
                    const cdata = (opts as any).extinfo.compileData
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
                            console.log(`build log ${jsonUrl.replace(/\.json$/, ".log")}`);
                            if (!json.success) {
                                console.log(`C++ build failed`);
                                if (json.mbedresponse && json.mbedresponse.result && json.mbedresponse.result.exception)
                                    console.log(json.mbedresponse.result.exception);
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
                await this.editor.cache.setAsync("cpp-" + cppsha, existing)
            }
            (opts as any).extinfo.hexinfo = { hex: existing.toString("utf8").split(/\r?\n/) }
        }

        // opts.breakpoints = true
        return this.serviceOp("compile", { options: opts })
    }

    getOptions(prj: mkc.Package, simpleOpts: any = {}): Promise<CompileOptions> {
        this.sandbox._opts = simpleOpts
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
        return this.runAsync("pxt.simpleGetCompileOptionsAsync(_scriptText, _opts)")
    }

    runFunctionSync(name: string, args: any[]) {
        let argString = ""
        for (let i = 0; i < args.length; ++i) {
            const arg = "_arg" + i
            this.sandbox[arg] = args[i]
            if (argString)
                argString += ", "
            argString += arg
        }
        return this.runSync(`${name}(${argString})`)
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
