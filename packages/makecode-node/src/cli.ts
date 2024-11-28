import {
    program as commander,
    CommandOptions,
    Command,
    Argument,
} from "commander";

import * as chalk from "chalk";
import * as fs from 'fs';
import watch from "node-watch"

import {
    ProjectOptions,
    BuildOptions,
    applyGlobalOptions,
    resolveProject,
    downloadCommand,
    initCommand,
    installCommand,
    cleanCommand,
    addCommand,
    searchCommand,
    stackCommand,
    buildCommandOnce,
    shareCommand,
    validateTranslatedBlockString,
} from "makecode-core/built/commands";

import { descriptors } from "makecode-core/built/loader";
import { setHost } from "makecode-core/built/host";
import { setLogging } from "makecode-core/built/mkc";

import { createNodeHost } from "./nodeHost";
import { bumpAsync } from "./bump";
import { startSimServer } from "./simserver";

let debugMode = false

function info(msg: string) {
    console.log(chalk.blueBright(msg))
}

function msg(msg: string) {
    console.log(chalk.green(msg))
}

function error(msg: string) {
    console.error(chalk.red(msg))
}

interface BumpOptions extends ProjectOptions {
    versionFile?: string
    stage?: boolean
    patch?: boolean
    minor?: boolean
    major?: boolean
}

export async function buildCommand(opts: BuildOptions, info: Command) {
    if (info?.args?.length) {
        error("invalid command")
        process.exit(1)
    }
    applyGlobalOptions(opts)
    if (opts.deploy && opts.monoRepo) {
        error("--deploy and --mono-repo cannot be used together")
        process.exit(1)
    }
    if (opts.deploy && opts.javaScript) {
        error("--deploy and --java-script cannot be used together")
        process.exit(1)
    }
    if (opts.watch) {
        startWatch(opts)
    } else await buildCommandOnce(opts)
}

export async function bumpCommand(opts: BumpOptions) {
    applyGlobalOptions(opts)
    const prj = await resolveProject(opts)
    await bumpAsync(prj, opts?.versionFile, opts?.stage, opts?.major ? "major" : opts?.minor ? "minor" : opts?.patch ? "patch" : undefined)
}

interface ValidateTranslatedBlockStringsOptions extends BuildOptions {
    translationFile: string
    skipBuild?: boolean
}

async function validateTranslatedBlockStringsCommand(opts: ValidateTranslatedBlockStringsOptions) {
    // Apply global options
    applyGlobalOptions(opts);

    const translationFile = opts.translationFile;
    msg(`Inputs: --translationFile: ${translationFile}, --skipBuild: ${opts.skipBuild}`);
    // const apiInfo = await validateBlockStrings(opts);
    if (!translationFile || !fs.existsSync(translationFile)) {
        error(`File ${translationFile} not found`);
    }

    const translationMap = JSON.parse(fs.readFileSync(translationFile, 'utf8'));

    if (!opts.skipBuild) {
        const compileResult = await buildCommandOnce(opts);
        if (compileResult.success) {
            error(`Failed to compile the project: ${compileResult.diagnostics?.join("\n")}`);
        }
    } else {
        msg("Skipping build step");
    }

    const results: { [translationKey: string]: {result: boolean, message?: string}} = {};
    for (const [translationKey, blockString] of Object.entries(translationMap)) {
        if (typeof translationKey !== 'string' || typeof blockString !== 'string') {
            error(`Invalid block string entry found for ${translationKey}: ${blockString}`);
        }

        if (translationKey.startsWith("{id:subcategory}")) {
            results[translationKey] = { result: true, message: "No validation for subcategories" } // TODO thsparks : any validation to do here?
        } else if (translationKey.startsWith("{id:group}")) {
            results[translationKey] = { result: true, message: "No validation for groups" } // TODO thsparks : any validation to do here?
        } else if (translationKey.endsWith("|block")) {
            const qName = translationKey.replace("|block", "");
            const validation = await validateTranslatedBlockString(opts, qName, blockString as string);
            results[translationKey] = validation;
        } else if (translationKey.indexOf("|param|")) {
            results[translationKey] = { result: true, message: "No validation for subcategories" } // TODO thsparks : any validation to do here?
        } else {
            results[translationKey] = { result: true, message: "No validation performed" } // TODO thsparks : any validation to do here?
        }
    }

    console.log(JSON.stringify(results, null, 2)); // TODO thsparks : remove formatting when done testing.

    return Promise.resolve();
}

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v))
}

