import vm = require("vm")
import mkc = require("./mkc")
import downloader = require("./downloader")
import { host, LanguageService } from "./host";

const cdnUrl = "https://pxt.azureedge.net"

export interface HexInfo {
    hex: string[]
}

export interface ExtensionInfo {
    sha: string
    compileData: string
    skipCloudBuild?: boolean
    hexinfo?: HexInfo
    appVariant?: string
}

export interface ExtensionTarget {
    extinfo: ExtensionInfo
    // target: CompileTarget
}

export interface CompileOptions {
    fileSystem: pxt.Map<string>
    testMode?: boolean
    sourceFiles?: string[]
    generatedFiles?: string[]
    jres?: pxt.Map<pxt.JRes>
    noEmit?: boolean
    forceEmit?: boolean
    ast?: boolean
    breakpoints?: boolean
    trace?: boolean
    justMyCode?: boolean
    computeUsedSymbols?: boolean
    computeUsedParts?: boolean
    name?: string
    warnDiv?: boolean // warn when emitting division operator
    bannedCategories?: string[]
    skipPxtModulesTSC?: boolean // skip re-checking of pxt_modules/*
    skipPxtModulesEmit?: boolean // skip re-emit of pxt_modules/*
    embedMeta?: string
    embedBlob?: string // base64

    extinfo?: ExtensionInfo
    otherMultiVariants?: ExtensionTarget[]
}

export interface BuiltSimJsInfo {
    js: string
    targetVersion: string
    fnArgs?: pxt.Map<String[]>
    parts?: string[]
    usedBuiltinParts?: string[]
    allParts?: string[]
    breakpoints?: number[]
}

export enum DiagnosticCategory {
    Warning = 0,
    Error = 1,
    Message = 2,
}
export interface LocationInfo {
    fileName: string
    start: number
    length: number
    line: number
    column: number
    endLine?: number
    endColumn?: number
}
export interface DiagnosticMessageChain {
    messageText: string
    category: DiagnosticCategory
    code: number
    next?: DiagnosticMessageChain
}
export interface KsDiagnostic extends LocationInfo {
    code: number
    category: DiagnosticCategory
    messageText: string | DiagnosticMessageChain
}

export interface CompileResult {
    outfiles: pxt.Map<string>
    diagnostics: KsDiagnostic[]
    success: boolean
    times: pxt.Map<number>
    // breakpoints?: Breakpoint[];
    usedArguments?: pxt.Map<string[]>
    usedParts?: string[]
    binaryPath?: string;
    simJsInfo?: BuiltSimJsInfo
}

export interface ServiceUser {
    linkedPackage: (id: string) => Promise<pxt.Map<string>>
}

interface SimpleDriverCallbacks {
    cacheGet: (key: string) => Promise<string>
    cacheSet: (key: string, val: string) => Promise<void>
    httpRequestAsync?: (
        options: downloader.HttpRequestOptions
    ) => Promise<downloader.HttpResponse>
    pkgOverrideAsync?: (id: string) => Promise<pxt.Map<string>>
}

export class Ctx {
    lastUser: ServiceUser
    private makerHw = false
    supportsGhPkgs = false
    languageService: LanguageService;

    constructor(public editor: mkc.DownloadedEditor) {
        this.initAsync();
    }

    async initAsync() {
        this.languageService = await host().createLanguageServiceAsync(this.editor);

        const cachePref = "c-" // TODO should this be editor-dependent?

        const callbacks: SimpleDriverCallbacks = {
            cacheGet: (key: string) =>
                this.editor.cache
                    .getAsync(cachePref + key)
                    .then(buf => (buf ? host().bufferToString(buf) : null)),
            cacheSet: (key: string, val: string) =>
                this.editor.cache.setAsync(
                    cachePref + key,
                    host().stringToBuffer(val)
                ),
            httpRequestAsync: (options: downloader.HttpRequestOptions) =>
            host().requestAsync(options, (protocol, method) => {
                    if (protocol != "https:")
                        throw new Error("only https: supported")
                    if (method != "GET") throw new Error("only GET supported")
                    if (!options.url.startsWith(cdnUrl + "/") && !options.url.startsWith("https://www.makecode.com/api/"))
                        throw new Error("only CDN URLs and makecode.com/api support: " + cdnUrl + ", got " + options.url)
                    mkc.log("GET " + options.url)
                }),
            pkgOverrideAsync: id => {
                if (this.lastUser && this.lastUser.linkedPackage)
                    return this.lastUser.linkedPackage(id)
                else return Promise.resolve(null)
            },
        }

        await this.languageService.registerDriverCallbacksAsync(callbacks);
        await this.languageService.setWebConfigAsync({
            cdnUrl: "https://pxt.azureedge.net",
        } as downloader.WebConfig);
        this.supportsGhPkgs = await this.languageService.supportsGhPackagesAsync();
    }

