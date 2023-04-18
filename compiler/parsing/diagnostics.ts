import * as path from "https://deno.land/std@0.157.0/path/mod.ts";

import { Logger } from "../../library/mod.ts";
import { CompilationContext } from "../context.ts";
import { SourcePosition, SourceSpan, SyntaxKind } from "../lexing/syntax.ts";
import { ISyntaxToken } from "../lexing/tokens.ts";

/**
 * A class used to collect diagnostics.
 */
export class DiagnosticSink {

    private readonly _diagnostics: Diagnostic[];

    constructor() {
        this._diagnostics = new Array<Diagnostic>();
    }

    public get diagnostics(): Diagnostic[] {
        return [...this._diagnostics];
    }

    public get errorCount(): number {
        return this._diagnostics.filter(d => d.severity === DiagnosticSeverity.Error).length;
    }

    public get warningCount(): number {
        return this._diagnostics.filter(d => d.severity === DiagnosticSeverity.Warning).length;
    }

    public reportError(position: SourcePosition, message: string, hint?: string): void {
        this._diagnostics.push(new Diagnostic(DiagnosticSeverity.Error, position, message, hint));
    }

    public reportWarning(position: SourcePosition, message: string): void {
        this._diagnostics.push(new Diagnostic(DiagnosticSeverity.Warning, position, message));
    }

    public reportUnexpectedToken(current: ISyntaxToken, expected: SyntaxKind[], hint?: string, file?: string): void {
        this._diagnostics.push(new Diagnostic(DiagnosticSeverity.Error, new SourcePosition(file, new SourceSpan(current.line ?? -1, 0), current.column), `Expected token of kind ${expected.map(e => this.transformSyntaxKind(e)).join(" or ")} but got ${this.transformSyntaxKind(current.kind)} instead.`, hint));
    }

    public report(...diagnostics: Diagnostic[]): void {
        this._diagnostics.push(...diagnostics);
    }

    public transformSyntaxKind(kind: SyntaxKind): string {
        return SyntaxKind[kind];
    }

    public print(context: CompilationContext) {
        console.log();
        Logger.info("Found %d errors and %d warnings:", this.errorCount, this.warningCount);

        for (const diagnostic of this._diagnostics) {
            if (diagnostic.severity === DiagnosticSeverity.Error) {
                Logger.error("\t" + diagnostic.message + " at " + diagnostic.position.toString());

                if (context.config.detailedErrors === true && diagnostic.position.file !== undefined) {
                    console.log();

                    const fileContent = Deno.readTextFileSync(path.join(Deno.cwd(), diagnostic.position.file));

                    const lines = fileContent.split("\r\n");
                    const minBarrier = Math.max(0, diagnostic.position.line.start - 5);
                    const maxBarrier = Math.min(lines.length, diagnostic.position.line.end + 1);
                    const targetLines = lines.slice(minBarrier, maxBarrier);

                    for (let i = 0; i < targetLines.length; i++) {
                        const line = targetLines[i];
                        const lineIndex = minBarrier + i + 1;
                        const linePrefix = lineIndex.toString().padStart(4, "0") + " | ";

                        if (lineIndex === diagnostic.position.line.start) {
                            if (diagnostic.hint !== "") {
                                Logger.errorHint(linePrefix + line.slice(0, diagnostic.position.column.start - 1), diagnostic.hint, line.slice(diagnostic.position.column.start - 1 + diagnostic.position.column.length));
                            } else {
                                Logger.error(linePrefix + line);
                            }
                            Logger.error("     | " + " ".repeat(diagnostic.position.column.start - 1) + "^".repeat(diagnostic.position.column.length));
                        } else {
                            Logger.error(linePrefix + line);
                        }
                    }

                    console.log();
                    console.log();
                }
            }
        }

        for (const diagnostic of this._diagnostics) {
            if (diagnostic.severity === DiagnosticSeverity.Warning) {
                Logger.warning("\t" + diagnostic.message + " at " + diagnostic.position.toString());
            }
        }

        console.log();
    }
}

export class Diagnostic {
    /**
     * The severity of the diagnostic.
     */
    public readonly severity: DiagnosticSeverity;

    /**
     * The position of the diagnostic in the source code.
     */    
    public readonly position: SourcePosition;

    /**
     * The message of the diagnostic.
     */
    public readonly message: string;

    /**
     * A hint for detailed error messages.
     */
    public readonly hint: string;

    constructor(severity: DiagnosticSeverity, position: SourcePosition, message: string, hint?: string) {
        this.severity = severity;
        this.position = position;
        this.message = message;
        this.hint = hint ?? "";
    }
}

/**
 * The severity of a diagnostic.
 */
export enum DiagnosticSeverity {
    Error,
    Warning,
}