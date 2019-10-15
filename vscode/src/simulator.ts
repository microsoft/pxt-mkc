import * as vscode from "vscode";
import * as mkc from '../../makecode/src/mkc';

import * as fs from "fs";
import * as path from "path";

interface SimulatorRunMessage {
    type: "run";
    code: string;
    storedState: any;
}

let extensionContext: vscode.ExtensionContext;

function resPath(fn: string) {
    return path.join(extensionContext.extensionPath, "resources", fn)
}

function readResource(fn: string) {
    return fs.readFileSync(resPath(fn), "utf8")
}

export class Simulator {
    public static readonly viewType = "mkcdsim";
    public static currentSimulator: Simulator;
    public messageHandler: (msg: any) => void;
    public simState: any;
    public simStateTimer: NodeJS.Timeout;
    private simconsole: vscode.OutputChannel;

    public static createOrShow(extCtx: vscode.ExtensionContext, cache: mkc.Cache) {
        let column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;
        column = column < 9 ? column + 1 : column;

        extensionContext = extCtx

        if (Simulator.currentSimulator) {
            Simulator.currentSimulator.simState = null;
            Simulator.currentSimulator.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        const panel = vscode.window.createWebviewPanel(Simulator.viewType, "MakeCode Arcade Simulator", {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true,
        }, {
            // Enable javascript in the webview
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(cache.rootPath),
                vscode.Uri.file(resPath(""))
            ]
        });

        Simulator.currentSimulator = new Simulator(panel)
    }

    public static revive(panel: vscode.WebviewPanel) {
        Simulator.currentSimulator = new Simulator(panel)
    }

    protected panel: vscode.WebviewPanel;
    protected binaryJS: string;
    protected disposables: vscode.Disposable[];

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;

        this.panel.webview.onDidReceiveMessage(message => {
            this.handleSimulatorMessage(message);
        });

        this.panel.onDidDispose(() => {
            if (Simulator.currentSimulator === this) {
                Simulator.currentSimulator = undefined;
            }

            this.disposables.forEach(d => d.dispose());
        });

        this.disposables = [];

        this.simconsole = vscode.window.createOutputChannel("MakeCode")
    }

    async simulateAsync(binaryJS: string, editor: mkc.DownloadedEditor) {
        this.binaryJS = binaryJS;
        this.panel.webview.html = ""
        const simulatorHTML = readResource("simframe.html")
        if (this.simState == null) {
            this.simState = await extensionContext.workspaceState.get("simstate", {})
        }
        const pathURL = (s: string) =>
            this.panel.webview.asWebviewUri(vscode.Uri.file(s)).toString()
        this.panel.webview.html = simulatorHTML
            .replace("@SIMURL@", pathURL(editor.simUrl))
            .replace(/@RES@\/([\w\-\.]+)/g, (f, fn) => pathURL(resPath(fn)))
            .replace(/@CSP@/g, this.panel.webview.cspSource)
    }

    handleSimulatorMessage(message: any) {
        if (this.messageHandler) this.messageHandler(message);

        const runit = () => {
            const msg: SimulatorRunMessage = {
                type: "run",
                code: this.binaryJS,
                storedState: this.simState
                // breakOnStart: true
            }
            this.panel.webview.postMessage(msg);
        }

        switch (message.type as string) {
            case "ready":
                console.log("Simulator ready")
                runit()
                break;
            case "bulkserial":
                message.data.forEach((d: { data: string }) => this.simconsole.append(d.data))
                break
            case "button":
                switch (message.btnid) {
                    case "console":
                        this.simconsole.show()
                        break
                    case "build":
                        vscode.commands.executeCommand("makecode.build");
                        break
                    default:
                        console.log("unhandled button", JSON.stringify(message))
                        break
                }
                break
            case "simulator":
                switch (message.command) {
                    case "restart":
                        runit()
                        break
                    case "setstate":
                        this.simState[message.stateKey] = message.stateValue
                        if (this.simStateTimer == null) {
                            this.simStateTimer = setTimeout(() => {
                                this.simStateTimer = null
                                extensionContext.workspaceState.update("simstate", this.simState)
                            }, 500)
                        }
                        break
                    default:
                        console.log(JSON.stringify(message))
                }
                break
            default:
                console.log(JSON.stringify(message))
        }
    }

    onMessage(cb: (msg: any) => void) {
        this.messageHandler = cb;
    }

    postMessaage(msg: any) {
        this.panel.webview.postMessage(msg);
        console.log("sending", msg)
    }

    addDisposable(d: vscode.Disposable) {
        this.disposables.push(d);
    }
}