    async setUserAsync(user: ServiceUser) {
        if (this.lastUser !== user) {
            this.lastUser = user
            if (user) await this.languageService.performOperationAsync("reset", {})
        }
    }

    private async compileExtInfo(extinfo: ExtensionInfo) {
        let existing = await this.editor.cache.getAsync("cpp-" + extinfo.sha)
        if (!existing) {
            const url = this.editor.cdnUrl + "/compile/" + extinfo.sha + ".hex"
            const resp = await downloader.requestAsync({ url }).then(
                r => r,
                err => null
            )
            if (resp == null) {
                mkc.log(`compiling C++; this can take a while`)
                const cdata = extinfo.compileData
                const cdataObj: any = JSON.parse(
                    host().bufferToString(host().stringToBuffer(cdata, "base64"))
                )
                if (!cdataObj.config)
                    throw new Error(
                        `Compile config missing in C++; compile variant likely misconfigured`
                    )
                // writeFileSync("compilereq.json", JSON.stringify(JSON.parse(Buffer.from(cdata, "base64").toString()), null, 4))
                const cresp = await downloader.requestAsync({
                    url: "https://www.makecode.com/api/compile/extension",
                    data: { data: cdata },
                    allowGzipPost: true,
                })
                const hexurl = cresp.json.hex
                const jsonUrl = hexurl.replace(/\.hex/, ".json")
                for (let i = 0; i < 100; ++i) {
                    const jresp = await downloader
                        .requestAsync({ url: jsonUrl })
                        .then(
                            r => r,
                            e => null
                        )
                    if (jresp) {
                        const json = jresp.json
                        mkc.log(
                            `build log ${jsonUrl.replace(/\.json$/, ".log")}`
                        )
                        if (!json.success) {
                            mkc.error(`C++ build failed`)
                            if (
                                json.mbedresponse &&
                                json.mbedresponse.result &&
                                json.mbedresponse.result.exception
                            )
                                mkc.error(json.mbedresponse.result.exception)
                            throw new Error("C++ build failed")
                        } else {
                            const hexresp = await downloader.requestAsync({
                                url: hexurl,
                            })
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
        extinfo.hexinfo = { hex: host().bufferToString(existing).split(/\r?\n/) }
    }

    async simpleCompileAsync(
        prj: mkc.Package,
        simpleOpts: any = {}
    ): Promise<CompileResult> {
        let opts = await this.getOptionsAsync(prj, simpleOpts)

        if (simpleOpts.native && opts?.extinfo?.sha) {
            const infos = [opts.extinfo].concat(
                (opts.otherMultiVariants || []).map(x => x.extinfo)
            )
            for (const info of infos) await this.compileExtInfo(info)
        }

        // Manually set this option for now
        if (simpleOpts.computeUsedParts) opts.computeUsedParts = true

        // opts.breakpoints = true
        return this.languageService.performOperationAsync("compile", { options: opts })
    }

    async buildSimJsInfoAsync(result: CompileResult): Promise<BuiltSimJsInfo> {
        return await this.languageService.buildSimJsInfoAsync(result);
    }

    private async setHwVariantAsync(prj: mkc.Package) {
        if (this.makerHw) {
            const tmp = Object.assign({}, prj.files)
            const cfg: pxt.PackageConfig = JSON.parse(tmp["pxt.json"])
            if (prj.mkcConfig.hwVariant)
                cfg.dependencies[prj.mkcConfig.hwVariant] = "*"
            tmp["pxt.json"] = mkc.stringifyConfig(cfg)
            await this.languageService.setProjectTextAsync(tmp);
        } else {
            await this.languageService.setProjectTextAsync(prj.files);
            await this.languageService.setHwVariantAsync(prj.mkcConfig.hwVariant || "");
        }
    }

   async getOptionsAsync(prj: mkc.Package, simpleOpts: any = {}) {
        await this.setHwVariantAsync(prj);
        return this.languageService.getCompileOptionsAsync(
            prj,
            simpleOpts
        )
    }

    async installGhPackagesAsync(prj: mkc.Package) {
        await this.setHwVariantAsync(prj);
        const pkg = await this.languageService.installGhPackagesAsync(prj.files);
        prj.files = pkg;
    }

    async getHardwareVariantsAsync() {
        let hwVariants = await this.languageService.getHardwareVariantsAsync();
        if (hwVariants.length == 0) {
            hwVariants = await this.languageService.getBundledPackageConfigsAsync();
            hwVariants = hwVariants.filter(
                pkg => !/prj/.test(pkg.name) && !!pkg.core
            )
            for (const pkg of hwVariants) {
                pkg.card = {
                    name: "",
                    description: pkg.description,
                }
            }
            if (hwVariants.length > 1) this.makerHw = true
            else hwVariants = []
        }

        return hwVariants
    }

    dispose() {
        this.languageService?.dispose?.();
    }
}
