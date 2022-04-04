import * as fs from "fs"
import * as path from "path"
import * as util from "util"
import { createServer } from "http"

import * as mkc from "./mkc"
import * as files from "./files"
import * as bump from "./bump"
import * as downloader from "./downloader"
import * as service from "./service"
import {
    program as commander,
    CommandOptions,
    Command,
    Argument,
    Option,
} from "commander"
import * as chalk from "chalk"
import { getDeployDrives } from "./deploy"
import { descriptors } from "./loader"
import watch from "node-watch"
import { cloudRoot, MkcJson } from "./mkc"
import { startSimServer } from "./simserver"
import { expandStackTrace } from "./stackresolver"
const fetch = require("node-fetch")

interface Options {
    colors?: boolean
    noColors?: boolean
    debug?: boolean
}

interface ProjectOptions extends Options {
    configPath?: string
    update?: boolean

    pxtModules?: boolean
    linkPxtModules?: boolean
    symlinkPxtModules?: boolean
}

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v))
}

async function downloadProjectAsync(id: string) {
    id = id.replace(/.*\//, "")
    const url = mkc.cloudRoot + id + "/text"
    const files = await downloader.httpGetJsonAsync(url)
    for (let fn of Object.keys(files)) {
        if (/\//.test(fn)) continue
        fs.writeFileSync(fn, files[fn])
    }
    msg("downloaded.")
}

async function buildOnePrj(opts: BuildOptions, prj: mkc.Project) {
    try {
        const simpleOpts = {
            native: opts.native,
        }

        const res = await prj.buildAsync(simpleOpts)

        const msgToString = (
            diagnostic: service.DiagnosticMessageChain | service.KsDiagnostic
        ) => {
            const category =
                diagnostic.category == 1
                    ? chalk.red("error")
                    : diagnostic.category == 2
                        ? chalk.yellowBright("warning")
                        : "message"
            return `${category} TS${diagnostic.code}: ${diagnostic.messageText}\n`
        }

        let output = ""
        for (let diagnostic of res.diagnostics) {
            let pref = ""
            if (diagnostic.fileName)
                pref = `${diagnostic.fileName}(${diagnostic.line + 1},${diagnostic.column + 1
                    }): `

            if (typeof diagnostic.messageText == "string")
                output += pref + msgToString(diagnostic)
            else {
                for (
                    let chain = diagnostic.messageText;
                    chain;
                    chain = chain.next
                ) {
                    output += pref + msgToString(chain)
                }
            }
        }

        if (output) console.log(output.replace(/\n$/, ""))

        return res.success ? res : null
    } catch (e) {
        error("Exception: " + e.stack)
        return null
    }
}

function info(msg: string) {
    console.log(chalk.blueBright(msg))
}

function msg(msg: string) {
    console.log(chalk.green(msg))
}

function error(msg: string) {
    console.error(chalk.red(msg))
}

function createCommand(name: string, opts?: CommandOptions) {
    const cmd = commander
        .command(name, opts)
        .option("--colors", "force color output")
        .option("--no-colors", "disable color output")
        .option("--debug", "enable debug output from PXT")
    return cmd
}

let debugMode = false
function applyGlobalOptions(opts: Options) {
    if (opts.debug) debugMode = true

    if (opts.noColors) (chalk as any).level = 0
    else if (opts.colors && !chalk.level) (chalk as any).level = 1
    else if (process.env["GITHUB_WORKFLOW"]) (chalk as any).level = 1
}

interface ServeOptions extends BuildOptions {
    port?: string
}
async function serveCommand(opts: ServeOptions) {
    applyGlobalOptions(opts)
    opts.javaScript = true
    if (opts.watch) startWatch(clone(opts))
    opts = clone(opts)
    opts.update = false
    const prj = await resolveProject(opts, !!opts.watch)
    const port = parseInt(opts.port) || 7000
    msg(`simulator web server at http://localhost:${port}`)
    startSimServer(prj.editor, port)
}

interface DownloadOptions extends Options { }
async function downloadCommand(URL: string, opts: DownloadOptions) {
    applyGlobalOptions(opts)
    await downloadProjectAsync(URL)
}

interface CleanOptions extends Options { }
async function cleanCommand(opts: CleanOptions) {
    applyGlobalOptions(opts)

        ;["built", "pxt_modules"]
            .filter(d => fs.existsSync(d))
            .forEach(d => {
                msg(`deleting ${d} folder`)
                fs.rmdirSync(d, { recursive: true, force: true } as any)
            })

    msg("run `mkc init` again to setup your project")
}

async function resolveProject(opts: ProjectOptions, quiet = false) {
    const prjdir = files.findProjectDir()
    if (!prjdir) {
        error(`could not find "pxt.json" file`)
        process.exit(1)
    }

    if (!opts.configPath) {
        const cfgFolder = files.findParentDirWith(prjdir, "mkc.json")
        if (cfgFolder) opts.configPath = path.join(cfgFolder, "mkc.json")
    }

    log(`using project: ${prjdir}/pxt.json`)
    const prj = new mkc.Project(prjdir)

    if (opts.configPath) {
        log(`using config: ${opts.configPath}`)
        prj.mkcConfig = readCfg(opts.configPath, quiet)
    }

    await prj.loadEditorAsync(!!opts.update)

    let version = "???"
    try {
        version = prj.service.runSync("pxt.appTarget?.versions?.target")
    } catch { }
    log(`using editor: ${prj.mkcConfig.targetWebsite} v${version}`)

    if (opts.debug) prj.service.runSync("(() => { pxt.options.debug = 1 })()")

    prj.writePxtModules = !!opts.pxtModules
    if (opts.linkPxtModules) {
        prj.writePxtModules = true
        prj.linkPxtModules = true
    } else if (opts.symlinkPxtModules) {
        prj.writePxtModules = true
        prj.symlinkPxtModules = true
    }
    return prj

    function log(msg: string) {
        if (!quiet) info(msg)
    }
}

interface BuildOptions extends ProjectOptions {
    hw?: string
    native?: boolean
    javaScript?: boolean
    deploy?: boolean
    serve?: boolean
    servePort?: number
    alwaysBuilt?: boolean
    monoRepo?: boolean
    watch?: boolean
}
async function buildCommand(opts: BuildOptions, info: any) {
    if (info?.args?.length) {
        error("invalid command")
        process.exit(1)
    }
    applyGlobalOptions(opts)
    if (opts.deploy && opts.monoRepo) {
        error("--deploy and --mono-repo cannot be used together")
        process.exit(1)
    }
    if (opts.deploy && opts.javaScript) {
        error("--deploy and --java-script cannot be used together")
        process.exit(1)
    }
    if (opts.serve && !opts.watch) {
        error("--serve must be used with --watch")
        process.exit(1)
    }
    if (opts.serve && opts.monoRepo) {
        error("--serve and --mono-repo cannot be used together")
        process.exit(1)
    }
    if (opts.watch) {
        startWatch(opts)
    } else await buildCommandOnce(opts)
}

function delay(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function startWatch(opts: BuildOptions) {
    const binaries: Record<string, Buffer | string> = {}
    if (opts.serve) {
        const port = opts.servePort || 7001
        createServer(async (req, res) => {
            // find file
            const k = req.url
                .toLowerCase()
                .replace(/^\//, "")
                .replace(/\/$/i, "")
            const data = binaries[k]
            if (data) {
                info(`found firmware file ${k}`)
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
        }).listen(port)
        msg(`firmware file server at http://127.0.0.1:${port}/`)
    }

    const watcher = watch("./", {
        recursive: true,
        delay: 200,
        filter(f, skip) {
            // skip node_modules, pxt_modules, built, .git
            if (/\/?((node|pxt)_modules|built|\.git)/i.test(f)) return skip
            // only watch for js files
            return /\.(json|ts|asm|cpp|c|h|hpp)$/i.test(f)
        },
    })

    let building = false
    let buildPending = false
    const build = async (ev: string, filename: string) => {
        if (ev) msg(`detected ${ev} ${filename}`)

        buildPending = true

        await delay(100) // wait for other change events, that might have piled-up to arrive

        // don't trigger 2 build, wait and do it again
        if (building) {
            msg(` build in progress, waiting...`)
            return
        }

        // start a build
        try {
            building = true
            while (buildPending) {
                buildPending = false
                const opts0 = clone(opts)
                if (ev)
                    // if not first time, don't update
                    opts0.update = false
                const files = await buildCommandOnce(opts0)
                if (files)
                    Object.entries(files).forEach(([key, value]) => {
                        if (/\.(hex|json|asm)$/.test(key)) binaries[key] = value
                        else binaries[key] = Buffer.from(value, "base64")
                    })
            }
        } catch (e) {
            error(e)
        } finally {
            building = false
        }
    }
    watcher.on("change", build)
    msg(`start watching for file changes`)
    build(undefined, undefined)
}

async function buildCommandOnce(opts: BuildOptions): Promise<pxt.Map<string>> {
    const prj = await resolveProject(opts)
    prj.service.runSync(
        "(() => { pxt.savedAppTheme().experimentalHw = true; pxt.reloadAppTargetVariant() })()"
    )
    const hwVariants = prj.service.hwVariants
    const targetId = prj.service.runSync("pxt.appTarget.id")
    let moreHw: string[] = []
    const outputs: string[] = []

    if (opts.hw) {
        const hws = opts.hw.split(/[\s,;]+/)
        selectHW(hws[0])
        moreHw = hws.slice(1)
    }

    if (!opts.javaScript || opts.hw) opts.native = true
    else opts.native = false

    if (opts.native && hwVariants.length) {
        prj.guessHwVariant()
        infoHW()
    }

    outputs.push(prj.outputPrefix)
    const compileRes = await buildOnePrj(opts, prj)
    if (compileRes && opts.deploy) {
        const firmwareName = ["binary.uf2", "binary.hex", "binary.elf"].filter(
            f => !!compileRes.outfiles[f]
        )[0]
        if (!firmwareName) {
            // something went wrong here
            error(
                `firmware missing from built files (${Object.keys(
                    compileRes.outfiles
                ).join(", ")})`
            )
        } else {
            const compileInfo = prj.service.runSync("pxt.appTarget.compile")
            const drives = await getDeployDrives(compileInfo)

            if (drives.length == 0) {
                msg("cannot find any drives to deploy to")
            } else {
                const firmware = compileRes.outfiles[firmwareName]
                const encoding =
                    firmwareName == "binary.hex" ? "utf8" : "base64"

                msg(`copying ${firmwareName} to ` + drives.join(", "))
                const writeFileAsync = util.promisify(fs.writeFile)
                const writeHexFile = (drivename: string) => {
                    return writeFileAsync(
                        path.join(drivename, firmwareName),
                        firmware,
                        encoding
                    )
                        .then(() => info("   wrote to " + drivename))
                        .catch(() => error(`   failed writing to ${drivename}`))
                }
                for (const p of drives.map(writeHexFile)) await p
            }
        }
    }

    let success = !!compileRes

    if (success && opts.monoRepo) {
        const dirs = bump.monoRepoConfigs(".")
        info(`mono-repo: building ${dirs.length} projects`)
        for (const fullpxtjson of dirs) {
            if (fullpxtjson.startsWith("pxt_modules")) continue
            const fulldir = path.dirname(fullpxtjson)
            info(`build ${fulldir}`)
            const prj0 = prj.mkChildProject(fulldir)
            const cfg = await prj0.readPxtConfig()
            if (
                cfg.supportedTargets &&
                cfg.supportedTargets.indexOf(targetId) < 0
            ) {
                info(`skipping due to supportedTargets`)
                continue
            }
            const ok = await buildOnePrj(opts, prj0)
            if (!ok) success = false
        }
    } else if (success && moreHw.length) {
        for (const hw of moreHw) {
            selectHW(hw)
            infoHW()
            outputs.push(prj.outputPrefix)
            await buildOnePrj(opts, prj)
        }
        const uf2s: Buffer[] = []
        for (const folder of outputs) {
            try {
                uf2s.push(fs.readFileSync(path.join(folder, "binary.uf2")))
            } catch { }
        }
        if (uf2s.length > 1) {
            const total = Buffer.concat(uf2s)
            const fn = "built/combined.uf2"
            info(
                `combining ${uf2s.length} UF2 files into ${fn} (${Math.round(
                    total.length / 1024
                )}kB)`
            )
            fs.writeFileSync(fn, total)
        }
    }

    if (success) {
        msg("Build OK")
        if (opts.watch) return compileRes?.outfiles
        else process.exit(0)
    } else {
        error("Build failed")
        if (opts.watch) return compileRes?.outfiles
        else process.exit(1)
    }

    function hwid(cfg: pxt.PackageConfig) {
        return cfg.name.replace(/hw---/, "")
    }

    function selectHW(hw0: string) {
        const hw = hw0.toLowerCase()
        const selected = hwVariants.filter(cfg => {
            return (
                cfg.name.toLowerCase() == hw ||
                hwid(cfg).toLowerCase() == hw ||
                cfg.card.name.toLowerCase() == hw
            )
        })
        if (!selected.length) {
            error(`No such HW id: ${hw0}`)
            msg(`Available hw:`)
            for (let cfg of hwVariants) {
                msg(`${hwid(cfg)}, ${cfg.card.name} - ${cfg.card.description}`)
            }
            process.exit(1)
        }
        prj.hwVariant = hwid(selected[0])
    }

    function infoHW() {
        info(
            `using hwVariant: ${prj.mainPkg.mkcConfig.hwVariant} (target ${targetId})`
        )
        if (!opts.alwaysBuilt)
            prj.outputPrefix = "built/" + prj.mainPkg.mkcConfig.hwVariant
    }
}

interface BumpOptions extends ProjectOptions {
    versionFile?: string
    stage?: boolean
}
async function bumpCommand(opts: BumpOptions) {
    applyGlobalOptions(opts)
    const prj = await resolveProject(opts)
    await bump.bumpAsync(prj, opts?.versionFile, opts?.stage)
}

interface InstallOptions extends ProjectOptions {
    monoRepo?: boolean
}
async function installCommand(opts: InstallOptions) {
    applyGlobalOptions(opts)
    if (!fs.existsSync("pxt.json")) {
        error("missing pxt.json")
        process.exit(1)
    }

    opts.pxtModules = true
    const prj = await resolveProject(opts)
    prj.mainPkg = null
    if (opts.monoRepo) {
        const dirs = bump.monoRepoConfigs(".")
        info(`mono-repo: building ${dirs.length} projects`)
        for (const fullpxtjson of dirs) {
            if (fullpxtjson.startsWith("pxt_modules")) continue
            const fulldir = path.dirname(fullpxtjson)
            info(`install ${fulldir}`)
            const prj0 = prj.mkChildProject(fulldir)
            await prj0.maybeWritePxtModulesAsync()
        }
    } else {
        await prj.maybeWritePxtModulesAsync()
    }
}

interface InitOptions extends ProjectOptions { }
async function initCommand(
    template: string,
    deps: string[],
    opts: InitOptions
) {
    applyGlobalOptions(opts)
    if (!fs.existsSync("pxt.json")) {
        if (!template) {
            error("missing template")
            process.exit(1)
        }
        const target = descriptors.find(t => t.id === template)
        if (!target) {
            error(`template not found`)
            process.exit(1)
        }
        msg(`initializing project for ${target.name}`)
        msg("saving main.ts")
        fs.writeFileSync("main.ts", "// add code here", { encoding: "utf-8" })
        msg("saving pxt.json")
        fs.writeFileSync(
            "pxt.json",
            JSON.stringify(
                {
                    name: "my-project",
                    version: "0.0.0",
                    files: ["main.ts"],
                    supportedTargets: [target.targetId],
                    dependencies:
                        target.dependencies ||
                        (target.corepkg && { [target.corepkg]: "*" }) ||
                        {},
                    testDependencies: target.testDependencies || {},
                },
                null,
                4
            )
        )
        fs.writeFileSync(
            "mkc.json",
            JSON.stringify(
                <MkcJson>{
                    targetWebsite: target.website,
                    links: {},
                },
                null,
                4
            ),
            { encoding: "utf-8" }
        )
    } else {
        if (template) {
            error("directory is not empty, cannot apply template")
            process.exit(1)
        }
    }

    if (!fs.existsSync("tsconfig.json")) {
        msg("saving tsconfig.json")
        fs.writeFileSync(
            "tsconfig.json",
            JSON.stringify(
                {
                    compilerOptions: {
                        target: "ES5",
                        noImplicitAny: true,
                        outDir: "built",
                        rootDir: ".",
                    },
                    include: ["**/*.ts"],
                    exclude: ["built/**", "pxt_modules/**/*test.ts"],
                },
                null,
                4
            ),
            { encoding: "utf-8" }
        )
    }

    const prettierrc = ".prettierrc"
    if (!fs.existsSync(prettierrc)) {
        msg(`saving ${prettierrc}`)
        fs.writeFileSync(
            prettierrc,
            JSON.stringify({
                arrowParens: "avoid",
                semi: false,
                tabWidth: 4,
            })
        )
    }

    opts.pxtModules = true
    const prj = await resolveProject(opts)
    if (!fs.existsSync("mkc.json")) {
        msg("saving mkc.json")
        fs.writeFileSync(
            "mkc.json",
            mkc.stringifyConfig(prj.mainPkg.mkcConfig),
            {
                encoding: "utf-8",
            }
        )
    }

    for (const dep of deps) await addDependency(prj, dep, undefined)

    prj.mainPkg = null
    prj.writePxtModules = true
    await prj.maybeWritePxtModulesAsync()
    msg(`project ready, run "mkc -d" to build and deploy`)
}

async function jacdacMakeCodeExtensions() {
    let data: {
        service: string
        client: {
            name: string
            repo: string
            qName: string
            default: string
        }
    }[] = []
    try {
        const r = await fetch(
            "https://raw.githubusercontent.com/microsoft/jacdac/main/services/makecode-extensions.json"
        )
        data = (await r.json()) as any
    } catch (e) { }
    return data
}

function join(...parts: string[]) {
    return parts.filter(p => !!p).join("/")
}

// parse https://github.com/[company]/[project](/filepath)(#tag)
function parseRepoId(repo: string) {
    if (!repo) return undefined
    // clean out whitespaces
    repo = repo.trim()
    // trim trailing /
    repo = repo.replace(/\/$/, "")

    // convert github pages into github repo
    const mgh = /^https:\/\/([^./#]+)\.github\.io\/([^/#]+)\/?$/i.exec(repo)
    if (mgh) repo = `github:${mgh[1]}/${mgh[2]}`

    repo = repo.replace(/^github:/i, "")
    repo = repo.replace(/^https:\/\/github\.com\//i, "")
    repo = repo.replace(/\.git\b/i, "")

    const m = /^([^#\/:]+)\/([^#\/:]+)(\/([^#]+))?(#([^\/:]*))?$/.exec(repo)
    if (!m) return undefined
    const owner = m[1]
    const project = m[2]
    let fileName = m[4]
    const tag = m[6]

    const treeM = fileName && /^tree\/([^\/]+\/)/.exec(fileName)
    if (treeM) {
        // https://github.com/pelikhan/mono-demo/tree/master/demo2
        fileName = fileName.slice(treeM[0].length)
        // branch info?
    }

    return {
        owner,
        project,
        slug: join(owner, project),
        fullName: join(owner, project, fileName),
        tag,
        fileName,
    }
}

async function fetchExtension(slug: string) {
    const url = `https://pxt.azureedge.net/api/gh/${slug}`
    const req = await fetch(url)
    if (req.status !== 200) {
        error(`resolution of ${slug} failed (${req.status})`)
        process.exit(1)
    }
    const script: {
        version: string
        defaultBranch: string
    } = (await req.json()) as any
    return script
}

interface SearchOptions extends ProjectOptions { }
async function searchCommand(query: string, opts: SearchOptions) {
    applyGlobalOptions(opts)
    query = query.trim().toLowerCase()
    msg(`searching for ${query}`)
    const prj = await resolveProject(opts)
    const targetid = prj.editor.targetJson.id
    const res = await fetch(
        `${cloudRoot}ghsearch/${targetid}/${targetid}?q=${encodeURIComponent(
            query
        )}`
    )
    if (res.status !== 200) {
        error(`search request failed`)
        process.exit(1)
    }
    const payload: {
        items: {
            name: string
            full_name: string
            private: boolean
            description: string
            default_branch: string
            owner: { login: string }
        }[]
    } = await res.json()
    const { items } = payload
    items?.forEach(({ full_name, description, owner }) => {
        msg(`  ${full_name}`)
        info(`    https://github.com/${full_name}`)
        if (description) info(`    ${description}`)
    })

    if (/jacdac/i.test(query)) {
        const q = query.replace(/jacdac-*/i, "")
        const exts = await jacdacMakeCodeExtensions()
        for (const ext of exts.filter(
            ext =>
                ext.client.name.indexOf(q) > -1 || ext.service.indexOf(q) > -1
        )) {
            msg(`  ${ext.client.name}`)
            info(`    https://${ext.client.repo}`)
        }
    }
}

async function stackCommand(opts: ProjectOptions) {
    const srcmap = JSON.parse(fs.readFileSync("built/binary.srcmap", "utf8"))
    console.log(expandStackTrace(srcmap, fs.readFileSync(0, "utf-8")))
}

interface AddOptions extends ProjectOptions { }
async function addCommand(repo: string, name: string, opts: AddOptions) {
    applyGlobalOptions(opts)
    opts.pxtModules = true

    msg(`adding ${repo}`)
    const prj = await resolveProject(opts)
    await addDependency(prj, repo, name)
    prj.mainPkg = null
    await prj.maybeWritePxtModulesAsync()
}

async function addDependency(prj: mkc.Project, repo: string, name: string) {
    repo = repo.toLowerCase().trim()
    if (repo === "jacdac") repo = "https://github.com/microsoft/pxt-jacdac"
    else if (/^jacdac-/.test(repo)) {
        const exts = await jacdacMakeCodeExtensions()
        const ext = exts.find(ext => ext.client.name === repo)
        if (ext) {
            info(`found jacdac ${ext.client.repo}`)
            repo = ext.client.repo
        }
    }

    const rid = parseRepoId(repo)
    if (!rid) {
        error("unkown repository format, try https://github.com/.../...")
        process.exit(1)
    }

    const d = await fetchExtension(rid.slug)
    const pxtJson = await prj.readPxtConfig()
    const dname =
        name ||
        join(rid.project, rid.fileName).replace(/^pxt-/, "").replace("/", "-")

    pxtJson.dependencies[dname] = `github:${rid.fullName}#${d.version ? `v${d.version}` : d.defaultBranch
        }`
    info(`adding dependency ${dname}=${pxtJson.dependencies[dname]}`)
    fs.writeFileSync("pxt.json", JSON.stringify(pxtJson, null, 4), {
        encoding: "utf-8",
    })
}

function isKV(v: any) {
    return !!v && typeof v === "object" && !Array.isArray(v)
}

function jsonMergeFrom(trg: any, src: any) {
    if (!src) return
    Object.keys(src).forEach(k => {
        if (isKV(trg[k]) && isKV(src[k])) jsonMergeFrom(trg[k], src[k])
        else if (Array.isArray(trg[k]) && Array.isArray(src[k]))
            trg[k] = trg[k].concat(src[k])
        else trg[k] = src[k]
    })
}

function readCfg(cfgpath: string, quiet = false) {
    const files: string[] = []
    return readCfgRec(cfgpath)

    function readCfgRec(cfgpath: string) {
        if (files.indexOf(cfgpath) >= 0) {
            error(`Config file loop: ${files.join(" -> ")} -> ${cfgpath}`)
            process.exit(1)
        }
        const cfg = cfgFile(cfgpath)
        const currCfg: mkc.MkcJson = {} as any
        files.push(cfgpath)
        for (const fn of cfg.include || []) {
            const resolved = path.resolve(path.dirname(cfgpath), fn)
            if (!quiet) info(`  include: ${resolved}`)
            jsonMergeFrom(currCfg, readCfgRec(resolved))
        }
        jsonMergeFrom(currCfg, cfg)
        delete currCfg.include
        files.pop()
        return currCfg

        function cfgFile(cfgpath: string) {
            let cfg: mkc.MkcJson
            try {
                cfg = JSON.parse(fs.readFileSync(cfgpath, "utf8"))
            } catch (e) {
                error(`Can't read config file: '${cfgpath}'; ` + e.message)
                process.exit(1)
            }
            const lnk = cfg.links
            if (lnk) {
                const mkcFolder = path.resolve(".", path.dirname(cfgpath))
                for (const k of Object.keys(lnk)) {
                    lnk[k] = path.resolve(mkcFolder, lnk[k])
                }
            }
            return cfg
        }
    }
}

async function mainCli() {
    mkc.setLogging({
        log: info,
        error: error,
        debug: s => {
            if (debugMode)
                console.debug(chalk.gray(s))
        },
    })

    commander.version(require("../package.json").version)

    createCommand("build", { isDefault: true })
        .description("build project")
        .option("-w, --watch", "watch source files and rebuild on changes")
        .option("-n, --native", "compile native (default)")
        .option("-d, --deploy", "copy resulting binary to UF2 or HEX drive")
        .option("-s, --serve", "start firmware files web server")
        .option(
            "-p",
            "--serve-port",
            "specify the port for firmware file web server"
        )
        .option(
            "-h, --hw <id,...>",
            "set hardware(s) for which to compile (implies -n)"
        )
        .option("-j, --java-script", "compile to JavaScript")
        .option("-u, --update", "check for web-app updates")
        .option(
            "-c, --config-path <file>",
            'set configuration file path (default: "mkc.json")'
        )
        .option(
            "-r, --mono-repo",
            "also build all subfolders with 'pxt.json' in them"
        )
        .option(
            "--always-built",
            "always generate files in built/ folder (and not built/hw-variant/)"
        )
        .action(buildCommand)

    createCommand("serve")
        .description("start local simulator web server")
        .option("--no-watch", "do not watch source files")
        .option("-p, --port <number>", "port to listen at, default to 7000")
        .option("-u, --update", "check for web-app updates")
        .option(
            "-c, --config-path <file>",
            'set configuration file path (default: "mkc.json")'
        )
        .action(serveCommand)

    createCommand("download")
        .argument(
            "<url>",
            "url to the shared project from your makecode editor"
        )
        .description("download project from share URL")
        .action(downloadCommand)

    createCommand("bump")
        .description(
            "interactive version incrementer for a project or mono-repo"
        )
        .option(
            "--version-file <file>",
            "write generated version number into the file"
        )
        .option("--stage", "skip git commit and push operations")
        .action(bumpCommand)

    createCommand("init")
        .addArgument(
            new Argument("[template]", "project template name").choices(
                descriptors.map(d => d.id)
            )
        )
        .argument("[repo...]", "dependencies to be added to the project")
        .description(
            "initializes the project, downloads the dependencies, optionally for a particular editor"
        )
        .option(
            "--symlink-pxt-modules",
            "symlink files in pxt_modules/* for auto-completion"
        )
        .option(
            "--link-pxt-modules",
            "write pxt_modules/* adhering to 'links' field in mkc.json (for pxt cli build)"
        )
        .action(initCommand)

    createCommand("install")
        .description("downloads the dependencies")
        .option(
            "-r, --mono-repo",
            "also install in all subfolders with 'pxt.json' in them"
        )
        .option(
            "--symlink-pxt-modules",
            "symlink files in pxt_modules/* for auto-completion"
        )
        .option(
            "--link-pxt-modules",
            "write pxt_modules/* adhering to 'links' field in mkc.json (for pxt cli build)"
        )
        .action(installCommand)

    createCommand("clean")
        .description("deletes built artifacts")
        .action(cleanCommand)

    createCommand("add")
        .argument("<repo>", "url to the github repository")
        .argument("[name]", "name of the dependency")
        .description("add new dependencies")
        .option(
            "-c, --config-path <file>",
            'set configuration file path (default: "mkc.json")'
        )
        .action(addCommand)

    createCommand("search")
        .argument("<query>", "extension to search for")
        .description("search for an extension")
        .option(
            "-c, --config-path <file>",
            'set configuration file path (default: "mkc.json")'
        )
        .action(searchCommand)

    createCommand("stack", { hidden: true })
        .description("expand stack trace")
        .action(stackCommand)

    await commander.parseAsync(process.argv)
}

async function mainWrapper() {
    try {
        await mainCli()
    } catch (e) {
        error("Exception: " + e.stack)
        error("Build failed")
        process.exit(1)
    }
}

mainWrapper()
