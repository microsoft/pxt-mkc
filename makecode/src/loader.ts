import * as mkc from "./mkc"
import * as downloader from "./downloader"

export interface TargetDescriptor {
    id: string;
    name: string;
    description: string;
    website: string;
    corepkg: string;
    label?: string;
}

export const descriptors: TargetDescriptor[] = [{
    id: "arcade",
    name: "MakeCode Arcade",
    description: "Old school games",
    website: "https://arcade.makecode.com/beta",
    corepkg: "device",
}, {
    id: "microbit",
    name: "micro:bit",
    description: "Get creative, get connected, get coding",
    website: "https://makecode.microbit.org/beta",
    corepkg: "core",
}, {
    id: "adafruit",
    name: "Circuit Playground Express",
    description: "An educational board from Adafruit",
    website: "https://makecode.adafruit.com/beta",
    corepkg: "circuit-playground",
}]

export function guessMkcJson(prj: mkc.Package) {
    const mkc = prj.mkcConfig
    const ver = prj.config.targetVersions || { target: "" }

    const theTarget = descriptors.filter(d => d.id == ver.targetId)[0]
        || descriptors.filter(d => d.website == ver.targetWebsite)[0]
        || descriptors.filter(d => !!prj.config.dependencies[d.corepkg])[0]

    if (!mkc.targetWebsite) {
        if (ver.targetWebsite) {
            mkc.targetWebsite = ver.targetWebsite
        } else if (theTarget) {
            mkc.targetWebsite = theTarget.website
        } else {
            throw new Error("Cannot determine target; please use mkc.json to specify")
        }
    }
}

async function recLoadAsync(ed: mkc.DownloadedEditor, ws: mkc.Workspace, myid = "this") {
    const mkcJson = ws.packages["this"].mkcConfig
    const pcfg = ws.packages[myid].config
    const pending: string[] = []
    for (let pkgid of Object.keys(pcfg.dependencies)) {
        const ver = pcfg.dependencies[pkgid]
        if (pkgid == "hw" && mkcJson.hwVariant)
            pkgid = "hw---" + mkcJson.hwVariant
        if (ws.packages[pkgid] !== undefined)
            continue // already loaded
        let text: pxt.Map<string>
        let fromTargetJson = false
        pending.push(pkgid)
        if (ver == "*" || /^file:/.test(ver)) {
            text = ed.targetJson.bundledpkgs[pkgid]
            if (!text)
                throw new Error(`Package ${pkgid} not found in target.json`)
            fromTargetJson = true
        } else {
            let m = /^github:([\w\-\.]+\/[\w\-\.]+)#([\w\-\.]+)$/.exec(ver)
            if (m) {
                const path = m[1] + "/" + m[2]
                let curr = await ed.cache.getAsync("gh-" + path)
                if (!curr) {
                    const res = await downloader.requestAsync({
                        url: mkc.cloudRoot + "gh/" + path + "/text"
                    })
                    curr = res.buffer
                    await ed.cache.setAsync("gh-" + path, curr)
                }
                text = JSON.parse(curr.toString("utf8"))
            } else {
                throw new Error(`Unsupported package version: ${pkgid}: ${ver}`)
            }
        }
        const pkg: mkc.Package = {
            config: JSON.parse(text["pxt.json"]),
            mkcConfig: null,
            files: text,
            fromTargetJson
        }
        ws.packages[pkgid] = pkg
        ws.packages[pkgid.replace(/---.*/, "")] = pkg
    }

    for (let id of pending)
        await recLoadAsync(ed, ws, id)
}

export async function loadDeps(ed: mkc.DownloadedEditor, mainPrj: mkc.Package) {
    const ws: mkc.Workspace = {
        packages: {
            "this": mainPrj
        }
    }

    await recLoadAsync(ed, ws)

    for (let k of Object.keys(ws.packages)) {
        if (k == "this")
            continue
        const prj = ws.packages[k]
        if (prj.fromTargetJson)
            continue
        for (let fn of Object.keys(prj.files))
            mainPrj.files["pxt_modules/" + k + "/" + fn] = prj.files[fn]
    }

    // console.log(Object.keys(mainPrj.files))

    return ws
}
