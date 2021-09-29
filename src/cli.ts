import * as fs from "fs"
import * as path from "path"
import * as util from "util"

import * as mkc from "./mkc"
import * as files from "./files"
import * as bump from "./bump"
import * as downloader from "./downloader"
import * as service from "./service"
import { program as commander } from "commander"
import * as chalk from "chalk"
import { getDeployDrives } from "./deploy"
interface CmdOptions {
    hw?: string;
    native?: boolean;
    javaScript?: boolean;
    download?: string;
    deploy?: boolean;
    pxtModules?: boolean;
    linkPxtModules?: boolean;
    initMkc?: boolean;
    alwaysBuilt?: boolean;
    update?: boolean;
    debug?: boolean;
    bump?: boolean;
    configPath?: string;
    monoRepo?: boolean;
    colors?: boolean;
    noColors?: boolean;
}

async function downloadProjectAsync(id: string) {
    id = id.replace(/.*\//, '')
    const url = mkc.cloudRoot + id + "/text"
    const files = await downloader.httpGetJsonAsync(url)
    for (let fn of Object.keys(files)) {
        if (/\//.test(fn))
            continue
        fs.writeFileSync(fn, files[fn])
    }
    msg("downloaded.")
}

async function buildOnePrj(opts: CmdOptions, prj: mkc.Project) {
    try {
        const simpleOpts = {
            native: opts.native
        }

        const res = await prj.buildAsync(simpleOpts)

        const msgToString = (diagnostic: service.DiagnosticMessageChain | service.KsDiagnostic) => {
            const category = diagnostic.category == 1 ? chalk.red("error") : diagnostic.category == 2 ? chalk.yellowBright("warning") : "message"
            return `${category} TS${diagnostic.code}: ${diagnostic.messageText}\n`
        }

        let output = ""
        for (let diagnostic of res.diagnostics) {
            let pref = ""
            if (diagnostic.fileName)
                pref = `${diagnostic.fileName}(${diagnostic.line + 1},${diagnostic.column + 1}): `;

            if (typeof diagnostic.messageText == "string")
                output += pref + msgToString(diagnostic);
            else {
                for (let chain = diagnostic.messageText; chain; chain = chain.next) {
                    output += pref + msgToString(chain);
                }
            }
        }

        if (output)
            console.log(output.replace(/\n$/, ""))

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

async function mainCli() {
    commander
        .version(require("../package.json").version)
        .option("-n, --native", "compile native (default)")
        .option("-d, --deploy", "copy resulting binary to UF2 or HEX drive")
        .option("-h, --hw <id,...>", "set hardware(s) for which to compile (implies -n)")
        .option("-j, --java-script", "compile to JavaScript")
        .option("-d, --download <URL>", "download project from share URL")
        .option("-i, --init-mkc", "initialize mkc.json")
        .option("-u, --update", "check for web-app updates")
        .option("-b, --bump", "bump version in pxt.json and git")
        .option("-c, --config-path <file>", "set configuration file path (default: \"mkc.json\")")
        .option("-r, --mono-repo", "also build all subfolders with 'pxt.json' in them")
        .option("-m, --pxt-modules", "write pxt_modules/*")
        .option("--link-pxt-modules", "write pxt_modules/* adhering to 'links' field in mkc.json (for pxt cli build)")
        .option("--always-built", "always generate files in built/ folder (and not built/hw-variant/)")
        .option("--colors", "force color output")
        .option("--no-colors", "disable color output")
        .option("--debug", "enable debug output from PXT")
        .parse(process.argv)

    const opts = commander.opts() as CmdOptions

    if (opts.noColors)
        (chalk as any).level = 0
    else if (opts.colors && !chalk.level)
        (chalk as any).level = 1
    else if (process.env["GITHUB_WORKFLOW"])
        (chalk as any).level = 1

    if (opts.deploy && opts.monoRepo) {
        error("--deploy and --mono-repo cannot be used together")
        process.exit(1)
    }

    if (opts.deploy && opts.javaScript) {
        error("--deploy and --java-script cannot be used together")
        process.exit(1)
    }

    mkc.setLogging({
        log: info,
        error: error,
        debug: s => console.log(chalk.gray(s))
    })

    if (opts.download)
        return downloadProjectAsync(opts.download)

    const prjdir = files.findProjectDir()
    if (!prjdir) {
        error(`could not find "pxt.json" file`)
        process.exit(1)
    }

    if (!opts.configPath) {
        const cfgFolder = files.findParentDirWith(prjdir, "mkc.json")
        if (cfgFolder)
            opts.configPath = path.join(cfgFolder, "mkc.json")
    }

    info(`Using project: ${prjdir}/pxt.json`)
    const prj = new mkc.Project(prjdir)

    if (opts.configPath) {
        info(`Using config: ${opts.configPath}`)
        prj.mkcConfig = readCfg(opts.configPath)
    }

    await prj.loadEditorAsync(!!opts.update)
    info(`Using editor: ${prj.mkcConfig.targetWebsite}`)

    if (opts.debug)
        prj.service.runSync("(() => { pxt.options.debug = 1 })()")

    if (opts.bump) {
        await bump.bumpAsync(prj)
        process.exit(0)
    }

    prj.service.runSync("(() => { pxt.savedAppTheme().experimentalHw = true; pxt.reloadAppTargetVariant() })()")
    const hwVariants = prj.service.hwVariants
    const targetId = prj.service.runSync("pxt.appTarget.id")
    let moreHw: string[] = []
    const outputs: string[] = []

    if (opts.hw) {
        const hws = opts.hw.split(/[\s,;]+/)
        selectHW(hws[0])
        moreHw = hws.slice(1)
    }

    if (opts.initMkc) {
        msg("saving mkc.json")
        fs.writeFileSync("mkc.json", mkc.stringifyConfig(prj.mainPkg.mkcConfig))
    }

    prj.writePxtModules = !!opts.pxtModules
    if (opts.linkPxtModules) {
        prj.writePxtModules = true
        prj.linkPxtModules = true
    }

    if (!opts.javaScript || opts.hw)
        opts.native = true
    else
        opts.native = false

    if (opts.native && hwVariants.length) {
        prj.guessHwVariant()
        infoHW()
    }

    outputs.push(prj.outputPrefix)
    const compileRes = await buildOnePrj(opts, prj)
    if (compileRes && opts.deploy) {
        const firmwareName = ["binary.uf2", "binary.hex", "binary.elf"].filter(f => !!compileRes.outfiles[f])[0];
        if (!firmwareName) { // something went wrong here
            error(`firmware missing from built files (${Object.keys(compileRes.outfiles).join(', ')})`)
        } else {
            const compileInfo = prj.service.runSync("pxt.appTarget.compile")
            const drives = await getDeployDrives(compileInfo)

            if (drives.length == 0) {
                msg("cannot find any drives to deploy to");
            } else {
                const firmware = compileRes.outfiles[firmwareName];
                const encoding = firmwareName == "binary.hex" ? "utf8" : "base64";

                msg(`copying ${firmwareName} to ` + drives.join(", "));
                const writeFileAsync = util.promisify(fs.writeFile)
                const writeHexFile = (drivename: string) => {
                    return writeFileAsync(path.join(drivename, firmwareName), firmware, encoding)
                        .then(() => info("   wrote to " + drivename))
                        .catch(() => error(`   failed writing to ${drivename}`));
                };
                for (const p of drives.map(writeHexFile)) await p
            }

        }
    }

    let success = !!compileRes

    if (success && opts.monoRepo) {
        const dirs = bump.monoRepoConfigs(".")
        info(`mono-repo: building ${dirs.length} projects`)
        for (const fullpxtjson of dirs) {
            if (fullpxtjson.startsWith("pxt_modules"))
                continue
            const fulldir = path.dirname(fullpxtjson)
            info(`build ${fulldir}`)
            const prj0 = prj.mkChildProject(fulldir)
            const cfg = await prj0.readPxtConfig()
            if (cfg.supportedTargets && cfg.supportedTargets.indexOf(targetId) < 0) {
                info(`skipping due to supportedTargets`)
                continue
            }
            const ok = await buildOnePrj(opts, prj0)
            if (!ok)
                success = false
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
            info(`combining ${uf2s.length} UF2 files into ${fn} (${Math.round(total.length / 1024)}kB)`)
            fs.writeFileSync(fn, total)
        }
    }

    if (success) {
        msg("Build OK")
        process.exit(0)
    } else {
        error("Build failed")
        process.exit(1)
    }

    function hwid(cfg: pxt.PackageConfig) {
        return cfg.name.replace(/hw---/, "")
    }

    function selectHW(hw0: string) {
        const hw = hw0.toLowerCase()
        const selected = hwVariants.filter(cfg => {
            return cfg.name.toLowerCase() == hw ||
                hwid(cfg).toLowerCase() == hw ||
                cfg.card.name.toLowerCase() == hw
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
        info(`using hwVariant: ${prj.mainPkg.mkcConfig.hwVariant} (target ${targetId})`)
        if (!opts.alwaysBuilt)
            prj.outputPrefix = "built/" + prj.mainPkg.mkcConfig.hwVariant
    }
}

function isKV(v: any) {
    return !!v && typeof v === "object" && !Array.isArray(v)
}

function jsonMergeFrom(trg: any, src: any) {
    if (!src) return;
    Object.keys(src).forEach(k => {
        if (isKV(trg[k]) && isKV(src[k]))
            jsonMergeFrom(trg[k], src[k]);
        else if (Array.isArray(trg[k]) && Array.isArray(src[k]))
            trg[k] = trg[k].concat(src[k])
        else trg[k] = src[k];
    });
}

function readCfg(cfgpath: string) {
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
            info(`  include: ${resolved}`)
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
