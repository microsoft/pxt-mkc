/// <reference path="../external/pxtpackage.d.ts" />

export import downloader = require("./downloader")
export import files = require("./files")
export import service = require("./service")
export import loader = require("./loader")
export import simserver = require("./simserver")
import { collectCurrentVersionAsync, monoRepoConfigsAsync } from "./files"

export interface MkcJson {
    targetWebsite: string
    hwVariant?: string
    links?: pxt.Map<string>
    overrides?: Partial<pxt.PackageConfig>
    include?: string[]
}

export interface Cache {
    getAsync(key: string): Promise<Buffer>
    setAsync(key: string, val: Buffer): Promise<void>
    expandKey?(key: string): string
    rootPath?: string
}

export interface DownloadedEditor {
    cache: Cache
    versionNumber: number
    cdnUrl: string
    simUrl: string
    website: string
    pxtWorkerJs: string
    targetJson: any
    webConfig: downloader.WebConfig
}

export interface Package {
    config: pxt.PackageConfig
    mkcConfig: MkcJson
    files: pxt.Map<string>
    fromTargetJson?: boolean
}

export interface Workspace {
    packages: pxt.Map<Package>
}

export let cloudRoot = "https://makecode.com/api/"

function jsonCopyFrom<T>(trg: T, src: T) {
    let v = JSON.parse(JSON.stringify(src))
    for (let k of Object.keys(src)) {
        ; (trg as any)[k] = (v as any)[k]
    }
}

export class Project {
    editor: DownloadedEditor
    service: service.Ctx
    mainPkg: Package
    lastPxtJson: string
    private _hwVariant: string
    writePxtModules = true
    linkPxtModules = false
    symlinkPxtModules = false
    outputPrefix = "built"
    mkcConfig: MkcJson

    constructor(public directory: string, protected cache: Cache = null) {
    }

    get hwVariant() {
        return this._hwVariant
    }
    set hwVariant(value: string) {
        this._hwVariant = value
        if (this.mainPkg) this.mainPkg.mkcConfig.hwVariant = value
    }

