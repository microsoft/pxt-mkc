
import * as vscode from 'vscode';
import * as mkc from '../../makecode/src/mkc';
import * as sim from './simulator';

// import { SimDebugAdapterDescriptorFactory } from './debug/debugAdapterDescriptorFactory';

const EMBED_DEBUG_ADAPTER = true;
let globalContext: vscode.ExtensionContext
let project: Project;

class Project extends mkc.Project {
    diagnostics: vscode.DiagnosticCollection;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('MKCD is active');

    globalContext = context

    let buildCMD = vscode.commands.registerCommand('extension.build', buildCommand);
    let simulateCMD = vscode.commands.registerCommand('extension.simulate', simulateCommand);
    //let createCMD = vscode.commands.registerCommand('extension.create', createCommand);

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


async function syncProjectAsync() {
    if (!project || project.directory != vscode.workspace.rootPath) {
        project = new Project(vscode.workspace.rootPath, mkc.files.mkHomeCache(globalContext.globalStoragePath))
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
    await syncProjectAsync()
    await project.buildAsync()
    progress.report({ increment: 90, message: "Installation complete" })
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

async function simulateCommand() {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (progress, token) => {
        progress.report({ increment: 10, message: "Loading editor..." })
        await syncProjectAsync()

        await vscode.commands.executeCommand("workbench.action.files.saveAll");

        // show the sim window first, before we start compiling to show progress
        let watcher: vscode.FileSystemWatcher;
        if (!sim.Simulator.currentSimulator) {
            watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.workspace.rootPath, "*.{ts,json}"), true, false, true);
            watcher.onDidChange(() => {
                vscode.commands.executeCommand("extension.simulate");
            });
        }

        sim.Simulator.createOrShow(project.cache);

        progress.report({ increment: 10, message: "Compiling..." })

        const res = await project.buildAsync()
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