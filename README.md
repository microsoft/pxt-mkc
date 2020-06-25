# MKC - command line tool for MakeCode editors

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
Use `makecode -j` to build JavaScript (it defaults to native).

The tool is configured with optional `mkc.json` file. Example:

```json
{
    "targetWebsite": "https://arcade.makecode.com/beta",
    "hwVariant": "samd51",
    "links": {
        "jacdac-services": "../../pxt-jacdac-services"
    }
}
```

All fields are optional.

* **targetWebsite** says where to take the compiler from; if you omit it, it will be guessed based on packages used by `pxt.json`;
  you can point this to a live or beta version of the editor, as well as to a specific version (including SHA-indexed uploads
  generated during PXT target builds)
* **hwVariant** specifies default hardware variant (currently only used in Arcade); try `--hw help` command line option to list variants
* **links** overrides specific packages; these can be github packages or built-in packages

## Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
