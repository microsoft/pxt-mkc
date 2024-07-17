import * as path from "path"
import * as chalk from "chalk"

import * as mkc from "./mkc"
import * as files from "./files"
import * as downloader from "./downloader"
import * as service from "./service"
import { descriptors } from "./loader"
import { cloudRoot, MkcJson } from "./mkc"
import { expandStackTrace } from "./stackresolver"
import { monoRepoConfigsAsync } from "./files"
import { host } from "./host"
import { shareProjectAsync } from "./share"

interface Options {
    colors?: boolean
    noColors?: boolean
    debug?: boolean
    compileFlags?: string
}

export interface ProjectOptions extends Options {
    configPath?: string
    update?: boolean

    pxtModules?: boolean
    linkPxtModules?: boolean
    symlinkPxtModules?: boolean
}

async function downloadProjectAsync(id: string) {
    id = id.replace(/.*\//, "")
    const url = mkc.cloudRoot + id + "/text"
    const files = await downloader.httpGetJsonAsync(url)
    for (let fn of Object.keys(files)) {
        if (/\//.test(fn)) continue
        await host().writeFileAsync(fn, files[fn]);
    }
    msg("downloaded.")
}

async function buildOnePrj(opts: BuildOptions, prj: mkc.Project) {
    try {
        const simpleOpts = {
            native: opts.native,
            computeUsedParts: opts.buildSimJsInfo,
            emitBreakpoints: opts.emitBreakpoints
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

        return res
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

export function applyGlobalOptions(opts: Options) {
    if (opts.noColors) (chalk as any).level = 0
    else if (opts.colors && !chalk.level) (chalk as any).level = 1
    else if (host().getEnvironmentVariable("GITHUB_WORKFLOW")) (chalk as any).level = 1
}

interface DownloadOptions extends Options { }
export async function downloadCommand(URL: string, opts: DownloadOptions) {
    applyGlobalOptions(opts)
    await downloadProjectAsync(URL)
}

interface CleanOptions extends Options { }
export async function cleanCommand(opts: CleanOptions) {
    applyGlobalOptions(opts)

    for (const dir of ["built", "pxt_modules"]) {
        if (await host().existsAsync(dir)) {
            msg(`deleting ${dir} folder`)
            await host().rmdirAsync(dir, { recursive: true, force: true } as any)
        }
    }

    msg("run `mkc init` again to setup your project")
}

let prjCache: pxt.Map<mkc.Project> = {};

export async function clearProjectCache() {
    for (const prjdir of Object.keys(prjCache)) {
        const prj = prjCache[prjdir];
        prj.service?.dispose?.();
    }
    prjCache = {};
}

function getCachedProject(prjdir: string) {
    if (!prjCache[prjdir]) {
        prjCache[prjdir] = new mkc.Project(prjdir);
    }
    return prjCache[prjdir];
}

export async function resolveProject(opts: ProjectOptions, quiet = false) {
    const prjdir = await files.findProjectDirAsync()
    if (!prjdir) {
        error(`could not find "pxt.json" file`)
        host().exitWithStatus(1)
    }

    if (!opts.configPath) {
        const cfgFolder = await files.findParentDirWithAsync(prjdir, "mkc.json")
        if (cfgFolder) opts.configPath = path.join(cfgFolder, "mkc.json")
    }

    log(`using project: ${prjdir}/pxt.json`);
    const prj = getCachedProject(prjdir);

    if (opts.configPath) {
        log(`using config: ${opts.configPath}`)
        prj.mkcConfig = await readCfgAsync(opts.configPath, quiet)
    }

    await prj.loadEditorAsync(!!opts.update)

    let version = "???"
    try {
        const appTarget = await prj.service.languageService.getAppTargetAsync();
        version = appTarget?.versions?.target;
    } catch { }
    log(`using editor: ${prj.mkcConfig.targetWebsite} v${version}`)

    if (opts.debug) await prj.service.languageService.enableDebugAsync();

    if (opts.compileFlags) {
        await prj.service.languageService.setCompileSwitchesAsync(opts.compileFlags);
    }

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

export interface BuildOptions extends ProjectOptions {
    hw?: string
    native?: boolean
    javaScript?: boolean
    buildSimJsInfo?: boolean
    deploy?: boolean
    alwaysBuilt?: boolean
    monoRepo?: boolean
    watch?: boolean
    emitBreakpoints?: boolean
}

export async function buildCommandOnce(opts: BuildOptions): Promise<mkc.service.CompileResult> {
    const prj = await resolveProject(opts)
    await prj.service.languageService.enableExperimentalHardwareAsync();
    const hwVariants = await prj.service.getHardwareVariantsAsync()
    const appTarget = await prj.service.languageService.getAppTargetAsync();
    const targetId = appTarget.id;
    let moreHw: string[] = []
    const outputs: string[] = []

    if (opts.buildSimJsInfo) {
        opts.javaScript = true
    }

    if (opts.hw) {
        const hws = opts.hw.split(/[\s,;]+/)
        selectHW(hws[0])
        moreHw = hws.slice(1)
    }

    if (!opts.javaScript || opts.hw) opts.native = true
    else opts.native = false

    if (opts.native && hwVariants.length) {
        await prj.guessHwVariantAsync()
        infoHW()
    }

    outputs.push(prj.outputPrefix)
    const compileRes = await buildOnePrj(opts, prj)
    const firmwareName = compileRes.success && ["binary.uf2", "binary.hex", "binary.elf"].filter(
        f => !!compileRes.outfiles[f]
    )[0];
    if (compileRes.success && opts.deploy) {
        if (!firmwareName) {
            // something went wrong here
            error(
                `firmware missing from built files (${Object.keys(
                    compileRes.outfiles
                ).join(", ")})`
            )
        } else {
            const compileInfo = appTarget.compile;
            const drives = await host().getDeployDrivesAsync(compileInfo)

            if (drives.length == 0) {
                msg("cannot find any drives to deploy to")
            } else {
                const firmware = compileRes.outfiles[firmwareName]
                const encoding =
                    firmwareName == "binary.hex" ? "utf8" : "base64"

                msg(`copying ${firmwareName} to ` + drives.join(", "))
                const writeHexFile = (drivename: string) => {
                    return host().writeFileAsync(
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

    let success = compileRes.success

    if (success && opts.monoRepo) {
        const dirs = await monoRepoConfigsAsync(".")
        info(`mono-repo: building ${dirs.length} projects`)
        for (const fullpxtjson of dirs) {
            if (fullpxtjson.startsWith("pxt_modules")) continue
            const fulldir = path.dirname(fullpxtjson)
            info(`build ${fulldir}`)
            const prj0 = await prj.mkChildProjectAsync(fulldir)
            const cfg = await prj0.readPxtConfig()
            if (
                cfg.supportedTargets &&
                cfg.supportedTargets.indexOf(targetId) < 0
            ) {
                info(`skipping due to supportedTargets`)
                continue
            }
            const res = await buildOnePrj(opts, prj0)
            if (!res.success) success = false
        }
    } else if (success && moreHw.length) {
        for (const hw of moreHw) {
            selectHW(hw)
            infoHW()
            outputs.push(prj.outputPrefix)
            await buildOnePrj(opts, prj)
        }
        const uf2s: Uint8Array[] = []
        for (const folder of outputs) {
            try {
                uf2s.push((await host().readFileAsync(path.join(folder, "binary.uf2")) as Uint8Array))
            } catch { }
        }
        if (uf2s.length > 1) {
            const total = concatUint8Arrays(uf2s)
            const fn = "built/combined.uf2"
            info(
                `combining ${uf2s.length} UF2 files into ${fn} (${Math.round(
                    total.length / 1024
                )}kB)`
            )
            await host().writeFileAsync(fn, total)
        }
    }

    if (compileRes && outputs.length && firmwareName) {
        compileRes.binaryPath = outputs[0] + "/" + firmwareName;
    }

    if (compileRes && opts.buildSimJsInfo) {
        compileRes.simJsInfo = await prj.buildSimJsInfoAsync(compileRes)
        compileRes.simJsInfo.parts = compileRes.usedParts
    }

    if (success) {
        msg("Build OK")
        if (opts.watch) return compileRes;
        else host().exitWithStatus(0)
    } else {
        error("Build failed")
        if (opts.watch) return compileRes;
        else host().exitWithStatus(1)
    }

    return null;

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
            host().exitWithStatus(1)
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

interface InstallOptions extends ProjectOptions {
    monoRepo?: boolean
}
export async function installCommand(opts: InstallOptions) {
    applyGlobalOptions(opts)
    if (!await host().existsAsync("pxt.json")) {
        error("missing pxt.json")
        host().exitWithStatus(1)
    }

    opts.pxtModules = true
    const prj = await resolveProject(opts)
    prj.mainPkg = null
    if (opts.monoRepo) {
        const dirs = await monoRepoConfigsAsync(".")
        info(`mono-repo: building ${dirs.length} projects`)
        for (const fullpxtjson of dirs) {
            if (fullpxtjson.startsWith("pxt_modules")) continue
            const fulldir = path.dirname(fullpxtjson)
            info(`install ${fulldir}`)
            const prj0 = await prj.mkChildProjectAsync(fulldir)
            await prj0.maybeWritePxtModulesAsync()
        }
    } else {
        await prj.maybeWritePxtModulesAsync()
    }
}

interface InitOptions extends ProjectOptions {
    vscodeProject?: boolean;
    gitIgnore?: boolean;
    importUrl?: string;
}
export async function initCommand(
    template: string,
    deps: string[],
    opts: InitOptions
) {
    applyGlobalOptions(opts)
    if (!await host().existsAsync("pxt.json")) {
        if (opts.importUrl) {
            await downloadProjectAsync(opts.importUrl);
        } else {
            if (!template) {
                error("missing template")
                host().exitWithStatus(1)
            }
            const target = descriptors.find(t => t.id === template)
            if (!target) {
                error(`template not found`)
                host().exitWithStatus(1)
            }
            msg(`initializing project for ${target.name}`)
            msg("saving main.ts")
            await host().writeFileAsync("main.ts", "// add code here", "utf8");
            msg("saving pxt.json")
            await host().writeFileAsync(
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
            await host().writeFileAsync(
                "mkc.json",
                JSON.stringify(
                    <MkcJson>{
                        targetWebsite: target.website,
                        links: {},
                    },
                    null,
                    4
                ),
                "utf8"
            )
        }
    } else {
        if (template || opts.importUrl) {
            error("directory is not empty, cannot apply template")
            host().exitWithStatus(1)
        }
    }

    const vscodeSettings = ".vscode/settings.json";
    if (opts.vscodeProject && !await host().existsAsync(vscodeSettings)) {
        if (!await host().existsAsync(".vscode")) await host().mkdirAsync(".vscode");
        await host().writeFileAsync(
            vscodeSettings,
            JSON.stringify({
                "editor.formatOnType": true,
                "files.autoSave": "afterDelay",
                "files.watcherExclude": {
                    "**/.git/objects/**": true,
                    "**/built/**": true,
                    "**/node_modules/**": true,
                    "**/yotta_modules/**": true,
                    "**/yotta_targets": true,
                    "**/pxt_modules/**": true,
                    "**/.pxt/**": true
                },
                "files.associations": {
                    "*.blocks": "html",
                    "*.jres": "json"
                },
                "search.exclude": {
                    "**/built": true,
                    "**/node_modules": true,
                    "**/yotta_modules": true,
                    "**/yotta_targets": true,
                    "**/pxt_modules": true,
                    "**/.pxt": true
                },
                "files.exclude": {
                    "**/pxt_modules": true,
                    "**/.pxt": true,
                    "**/mkc.json": true
                }
            }, null, 4)
        );
    }

    const vscodeExtensions = ".vscode/extensions.json";
    if (opts.vscodeProject && !await host().existsAsync(vscodeExtensions)) {
        if (!await host().existsAsync(".vscode")) await host().mkdirAsync(".vscode");
        await host().writeFileAsync(
            vscodeExtensions,
            JSON.stringify({
                recommendations: [
                    "ms-edu.pxt-vscode-web"
                ]
            }, null, 4)
        );
    }

    const gitignore = ".gitignore";
    if (opts.gitIgnore && !await host().existsAsync(gitignore)) {
        msg(`saving ${gitignore}`);
        await host().writeFileAsync(
            gitignore,
            `# MakeCode
built
node_modules
yotta_modules
yotta_targets
pxt_modules
.pxt
_site
*.db
*.tgz
.header.json
.simstate.json`
        );
    }

    if (!await host().existsAsync("tsconfig.json")) {
        msg("saving tsconfig.json")
        await host().writeFileAsync(
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
            "utf8"
        )
    }

    const prettierrc = ".prettierrc"
    if (!await host().existsAsync(prettierrc)) {
        msg(`saving ${prettierrc}`)
        await host().writeFileAsync(
            prettierrc,
            JSON.stringify({
                arrowParens: "avoid",
                semi: false,
                tabWidth: 4,
            })
        )
    }

    const gh = ".github/workflows/makecode.yml"
    if (!await host().existsAsync(gh)) {
        if (!await host().existsAsync(".github")) await host().mkdirAsync(".github")
        if (!await host().existsAsync(".github/workflows")) await host().mkdirAsync(".github/workflows")
        msg(`saving ${gh}`)
        await host().writeFileAsync(gh,
            `name: MakeCode Build
on:
  push:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
        with:
          submodules: recursive
      - run: npx makecode
`)
    }

    opts.pxtModules = true
    const prj = await resolveProject(opts)
    if (!await host().existsAsync("mkc.json")) {
        msg("saving mkc.json")
        await host().writeFileAsync(
            "mkc.json",
            mkc.stringifyConfig(prj.mainPkg.mkcConfig),
            "utf8"
        )
    }

    for (const dep of deps) await addDependency(prj, dep, undefined)

    prj.mainPkg = null
    prj.writePxtModules = true
    await prj.maybeWritePxtModulesAsync()
    msg(`project ready, run "makecode -d" to build and deploy`)
}

export async function listHardwareVariantsAsync(opts: ProjectOptions) {
    const prj = await resolveProject(opts)
    await prj.service.languageService.enableExperimentalHardwareAsync();
    return await prj.service.getHardwareVariantsAsync()
}

export async function getAppTargetAsync(opts: ProjectOptions) {
    const prj = await resolveProject(opts)
    return await prj.service.languageService.getAppTargetAsync();
}

export async function getTargetConfigAsync(opts: ProjectOptions) {
    const prj = await resolveProject(opts)
    return await prj.service.languageService.getTargetConfigAsync();
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
        const r = await host().requestAsync({
            url: "https://raw.githubusercontent.com/microsoft/jacdac/main/services/makecode-extensions.json"
        });

        data = JSON.parse(r.text)
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
    const req = await host().requestAsync({
        url
    })
    if (req.statusCode !== 200) {
        error(`resolution of ${slug} failed (${req.statusCode})`)
        host().exitWithStatus(1)
    }
    const script: {
        version: string
        defaultBranch: string
    } = JSON.parse(req.text)
    return script
}

interface SearchOptions extends ProjectOptions {}
export async function searchCommand(query: string, opts: SearchOptions) {
    applyGlobalOptions(opts)
    query = query.trim().toLowerCase()
    msg(`searching for ${query}`)
    const prj = await resolveProject(opts)
    const targetid = prj.editor.targetJson.id
    const res = await host().requestAsync({
        url: `${cloudRoot}ghsearch/${targetid}/${targetid}?q=${encodeURIComponent(
            query
        )}`
    })
    if (res.statusCode !== 200) {
        error(`search request failed`)
        host().exitWithStatus(1)
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
    } = JSON.parse(res.text);
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

export async function stackCommand(opts: ProjectOptions) {
    const srcmap = JSON.parse(await host().readFileAsync("built/binary.srcmap", "utf8") as string)
    console.log(expandStackTrace(srcmap, await host().readFileAsync(0 as any, "utf8") as string))
}

interface AddOptions extends ProjectOptions { }
export async function addCommand(pkg: string, name: string, opts: AddOptions) {
    applyGlobalOptions(opts)
    opts.pxtModules = true

    msg(`adding ${pkg}`)
    const prj = await resolveProject(opts)
    await addDependency(prj, pkg, name)
    prj.mainPkg = null
    await prj.maybeWritePxtModulesAsync()
}

async function addDependency(prj: mkc.Project, pkg: string, name: string) {
    pkg = pkg.toLowerCase().trim()
    if (pkg === "jacdac") pkg = "https://github.com/microsoft/pxt-jacdac"
    else if (/^jacdac-/.test(pkg)) {
        const exts = await jacdacMakeCodeExtensions()
        const ext = exts.find(ext => ext.client.name === pkg)
        if (ext) {
            info(`found jacdac ${ext.client.repo}`)
            pkg = ext.client.repo
        }
    }

    const rid = parseRepoId(pkg);
    const pxtJson = await prj.readPxtConfig();
    if (rid) {
        const d = await fetchExtension(rid.slug);
        const dname =
            name ||
            join(rid.project, rid.fileName).replace(/^pxt-/, "").replace("/", "-");

        pxtJson.dependencies[dname] = `github:${rid.fullName}#${d.version ? `v${d.version}` : d.defaultBranch}`;
        info(`adding dependency ${dname}=${pxtJson.dependencies[dname]}`);
    } else {
        const appTarget = await prj.service.languageService.getAppTargetAsync();
        const bundledPkgs: string[] = appTarget
            ?.bundleddirs
            ?.map((dir: string) => /^libs\/(.+)/.exec(dir)?.[1])
            ?.filter((dir: string) => !!dir);
        const builtInPkg = bundledPkgs?.find(dir => dir === pkg);

        if (!builtInPkg) {
            const possiblyMeant = bundledPkgs
                ?.filter(el => el?.toLowerCase().indexOf(pkg) !== -1);
            if (possiblyMeant?.length) {
                error(`Did you mean ${possiblyMeant?.join(", ")}?`);
            } else {
                error("unknown package, try https://github.com/.../... for github extensions");
            }
            host().exitWithStatus(1);
        }

        const collidingHwVariant = Object.keys(pxtJson.dependencies)
            .find(dep => dep.toLowerCase().replace(/---.+$/, "") === pkg.replace(/---.+$/, "")
                && pxtJson.dependencies[dep] === "*");

        if (collidingHwVariant) {
            delete pxtJson.dependencies[collidingHwVariant];
        }

        pxtJson.dependencies[builtInPkg] = "*";
        info(`adding builtin dependency ${builtInPkg}=*`);
    }

    await host().writeFileAsync("pxt.json", JSON.stringify(pxtJson, null, 4), "utf8")
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

async function readCfgAsync(cfgpath: string, quiet = false) {
    const files: string[] = []
    return readCfgRec(cfgpath)

    async function readCfgRec(cfgpath: string) {
        if (files.indexOf(cfgpath) >= 0) {
            error(`Config file loop: ${files.join(" -> ")} -> ${cfgpath}`)
            host().exitWithStatus(1)
        }
        const cfg = await cfgFile(cfgpath)
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

        async function cfgFile(cfgpath: string) {
            let cfg: mkc.MkcJson
            try {
                cfg = JSON.parse(await host().readFileAsync(cfgpath, "utf8") as string)
            } catch (e) {
                error(`Can't read config file: '${cfgpath}'; ` + e.message)
                host().exitWithStatus(1)
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


function concatUint8Arrays(bufs: Uint8Array[]) {
    let size = 0;

    for (const buf of bufs) {
        size += buf.length;
    }

    const res = new Uint8Array(size);

    let offset = 0;

    for (const buf of bufs) {
        res.set(buf, offset);
        offset += buf.length;
    }

    return res;
}

export async function shareCommand(opts: ProjectOptions) {
    const shareLink = await shareProjectAsync(opts);

    if (shareLink) {
        info(`Success! Project shared to ${shareLink}`)
    }
    else {
        error("Unable to share project");
    }

}