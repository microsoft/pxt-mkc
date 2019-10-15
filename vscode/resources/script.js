(function () {
    console.log("Init");
    var frame;
    var vscode = acquireVsCodeApi();
    document.addEventListener("DOMContentLoaded", function (event) {
        console.log("Registering handlers...")
        frame = document.getElementById("sim-frame");
        window.addEventListener("message", function (m) {
            console.log("Got Message", m.origin)

            if (m.origin === "vscode-resource://") {
                console.log("Forward to vscode");
                vscode.postMessage(m.data);
            } else if (m.origin === "null") {
                console.log("Forward to sim-frame");
                frame.contentWindow.postMessage(m.data, "*");
            }
        });
        ["build", "console"].forEach(id => {
            document.getElementById("btn-" + id).addEventListener("click", () => {
                vscode.postMessage({ type: "button", btnid: id });
            })
        })
    });
}())
