let channelHandlers = {}

function addSimMessageHandler(channel: string, handler: () => void) {
    channelHandlers[channel] = handler
}

function makeCodeRun(options) {
    let code = ""
    let isReady = false
    let simState = {}
    let simStateChanged = false
    let started = false
    let meta = undefined
    let boardDefinition = undefined
    let simOrigin = undefined
    const selfId = options.selfId || "pxt" + Math.random()
    const tool = options.tool

    // hide scrollbar
    window.scrollTo(0, 1)

    const lckey = "pxt_frameid_" + tool
    if (!localStorage[lckey])
        localStorage[lckey] = "x" + Math.round(Math.random() * 2147483647)
    let frameid = localStorage[lckey]

    // init runtime
    initSimState()
    fetchCode()

    // helpers
    function fetchCode() {
        sendReq(options.js, function (c, status) {
            if (status != 200) return
            code = c
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

            // force local sim
            meta.simUrl = window.location.protocol + "//" + window.location.host + "/sim.html"

            // load simulator with correct version
            document
                .getElementById("simframe")
                .setAttribute("src", meta.simUrl + "#" + frameid)
            let m = /^https?:\/\/[^\/]+/.exec(meta.simUrl)
            simOrigin = m[0]
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
                            if (/localhost/.test(window.location.host)) {
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
                } else if (d.type === "messagepacket" && d.channel) {
                    if (
                        d.channel == "jacdac" &&
                        d.broadcast &&
                        window.parent != window
                    ) {
                        d.sender = selfId
                        window.parent.postMessage(d, "*")
                    }
                    const handler = channelHandlers[d.channel]
                    if (handler) {
                        try {
                            const buf = d.data
                            const str = uint8ArrayToString(buf)
                            const data = JSON.parse(str)
                            handler(data)
                        } catch (e) {
                            console.log(`invalid simmessage`)
                            console.log(e)
                        }
                    }
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
            }
        },
        false
    )

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

    function sendReq(url, cb) {
        let xhttp = new XMLHttpRequest()
        xhttp.onreadystatechange = function () {
            if (xhttp.readyState == 4) {
                cb(xhttp.responseText, xhttp.status)
            }
        }
        xhttp.open("GET", url, true)
        xhttp.send()
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
}
