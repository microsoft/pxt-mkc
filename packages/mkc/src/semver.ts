export interface Version {
    major: number;
    minor: number;
    patch: number;
    pre: string[];
    build: string[];
}

export function cmp(a: Version, b: Version) {
    if (!a)
        if (!b)
            return 0;
        else
            return 1;
    else if (!b)
        return -1;
    else {
        let d = a.major - b.major || a.minor - b.minor || a.patch - b.patch
        if (d) return d
        if (a.pre.length == 0 && b.pre.length > 0)
            return 1;
        if (a.pre.length > 0 && b.pre.length == 0)
            return -1;
        for (let i = 0; i < a.pre.length + 1; ++i) {
            let aa = a.pre[i]
            let bb = b.pre[i]
            if (!aa)
                if (!bb)
                    return 0;
                else
                    return -1;
            else if (!bb)
                return 1;
            else if (/^\d+$/.test(aa))
                if (/^\d+$/.test(bb)) {
                    d = parseInt(aa) - parseInt(bb)
                    if (d) return d
                } else return -1;
            else if (/^\d+$/.test(bb))
                return 1
            else {
                d = strcmp(aa, bb)
                if (d) return d
            }
        }
        return 0
    }
}

export function parse(v: string, defaultVersion?: string): Version {
    let r = tryParse(v) || tryParse(defaultVersion)
    return r
}

export function tryParse(v: string): Version {
    if (!v) return null
    if ("*" === v) {
        return {
            major: Number.MAX_SAFE_INTEGER,
            minor: Number.MAX_SAFE_INTEGER,
            patch: Number.MAX_SAFE_INTEGER,
            pre: [],
            build: []
        };
    }
    if (/^v\d/i.test(v)) v = v.slice(1)
    let m = /^(\d+)\.(\d+)\.(\d+)(-([0-9a-zA-Z\-\.]+))?(\+([0-9a-zA-Z\-\.]+))?$/.exec(v)
    if (m)
        return {
            major: parseInt(m[1]),
            minor: parseInt(m[2]),
            patch: parseInt(m[3]),
            pre: m[5] ? m[5].split(".") : [],
            build: m[7] ? m[7].split(".") : []
        }
    return null
}

export function normalize(v: string): string {
    return stringify(parse(v));
}

export function stringify(v: Version) {
    let r = v.major + "." + v.minor + "." + v.patch
    if (v.pre.length)
        r += "-" + v.pre.join(".")
    if (v.build.length)
        r += "+" + v.build.join(".")
    return r
}

export function majorCmp(a: string, b: string) {
    let aa = tryParse(a)
    let bb = tryParse(b)
    return aa.major - bb.major;
}

/**
 * Compares two semver version strings and returns -1 if a < b, 1 if a > b and 0
 * if versions are equivalent. If a and b are invalid versions, classic strcmp is called.
 * If a (or b) is an invalid version, it is considered greater than any version (strmp(undefined, "0.0.0") = 1)
 */
export function compareStrings(a: string, b: string) {
    let aa = tryParse(a)
    let bb = tryParse(b)
    if (!aa && !bb)
        return strcmp(a, b)
    else return cmp(aa, bb)
}

export function inRange(rng: string, v: Version): boolean {
    let rngs = rng.split(' - ');
    if (rngs.length != 2) return false;
    let minInclusive = tryParse(rngs[0]);
    let maxExclusive = tryParse(rngs[1]);
    if (!minInclusive || !maxExclusive) return false;
    if (!v) return true;
    const lwr = cmp(minInclusive, v);
    const hr = cmp(v, maxExclusive);
    return lwr <= 0 && hr < 0;
}

/**
 * Filters and sort tags from latest to oldest (semver wize)
 * @param tags
 */
export function sortLatestTags(tags: string[]): string[] {
    const v = tags.filter(tag => !!tryParse(tag));
    v.sort(compareStrings);
    v.reverse();
    return v;
}

function strcmp(a: string, b: string) {
    if (a == b) return 0;
    if (a < b) return -1;
    else return 1;
}