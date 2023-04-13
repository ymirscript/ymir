import { SourcePosition, SyntaxKind } from "../lexing/syntax.ts";
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

    public reportError(position: SourcePosition, message: string): void {
        this._diagnostics.push(new Diagnostic(DiagnosticSeverity.Error, position, message));
    }

    public reportWarning(position: SourcePosition, message: string): void {
        this._diagnostics.push(new Diagnostic(DiagnosticSeverity.Warning, position, message));
    }

    public reportUnexpectedToken(current: ISyntaxToken, expected: SyntaxKind[]): void {
        this._diagnostics.push(new Diagnostic(DiagnosticSeverity.Error, current.position, `Expected token of kind ${expected.map(e => this.transformSyntaxKind(e)).join(" or ")} but got ${this.transformSyntaxKind(current.kind)} instead.`));
    }

    public report(...diagnostics: Diagnostic[]): void {
        this._diagnostics.push(...diagnostics);
    }

    public transformSyntaxKind(kind: SyntaxKind): string {
        return SyntaxKind[kind];
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

    constructor(severity: DiagnosticSeverity, position: SourcePosition, message: string) {
        this.severity = severity;
        this.position = position;
        this.message = message;
    }
}

/**
 * The severity of a diagnostic.
 */
export enum DiagnosticSeverity {
    Error,
    Warning,
}