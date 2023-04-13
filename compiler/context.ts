import * as path from "https://deno.land/std@0.157.0/path/mod.ts";

import { IPluginContext, IYmirFile, ProjectNode, YmirFileKind } from "../library/mod.ts";
import { Lexer } from "./lexing/lexer.ts";
import { Logger } from "./logger.ts";
import { Parser, ParsingPolicy } from "./parsing/parser.ts";
import { DiagnosticSink } from "./parsing/diagnostics.ts";

export class CompilationContext implements IPluginContext {

    public readonly workingDirectory: string;
    public readonly indexFile: string;
    private readonly _files: PreparedYmirFile[];

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
        Logger.info("Found %d tokens. Lets parse them...", tokens.length);

        const parser = new Parser(new DiagnosticSink(), ParsingPolicy.SkipErroredProject, tokens);
        parser.setWorkingDirectory(this.workingDirectory);
        const project = parser.parse();

        if (project === undefined) {
            Logger.error("Failed to parse %s", file.path);
            return;
        }

        Logger.success("Parsed %s", file.path);

        this._files.push(new PreparedYmirFile(file, project));

        console.log(JSON.stringify(project, null, 4));
    }

    public get files(): IYmirFile[] {
        return this._files.map(file => file.file);
    }
}

export class PreparedYmirFile {

    public readonly file: IYmirFile;
    public readonly project: ProjectNode;

    constructor(file: IYmirFile, project: ProjectNode) {
        this.file = file;
        this.project = project;
    }

}