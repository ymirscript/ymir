import * as path from "https://deno.land/std@0.157.0/path/mod.ts";

import { IPluginContext, IYmirFile, ProjectNode, YmirFileKind } from "../library/mod.ts";
import { Lexer } from "./lexing/lexer.ts";
import { Logger } from "../library/mod.ts";
import { Parser, ParsingPolicy } from "./parsing/parser.ts";
import { DiagnosticSink } from "./parsing/diagnostics.ts";
import { IYmirConfig, loadConfig } from "./config.ts";
import { LogLevel } from "../library/logger.ts";

export class CompilationContext implements IPluginContext {

    public readonly linesOfCode: number;
    public readonly workingDirectory: string;
    public readonly diagnostics: DiagnosticSink|undefined;
    public readonly config: IYmirConfig;
    public readonly configuration: { [key: string]: unknown; };

    public additionalOutputDirectory: string;

    private readonly _preparedIndexFile: PreparedYmirFile|undefined;
    private _outputDirectory: string;

    constructor(indexFile: string) {
        this.workingDirectory = path.dirname(indexFile);
        this.config = loadConfig(this.workingDirectory);

        this._outputDirectory = path.join(this.workingDirectory, this.config.output!);
        this.additionalOutputDirectory = "";
        this.configuration = this.config.target ?? {};

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

        const parser = new Parser(new DiagnosticSink(), ParsingPolicy.CancelParsingOnFirstError, tokens, lexer.comments);
        parser.setWorkingDirectory(this.workingDirectory);
        parser.setIndexFile(file.path);
        const project = parser.parse();

        if (project === undefined) {
            this.diagnostics = parser.diagnostics;
            this.linesOfCode = 0;

            Logger.error("Failed to parse %s", file.path);
            return;
        }

        Logger.success("Parsed %s", file.path);

        this._preparedIndexFile = new PreparedYmirFile(file, project);
        this.linesOfCode = parser.includedLinesOfCode + lexer.linesOfCode;
    }

    public async initBuildDir(): Promise<void> {
        if (await Deno.stat(this._outputDirectory).then(stat => stat.isDirectory).catch(() => false)) {
            Logger.debug("Build directory already exists. Deleting it...");
            await Deno.remove(this._outputDirectory, { recursive: true });
        }

        await Deno.mkdir(this._outputDirectory);
        Logger.debug("Created build directory.");
    }

    public countGeneratedLinesOfCode(): Promise<number> {
        const count = async (dir: string) => {
            let lines = 0;

            for await (const entry of Deno.readDir(dir)) {
                if (entry.isFile) {
                    lines += (await Deno.readTextFile(path.join(dir, entry.name))).split("\n").map((line) => line.trim()).filter((line) => line.length > 0).length;
                } else if (entry.isDirectory) {
                    lines += await count(path.join(dir, entry.name));
                }
            }

            return lines;
        };

        return count(this._outputDirectory);
    }

    public get outputDirectory(): string {
        const dir = this.additionalOutputDirectory.length > 0 ? path.join(this._outputDirectory, this.additionalOutputDirectory) : this._outputDirectory;

        if (!this.isDirectory(dir)) {
            Deno.mkdirSync(dir, { recursive: true });
        }

        return dir;
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

    private isDirectory(path: string): boolean {
        try {
            return Deno.statSync(path).isDirectory;
        } catch {
            return false;
        }
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