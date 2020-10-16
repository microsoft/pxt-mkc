import * as child_process from 'child_process';
import * as fs from 'fs';
import * as mkc from "./mkc"
import * as files from "./files"
import { httpGetJsonAsync } from './downloader';

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
    console.log("[run] " + info)
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

export async function bumpAsync(prj: mkc.Project) {
    await needsGitCleanAsync()
    const cfg = prj.mainPkg.config
    const m = /^(\d+\.\d+)\.(\d+)(.*)/.exec(cfg.version)
    let newV = m ? m[1] + "." + (parseInt(m[2]) + 1) + m[3] : ""
    newV = await queryAsync("New version", newV)
    cfg.version = newV
    await files.writeFilesAsync(prj.directory, { "pxt.json": JSON.stringify(cfg, null, 4) }, true)
    await runGitAsync("commit", "-a", "-m", newV)
    await runGitAsync("tag", "v" + newV)
    await runGitAsync("push")
    await runGitAsync("push", "--tags")

    const urlinfo = await spawnWithPipeAsync({
        cmd: "git",
        args: ["remote", "get-url", "origin"],
        pipe: true
    }).then(v => v, err => {
        console.log(err)
        return null as Buffer
    })
    const url = urlinfo?.toString("utf8")?.trim()
    if (url) {
        const slug = url.replace(/.*github\.com\//i, "")
        if (slug != url) {
            console.log(`Github slug ${slug}; refreshing makecode.com cache`)
            const res = await httpGetJsonAsync("https://makecode.com/api/gh/" + slug + "/refs?nocache=1")
            const sha = res?.refs?.["refs/tags/v" + newV]
            console.log(`refreshed ${newV} -> ${sha}`)
        }
    }
}
