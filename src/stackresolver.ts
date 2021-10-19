export function resolveAddr(sourceMap: Record<string, number[]>, addr: number) {
    const offsets = [-2, -4, 0]
    let hit = ""
    let bestOffset: number = undefined
    if (addr == 2)
        return "<bottom>"
    for (const fn of Object.keys(sourceMap)) {
        const vals = sourceMap[fn]
        for (let i = 0; i < vals.length; i += 3) {
            const lineNo = vals[i]
            const startA = vals[i + 1]
            const endA = startA + vals[i + 2]
            if (addr + 10 >= startA && addr - 10 <= endA) {
                for (const off of offsets) {
                    if (startA <= addr + off && addr + off <= endA) {
                        if (!hit || offsets.indexOf(off) < offsets.indexOf(bestOffset)) {
                            hit = fn + "(" + lineNo + ")"
                            bestOffset = off
                        }
                    }
                }
            }
        }
    }
    return hit
}

export function expandStackTrace(sourceMap: Record<string, number[]>, stackTrace: string) {
    return stackTrace.replace(/(^| )PC:0x([A-F0-9]+)/g, (full, space, num) => {
        const n = resolveAddr(sourceMap, parseInt(num, 16)) || "???"
        return " " + n + " (0x" + num + ")"
    })
}
