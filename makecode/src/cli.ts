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
        .parse(process.argv)

    const opts = commander as CmdOptions

    if (opts.download)
        return downloadProjectAsync(opts.download)

    let prj = new mkc.Project(files.findProjectDir())

    if (opts.hw) {
        await prj.loadEditorAsync()
        const cfgs: pxt.PackageConfig[] = prj.service.runSync("pxt.getHwVariants()")
        const hw = opts.hw.toLowerCase()
        const selected = cfgs.filter(cfg => {
            return cfg.name.toLowerCase() == hw ||
                hwid(cfg).toLowerCase() == hw ||
                cfg.card.name.toLowerCase() == hw
        })
        if (!selected.length) {
            console.error(`No such HW id: ${opts.hw}. Available hw:`)
            for (let cfg of cfgs) {
                console.error(`${hwid(cfg)}, ${cfg.card.name} - ${cfg.card.description}`)
            }
            process.exit(1)
        }
        prj = new mkc.Project(files.findProjectDir())
        prj.hwVariant = hwid(selected[0])

        function hwid(cfg: pxt.PackageConfig) {
            return cfg.name.replace(/hw---/, "")
        }
    }

    if (!opts.javaScript || opts.hw)
        opts.native = true
    else
        opts.native = false

    const simpleOpts = {
        native: opts.native
    }

    await prj.buildAsync(simpleOpts)

    console.log("all done")
}

mainCli()
