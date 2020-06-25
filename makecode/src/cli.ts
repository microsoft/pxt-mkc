import * as fs from "fs"

import * as mkc from "./mkc"
import * as loader from "./loader"
import * as files from "./files"
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
        .option("-m, --pxt-modules", "write pxt_modules/*")
        .option("-i, --init-mkc", "initialize mkc.json")
        .parse(process.argv)

    const opts = commander as CmdOptions

    if (opts.download)
        return downloadProjectAsync(opts.download)

    const prj = new mkc.Project(files.findProjectDir())

    await prj.loadEditorAsync()

    prj.service.runSync("(() => { pxt.savedAppTheme().experimentalHw = true; pxt.reloadAppTargetVariant() })()")
    const hwVariants: pxt.PackageConfig[] = prj.service.runSync("pxt.getHwVariants()")

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

    if (opts.native && hwVariants.length && !prj.mainPkg.mkcConfig.hwVariant) {
        console.log("selecting first hw-variant: " + hwid(hwVariants[0]))
        prj.hwVariant = hwid(hwVariants[0])
    }

    const simpleOpts = {
        native: opts.native
    }

    await prj.buildAsync(simpleOpts)

    console.log("all done")


    function hwid(cfg: pxt.PackageConfig) {
        return cfg.name.replace(/hw---/, "")
    }
}

mainCli()
