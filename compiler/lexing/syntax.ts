/**
 * Defines the position of a token in the source code.
 */
export class SourcePosition {
    public readonly file?: string;
    public readonly line: SourceSpan;
    public readonly column: SourceSpan;

    constructor(file: string|undefined, line: SourceSpan, column: SourceSpan) {
        this.file = file;
        this.line = line;
        this.column = column;
    }

    public toString(): string {
        return `${this.file ?? "<unknown>"}:${this.line.toString()}:${this.column.toString()}`;
    }
}

export class SourceSpan {
    public readonly start: number;
    public readonly length: number;

    constructor(start: number, length: number) {
        this.start = start;
        this.length = length;
    }

    public get end(): number {
        return this.start + this.length;
    }

    public toString(): string {
        return `${this.start}..${this.end}`;
    }

    public static fromBounds(start: number, end: number): SourceSpan {
        return new SourceSpan(start, end - start);
    }
}

/**
 * The syntax kind defines the type of a token in the lexing process.
 */
export enum SyntaxKind {
    /**
     * The token is used for any unknown token.
     */
    BadToken,
    EndOfFileToken,

    // Literals
    NumericLiteral,
    StringLiteral,
    BooleanLiteral,

    // Identifiers
    Identifier,

    // Keywords
    TargetKeyword,
    UseKeyword,
    RouterKeyword,
    GetMethodKeyword,
    PostMethodKeyword,
    PutMethodKeyword,
    DeleteMethodKeyword,
    PatchMethodKeyword,
    HeadMethodKeyword,
    OptionsMethodKeyword,
    IncludeKeyword,
    AsKeyword,
    StringTypeKeyword,
    IntegerTypeKeyword,
    FloatTypeKeyword,
    BooleanTypeKeyword,
    AnyTypeKeyword,
    DateTypeKeyword,
    DateTimeTypeKeyword,
    TimeTypeKeyword,
    BodyKeyword,
    HeaderKeyword,
    QueryKeyword,
    WithKeyword,
    PublicKeyword,
    AuthenticatedKeyword,
    AuthenticateKeyword,
    AuthKeyword,
    
    // Punctuation
    OpenBraceToken,
    CloseBraceToken,
    OpenParenToken,
    CloseParenToken,
    OpenBracketToken,
    CloseBracketToken,
    DotToken,
    CommaToken,
    SemicolonToken,
    ColonToken,
    QuestionToken,
    ExclamationToken,
    LessThanToken,
    GreaterThanToken,
    EqualsToken,
    PlusToken,
    MinusToken,
    AsteriskToken,
    SlashToken,
    PercentToken,
    CaretToken,
    TildeToken,
    AmpersandToken,
    BarToken,
    AtToken,
    HashToken,

}