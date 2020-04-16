
import * as vscode from 'vscode';
import * as mkc from '../../makecode/src/mkc';
import * as sim from './simulator';

// import { SimDebugAdapterDescriptorFactory } from './debug/debugAdapterDescriptorFactory';

let globalContext: vscode.ExtensionContext
let project: Project;
let currFolder: vscode.WorkspaceFolder

class Project extends mkc.Project {
    diagnostics: vscode.DiagnosticCollection;

    fileUri(filename: string) {
        const duri = vscode.Uri.parse(this.directory)
        return duri.with({ path: duri.path + "/" + filename })
    }

    protected async readFileAsync(filename: string) {
        const data = await vscode.workspace.fs.readFile(this.fileUri(filename))
        return Buffer.from(data).toString("utf8")
    }

    protected async writeFilesAsync(folder: string, outfiles: pxt.Map<string>) {
        await vscode.workspace.fs.createDirectory(this.fileUri(folder))
        for (let fn of Object.keys(outfiles)) {
            if (fn.indexOf("/") >= 0)
                continue
            const data = Buffer.from(outfiles[fn], "utf8")
            const uri = this.fileUri(folder + "/" + fn)
            const curr = await vscode.workspace.fs.readFile(uri).then(v => v, err => null as Uint8Array)
            // without this check, writing pxt_modules takes a few seconds
            // with it, it still takes 0.3s
            if (curr && data.equals(curr))
                continue
            await vscode.workspace.fs.writeFile(uri, data)
        }
    }

    protected saveBuiltFilesAsync(res: mkc.service.CompileResult) {
        return this.writeFilesAsync("built", res.outfiles || {})
    }

    protected async savePxtModulesAsync(ws: mkc.Workspace) {
        await vscode.workspace.fs.createDirectory(this.fileUri("pxt_modules"))
        for (let k of Object.keys(ws.packages)) {
            if (k == "this")
                continue
            await this.writeFilesAsync("pxt_modules/" + k, ws.packages[k].files)
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('MKCD is active');

    globalContext = context

    const addCmd = (id: string, fn: () => Promise<void>) => {
        const cmd = vscode.commands.registerCommand(id, () => fn()
            .then(() => { }, err => {
                console.error("MakeCode Ext Exception", err)
            }));
        context.subscriptions.push(cmd);
    }

    addCmd('makecode.build', buildCommand)
    addCmd('makecode.simulate', simulateCommand)
    addCmd('makecode.choosehw', choosehwCommand)
    addCmd('makecode.create', createCommand)

    vscode.workspace.onDidChangeWorkspaceFolders(chg => {
        currFolder = null
    })

    if (vscode.window.registerWebviewPanelSerializer) {
        // Make sure we register a serilizer in activation event
        vscode.window.registerWebviewPanelSerializer(sim.Simulator.viewType, {
            async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
                console.log(`Got state: ${state}`);
                sim.Simulator.revive(webviewPanel);
            }
        });
    }

    /*
    if (EMBED_DEBUG_ADAPTER) {
        const factory = new SimDebugAdapterDescriptorFactory();
        context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('makecode', factory));
        context.subscriptions.push(factory);
    }
    */
}

// this method is called when your extension is deactivated
export function deactivate() {

}

async function currentWsFolderAsync() {
    if (currFolder)
        return currFolder
    const folds = vscode.workspace.workspaceFolders
    if (folds && folds.length == 1) {
        currFolder = folds[0]
    } else {
        currFolder = await vscode.window.showWorkspaceFolderPick()
    }
    // vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    return currFolder
}

async function syncProjectAsync() {
    const currWsFolderName = (await currentWsFolderAsync()).uri.toString()
    const currhw: string = await globalContext.workspaceState.get("hw") || ""
    if (!project || project.directory != currWsFolderName || project.hwVariant != currhw) {
        project = new Project(currWsFolderName, mkc.files.mkHomeCache(globalContext.globalStoragePath))
        project.hwVariant = currhw.replace(/hw---/, "")
        console.log("cache: " + project.cache.rootPath)
        try {
            await project.loadEditorAsync()
        } catch (e) {
            console.error("error loading editor", e)
            vscode.window.showWarningMessage("Failed to load MakeCode editor")
            throw e
        }
        project.updateEditorAsync()
            .then(isUpdated => {
                if (isUpdated) {
                    vscode.window.showInformationMessage("MakeCode editor updated")
                    console.log("Updated editor!")
                    // TODO do something?
                }
            }, err => {
                // generally, ignore errors
                vscode.window.showWarningMessage("Failed to check for MakeCode editor updates")
                console.log("Error updating", err)
            })
    }
}

async function doBuild(progress: vscode.Progress<{ increment: number, message: string }>, token: vscode.CancellationToken) {
    let hw = await globalContext.workspaceState.get("hw")
    if (!hw) {
        await choosehwCommand()
        hw = await globalContext.workspaceState.get("hw")
        if (!hw)
            return
    }
    progress.report({ increment: 10, message: "Compiling..." })
    await justBuild(true)
    progress.report({ increment: 90, message: "Compilation complete" })
}

async function buildCommand() {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, doBuild);
}

