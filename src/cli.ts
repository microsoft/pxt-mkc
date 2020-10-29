import * as fs from "fs"

import * as mkc from "./mkc"
import * as loader from "./loader"
import * as files from "./files"
import * as bump from "./bump"
import * as downloader from "./downloader"
import * as service from "./service"
import { program as commander } from "commander"

interface CmdOptions {
    hw?: string;
    native?: boolean;
    javaScript?: boolean;
    download?: string;
    pxtModules?: boolean;
    initMkc?: boolean;
    alwaysBuilt?: boolean;
    update?: boolean;
    debug?: boolean;
    bump?: boolean;
    configPath?: string;
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
    console.log("downloaded.")
}


async function mainCli() {
    commander
        .version("0.0.0")
        .option("-n, --native", "compile native (default)")
        .option("-h, --hw <id>", "set hardware for which to compile (implies -n)")
        .option("-j, --java-script", "compile to JavaScript")
        .option("-d, --download <URL>", "download project from share URL")
        .option("-i, --init-mkc", "initialize mkc.json")
        .option("-u, --update", "check for web-app updates")
        .option("-b, --bump", "bump version in pxt.json and git")
        .option("--config-path <file>", "set configuration file path", "mkc.json")
        .option("--pxt-modules", "write pxt_modules/*")
        .option("--always-built", "always generate files in built/ folder (and not built/hw-variant/)")
        .option("--debug", "enable debug output from PXT")
        .parse(process.argv)

    const opts = commander as CmdOptions

    if (opts.download)
        return downloadProjectAsync(opts.download)

    const prj = new mkc.Project(files.findProjectDir())
    prj.mkcConfigPath = opts.configPath

    await prj.loadEditorAsync(!!opts.update)

    if (opts.debug)
        prj.service.runSync("(() => { pxt.options.debug = 1 })()")

    if (opts.bump) {
        await bump.bumpAsync(prj)
        process.exit(0)
    }

    prj.service.runSync("(() => { pxt.savedAppTheme().experimentalHw = true; pxt.reloadAppTargetVariant() })()")
    const hwVariants = prj.service.hwVariants

    if (opts.hw) {
        const hw = opts.hw.toLowerCase()
        const selected = hwVariants.filter(cfg => {
            return cfg.name.toLowerCase() == hw ||
                hwid(cfg).toLowerCase() == hw ||
                cfg.card.name.toLowerCase() == hw
        })
        if (!selected.length) {
            console.error(`No such HW id: ${opts.hw}. Available hw:`)
            for (let cfg of hwVariants) {
                console.error(`${hwid(cfg)}, ${cfg.card.name} - ${cfg.card.description}`)
            }
            process.exit(1)
        }
        prj.hwVariant = hwid(selected[0])
    }

    if (opts.initMkc) {
        console.log("saving mkc.json")
        fs.writeFileSync("mkc.json", JSON.stringify(prj.mainPkg.mkcConfig, null, 4))
    }

    prj.writePxtModules = !!opts.pxtModules

    if (!opts.javaScript || opts.hw)
        opts.native = true
    else
        opts.native = false

    if (opts.native && hwVariants.length) {
        prj.guessHwVariant()
        console.log(`using hwVariant: ${prj.mainPkg.mkcConfig.hwVariant}`)
        if (!opts.alwaysBuilt)
            prj.outputPrefix = "built/" + prj.mainPkg.mkcConfig.hwVariant
    }

    const simpleOpts = {
        native: opts.native
    }

    const res = await prj.buildAsync(simpleOpts)

    let output = ""
    for (let diagnostic of res.diagnostics) {
        const category = diagnostic.category == 1 ? "error" : diagnostic.category == 2 ? "warning" : "message"
        if (diagnostic.fileName)
            output += `${diagnostic.fileName}(${diagnostic.line + 1},${diagnostic.column + 1}): `;
        output += `${category} TS${diagnostic.code}: ${diagnostic.messageText}\n`;
    }

    if (output)
        console.log(output.replace(/\n$/, ""))
    if (res.success) {
        console.log("Build OK")
        process.exit(0)
    } else {
        console.log("Build failed")
        process.exit(1)
    }

    function hwid(cfg: pxt.PackageConfig) {
        return cfg.name.replace(/hw---/, "")
    }
}

mainCli()
