export const simloaderFiles: Record<string, string> = {
"loader.js": `let channelHandlers = {};
function addSimMessageHandler(channel, handler, init) {
    channelHandlers[channel] = {
        channel: channel,
        init: init,
        handler: handler,
    };
}
function makeCodeRun(options) {
    let code = "";
    let code0 = "";
    let isReady = false;
    let simState = {};
    let simStateChanged = false;
    let started = false;
    let meta = undefined;
    let boardDefinition = undefined;
    let simOrigin = undefined;
    const selfId = options.selfId || "pxt" + Math.random();
    const tool = options.tool;
    const isLocalHost = /^(localhost|127\\.0\\.0\\.1)(:|\$)/i.test(window.location.host);
    // hide scrollbar
    window.scrollTo(0, 1);
    const lckey = "pxt_frameid_" + tool;
    if (!localStorage[lckey])
        localStorage[lckey] = "x" + Math.round(Math.random() * 2147483647);
    let frameid = localStorage[lckey];
    // init runtime
    initSimState();
    startCode();
    if (isLocalHost)
        autoReload();
    function fetchSourceCode() {
        return fetch(options.js)
            .then(resp => resp.status == 200 ? resp.text() : undefined);
    }
    // helpers
    function autoReload() {
        setInterval(() => {
            fetchSourceCode()
                .then(c => {
                if (c && c != code0)
                    window.location.reload();
            });
        }, 1000);
    }
    function startCode() {
        fetchSourceCode()
            .then(c => {
            if (!c)
                return;
            code0 = code = c;
            // find metadata
            code.replace(/^\\/\\/\\s+meta=([^\\n]+)\\n/m, function (m, metasrc) {
                meta = JSON.parse(metasrc);
                return "";
            });
            code.replace(/^\\/\\/\\s+boardDefinition=([^\\n]+)\\n/m, function (m, metasrc) {
                boardDefinition = JSON.parse(metasrc);
                return "";
            });
            document.body.dataset.version = meta === null || meta === void 0 ? void 0 : meta.version;
            // force local sim
            if (isLocalHost)
                meta.simUrl = window.location.protocol + "//" + window.location.host + \`/sim.html\${window.location.search || ""}\`;
            const ap = document.getElementById("download-a");
            if (meta.version && ap && ap.download)
                ap.download = ap.download.replace(/VERSION/, meta.version);
            // load simulator with correct version
            document
                .getElementById("simframe")
                .setAttribute("src", meta.simUrl + "#" + frameid);
            let m = /^https?:\\/\\/[^\\/]+/.exec(meta.simUrl);
            simOrigin = m[0];
            initFullScreen();
        });
    }
    function startSim() {
        if (!code || !isReady || started)
            return;
        setState("run");
        started = true;
        const runMsg = {
            type: "run",
            parts: [],
            builtinParts: [],
            code: code,
            partDefinitions: {},
            fnArgs: {},
            cdnUrl: meta.cdnUrl,
            version: meta.target,
            storedState: simState,
            frameCounter: 1,
            boardDefinition: boardDefinition,
            options: {
                theme: "green",
                player: "",
            },
            id: "green-" + Math.random(),
        };
        postMessage(runMsg);
    }
    function stopSim() {
        setState("stopped");
        postMessage({
            type: "stop",
        });
        started = false;
    }
    window.addEventListener("message", function (ev) {
        let d = ev.data;
        // console.debug(ev.origin, d)
        if (ev.origin == simOrigin) {
            if (d.type == "ready") {
                let loader = document.getElementById("loader");
                if (loader)
                    loader.remove();
                isReady = true;
                startSim();
            }
            else if (d.type == "simulator") {
                switch (d.command) {
                    case "restart":
                        if (isLocalHost) {
                            window.location.reload();
                        }
                        else {
                            stopSim();
                            startSim();
                        }
                        break;
                    case "setstate":
                        if (d.stateValue === null)
                            delete simState[d.stateKey];
                        else
                            simState[d.stateKey] = d.stateValue;
                        simStateChanged = true;
                        break;
                }
            }
            else if (d.type === "debugger") {
                // console.log("dbg", d)
                let brk = d;
                let stackTrace = brk.exceptionMessage + "\\n";
                for (let s of brk.stackframes) {
                    let fi = s.funcInfo;
                    stackTrace += \`   at \${fi.functionName} (\${fi.fileName}:\${fi.line + 1}:\${fi.column + 1})\\n\`;
                }
                if (brk.exceptionMessage)
                    console.error(stackTrace);
            }
            else if (d.type === "messagepacket" && d.channel) {
                if (d.channel == "jacdac" &&
                    d.broadcast &&
                    window.parent != window) {
                    d.sender = selfId;
                    window.parent.postMessage(d, "*");
                }
                const ch = channelHandlers[d.channel];
                if (ch) {
                    try {
                        ch.handler(d.data);
                    }
                    catch (e) {
                        console.log(\`invalid simmessage\`);
                        console.log(e);
                    }
                }
            }
        }
        else {
            if (d.type == "messagepacket" &&
                d.channel == "jacdac" &&
                d.sender != selfId) {
                postMessage(d);
            }
            else if (d.type == "reload") {
                window.location.reload();
            }
        }
    }, false);
    // initialize simmessages
    Object.keys(channelHandlers)
        .map(k => channelHandlers[k])
        .filter(ch => !!ch.init)
        .forEach(ch => {
        const send = (msg) => postMessage({
            type: "messagepacket",
            channel: ch.channel,
            data: msg
        });
        ch.init({ send });
    });
    // helpers
    function uint8ArrayToString(input) {
        let len = input.length;
        let res = "";
        for (let i = 0; i < len; ++i)
            res += String.fromCharCode(input[i]);
        return res;
    }
    function setState(st) {
        let r = document.getElementById("root");
        if (r)
            r.setAttribute("data-state", st);
    }
    function postMessage(msg) {
        const frame = document.getElementById("simframe");
        if (meta && frame)
            frame.contentWindow.postMessage(msg, meta.simUrl);
    }
    function initSimState() {
        try {
            simState = JSON.parse(localStorage["pxt_simstate"]);
        }
        catch (e) {
            simState = {};
        }
        setInterval(function () {
            if (simStateChanged)
                localStorage["pxt_simstate"] = JSON.stringify(simState);
            simStateChanged = false;
        }, 200);
    }
    function initFullScreen() {
        var sim = document.getElementById("simframe");
        var fs = document.getElementById("fullscreen");
        if (fs && sim.requestFullscreen) {
            fs.onclick = function () { sim.requestFullscreen(); };
        }
        else if (fs) {
            fs.remove();
        }
    }
}
`,
"index.html": `<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8" />
        <script type="text/javascript" src="loader.js"></script>
        <script type="text/javascript" src="custom.js"></script>
        <title>MakeCode Simulator Driver</title>
        <style>
            body {
                background: transparent;
                color: black;
                font-family: monospace;
                overflow: hidden;
                font-size: 14pt;
            }

            @media (prefers-color-scheme: dark) {
                body {
                    color: white;
                }
            }

            iframe {
                position: absolute;
                top: 30px;
                left: 0;
                aspect-ratio: 16/9;
                width: calc(100vw - 4rem);
                height: calc(100vh - 4rem);
                border: none;
                margin: 1rem;
            }
            #fullscreen {
                position: absolute;
                right: 0.25rem;
                bottom: 0;
                cursor: pointer;
            }
            .lds-ripple {
                width: 80px;
                height: 80px;
                margin: auto;
                position: absolute;
                margin: auto;
                top: 0;
                right: 0;
                bottom: 0;
                left: 0;
                z-index: -1;
            }

            .lds-ripple div {
                position: absolute;
                border: 4px solid #fff;
                opacity: 1;
                border-radius: 50%;
                animation: lds-ripple 1s cubic-bezier(0, 0.2, 0.8, 1) infinite;
            }

            .lds-ripple div:nth-child(2) {
                animation-delay: -0.5s;
            }

            @keyframes lds-ripple {
                0% {
                    top: 36px;
                    left: 36px;
                    width: 0;
                    height: 0;
                    opacity: 1;
                }

                100% {
                    top: 0px;
                    left: 0px;
                    width: 72px;
                    height: 72px;
                    opacity: 0;
                }
            }
        </style>
    </head>

    <body id="root">
        <div id="loader" class="lds-ripple">
            <div></div>
            <div></div>
            <svg
                viewBox="0 0 134 134"
                xmlns="http://www.w3.org/2000/svg"
                fill-rule="evenodd"
                clip-rule="evenodd"
                stroke-linejoin="round"
                stroke-miterlimit="2"
            >
                <path
                    d="M77.191 19.583a7.537 7.537 0 00-7.533-7.534h-4.692a7.538 7.538 0 00-7.534 7.534v91.633a7.538 7.538 0 007.534 7.534h4.692a7.537 7.537 0 007.533-7.534V19.583zm24.892 10.72a7.536 7.536 0 00-7.534-7.533h-4.691a7.537 7.537 0 00-7.534 7.533v80.913a7.538 7.538 0 007.534 7.534h4.691a7.537 7.537 0 007.534-7.534V30.303zm-50.67-10.72a7.537 7.537 0 00-7.533-7.534h-4.692a7.538 7.538 0 00-7.534 7.534v91.633a7.538 7.538 0 007.534 7.534h4.692a7.537 7.537 0 007.533-7.534V19.583zm-9.879 83.553a6.113 6.113 0 016.11 6.11 6.113 6.113 0 01-6.11 6.11 6.113 6.113 0 01-6.11-6.11 6.113 6.113 0 016.11-6.11zm25.778 0a6.113 6.113 0 016.11 6.11 6.113 6.113 0 01-6.11 6.11 6.113 6.113 0 01-6.11-6.11 6.113 6.113 0 016.11-6.11zm24.892 0a6.113 6.113 0 016.11 6.11 6.113 6.113 0 01-6.11 6.11 6.113 6.113 0 01-6.11-6.11 6.113 6.113 0 016.11-6.11z"
                    fill="#ffd100"
                />
            </svg>
        </div>
        <iframe
            id="simframe"
            allowfullscreen="allowfullscreen"
            sandbox="allow-popups allow-forms allow-scripts allow-same-origin"
        >
        </iframe>
        <div id="fullscreen">⇲</div>
        <script type="text/javascript">
            makeCodeRun({
                selfId: window.location.hash.slice(1),
                js: "binary.js",
            })
        </script>
    </body>
</html>
`,
"custom.js": `// can be replaced by assets/custom.js
`,
}
