import * as path from "path"
import * as mkc from "./mkc"
import { lt, valid, clean } from "semver"
import { host } from "./host";

export async function findParentDirWithAsync(base: string, filename: string) {
    let s = base
    while (true) {
        if (await host().existsAsync(path.join(s, filename))) return s

        const s2 = path.resolve(path.join(s, ".."))
        if (s == s2) return null
        s = s2
    }
}

export function findProjectDirAsync() {
    return findParentDirWithAsync(process.cwd(), "pxt.json")
}

function resolveFilename(dir: string, filename: string) {
    const resolved = path.resolve(dir, filename)
    if (resolved.startsWith(path.resolve(".", dir))) return resolved
    throw new Error(`Invalid file name: ${filename} (in ${dir})`)
}

export function relativePath(currdir: string, target: string) {
    return path.relative(currdir, target)
}

export function fileExistsAsync(name: string) {
    return host().existsAsync(name)
}

export function readPrjFileAsync(dir: string, filename: string) {
    return host().readFileAsync(resolveFilename(dir, filename), "utf8")
}

export async function readProjectAsync(dir: string) {
    const pxtJson = await host().readFileAsync(path.join(dir, "pxt.json"), "utf8")
    const res: mkc.Package = {
        config: JSON.parse(pxtJson),
        mkcConfig: null, // JSON.parse(await readAsync(path.join(dir, "mkc.json"), "utf8").then(s => s, err => "{}")),
        files: {
            "pxt.json": pxtJson,
        },
    }
    for (const fn of res.config.files.concat(res.config.testFiles || [])) {
        res.files[fn] = await host().readFileAsync(resolveFilename(dir, fn), "utf8")
    }
    return res.files
}

function homePxtDir() {
    return path.join(process.env["HOME"] || process.env["UserProfile"], ".pxt")
}

export async function mkHomeCacheAsync(dir?: string): Promise<mkc.Cache> {
    if (!dir) dir = homePxtDir()
    await mkdirpAsync(dir)
    const rootPath = path.join(dir, "mkc-cache")
    await mkdirpAsync(rootPath)

    function expandKey(key: string) {
        return key.replace(/[^\.a-z0-9_\-]/g, c => "_" + c.charCodeAt(0) + "_")
    }

    function keyPath(key: string) {
        return path.join(rootPath, expandKey(key))
    }

    return {
        rootPath,
        expandKey,
        getAsync: key =>
            host().readFileAsync(keyPath(key)).then(
                buf => buf,
                err => null
            ),
        setAsync: (key, val) => host().writeFileAsync(keyPath(key), val),
    }
}

async function mkdirpAsync(dirname: string, lev = 5) {
    if (!await host().existsAsync(dirname)) {
        if (lev > 0) await mkdirpAsync(path.resolve(dirname, ".."), lev - 1)
        await host().mkdirAsync(dirname)
    }
}

export async function writeFilesAsync(
    built: string,
    outfiles: pxt.Map<string>,
    log = false
) {
    await mkdirpAsync(built)
    for (let fn of Object.keys(outfiles)) {
        if (fn.indexOf("/") >= 0) continue
        if (log) mkc.log(`write ${built}/${fn}`)
        if (/\.(uf2|pxt64|elf)$/.test(fn))
            await host().writeFileAsync(path.join(built, fn), outfiles[fn], "base64")
        else await host().writeFileAsync(path.join(built, fn), outfiles[fn], "utf8")
    }
}

export async function saveBuiltFilesAsync(
    dir: string,
    res: mkc.service.CompileResult,
    folder = "built"
) {
    await writeFilesAsync(path.join(dir, folder), res.outfiles || {}, true)
}

export async function savePxtModulesAsync(
    dir: string,
    files: pxt.Map<string | { symlink: string }>
) {
    for (const k of Object.keys(files))
        if (k.startsWith("pxt_modules/")) {
           await mkdirpAsync(path.dirname(k))
            const v = files[k]
            if (typeof v == "string") {
                mkc.debug(`    write ${k}`)
                await host().writeFileAsync(k, v)
            }
            else {
                mkc.debug(`    link ${k}`)
                try {
                    await host().unlinkAsync(k)
                } catch { }
                await host().symlinkAsync(v.symlink, k, "file")
            }
        }
}

export async function monoRepoConfigsAsync(folder: string, includingSelf = true) {
    const files = await host().listFilesAsync(folder, "pxt.json");
    return files.filter(
        e =>
            e.indexOf("pxt_modules") < 0 &&
            e.indexOf("node_modules") < 0 &&
            (includingSelf ||
                path.resolve(folder, "pxt.json") != path.resolve(e))
    )
}

export async function collectCurrentVersionAsync(configs: string[]) {
    let version = "0.0.0"
    for (const config of configs) {
        const cfg = JSON.parse(await host().readFileAsync(config, "utf8"))
        const v = clean(cfg.version || "")
        if (valid(v) && lt(version, v))
            version = v
    }
    return version
}