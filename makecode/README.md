# MakeCode build tool

This package includes a tool that can compile MakeCode (PXT) projects by
downloading parts of a released MakeCode web app and running them in node.js.

This is different than `pxt` command line tool, which is used primarily during
development of MakeCode editors.

## Usage

In a folder with `pxt.json` file, run:

```
> makecode
```

You can also pass `--hw f4`, `--hw d5` etc. Try `--hw help` to get a list.

## License

MIT
