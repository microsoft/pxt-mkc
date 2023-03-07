import * as vm from "vm";
import * as util from "util";

import * as mkc from "makecode-core/built/mkc";
import { WebConfig } from "makecode-core/built/downloader";
import { CompileOptions } from "makecode-core/built/service";
import { LanguageService, SimpleDriverCallbacks } from "makecode-core/built/host";

export class NodeLanguageService implements LanguageService {
    sandbox: vm.Context

    constructor(public editor: mkc.DownloadedEditor) {
        this.sandbox = {
            eval: (str: string) =>
                vm.runInContext(str, this.sandbox, {
                    filename: "eval",
                }),
            Function: undefined,
            setTimeout: setTimeout,
            clearInterval: clearInterval,
            clearTimeout: clearTimeout,
            setInterval: setInterval,
            clearImmediate: clearImmediate,
            setImmediate: setImmediate,
            TextEncoder: util.TextEncoder,
            TextDecoder: util.TextDecoder,
            Buffer: Buffer,
            pxtTargetBundle: {},
            scriptText: {},
            global: null,
            console: {
                log: (s: string) => mkc.log(s),
                debug: (s: string) => mkc.debug(s),
                warn: (s: string) => mkc.error(s),
            },
        };

        this.sandbox.global = this.sandbox
        vm.createContext(this.sandbox, {
            codeGeneration: {
                strings: false,
                wasm: false,
            },
        });

        const ed = this.editor
        ed.targetJson.compile.keepCppFiles = true
        this.sandbox.pxtTargetBundle = ed.targetJson
        this.runScript(ed.pxtWorkerJs, ed.website + "/pxtworker.js")
    }

    async registerDriverCallbacksAsync(callbacks: SimpleDriverCallbacks): Promise<void> {
        this.runFunctionSync("pxt.setupSimpleCompile", [callbacks]);
        // disable packages config for now;
        // otherwise we do a HTTP request on every compile
        this.runSync(
            "pxt.packagesConfigAsync = () => Promise.resolve({})"
        )
    }

    async setWebConfigAsync(config: WebConfig): Promise<void> {
        this.runFunctionSync("pxt.setupWebConfig", [
            config
        ])
    }

    async getWebConfigAsync(): Promise<mkc.downloader.WebConfig> {
        return this.runSync("pxt.webConfig")
    }

    async getAppTargetAsync(): Promise<any> {
        return this.runSync("pxt.appTarget");
    }

    async getTargetConfigAsync(): Promise<any> {
        return this.editor.targetConfig;
    }

    async supportsGhPackagesAsync(): Promise<boolean> {
        return !!this.runSync("pxt.simpleInstallPackagesAsync")
    }

    async setHwVariantAsync(variant: string): Promise<void> {
        this.runFunctionSync("pxt.setHwVariant", [
            variant || "",
        ])
    }

    async getHardwareVariantsAsync(): Promise<pxt.PackageConfig[]> {
        return this.runSync(
            "pxt.getHwVariants()"
        )
    }

    async getBundledPackageConfigsAsync(): Promise<pxt.PackageConfig[]> {
        return this.runSync(
            "Object.values(pxt.appTarget.bundledpkgs).map(pkg => JSON.parse(pkg['pxt.json']))"
        );
    }

    async getCompileOptionsAsync(prj: mkc.Package, simpleOpts?: any): Promise<CompileOptions> {
        this.sandbox._opts = simpleOpts
        return this.runAsync(
            "pxt.simpleGetCompileOptionsAsync(_scriptText, _opts)"
        )
    }

    async installGhPackagesAsync(projectFiles: pxt.Map<string>): Promise<pxt.Map<string>> {
        await this.runFunctionAsync("pxt.simpleInstallPackagesAsync", [
            projectFiles,
        ])
        return projectFiles;
    }

    performOperationAsync(op: string, data: any): Promise<any> {
        return this.runFunctionSync("pxtc.service.performOperation", [op, data])
    }

    async setProjectTextAsync(projectFiles: pxt.Map<string>): Promise<void> {
        this.sandbox._scriptText = projectFiles;
    }

    async enableExperimentalHardwareAsync(): Promise<void> {
        this.runSync(
            "(() => { pxt.savedAppTheme().experimentalHw = true; pxt.reloadAppTargetVariant() })()"
        );
    }

    async enableDebugAsync(): Promise<void> {
        this.runSync("(() => { pxt.options.debug = 1 })()");
    }

    async setCompileSwitchesAsync(flags: string): Promise<void> {
        this.runSync(`(() => {
            pxt.setCompileSwitches(${JSON.stringify(flags)});
            if (pxt.appTarget.compile.switches.asmdebug)
                ts.pxtc.assembler.debug = 1
        })()`)
    }

    private runScript(content: string, filename: string) {
        const scr = new vm.Script(content, {
            filename: filename,
        })
        scr.runInContext(this.sandbox)
    }

    private runWithCb(code: string, cb: (err: any, res: any) => void) {
        this.sandbox._gcb = cb
        const src = "(() => { const _cb = _gcb; _gcb = null; " + code + " })()"
        const scr = new vm.Script(src)
        scr.runInContext(this.sandbox)
    }

    private runAsync(code: string) {
        const src =
            `Promise.resolve().then(() => ${code})` +
            `.then(v => _cb(null, v), err => _cb(err.stack || "" + err, null))`
        return new Promise<any>((resolve, reject) =>
            this.runWithCb(src, (err, res) =>
                err ? reject(new Error(err)) : resolve(res)
            )
        )
    }

    private  runSync(code: string): any {
        const src =
            `try { _cb(null, ${code}) } ` +
            `catch (err) { _cb(err.stack || "" + err, null) }`
        let errRes = null
        let normRes = null
        this.runWithCb(src, (err, res) =>
            err ? (errRes = err) : (normRes = res)
        )
        if (errRes) throw new Error(errRes)
        return normRes
    }

    private runFunctionSync(name: string, args: any[]) {
        return this.runSync(this.runFunctionCore(name, args))
    }

    private runFunctionAsync(name: string, args: any[]) {
        return this.runAsync(this.runFunctionCore(name, args))
    }

    private runFunctionCore(name: string, args: any[]) {
        let argString = ""
        for (let i = 0; i < args.length; ++i) {
            const arg = "_arg" + i
            this.sandbox[arg] = args[i]
            if (argString) argString += ", "
            argString += arg
        }
        return `${name}(${argString})`
    }
}