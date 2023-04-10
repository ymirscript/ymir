import * as path from "https://deno.land/std@0.157.0/path/mod.ts";

import { IPluginContext, IYmirFile } from "../library/mod.ts";

export class CompilationContext implements IPluginContext {

    public readonly workingDirectory: string;
    public readonly indexFile: string;
    public readonly files: IYmirFile[];

    constructor(indexFile: string) {
        this.indexFile = indexFile;
        this.workingDirectory = path.dirname(indexFile);
        this.files = [];
    }

}