    async guessHwVariantAsync() {
        if (this.mainPkg.mkcConfig.hwVariant) return

        const variants = await this.service.getHardwareVariantsAsync();
        const cfg = this.mainPkg.config
        for (const v of variants) {
            if (cfg.dependencies[v.name] || cfg.testDependencies?.[v.name]) {
                log("guessing hw-variant: " + hwid(v))
                this.hwVariant = hwid(v)
                return
            }
        }

        log("selecting first hw-variant: " + hwid(variants[0]))
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

    protected async savePxtModulesAsync(filesmap0: pxt.Map<string>) {
        let filesmap: pxt.Map<string | { symlink: string }> = filesmap0
        if (this.linkPxtModules || this.symlinkPxtModules) {
            let libsPath = await files.findParentDirWithAsync("..", "pxtarget.json")
            if (libsPath)
                libsPath =
                    files.relativePath(".", libsPath).replace(/\\/g, "/") +
                    "/libs"
            filesmap = JSON.parse(JSON.stringify(filesmap0))
            const pxtmod = "pxt_modules/"
            const filesByPkg: pxt.Map<string[]> = {}
            const filenames = Object.keys(filesmap)
            for (const s of filenames) {
                if (s.startsWith(pxtmod)) {
                    const id = s.slice(pxtmod.length).replace(/\/.*/, "")
                    if (!filesByPkg[id]) filesByPkg[id] = []
                    filesByPkg[id].push(s)
                }
            }
            for (const id of Object.keys(filesByPkg)) {
                let lnk = this.mkcConfig.links?.[id]
                let rel = ""
                if (lnk)
                    rel = files.relativePath(
                        this.directory + "/pxt_modules/foobar",
                        lnk
                    )
                else if (await files.fileExistsAsync(`${libsPath}/${id}/pxt.json`)) {
                    lnk = `${libsPath}/${id}`
                    rel = `../../${lnk}`
                }
                if (lnk && this.linkPxtModules) {
                    for (const fn of filesByPkg[id]) delete filesmap[fn]
                    log(`link ${id} -> ${lnk}`)
                    const pxtJson = JSON.stringify(
                        {
                            additionalFilePath: rel,
                        },
                        null,
                        4
                    )
                    filesmap["pxt_modules/" + id + "/pxt.json"] = pxtJson
                    if (/---/.test(id)) {
                        filesmap[
                            "pxt_modules/" +
                            id.replace(/---.*/, "") +
                            "/pxt.json"
                        ] = pxtJson
                    }
                } else if (lnk && this.symlinkPxtModules) {
                    for (const fn of filesByPkg[id]) {
                        const bn = fn.replace(/.*\//, "")
                        if (await files.fileExistsAsync(`${lnk}/${bn}`)) {
                            filesmap[fn] = { symlink: `${rel}/${bn}` }
                            // log(`symlink ${fn} -> ${rel}/${bn}`)
                        } else {
                            log(`not link ${fn}`)
                        }
                    }
                }
            }
        }
        return files.savePxtModulesAsync(this.directory, filesmap)
    }

    async readPxtConfig() {
        const pxtJson = await this.readFileAsync("pxt.json")
        return JSON.parse(pxtJson) as pxt.PackageConfig
    }

    protected async readPackageAsync() {
        if (!this.mkcConfig)
            this.mkcConfig = JSON.parse(
                await this.readFileAsync("mkc.json").then(
                    s => s,
                    _err => "{}"
                )
            )
        const res: Package = {
            config: await this.readPxtConfig(),
            mkcConfig: this.mkcConfig,
            files: {},
        }
        if (res.mkcConfig.overrides)
            jsonCopyFrom(res.config, res.mkcConfig.overrides)
        res.files["pxt.json"] = stringifyConfig(res.config)
        for (let f of res.config.files.concat(res.config.testFiles || [])) {
            res.files[f] = await this.readFileAsync(f)
        }
        if (res.files["main.ts"] === undefined) res.files["main.ts"] = "" // avoid bogus warning from PXT
        return res
    }

    async loadPkgAsync() {
        if (this.mainPkg) return

        const prj = await this.readPackageAsync()
        loader.guessMkcJson(prj)

        if (this.hwVariant) prj.mkcConfig.hwVariant = this.hwVariant

        // TODO handle require("lzma") in worker
        prj.config.binaryonly = true
        const pxtJson = (prj.files["pxt.json"] = stringifyConfig(prj.config))

        this.mainPkg = prj

        if (pxtJson != this.lastPxtJson) {
            this.lastPxtJson = pxtJson
            if (this.service) await this.service.setUserAsync(null)
        }
    }

    updateEditorAsync() {
        return this.loadEditorAsync(true)
    }

    async loadEditorAsync(forceUpdate = false) {
        if (this.editor && !forceUpdate) return false

        await this.loadPkgAsync()

        const newEditor = await downloader.downloadAsync(
            await this.getCacheAsync(),
            this.mainPkg.mkcConfig.targetWebsite,
            !forceUpdate
        )

        if (
            !this.editor ||
            newEditor.versionNumber != this.editor.versionNumber
        ) {
            this.editor = newEditor
            this.service = new service.Ctx(this.editor)
            return true
        } else {
            return false
        }
    }

    async getCacheAsync() {
        if (!this.cache) this.cache = await files.mkHomeCacheAsync();
        return this.cache;
    }

    async maybeWritePxtModulesAsync() {
        await this.loadEditorAsync()
        await this.loadPkgAsync()

        const wasThis = this.service.lastUser == this

        this.service.setUserAsync(this)

        if (this.service.supportsGhPkgs) {
            await this.service.installGhPackagesAsync(this.mainPkg)
        } else {
            await loader.loadDeps(this.editor, this.mainPkg)
        }

        if (this.writePxtModules && !wasThis) {
            log("writing pxt_modules/*")
            await this.savePxtModulesAsync(this.mainPkg.files)
        }
    }

    async linkedPackage(id: string) {
        const folder = this.mainPkg?.mkcConfig?.links?.[id]
        if (folder) return files.readProjectAsync(folder)
        return null
    }

    async buildAsync(simpleOpts = {}) {
        this.mainPkg = null // force reload

        await this.maybeWritePxtModulesAsync()

        await this.service.setUserAsync(this)
        const res = await this.service.simpleCompileAsync(
            this.mainPkg,
            simpleOpts
        )

        const err = (res as any).errorMessage
        if (err) throw new Error(err)

        const binjs = "binary.js"
        if (res.outfiles[binjs]) {
            const appTarget = await this.service.languageService.getAppTargetAsync();
            const boardDef = appTarget.simulator?.boardDefinition
            if (boardDef) {
                res.outfiles[binjs] =
                    `// boardDefinition=${JSON.stringify(boardDef)}\n` +
                    res.outfiles[binjs]
            }
            const webConfig: downloader.WebConfig =
                this.editor.webConfig || (await this.service.languageService.getWebConfigAsync())
            const configs = await monoRepoConfigsAsync(this.directory, true)
            const version = `v${await collectCurrentVersionAsync(configs) || "0"}`
            const meta: any = {
                simUrl: webConfig.simUrl,
                cdnUrl: webConfig.cdnUrl,
                version,
                target: appTarget.id,
                targetVersion: appTarget.versions.target,
            }

            res.outfiles[binjs] =
                `// meta=${JSON.stringify(meta)}\n` + res.outfiles[binjs]
        }

        await this.saveBuiltFilesAsync(res)

        //delete res.outfiles
        //delete (res as any).procDebugInfo
        //console.log(res)

        return res
    }

    async mkChildProjectAsync(folder: string) {
        const prj = new Project(folder, await this.getCacheAsync())
        prj.service = this.service
        prj.mkcConfig = this.mkcConfig
        if (this._hwVariant) prj.hwVariant = this._hwVariant
        prj.outputPrefix = this.outputPrefix
        prj.writePxtModules = this.writePxtModules
        prj.editor = this.editor
        return prj
    }
}

export let log = (msg: string) => {
    console.log(msg)
}
export let error = (msg: string) => {
    console.error(msg)
}
export let debug = (msg: string) => {
    console.debug(msg)
}

export function setLogging(fns: {
    log: (msg: string) => void
    error: (msg: string) => void
    debug: (msg: string) => void
}) {
    log = fns.log
    error = fns.error
    debug = fns.debug
}

export function stringifyConfig(cfg: pxt.PackageConfig | MkcJson) {
    return JSON.stringify(cfg, null, 4) + "\n"
}
