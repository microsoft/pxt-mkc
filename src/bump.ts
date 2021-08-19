import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as mkc from "./mkc"
import * as files from "./files"
import { httpGetJsonAsync } from './downloader';
import { glob } from 'glob';

export interface SpawnOptions {
    cmd: string;
    args: string[];
    cwd?: string;
    shell?: boolean;
    pipe?: boolean;
    input?: string;
    silent?: boolean;
    allowNonZeroExit?: boolean;
}

export function spawnAsync(opts: SpawnOptions) {
    opts.pipe = false
    return spawnWithPipeAsync(opts)
        .then(() => { })
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
            stdio: opts.pipe ? [opts.input == null ? process.stdin : "pipe", "pipe", process.stderr] : "inherit",
            shell: opts.shell || false
        } as any)
        let bufs: Buffer[] = []
        if (opts.pipe)
            ch.stdout.on('data', (buf: Buffer) => {
                bufs.push(buf)
                if (!opts.silent) {
                    process.stdout.write(buf)
                }
            })
        ch.on('close', (code: number) => {
            if (code != 0 && !opts.allowNonZeroExit)
                reject(new Error("Exit code: " + code + " from " + info))
            resolve(Buffer.concat(bufs))
        });
        if (opts.input != null)
            ch.stdin.end(opts.input, "utf8")
    })
}


let readlineCount = 0
function readlineAsync() {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    readlineCount++
    return new Promise<string>((resolve, reject) => {
        process.stdin.once('data', (text: string) => {
            resolve(text)
        })
    })
}

export function queryAsync(msg: string, defl: string) {
    process.stdout.write(`${msg} [${defl}]: `)
    return readlineAsync()
        .then(text => {
            text = text.trim()
            if (!text) return defl
            else return text
        })
}

export function needsGitCleanAsync() {
    return Promise.resolve()
        .then(() => spawnWithPipeAsync({
            cmd: "git",
            args: ["status", "--porcelain", "--untracked-files=no"]
        }))
        .then(buf => {
            if (buf.length)
                throw new Error("Please commit all files to git before running 'makecode --bump'")
        })
}

export function runGitAsync(...args: string[]) {
    return spawnAsync({
        cmd: "git",
        args: args,
        cwd: "."
    })
}

export function monoRepoConfigs(folder: string, includingSelf = true) {
    return glob.sync(folder + "/**/pxt.json")
        .filter(e =>
            e.indexOf("pxt_modules") < 0 &&
            e.indexOf("node_modules") < 0 &&
            (includingSelf || path.resolve(folder, "pxt.json") != path.resolve(e)))
}

export async function bumpAsync(prj: mkc.Project) {
    await needsGitCleanAsync()
    await runGitAsync("pull")
    const cfg = prj.mainPkg.config
    const m = /^(\d+\.\d+)\.(\d+)(.*)/.exec(cfg.version)
    let newV = m ? m[1] + "." + (parseInt(m[2]) + 1) + m[3] : ""
    newV = await queryAsync("New version", newV)
    cfg.version = newV

    const configs = monoRepoConfigs(prj.directory, false)
    if (configs.length > 0) {
        if (await queryAsync(`Also update sub-packages (${configs.length}) in this repo?`, "y") == "y") {
            for (const fn of configs) {
                const cfg0 = JSON.parse(fs.readFileSync(fn, "utf8"))
                cfg0.version = newV
                fs.writeFileSync(fn, mkc.stringifyConfig(cfg0))
            }
        }
    }

    await files.writeFilesAsync(prj.directory, { "pxt.json": mkc.stringifyConfig(cfg) }, true)
    await runGitAsync("commit", "-a", "-m", newV)
    await runGitAsync("tag", "v" + newV)
    await runGitAsync("push")
    await runGitAsync("push", "--tags")

    const urlinfo = await spawnWithPipeAsync({
        cmd: "git",
        args: ["remote", "get-url", "origin"],
        pipe: true
    }).then(v => v, err => {
        mkc.error(err)
        return null as Buffer
    })
    const url = urlinfo?.toString("utf8")?.trim()
    if (url) {
        const slug = url.replace(/.*github\.com\//i, "")
        if (slug != url) {
            mkc.log(`Github slug ${slug}; refreshing makecode.com cache`)
            const res = await httpGetJsonAsync("https://makecode.com/api/gh/" + slug + "/refs?nocache=1")
            const sha = res?.refs?.["refs/tags/v" + newV]
            mkc.log(`refreshed ${newV} -> ${sha}`)
        }
    }
}