function delay(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
}

interface ServeOptions extends BuildOptions {
    port?: string
    forceLocal?: boolean
}
async function serveCommand(opts: ServeOptions) {
    applyGlobalOptions(opts)
    opts.javaScript = true
    if (opts.watch) startWatch(clone(opts))
    opts = clone(opts)
    opts.update = false
    const prj = await resolveProject(opts, !!opts.watch)
    const port = parseInt(opts.port) || 7001
    const url = `http://127.0.0.1:${port}`
    const forceLocal = !!opts.forceLocal
    msg(`simulator at ${url}`)
    msg(`Jacdac+simulator at https://microsoft.github.io/jacdac-docs/clients/javascript/devtools#${url}`)
    startSimServer(prj.editor, port, forceLocal)
}

function startWatch(opts: BuildOptions) {
    const binaries: Record<string, Buffer | string> = {}
    const watcher = watch("./", {
        recursive: true,
        delay: 200,
        filter(f, skip) {
            // skip node_modules, pxt_modules, built, .git
            if (/\/?((node|pxt)_modules|built|\.git)/i.test(f)) return skip
            // only watch for js files
            return /\.(json|ts|asm|cpp|c|h|hpp)$/i.test(f)
        },
    })

    let building = false
    let buildPending = false
    const build = async (ev: string, filename: string) => {
        if (ev) msg(`detected ${ev} ${filename}`)

        buildPending = true

        await delay(100) // wait for other change events, that might have piled-up to arrive

        // don't trigger 2 build, wait and do it again
        if (building) {
            msg(` build in progress, waiting...`)
            return
        }

        // start a build
        try {
            building = true
            while (buildPending) {
                buildPending = false
                const opts0 = clone(opts)
                if (ev)
                    // if not first time, don't update
                    opts0.update = false
                const files = (await buildCommandOnce(opts0)).outfiles
                if (files)
                    Object.entries(files).forEach(([key, value]) => {
                        if (/\.(hex|json|asm)$/.test(key)) binaries[key] = value
                        else binaries[key] = Buffer.from(value, "base64")
                    })
            }
        } catch (e) {
            error(e)
        } finally {
            building = false
        }
    }
    watcher.on("change", build)
    msg(`start watching for file changes`)
    build(undefined, undefined)
}

function createCommand(name: string, opts?: CommandOptions) {
    const cmd = commander
        .command(name, opts)
        .option("--colors", "force color output")
        .option("--no-colors", "disable color output")
        .option("--debug", "enable debug output from PXT")
        .option("-f, --compile-flags <flag,...>",
            "set PXT compiler options (?compile=... or PXT_COMPILE_SWITCHES=... in other tools)")
    return cmd
}

