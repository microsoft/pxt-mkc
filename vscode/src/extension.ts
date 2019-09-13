
import * as vscode from 'vscode';
import * as mkc from 'makecode';
import * as sim from './simulator';

// import { SimDebugAdapterDescriptorFactory } from './debug/debugAdapterDescriptorFactory';

const EMBED_DEBUG_ADAPTER = true;
let globalContext: vscode.ExtensionContext

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

let project: mkc.Project;

function syncProject() {
    if (!project || project.directory != vscode.workspace.rootPath) {
        project = new mkc.Project(vscode.workspace.rootPath, mkc.files.mkHomeCache(globalContext.globalStoragePath))
    }
}

async function doInstall(progress: vscode.Progress<{ increment: number, message: string }>, token: vscode.CancellationToken) {
    syncProject()
    await project.buildAsync()
    progress.report({ increment: 100, message: "Installation complete" })
}

async function buildCommand() {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, doInstall);
}

async function simulateCommand() {
    syncProject()

    const res = await project.buildAsync()

    const binJs = res.outfiles["binary.js"]

    if (!binJs)
        return

    let watcher: vscode.FileSystemWatcher;
    if (!sim.Simulator.currentSimulator) {
        watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.workspace.rootPath, "*.{ts,json}"), true, false, true);
        watcher.onDidChange(() => {
            vscode.commands.executeCommand("extension.simulate");
        });
    }

    sim.Simulator.createOrShow();
    sim.Simulator.currentSimulator.simulate(binJs);
    if (watcher) sim.Simulator.currentSimulator.addDisposable(watcher);
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