function setDiags(ds: mkc.service.KsDiagnostic[]) {
    if (!ds) ds = []
    const byFile: pxt.Map<vscode.Diagnostic[]> = {}

    for (let d of ds) {
        if (d.endLine == null)
            d.endLine = d.line
        if (d.endColumn == null)
            d.endColumn = d.column + d.length
        const range = new vscode.Range(d.line, d.column, d.endLine, d.endColumn);
        const diagnostic = new vscode.Diagnostic(range, d.messageText,
            d.category == mkc.service.DiagnosticCategory.Message ?
                vscode.DiagnosticSeverity.Information :
                d.category == mkc.service.DiagnosticCategory.Warning ?
                    vscode.DiagnosticSeverity.Warning :
                    vscode.DiagnosticSeverity.Error);
        diagnostic.code = d.code;
        if (!byFile[d.fileName]) byFile[d.fileName] = []
        byFile[d.fileName].push(diagnostic)
    }

    if (!project.diagnostics)
        project.diagnostics = vscode.languages.createDiagnosticCollection("mkcd")

    project.diagnostics.clear()
    project.diagnostics.set(
        Object.keys(byFile).map(fn => [project.fileUri(fn), byFile[fn]]))
}

async function justBuild(native = false) {
    try {
        await syncProjectAsync()
        console.time("build-inner")
        const res = await project.buildAsync({ native })
        console.timeEnd("build-inner")
        return res
    } catch (e) {
        vscode.window.showWarningMessage("Failed to compile!")
        console.error("compilation error", e)
        const r: mkc.service.CompileResult = {
            outfiles: {},
            diagnostics: [],
            success: false,
            times: {},
        }
        return r
    }
}


// Returns a function, that, as long as it continues to be invoked, will only
// trigger every N milliseconds. If `immediate` is passed, trigger the
// function on the leading edge, instead of the trailing.
export function throttle(func: (...args: any[]) => any, wait: number, immediate?: boolean): any {
    let timeout: any;
    return function (this: any) {
        let context = this;
        let args = arguments;
        let later = function () {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        let callNow = immediate && !timeout;
        if (!timeout) timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

async function choosehwCommand() {
    await syncProjectAsync()
    const cfgs: pxt.PackageConfig[] = project.service.runSync("pxt.getHwVariants()")
    console.log(cfgs)
    const items = cfgs.map(cfg => ({ label: cfg.card.name, description: cfg.card.description, id: cfg.name }))
    const chosen = await vscode.window.showQuickPick(items)
    if (chosen) {
        await globalContext.workspaceState.update("hw", chosen.id)
        await syncProjectAsync()
    }
}

async function simulateCommand() {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (progress, token) => {
        progress.report({ increment: 10, message: "Loading editor..." })

        await syncProjectAsync()
        await vscode.commands.executeCommand("workbench.action.files.saveAll");

        // show the sim window first, before we start compiling to show progress
        let watcher: vscode.FileSystemWatcher;
        if (!sim.Simulator.currentSimulator) {
            watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(await currentWsFolderAsync(), "*.{ts,json}"), true, false, true);
            watcher.onDidChange(throttle(() => {
                vscode.commands.executeCommand("makecode.simulate");
            }, 1000, true));
        }

        sim.Simulator.createOrShow(globalContext, project.cache);
        if (watcher) sim.Simulator.currentSimulator.addDisposable(watcher);

        progress.report({ increment: 20, message: "Compiling..." })

        const res = await justBuild()
        //if (res.diagnostics.length)
        //    vscode.window.setStatusBarMessage("Programs has errors")
        setDiags(res.diagnostics)
        const binJs = res.outfiles["binary.js"]
        if (res.success && binJs) {
            await sim.Simulator.currentSimulator.simulateAsync(binJs, project.editor);
            progress.report({ increment: 100, message: "Simulation starting" })
        }
    });
}

async function createCommand() {
    const folderURI = (await currentWsFolderAsync()).uri
    const fileURI = (filename: string) =>
        folderURI.with({ path: folderURI.path + "/" + filename })

    const pxtJSON: Uint8Array = await vscode.workspace.fs.readFile(fileURI("pxt.json"))
        .then(r => r, err => null)

    if (pxtJSON && pxtJSON.length > 5) {
        vscode.window.showErrorMessage("Project already created")
        return;
    }

    const target = await vscode.window.showQuickPick(mkc.loader.descriptors.map(d => ({
        id: d.id,
        label: d.name,
        description: d.description
    })))

    if (!target)
        return

    const targetDesc = mkc.loader.descriptors.find(d => d.id == target.id)
    const cache = mkc.files.mkHomeCache()
    const newEditor = await mkc.downloader.downloadAsync(cache, targetDesc.website, true)
    const service = new mkc.service.Ctx(newEditor)
    const files = service.runFunctionSync("pxt.packageFiles", ["no name"])
    service.runFunctionSync("pxt.packageFilesFixup", [files])

    for (let fn of Object.keys(files)) {
        if (fn == ".vscode/tasks.json")
            continue // this uses legacy CLI
        const dir = fn.split("/")
        dir.pop()
        for (let i = 0; i < dir.length; ++i) {
            await vscode.workspace.fs.createDirectory(fileURI(dir.slice(0, i + 1).join("/"))).then(() => { }, () => { })
        }
        await vscode.workspace.fs.writeFile(fileURI(fn), Buffer.from(files[fn], "utf8"))
    }

    /*
    for (const file of Object.keys(projectFiles.files)) {
        if (!await util.existsAsync(path.join(vscode.workspace.rootPath, file))) {
            await util.writefileAsync(path.join(vscode.workspace.rootPath, file), projectFiles.files[file].trim() + "\n");
        }
    }
    */
}