async function mainCli() {
    setHost(createNodeHost());

    setLogging({
        log: info,
        error: error,
        debug: s => {
            if (debugMode)
                console.debug(chalk.gray(s))
        },
    })

    commander.version(require("../package.json").version)

    createCommand("build", { isDefault: true })
        .description("build project")
        .option("-w, --watch", "watch source files and rebuild on changes")
        .option("-n, --native", "compile native (default)")
        .option("-d, --deploy", "copy resulting binary to UF2 or HEX drive")
        .option(
            "-h, --hw <id,...>",
            "set hardware(s) for which to compile (implies -n)"
        )
        .option("-j, --java-script", "compile to JavaScript")
        .option("-u, --update", "check for web-app updates")
        .option(
            "-c, --config-path <file>",
            'set configuration file path (default: "mkc.json")'
        )
        .option(
            "-r, --mono-repo",
            "also build all subfolders with 'pxt.json' in them"
        )
        .option(
            "--always-built",
            "always generate files in built/ folder (and not built/hw-variant/)"
        )
        .action(buildCommand)

    createCommand("serve")
        .description("start local simulator web server")
        .option("--no-watch", "do not watch source files")
        .option("-p, --port <number>", "port to listen at, default to 7001")
        .option("-u, --update", "check for web-app updates")
        .option(
            "-c, --config-path <file>",
            'set configuration file path (default: "mkc.json")'
        )
        .option("--force-local", "force using all local files")
        .action(serveCommand)

    createCommand("download")
        .argument(
            "<url>",
            "url to the shared project from your makecode editor"
        )
        .description("download project from share URL")
        .action(downloadCommand)

    createCommand("bump")
        .description(
            "interactive version incrementer for a project or mono-repo"
        )
        .option(
            "--version-file <file>",
            "write generated version number into the file"
        )
        .option("--stage", "skip git commit and push operations")
        .option("--patch", "auto-increment patch version number")
        .option("--minor", "auto-increment minor version number")
        .option("--major", "auto-increment major version number")
        .action(bumpCommand)

    createCommand("init")
        .addArgument(
            new Argument("[template]", "project template name").choices(
                descriptors.map(d => d.id)
            )
        )
        .argument("[repo...]", "dependencies to be added to the project")
        .description(
            "initializes the project, downloads the dependencies, optionally for a particular editor"
        )
        .option(
            "--symlink-pxt-modules",
            "symlink files in pxt_modules/* for auto-completion"
        )
        .option(
            "--link-pxt-modules",
            "write pxt_modules/* adhering to 'links' field in mkc.json (for pxt cli build)"
        )
        .action(initCommand)

    createCommand("install")
        .description("downloads the dependencies")
        .option(
            "-r, --mono-repo",
            "also install in all subfolders with 'pxt.json' in them"
        )
        .option(
            "--symlink-pxt-modules",
            "symlink files in pxt_modules/* for auto-completion"
        )
        .option(
            "--link-pxt-modules",
            "write pxt_modules/* adhering to 'links' field in mkc.json (for pxt cli build)"
        )
        .action(installCommand)

    createCommand("clean")
        .description("deletes built artifacts")
        .action(cleanCommand)

    createCommand("add")
        .argument("<repo>", "url to the github repository")
        .argument("[name]", "name of the dependency")
        .description("add new dependencies")
        .option(
            "-c, --config-path <file>",
            'set configuration file path (default: "mkc.json")'
        )
        .action(addCommand)

    createCommand("search")
        .argument("<query>", "extension to search for")
        .description("search for an extension")
        .option(
            "-c, --config-path <file>",
            'set configuration file path (default: "mkc.json")'
        )
        .action(searchCommand)

    createCommand("share")
        .description("creates a public share link for the project")
        .action(shareCommand)

    createCommand("stack", { hidden: true })
        .description("expand stack trace")
        .action(stackCommand)

    createCommand("validateTranslatedBlockStrings")
        .description("build project and validate block strings")
        .requiredOption("-f, --translation-file <file>", "path to the translated strings file")
        .option("-sb, --skip-build", "skip build step")
        .option("-w, --watch", "watch source files and rebuild on changes")
        .option("-n, --native", "compile native (default)")
        .option("-d, --deploy", "copy resulting binary to UF2 or HEX drive")
        .option(
            "-h, --hw <id,...>",
            "set hardware(s) for which to compile (implies -n)"
        )
        .option("-j, --java-script", "compile to JavaScript")
        .option("-u, --update", "check for web-app updates")
        .option(
            "-c, --config-path <file>",
            'set configuration file path (default: "mkc.json")'
        )
        .option(
            "-r, --mono-repo",
            "also build all subfolders with 'pxt.json' in them"
        )
        .option(
            "--always-built",
            "always generate files in built/ folder (and not built/hw-variant/)"
        )
        .action(validateTranslatedBlockStringsCommand);

    await commander.parseAsync(process.argv)
}

async function mainWrapper() {
    try {
        await mainCli()
    } catch (e) {
        error("Exception: " + e.stack)
        error("Build failed")
        process.exit(1)
    }
}

mainWrapper()
