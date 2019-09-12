import * as vscode from "vscode";

interface SimulatorRunMessage {
    type: "run";
    code: string;
}

export class Simulator {
    public static readonly viewType = "mkcdsim";
    public static currentSimulator: Simulator;
    public messageHandler: (msg: any) => void;

    public static createOrShow() {
        let column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : vscode.ViewColumn.One;
        column = column < 9 ? column + 1 : column;

        if (Simulator.currentSimulator) {
            Simulator.currentSimulator.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        const panel = vscode.window.createWebviewPanel(Simulator.viewType, "MakeCode Arcade Simulator", {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true
        }, {
            // Enable javascript in the webview
            enableScripts: true,
            retainContextWhenHidden: true
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
    }

    simulate(binaryJS: string) {
        this.binaryJS = binaryJS;
        this.panel.webview.html = ""
        this.panel.webview.html = simulatorHTML();
    }

    handleSimulatorMessage(message: any) {
        if (this.messageHandler) this.messageHandler(message);

        switch (message.type as string) {
            case "ready":
                console.log("Simulator ready")
                this.panel.webview.postMessage({
                    type: "run",
                    code: this.binaryJS,
                    // breakOnStart: true
                } as SimulatorRunMessage);
                break;
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

function simulatorHTML() {
    return `<!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>MakeCode Arcade Simulator</title>
                </head>
                <body>

                <script>
                (function() {
                    console.log("Init");
                    var frame;
                    var vscode = acquireVsCodeApi();
                    document.addEventListener("DOMContentLoaded", function(event) {
                        console.log("Registering handlers...")
                        frame = document.getElementById("sim-frame");
                        window.addEventListener("message", function(m) {
                            console.log("Got Message")

                            if (m.origin === "https://trg-arcade.userpxt.io") {
                                console.log("Forward to vscode");
                                vscode.postMessage(m.data);
                            }
                            else if (m.origin === "null") {
                                console.log("Forward to sim-frame");
                                frame.contentWindow.postMessage(m.data, "*");
                            }
                        });
                    });
                }())

                </script>
                <div style="height:100%; width:100%; padding:50px">
                    <iframe id="sim-frame" style="position:absolute;top:0;left:0;width:100%;height:100%;" src="https://trg-arcade.userpxt.io/---simulator" allowfullscreen="allowfullscreen" sandbox="allow-popups allow-forms allow-scripts allow-same-origin" frameborder="0">
                    </iframe>
                </div>
                </body>
    </html>`;
}