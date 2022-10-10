import { Host } from "./host";
import { glob } from "glob"
import * as fs from "fs"
import * as util from "util"

export function createNodeHost(): Host {
    return {
        readFileAsync: util.promisify(fs.readFile),
        writeFileAsync: util.promisify(fs.writeFile),
        mkdirAsync: util.promisify(fs.mkdir),
        existsAsync: util.promisify(fs.exists),
        unlinkAsync: util.promisify(fs.unlink),
        symlinkAsync: util.promisify(fs.symlink),
        listFilesAsync: async (directory, filename) =>
            glob.sync(directory + "/**/" + filename)
    }
}