/// <reference path="../external/pxtpackage.d.ts" />

export import downloader = require("./downloader")
export import files = require("./files")
export import service = require("./service")
export import loader = require("./loader")
export import simserver = require("./simserver")

export interface MkcJson {
    targetWebsite: string;
    hwVariant?: string;
    links?: pxt.Map<string>;
    overrides?: Partial<pxt.PackageConfig>;
}

export interface Cache {
    getAsync(key: string): Promise<Buffer>;
    setAsync(key: string, val: Buffer): Promise<void>;
    expandKey?(key: string): string;
    rootPath?: string;
}

export interface DownloadedEditor {
    cache: Cache;
    versionNumber: number;
    cdnUrl: string;
    simUrl: string;
    website: string;
    pxtWorkerJs: string;
    targetJson: any;
}

export interface Package {
    config: pxt.PackageConfig;
    mkcConfig: MkcJson;
    files: pxt.Map<string>;
    fromTargetJson?: boolean;
}

export interface Workspace {
    packages: pxt.Map<Package>;
}

export let cloudRoot = "https://makecode.com/api/"


function jsonCopyFrom<T>(trg: T, src: T) {
    let v = JSON.parse(JSON.stringify(src))
    for (let k of Object.keys(src)) {
        (trg as any)[k] = (v as any)[k]
    }
}


export class Project {
    editor: DownloadedEditor
    service: service.Ctx
    mainPkg: Package
    lastPxtJson: string;
    private _hwVariant: string;
    writePxtModules = true
    outputPrefix = "built"
    mkcConfig: MkcJson

    constructor(public directory: string, public cache: Cache = null) {
        if (!this.cache)
            this.cache = files.mkHomeCache()
    }

    get hwVariant() {
        return this._hwVariant
    }
    set hwVariant(value: string) {
        this._hwVariant = value
        if (this.mainPkg)
            this.mainPkg.mkcConfig.hwVariant = value
    }

    guessHwVariant() {
        if (this.mainPkg.mkcConfig.hwVariant)
            return

        const variants = this.service.hwVariants
        const cfg = this.mainPkg.config
        for (const v of variants) {
            if (cfg.dependencies[v.name] || cfg.testDependencies?.[v.name]) {
                console.log("guessing hw-variant: " + hwid(v))
                this.hwVariant = hwid(v)
                return
            }
        }

        console.log("selecting first hw-variant: " + hwid(variants[0]))
        this.hwVariant = hwid(variants[0])

        function hwid(cfg: pxt.PackageConfig) {
            return cfg.name.replace(/hw---/, "")
        }
    }

    protected readFileAsync(filename: string) {
        return files.readPrjFileAsync(this.directory, filename)
    }

    protected saveBuiltFilesAsync(res: service.CompileResult) {
        return files.saveBuiltFilesAsync(this.directory, res, this.outputPrefix)
    }

    protected savePxtModulesAsync(ws: Workspace) {
        return files.savePxtModulesAsync(this.directory, ws)
    }

    protected async readPackageAsync() {
        if (!this.mkcConfig)
            this.mkcConfig = JSON.parse(await this.readFileAsync("mkc.json").then(s => s, _err => "{}"))
        const pxtJson = await this.readFileAsync("pxt.json")
        const res: Package = {
            config: JSON.parse(pxtJson),
            mkcConfig: this.mkcConfig,
            files: {
                "pxt.json": pxtJson
            }
        }
        if (res.mkcConfig.overrides) {
            jsonCopyFrom(res.config, res.mkcConfig.overrides)
            res.files["pxt.json"] = JSON.stringify(res.config, null, 4)
        }
        for (let f of res.config.files.concat(res.config.testFiles || [])) {
            if (f.indexOf("/") >= 0)
                continue
            res.files[f] = await this.readFileAsync(f)
        }
        if (res.files["main.ts"] === undefined)
            res.files["main.ts"] = "" // avoid bogus warning from PXT
        return res
    }

    async loadPkgAsync() {
        if (this.mainPkg)
            return

        const prj = await this.readPackageAsync()
        loader.guessMkcJson(prj)

        if (this.hwVariant)
            prj.mkcConfig.hwVariant = this.hwVariant

        // TODO handle require("lzma") in worker
        prj.config.binaryonly = true
        const pxtJson = prj.files["pxt.json"] = JSON.stringify(prj.config, null, 4)

        this.mainPkg = prj

        if (pxtJson != this.lastPxtJson) {
            this.lastPxtJson = pxtJson
            if (this.service)
                await this.service.setUserAsync(null)
        }
    }

    updateEditorAsync() {
        return this.loadEditorAsync(true)
    }

    async loadEditorAsync(forceUpdate = false) {
        if (this.editor && !forceUpdate)
            return false

        await this.loadPkgAsync()

        const newEditor = await downloader.downloadAsync(
            this.cache, this.mainPkg.mkcConfig.targetWebsite, !forceUpdate)

        if (!this.editor || newEditor.versionNumber != this.editor.versionNumber) {
            this.editor = newEditor
            this.service = new service.Ctx(this.editor)
            return true
        } else {
            return false
        }
    }

    async maybeWritePxtModulesAsync() {
        await this.loadEditorAsync()
        await this.loadPkgAsync()
        const ws = await loader.loadDeps(this.editor, this.mainPkg)
        if (this.writePxtModules && this.service.lastUser !== this) {
            console.log("writing pxt_modules/*")
            await this.savePxtModulesAsync(ws)
        }
    }

    async buildAsync(simpleOpts = {}) {
        const t0 = Date.now()
        this.mainPkg = null // force reload

        console.log("build started")

        await this.maybeWritePxtModulesAsync()

        await this.service.setUserAsync(this)
        const res = await this.service.simpleCompileAsync(this.mainPkg, simpleOpts)

        const err = (res as any).errorMessage
        if (err)
            throw new Error(err)

        await this.saveBuiltFilesAsync(res)

        console.log("build " + (Date.now() - t0) + "ms")

        //delete res.outfiles
        //delete (res as any).procDebugInfo
        //console.log(res)

        return res
    }

    mkChildProject(folder: string) {
        const prj = new Project(folder, this.cache)
        prj.service = this.service
        prj.mkcConfig = this.mkcConfig
        if (this._hwVariant)
            prj.hwVariant = this._hwVariant
        prj.outputPrefix = this.outputPrefix
        prj.writePxtModules = this.writePxtModules
        prj.editor = this.editor
        return prj
    }
}
