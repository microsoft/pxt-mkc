import * as fs from "fs"
import * as path from "path"
import * as util from "util"
import * as mkc from "./mkc"

export function findParentDirWith(base: string, filename: string) {
    let s = base
    while (true) {
        if (fs.existsSync(path.join(s, filename))) return s

        const s2 = path.resolve(path.join(s, ".."))
        if (s == s2) return null
        s = s2
    }
}

export function findProjectDir() {
    return findParentDirWith(process.cwd(), "pxt.json")
}

const readAsync = util.promisify(fs.readFile)
const writeAsync = util.promisify(fs.writeFile)

function resolveFilename(dir: string, filename: string) {
    const resolved = path.resolve(dir, filename)
    if (resolved.startsWith(path.resolve(".", dir))) return resolved
    throw new Error(`Invalid file name: ${filename} (in ${dir})`)
}

export function relativePath(currdir: string, target: string) {
    return path.relative(currdir, target)
}

export function fileExists(name: string) {
    return fs.existsSync(name)
}

export function readPrjFileAsync(dir: string, filename: string) {
    return readAsync(resolveFilename(dir, filename), "utf8")
}

export async function readProjectAsync(dir: string) {
    const pxtJson = await readAsync(path.join(dir, "pxt.json"), "utf8")
    const res: mkc.Package = {
        config: JSON.parse(pxtJson),
        mkcConfig: null, // JSON.parse(await readAsync(path.join(dir, "mkc.json"), "utf8").then(s => s, err => "{}")),
        files: {
            "pxt.json": pxtJson,
        },
    }
    for (const fn of res.config.files.concat(res.config.testFiles || [])) {
        res.files[fn] = await readAsync(resolveFilename(dir, fn), "utf8")
    }
    return res.files
}

function homePxtDir() {
    return path.join(process.env["HOME"] || process.env["UserProfile"], ".pxt")
}

export function mkHomeCache(dir?: string): mkc.Cache {
    if (!dir) dir = homePxtDir()
    mkdirp(dir)
    const rootPath = path.join(dir, "mkc-cache")
    mkdirp(rootPath)

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
            readAsync(keyPath(key)).then(
                buf => buf,
                err => null
            ),
        setAsync: (key, val) => writeAsync(keyPath(key), val),
    }
}

function mkdirp(dirname: string, lev = 5) {
    if (!fs.existsSync(dirname)) {
        if (lev > 0) mkdirp(path.resolve(dirname, ".."), lev - 1)
        fs.mkdirSync(dirname)
    }
}

export async function writeFilesAsync(
    built: string,
    outfiles: pxt.Map<string>,
    log = false
) {
    mkdirp(built)
    for (let fn of Object.keys(outfiles)) {
        if (fn.indexOf("/") >= 0) continue
        if (log) mkc.log(`write ${built}/${fn}`)
        if (/\.(uf2|pxt64|elf)$/.test(fn))
            await writeAsync(path.join(built, fn), outfiles[fn], "base64")
        else await writeAsync(path.join(built, fn), outfiles[fn], "utf8")
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
            mkdirp(path.dirname(k))
            const v = files[k]
            if (typeof v == "string") {
                mkc.debug(`    write ${k}`)
                await writeAsync(k, v)
            }
            else {
                mkc.debug(`    link ${k}`)
                try {
                    fs.unlinkSync(k)
                } catch { }
                fs.symlinkSync(v.symlink, k, "file")
            }
        }
}
