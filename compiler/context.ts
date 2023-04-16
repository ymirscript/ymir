import * as path from "https://deno.land/std@0.157.0/path/mod.ts";

import { IPluginContext, IYmirFile, ProjectNode, YmirFileKind } from "../library/mod.ts";
import { Lexer } from "./lexing/lexer.ts";
import { Logger } from "../library/mod.ts";
import { Parser, ParsingPolicy } from "./parsing/parser.ts";
import { DiagnosticSink } from "./parsing/diagnostics.ts";
import { IYmirConfig, loadConfig } from "./config.ts";
import { LogLevel } from "../library/logger.ts";

export class CompilationContext implements IPluginContext {

    public readonly workingDirectory: string;
    public readonly outputDirectory: string;
    public readonly diagnostics: DiagnosticSink|undefined;
    public readonly config: IYmirConfig;

    private readonly _preparedIndexFile: PreparedYmirFile|undefined;

    constructor(indexFile: string) {
        this.workingDirectory = path.dirname(indexFile);
        this.config = loadConfig(this.workingDirectory);

        this.outputDirectory = path.join(this.workingDirectory, this.config.output!);

        Logger.loglevel = this.config.debug ? LogLevel.Debug : LogLevel.Info;

        const file = {
            path: indexFile,
            filename: path.basename(indexFile),
            kind: YmirFileKind.Script,
        };
        
        const decoder = new TextDecoder("utf-8");
        const lexer = new Lexer(file, decoder.decode(Deno.readFileSync(file.path)));
        const tokens = lexer.tokenize();

        Logger.success("Lexed %s", file.path);
        Logger.info("Found %d tokens. Lets parse them...", tokens.length);

        const parser = new Parser(new DiagnosticSink(), ParsingPolicy.CancelParsingOnFirstError, tokens);
        parser.setWorkingDirectory(this.workingDirectory);
        parser.setIndexFile(file.path);
        const project = parser.parse();

        if (project === undefined) {
            this.diagnostics = parser.diagnostics;

            Logger.error("Failed to parse %s", file.path);
            return;
        }

        Logger.success("Parsed %s", file.path);

        this._preparedIndexFile = new PreparedYmirFile(file, project);
    }

    public async initBuildDir(): Promise<void> {
        if (await Deno.stat(this.outputDirectory).then(stat => stat.isDirectory).catch(() => false)) {
            Logger.debug("Build directory already exists. Skipping creation.");
            return;
        }

        await Deno.mkdir(this.outputDirectory);
        Logger.debug("Created build directory.");
    }

    public get isIndexFilePrepared(): boolean {
        return this._preparedIndexFile !== undefined;
    }

    public get indexFile(): IYmirFile {
        return this._preparedIndexFile!.file;
    }

    public get projectNode(): ProjectNode {
        return this._preparedIndexFile!.project;
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