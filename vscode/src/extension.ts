
import * as vscode from 'vscode';
import * as mkc from '../../makecode/src/mkc';
import * as sim from './simulator';

// import { SimDebugAdapterDescriptorFactory } from './debug/debugAdapterDescriptorFactory';

let globalContext: vscode.ExtensionContext
let project: Project;

class Project extends mkc.Project {
    diagnostics: vscode.DiagnosticCollection;

    protected fileUri(filename: string) {
        const duri = vscode.Uri.parse(this.directory)
        return duri.with({ path: duri.path + "/" + filename })
    }

    protected async readFileAsync(filename: string) {
        const data = await vscode.workspace.fs.readFile(this.fileUri(filename))
        return new Buffer(data).toString("utf8")
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

    let buildCMD = vscode.commands.registerCommand('makecode.build', buildCommand);
    let simulateCMD = vscode.commands.registerCommand('makecode.simulate', simulateCommand);
    //let createCMD = vscode.commands.registerCommand('makecode.create', createCommand);

    context.subscriptions.push(buildCMD);
    context.subscriptions.push(simulateCMD);
    //context.subscriptions.push(createCMD);

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

function currentWsFolder() {
    return vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
}

async function syncProjectAsync() {
    const currWsFolderName = currentWsFolder().uri.toString()
    if (!project || project.directory != currWsFolderName) {
        project = new Project(currWsFolderName, mkc.files.mkHomeCache(globalContext.globalStoragePath))
        console.log("cache: " + project.cache.rootPath)
        await project.loadEditorAsync()
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
    progress.report({ increment: 10, message: "Compiling..." })
    await justBuild()
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
        Object.keys(byFile).map(fn => [vscode.Uri.file(project.directory + "/" + fn), byFile[fn]]))
}

async function justBuild() {
    try {
        await syncProjectAsync()
        console.log("building...")
        const res = await project.buildAsync()
        console.log("done building")
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

async function simulateCommand() {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (progress, token) => {
        progress.report({ increment: 10, message: "Loading editor..." })

        await syncProjectAsync()
        await vscode.commands.executeCommand("workbench.action.files.saveAll");

        // show the sim window first, before we start compiling to show progress
        let watcher: vscode.FileSystemWatcher;
        if (!sim.Simulator.currentSimulator) {
            watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(currentWsFolder(), "*.{ts,json}"), true, false, true);
            watcher.onDidChange(() => {
                vscode.commands.executeCommand("makecode.simulate");
            });
        }

        sim.Simulator.createOrShow(project.cache);

        progress.report({ increment: 10, message: "Compiling..." })

        const res = await justBuild()
        setDiags(res.diagnostics)
        const binJs = res.outfiles["binary.js"]
        if (binJs) {
            sim.Simulator.currentSimulator.simulate(binJs, project.editor);
            if (watcher) sim.Simulator.currentSimulator.addDisposable(watcher);
            progress.report({ increment: 100, message: "Simulation starting" })
        }
    });
}

/*
async function createCommand() {
    if ((await util.existsAsync(path.join(vscode.workspace.rootPath, "pxt.json"))) || (await util.existsAsync(path.join(vscode.workspace.rootPath, "mkcd.json")))) {
        vscode.window.showErrorMessage("Project already created")
        return;
    }

    for (const file of Object.keys(projectFiles.files)) {
        if (!await util.existsAsync(path.join(vscode.workspace.rootPath, file))) {
            await util.writefileAsync(path.join(vscode.workspace.rootPath, file), projectFiles.files[file].trim() + "\n");
        }
    }
}
*/