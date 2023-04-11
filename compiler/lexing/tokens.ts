import { SyntaxKind, SourceSpan } from "./syntax.ts";

/**
 * Defines a token in the lexing process.
 */
export interface ISyntaxToken {
    readonly kind: SyntaxKind;
    readonly column: SourceSpan;
    line?: number;
    readonly text: string;
}

export interface INumericToken extends ISyntaxToken {
    readonly value: number;
}

export interface IStringToken extends ISyntaxToken {
    readonly value: string;
}

export interface IBooleanToken extends ISyntaxToken {
    readonly value: boolean;
}