import * as child_process from "child_process"
import * as util from "util"
import * as fs from "fs"
import * as path from "path"

const cpExecAsync = util.promisify(child_process.exec)
const readDirAsync = util.promisify(fs.readdir)

function getBoardDrivesAsync(compile: any): Promise<string[]> {
    if (process.platform == "win32") {
        const rx = new RegExp("^([A-Z]:)\\s+(\\d+).* " + compile.deployDrives)
        return cpExecAsync(
            "wmic PATH Win32_LogicalDisk get DeviceID, VolumeName, FileSystem, DriveType"
        ).then(({ stdout, stderr }) => {
            let res: string[] = []
            stdout.split(/\n/).forEach(ln => {
                let m = rx.exec(ln)
                if (m && m[2] == "2") {
                    res.push(m[1] + "/")
                }
            })
            return res
        })
    } else if (process.platform == "darwin") {
        const rx = new RegExp(compile.deployDrives)
        return readDirAsync("/Volumes").then(lst =>
            lst.filter(s => rx.test(s)).map(s => "/Volumes/" + s + "/")
        )
    } else if (process.platform == "linux") {
        const rx = new RegExp(compile.deployDrives)
        const user = process.env["USER"]
        if (fs.existsSync(`/media/${user}`))
            return readDirAsync(`/media/${user}`).then(lst =>
                lst.filter(s => rx.test(s)).map(s => `/media/${user}/${s}/`)
            )
        return Promise.resolve([])
    } else {
        return Promise.resolve([])
    }
}

function filteredDrives(compile: any, drives: string[]): string[] {
    const marker = compile.deployFileMarker
    if (!marker) return drives
    return drives.filter(d => {
        try {
            return fs.existsSync(path.join(d, marker))
        } catch (e) {
            return false
        }
    })
}

export async function getDeployDrivesAsync(compile: any) {
    const drives = await getBoardDrivesAsync(compile)
    return filteredDrives(compile, drives)
}
