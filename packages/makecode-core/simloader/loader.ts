type InitFn = (props: { send: (msg: Uint8Array) => void }) => void
type HandlerFn = {
    channel: string,
    handler: (data: Uint8Array) => void,
    init: InitFn
}

let channelHandlers: { [name: string]: HandlerFn } = {}
let _vsapi: any

function addSimMessageHandler(
    channel: string,
    handler: (data: any) => void,
    init: (props: { send: (msg: Uint8Array) => void }) => void
) {
    channelHandlers[channel] = {
        channel: channel,
        init: init,
        handler: handler,
    }
}


const pendingMessages: {[index: string]: (result: string) => void} = {};
let nextMessageId = 0;

function makeCodeRun(options) {
    let code = ""
    let code0 = ""
    let isReady = false
    let simState = {}
    let simStateChanged = false
    let started = false
    let meta = undefined
    let boardDefinition = undefined
    let simOrigin = undefined
    const selfId = options.selfId || "pxt" + Math.random()
    const tool = options.tool
    const isLocalHost = /^(localhost|127\.0\.0\.1)(:|$)/i.test(window.location.host)

    // hide scrollbar
    window.scrollTo(0, 1)

    const lckey = "pxt_frameid_" + tool
    if (!localStorage[lckey])
        localStorage[lckey] = "x" + Math.round(Math.random() * 2147483647)
    let frameid = localStorage[lckey]

    // init runtime
    initSimState()
    startCode()
    if (isLocalHost)
        autoReload()

    function fetchSourceCode() {
        if (options.usePostMessage) {
            return postMessageToParentAsync({
                type: "fetch-js"
            });
        }
        return fetch(options.js)
            .then(resp => resp.status == 200 ? resp.text() : undefined)
    }

    // helpers
    function autoReload() {
        setInterval(() => {
            fetchSourceCode()
                .then(c => {
                    if (c && c != code0)
                        window.location.reload();
                })
        }, 1000)
    }
    function startCode() {
        fetchSourceCode()
            .then(c => {
                if (!c) return
                code0 = code = c
                // find metadata
                code.replace(/^\/\/\s+meta=([^\n]+)\n/m, function (m, metasrc) {
                    meta = JSON.parse(metasrc)
                    return ""
                })
                code.replace(
                    /^\/\/\s+boardDefinition=([^\n]+)\n/m,
                    function (m, metasrc) {
                        boardDefinition = JSON.parse(metasrc)
                        return ""
                    }
                )
                document.body.dataset.version = meta?.version
                // force local sim
                if (isLocalHost)
                    meta.simUrl = window.location.protocol + "//" + window.location.host + `/sim.html${window.location.search || ""}`

                const ap = document.getElementById("download-a") as HTMLAnchorElement
                if (meta.version && ap && ap.download)
                    ap.download = ap.download.replace(/VERSION/, meta.version)

                // load simulator with correct version
                document
                    .getElementById("simframe")
                    .setAttribute("src", meta.simUrl + "#" + frameid)
                let m = /^https?:\/\/[^\/]+/.exec(meta.simUrl)
                simOrigin = m[0]
                initFullScreen()
            })
    }

    function startSim() {
        if (!code || !isReady || started) return
        setState("run")
        started = true
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
        }
        postMessage(runMsg)
    }

    function stopSim() {
        setState("stopped")
        postMessage({
            type: "stop",
        })
        started = false
    }

    window.addEventListener(
        "message",
        function (ev) {
            let d = ev.data
            // console.debug(ev.origin, d)
            if (ev.origin == simOrigin) {
                if (d.type == "ready") {
                    let loader = document.getElementById("loader")
                    if (loader) loader.remove()
                    isReady = true
                    startSim()
                } else if (d.type == "simulator") {
                    switch (d.command) {
                        case "restart":
                            if (isLocalHost) {
                                window.location.reload();
                            } else {
                                stopSim();
                                startSim();
                            }
                            break
                        case "setstate":
                            if (d.stateValue === null)
                                delete simState[d.stateKey]
                            else simState[d.stateKey] = d.stateValue
                            simStateChanged = true
                            break
                    }
                } else if (d.type === "debugger") {
                    // console.log("dbg", d)
                    let brk = d
                    let stackTrace = brk.exceptionMessage + "\n"
                    for (let s of brk.stackframes) {
                        let fi = s.funcInfo
                        stackTrace += `   at ${fi.functionName} (${fi.fileName
                            }:${fi.line + 1}:${fi.column + 1})\n`
                    }
                    if (brk.exceptionMessage) console.error(stackTrace)
                    postMessageToParentAsync(d);
                } else if (d.type === "messagepacket" && d.channel) {
                    if (
                        d.channel == "jacdac" &&
                        d.broadcast &&
                        window.parent != window
                    ) {
                        d.sender = selfId
                        window.parent.postMessage(d, "*")
                    }
                    const ch = channelHandlers[d.channel]
                    if (ch) {
                        try {
                            ch.handler(d.data)
                        } catch (e) {
                            console.log(`invalid simmessage`)
                            console.log(e)
                        }
                    }
                }
                else if (d.type === "bulkserial") {
                    postMessageToParentAsync(d);
                }
            } else {
                if (
                    d.type == "messagepacket" &&
                    d.channel == "jacdac" &&
                    d.sender != selfId
                ) {
                    postMessage(d)
                } else if (d.type == "reload") {
                    window.location.reload()
                }
                else if (d.type == "fetch-js") {
                    pendingMessages[d.id](d.text);
                    delete pendingMessages[d.id];
                }
            }
        },
        false
    )

    // initialize simmessages
    Object.keys(channelHandlers)
        .map(k => channelHandlers[k])
        .filter(ch => !!ch.init)
        .forEach(ch => {
            const send = (msg) => postMessage({
                type: "messagepacket",
                channel: ch.channel,
                data: msg
            })
            ch.init({ send });
        })

    // helpers
    function uint8ArrayToString(input) {
        let len = input.length
        let res = ""
        for (let i = 0; i < len; ++i) res += String.fromCharCode(input[i])
        return res
    }

    function setState(st) {
        let r = document.getElementById("root")
        if (r) r.setAttribute("data-state", st)
    }

    function postMessage(msg) {
        const frame = document.getElementById("simframe") as HTMLIFrameElement
        if (meta && frame) frame.contentWindow.postMessage(msg, meta.simUrl)
    }

    function initSimState() {
        try {
            simState = JSON.parse(localStorage["pxt_simstate"])
        } catch (e) {
            simState = {}
        }
        setInterval(function () {
            if (simStateChanged)
                localStorage["pxt_simstate"] = JSON.stringify(simState)
            simStateChanged = false
        }, 200)
    }

    function initFullScreen() {
        var sim = document.getElementById("simframe");
        var fs = document.getElementById("fullscreen");
        if (fs && sim.requestFullscreen) {
            fs.onclick = function () { sim.requestFullscreen(); }
        } else if (fs) {
            fs.remove();
        }
    }

    function postMessageToParentAsync(message: any) {
        return new Promise<string>(resolve => {
            message.id = nextMessageId++;
            pendingMessages[message.id] = resolve;
            if ((window as any).acquireVsCodeApi) {
                if (!_vsapi) {
                    _vsapi = (window as any).acquireVsCodeApi();
                }
                _vsapi.postMessage(message);
            }
            else {
                window.postMessage(message);
            }
        });
    }
}
