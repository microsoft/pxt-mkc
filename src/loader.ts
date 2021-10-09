import * as mkc from "./mkc"
import * as downloader from "./downloader"

export interface TargetDescriptor {
    id: string;
    targetId: string;
    name: string;
    description: string;
    website: string;
    corepkg?: string;
    label?: string;
    dependencies?: Record<string, string>
    testDependencies?: Record<string, string>
}

export const descriptors: TargetDescriptor[] = [{
    id: "arcade",
    targetId: "arcade",
    name: "MakeCode Arcade",
    description: "Old school games",
    website: "https://arcade.makecode.com/beta",
    corepkg: "device",
}, {
    id: "microbit",
    targetId: "microbit",
    name: "micro:bit",
    description: "Get creative, get connected, get coding",
    website: "https://makecode.microbit.org/beta",
    corepkg: "core",
    dependencies: {
        "core": "*",
        "radio": "*",
        "microphone": "*"
    }
}, {
    id: "maker-jacdac-brain-esp32",
    targetId: "maker",
    name: "Maker ESP32-S2",
    description: "Jacdac ESP32-S2 brain",
    website: "https://maker.makecode.com/",
    corepkg: "jacdac-iot-s2",
}, {
    id: "maker-jacdac-brain-f4",
    targetId: "maker",
    name: "Maker Jacdac Brain F4",
    description: "Jacdac STM32 F4 brain",
    website: "https://maker.makecode.com/",
    corepkg: "jacdac-brain-f4",
}, {
    id: "maker-jacdac-brain-rp2040",
    targetId: "maker",
    name: "Maker Jacdac Brain RP2040",
    description: "Jacdac STM32 RP2040 brain",
    website: "https://maker.makecode.com/",
    corepkg: "jacdac-brain-rp2040",
}, {
    id: "maker-jacdac-brain-nrf52",
    targetId: "maker",
    name: "Maker Jacdac Brain NRF52",
    description: "Jacdac STM32 NRF52 brain",
    website: "https://maker.makecode.com/",
    corepkg: "jacdac-nrfbrain",
}, {
    id: "adafruit",
    targetId: "adafruit",
    name: "Circuit Playground Express",
    description: "An educational board from Adafruit",
    website: "https://makecode.adafruit.com/beta",
    corepkg: "circuit-playground",
}]

export function guessMkcJson(prj: mkc.Package) {
    const mkc = prj.mkcConfig
    const ver = prj.config.targetVersions || { target: "" }
    const vers = prj.config.supportedTargets || []

    const theTarget = descriptors.find(d => d.targetId == ver.targetId)
        || descriptors.find(d => d.website == ver.targetWebsite)
        || descriptors.find(d => vers.indexOf(d.targetId) > -1)
        || descriptors.find(d => d.corepkg && !!prj.config?.testDependencies?.[d.corepkg] || !!prj.config.dependencies[d.corepkg])

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

function merge(trg: any, src: any) {
    for (const k of Object.keys(src))
        trg[k] = src[k]
}

async function recLoadAsync(ed: mkc.DownloadedEditor, ws: mkc.Workspace, myid = "this") {
    const mkcJson = ws.packages["this"].mkcConfig
    const pcfg = ws.packages[myid].config
    const pending: string[] = []
    let deps = pcfg.dependencies
    if (myid == "this" && pcfg.testDependencies) {
        deps = {}
        merge(deps, pcfg.dependencies)
        merge(deps, pcfg.testDependencies)
    }
    for (let pkgid of Object.keys(deps)) {
        const ver = deps[pkgid]
        if (pkgid == "hw" && mkcJson.hwVariant)
            pkgid = "hw---" + mkcJson.hwVariant
        if (ws.packages[pkgid] !== undefined)
            continue // already loaded
        let text: pxt.Map<string>
        let fromTargetJson = false
        pending.push(pkgid)
        if (mkcJson.links && mkcJson.links[pkgid]) {
            text = await mkc.files.readProjectAsync(mkcJson.links[pkgid])
        } else if (ver == "*" || /^file:/.test(ver)) {
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
        for (let fn of Object.keys(prj.files))
            mainPrj.files["pxt_modules/" + k + "/" + fn] = prj.files[fn]
    }

    // console.log(Object.keys(mainPrj.files))
}
