import * as path from "https://deno.land/std@0.157.0/path/mod.ts";

import { IPluginContext, IYmirFile, YmirFileKind } from "../library/mod.ts";
import { ISyntaxToken } from "./lexing/tokens.ts";
import { Lexer } from "./lexing/lexer.ts";
import { Logger } from "./logger.ts";

export class CompilationContext implements IPluginContext {

    public readonly workingDirectory: string;
    public readonly indexFile: string;
    private readonly _files: LexedYmirFile[];

    constructor(indexFile: string) {
        this.indexFile = indexFile;
        this.workingDirectory = path.dirname(indexFile);
        this._files = [];

        this.addFile({
            path: indexFile,
            filename: path.basename(indexFile),
            kind: YmirFileKind.Script,
        });
    }

    public addFile(file: IYmirFile): void {
        const decoder = new TextDecoder("utf-8");
        const lexer = new Lexer(file, decoder.decode(Deno.readFileSync(file.path)));
        const tokens = lexer.tokenize();

        Logger.success("Lexed %s", file.path);

        console.log(tokens);

        this._files.push(new LexedYmirFile(file, tokens));
    }

    public get files(): IYmirFile[] {
        return this._files.map(file => file.file);
    }
}

export class LexedYmirFile {

    public readonly file: IYmirFile;
    public readonly tokens: ISyntaxToken[];

    constructor(file: IYmirFile, tokens: ISyntaxToken[]) {
        this.file = file;
        this.tokens = tokens;
    }

}