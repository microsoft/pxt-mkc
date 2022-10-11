import * as child_process from "child_process"
import * as fs from "fs"
import * as mkc from "mkc-core/built/mkc"
import { httpGetJsonAsync } from "mkc-core/built/downloader"
import { inc } from "semver"
import { collectCurrentVersionAsync, monoRepoConfigsAsync } from "mkc-core/built/files"

export interface SpawnOptions {
    cmd: string
    args: string[]
    cwd?: string
    shell?: boolean
    pipe?: boolean
    input?: string
    silent?: boolean
    allowNonZeroExit?: boolean
}

export function spawnAsync(opts: SpawnOptions) {
    opts.pipe = false
    return spawnWithPipeAsync(opts).then(() => { })
}

export function spawnWithPipeAsync(opts: SpawnOptions) {
    if (opts.pipe === undefined) opts.pipe = true
    let info = opts.cmd + " " + opts.args.join(" ")
    if (opts.cwd && opts.cwd != ".") info = "cd " + opts.cwd + "; " + info
    mkc.log("[run] " + info)
    return new Promise<Buffer>((resolve, reject) => {
        let ch = child_process.spawn(opts.cmd, opts.args, {
            cwd: opts.cwd,
            env: process.env,
            stdio: opts.pipe
                ? [
                    opts.input == null ? process.stdin : "pipe",
                    "pipe",
                    process.stderr,
                ]
                : "inherit",
            shell: opts.shell || false,
        } as any)
        let bufs: Buffer[] = []
        if (opts.pipe)
            ch.stdout.on("data", (buf: Buffer) => {
                bufs.push(buf)
                if (!opts.silent) {
                    process.stdout.write(buf)
                }
            })
        ch.on("close", (code: number) => {
            if (code != 0 && !opts.allowNonZeroExit)
                reject(new Error("Exit code: " + code + " from " + info))
            resolve(Buffer.concat(bufs))
        })
        if (opts.input != null) ch.stdin.end(opts.input, "utf8")
    })
}

let readlineCount = 0
function readlineAsync() {
    process.stdin.resume()
    process.stdin.setEncoding("utf8")
    readlineCount++
    return new Promise<string>((resolve, reject) => {
        process.stdin.once("data", (text: string) => {
            resolve(text)
        })
    })
}

export function queryAsync(msg: string, defl: string) {
    process.stdout.write(`${msg} [${defl}]: `)
    return readlineAsync().then(text => {
        text = text.trim()
        if (!text) return defl
        else return text
    })
}

export function needsGitCleanAsync() {
    return Promise.resolve()
        .then(() =>
            spawnWithPipeAsync({
                cmd: "git",
                args: ["status", "--porcelain", "--untracked-files=no"],
            })
        )
        .then(buf => {
            if (buf.length)
                throw new Error(
                    "Please commit all files to git before running 'makecode --bump'"
                )
        })
}

export function runGitAsync(...args: string[]) {
    return spawnAsync({
        cmd: "git",
        args: args,
        cwd: ".",
    })
}

export async function bumpAsync(
    prj: mkc.Project,
    versionFile: string,
    stage: boolean,
    release: "patch" | "minor" | "major"
) {
    if (stage) mkc.log(`operation staged, skipping git commit/push`)

    if (!stage) {
        await needsGitCleanAsync()
        await runGitAsync("pull")
    }
    const configs = await monoRepoConfigsAsync(prj.directory, true)
    const currentVersion = await collectCurrentVersionAsync(configs)
    let newV: string
    if (release)
        newV = inc(currentVersion, release)
    else
        newV = await queryAsync("New version", inc(currentVersion, "patch"))
    const newTag = "v" + newV
    mkc.log(`new version: ${newV}`)

    if (versionFile) {
        const cfg = prj.mainPkg.config
        mkc.debug(`writing version in ${versionFile}`)
        const versionSrc = `
// Auto-generated file: do not edit.
namespace ${cfg.name
                .replace(/^pxt-/, "")
                .split(/-/g)
                .map((p, i) => (i == 0 ? p : p[0].toUpperCase() + p.slice(1)))
                .join("")} {
    /**
     * Version of the package
     */
    export const VERSION = "${newTag}"
}`
        fs.writeFileSync(versionFile, versionSrc, { encoding: "utf-8" })
    }

    for (const fn of configs) {
        const cfg0 = JSON.parse(fs.readFileSync(fn, "utf8"))
        if (cfg0?.codal?.libraries?.length == 1) {
            const lib: string = cfg0.codal.libraries[0]
            if (lib.endsWith("#v" + cfg0.version)) {
                mkc.debug(`updating codal library in ${fn}`)
                cfg0.codal.libraries[0] = lib.replace(/#.*/, "#v" + newV)
            }
        }
        cfg0.version = newV
        mkc.debug(`updating ${fn}`)
        fs.writeFileSync(fn, mkc.stringifyConfig(cfg0))
    }

    if (!stage) {
        await runGitAsync("commit", "-a", "-m", newV)
        await runGitAsync("tag", newTag)
        await runGitAsync("push")
        await runGitAsync("push", "--tags")

        const urlinfo = await spawnWithPipeAsync({
            cmd: "git",
            args: ["remote", "get-url", "origin"],
            pipe: true,
        }).then(
            v => v,
            err => {
                mkc.error(err)
                return null as Buffer
            }
        )
        const url = urlinfo?.toString("utf8")?.trim()
        if (url) {
            const slug = url.replace(/.*github\.com\//i, "")
            if (slug != url) {
                mkc.log(`Github slug ${slug}; refreshing makecode.com cache`)
                const res = await httpGetJsonAsync(
                    "https://makecode.com/api/gh/" + slug + "/refs?nocache=1"
                )
                const sha = res?.refs?.["refs/tags/" + newTag]
                mkc.debug(`refreshed ${newV} -> ${sha}`)
            }
        }
    }
}
