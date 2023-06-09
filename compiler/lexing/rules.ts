import { LexerContext } from "./lexer.ts";
import { SourceSpan, SyntaxKind } from "./syntax.ts";
import { IBooleanToken, INumericToken, IStringToken, ISyntaxToken } from "./tokens.ts";

/**
 * Defines a rule for the lexer to parse the source code.
 */
export interface ISyntaxRule {
    /**
     * Checks if the rule matches the current context.
     * 
     * @param context The lexer context.
     */
    isMatch(context: LexerContext): boolean;

    /**
     * Transforms the current context into a token.
     * 
     * @param context The lexer context.
     */
    transform(context: LexerContext): ISyntaxToken;
}

/**
 * Defines a rule that matches any character.
 */
export class AnySyntaxRule implements ISyntaxRule {

    private readonly _kind: SyntaxKind;

    constructor(kind: SyntaxKind) {
        this._kind = kind;
    }

    isMatch(_context: LexerContext): boolean {
        return true;
    }

    transform(context: LexerContext): ISyntaxToken {
        const pos = new SourceSpan(context.sourcePosition, 1);
        context.jump(1);

        return {
            kind: this._kind,
            column: pos,
            text: context.currentCharacter
        };
    }
}

/**
 * Defines a rule that matches a whole pattern (multi char).
 */
export class PatternSyntaxRule implements ISyntaxRule {

    private readonly _patternChars: string[];
    private readonly _pattern: string;
    private readonly _kind: SyntaxKind;

    constructor(pattern: string, kind: SyntaxKind) {
        this._pattern = pattern;
        this._patternChars = pattern.split("");
        this._kind = kind;
    }

    isMatch(context: LexerContext): boolean {
        for (let i = 0; i < this._patternChars.length; i++) {
            if (context.peek(i) !== this._patternChars[i]) {
                return false;
            }
        }

        const lookahead = context.peek(this._patternChars.length);

        if (lookahead === " " || lookahead === "\t" || lookahead === "\r" || lookahead === "\n" || lookahead === "\0" || !lookahead.match(/^[a-zA-Z0-9_-]+$/)) {
            return true;
        }

        return false;
    }

    transform(context: LexerContext): ISyntaxToken {
        const pos = new SourceSpan(context.sourcePosition, this._patternChars.length);
        context.jump(this._patternChars.length);

        return {
            kind: this._kind,
            column: pos,
            text: this._pattern
        };
    }
}

/**
 * Defines a rule that matches a single character.
 */
export class CharSyntaxRule implements ISyntaxRule {

    private readonly _char: string;
    private readonly _kind: SyntaxKind;

    constructor(char: string, kind: SyntaxKind) {
        this._char = char;
        this._kind = kind;
    }

    isMatch(context: LexerContext): boolean {
        return context.currentCharacter === this._char;
    }

    transform(context: LexerContext): ISyntaxToken {
        const pos = new SourceSpan(context.sourcePosition, 1);
        context.jump(1);

        return {
            kind: this._kind,
            column: pos,
            text: this._char
        };
    }
}

/**
 * Defines a rule that matches an identifier (a-z, A-Z, _ and 0-9 while the first char is not a number)
 */
export class IdentifierSyntaxRule implements ISyntaxRule {

    isMatch(context: LexerContext): boolean {
        const char = context.currentCharacter;
        return char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char === "_" || char === "-";
    }

    transform(context: LexerContext): ISyntaxToken {
        const start = context.sourcePosition;
        const text = this.readIdentifier(context);
    
        return {
            kind: SyntaxKind.Identifier,
            column: new SourceSpan(start, text.length),
            text
        };
    }

    private readIdentifier(context: LexerContext): string {
        let identifier = "";
        while (this.isCharLetter(context.currentCharacter) || this.isCharNumber(context.currentCharacter) || context.currentCharacter === "_" || context.currentCharacter === "-") {
            identifier += context.read();
        }

        return identifier;
    }

    private isCharNumber(char: string): boolean {
        return char >= "0" && char <= "9";
    }

    private isCharLetter(char: string): boolean {
        return char >= "a" && char <= "z" || char >= "A" && char <= "Z";
    }
}

/**
 * Defines a rule that matches a boolean literal (true or false).
 */
export class BooleanSyntaxRule implements ISyntaxRule {

    private readonly _truePattern: PatternSyntaxRule;
    private readonly _falsePattern: PatternSyntaxRule;

    constructor() {
        this._truePattern = new PatternSyntaxRule("true", SyntaxKind.BooleanLiteral);
        this._falsePattern = new PatternSyntaxRule("false", SyntaxKind.BooleanLiteral);
    }

    isMatch(context: LexerContext): boolean {
        return this._truePattern.isMatch(context) || this._falsePattern.isMatch(context);
    }

    transform(context: LexerContext): ISyntaxToken {
        const baseToken = (this._truePattern.isMatch(context) ? this._truePattern : this._falsePattern).transform(context);

        return <IBooleanToken> {
            ...baseToken,
            value: baseToken.text === "true"
        };
    }
}

/**
 * Defines a rule that matches a number literal. Allowing: 0-9, . and e and - (for negative numbers).
 */
export class NumberSyntaxRule implements ISyntaxRule {
    
    isMatch(context: LexerContext): boolean {
        return this.isDigit(context.currentCharacter) 
            || context.currentCharacter === "-" && this.isDigit(context.peek(1, true))
            || context.currentCharacter === "+" && this.isDigit(context.peek(1, true))
            || context.currentCharacter === "." && this.isDigit(context.peek(1, true))
            || context.currentCharacter === "-" && this.checkForDot(context)
            || context.currentCharacter === "+" && this.checkForDot(context);
    }

    transform(context: LexerContext): ISyntaxToken {
        const start = context.sourcePosition;
        const number = this.readNumber(context);
        const length = number.length;

        return <INumericToken> {
            kind: SyntaxKind.NumericLiteral,
            column: new SourceSpan(start, length),
            text: number,
            value: parseFloat(number)
        };
    }

    private readNumber(context: LexerContext): string {
        let number = "";

        if (context.currentCharacter === "-" || context.currentCharacter === "+") {
            if (context.currentCharacter === "-") {
                number += context.read(true);
            } else {
                context.read(true);
            }
        }

        while (this.isDigit(context.currentCharacter)) {
            number += context.read();
        }

        if (context.currentCharacter === ".") {
            number += context.read();
        }

        while (this.isDigit(context.currentCharacter)) {
            number += context.read();
        }

        if (context.currentCharacter !== "e" && context.currentCharacter !== "E") {
            return number;
        }

        number += context.read();

        // @ts-ignore: read does move the cursor but deno thinks it doesn't
        if (context.currentCharacter === "-" || context.currentCharacter === "+") {
            number += context.read();
        }

        while (this.isDigit(context.currentCharacter)) {
            number += context.read();
        }

        return number;
    }

    private checkForDot(context: LexerContext): boolean {
        const [char, index] = context.peekWithIndex(1, true);
        return char === "." && this.isDigit(context.peek(index + 1));
    }

    private isDigit(char: string): boolean {
        return char >= "0" && char <= "9";
    }
}

/**
 * Defines a rule that matches a string literal. Allowing: " and \ (for escape chars).
 */
export class StringSyntaxRule implements ISyntaxRule {

    isMatch(context: LexerContext): boolean {
        return context.currentCharacter === "\"" || context.currentCharacter === "'";
    }

    transform(context: LexerContext): ISyntaxToken {
        const start = context.sourcePosition;
        const quote = context.read();
        const text = this.readString(context, quote);

        if (text === undefined) {
            throw new Error("Unterminated string literal");
        }

        return <IStringToken>{
            kind: SyntaxKind.StringLiteral,
            column: new SourceSpan(start, text.length + 2),
            text: quote + text + quote,
            value: text
        };
    }

    private readString(context: LexerContext, quote: string): string|undefined {
        let string = "";

        let wasEscaped = false;
        let errored = false;

        while (true) {
            const current = context.currentCharacter;

            if (current === quote && !wasEscaped) {
                break;
            }

            if (current === "\0") {
                errored = true;
                break;
            }

            if (current === "\\" && !wasEscaped) {
                wasEscaped = true;
                context.read();
                continue;
            }

            wasEscaped = false;
            string += context.read();
        }

        context.read();

        if (errored) {
            return undefined;
        }

        return string;
    }
}

/**
 * The path syntax rule matches an URL path in the source code.
 */
export class RegExSyntaxRule implements ISyntaxRule {

    constructor(
        private readonly _pattern: RegExp,
        private readonly _kind: SyntaxKind,
        private readonly _normalizer?: (value: string) => string
    ) {}

    isMatch(context: LexerContext): boolean {
        return context.peekRegEx(this._pattern).length > 0;
    }

    transform(context: LexerContext): ISyntaxToken {
        const start = context.sourcePosition;
        const text = context.readRegEx(this._pattern);

        return {
            kind: this._kind,
            column: new SourceSpan(start, text.length),
            text: this._normalizer !== undefined ? this._normalizer(text) : text
        };
    }
}

/**
 * The comment syntax rule matches a single line comment in the source code.
 */
export class CommentSyntaxRule implements ISyntaxRule {

    isMatch(context: LexerContext): boolean {
        return context.currentCharacter === "/" && context.peek(1) === "/";
    }

    transform(context: LexerContext): ISyntaxToken {
        const start = context.sourcePosition;

        context.read();
        context.read();

        let comment = "";
        
        while (context.currentCharacter !== "\0" && context.currentCharacter !== "\n") {
            comment += context.read();
        }

        return {
            kind: SyntaxKind.Comment,
            column: new SourceSpan(start, comment.length),
            text: comment.trim()
        };
    }
}

export const RuleSet: ISyntaxRule[] = [
    new NumberSyntaxRule(),
    new StringSyntaxRule(),
    new BooleanSyntaxRule(),
    new CommentSyntaxRule(),
    new RegExSyntaxRule(/^(?:\/(?::\w+|{[\w]+(?:<(?:[^>?\\]|\\.)+>)?}|(?:[^\s?;\\]|\\.)+))*/gm, SyntaxKind.PathLiteral, s => s.replaceAll('\\?', '?').replaceAll('\\;', ';').replaceAll('\\ ', ' ')),

    new PatternSyntaxRule("target", SyntaxKind.TargetKeyword),
    new PatternSyntaxRule("use", SyntaxKind.UseKeyword),
    new PatternSyntaxRule("router", SyntaxKind.RouterKeyword),
    new PatternSyntaxRule("include", SyntaxKind.IncludeKeyword),
    new PatternSyntaxRule("with", SyntaxKind.WithKeyword),
    new PatternSyntaxRule("body", SyntaxKind.BodyKeyword),
    new PatternSyntaxRule("header", SyntaxKind.HeaderKeyword),
    new PatternSyntaxRule("query", SyntaxKind.QueryKeyword),
    new PatternSyntaxRule("GET", SyntaxKind.GetMethodKeyword),
    new PatternSyntaxRule("POST", SyntaxKind.PostMethodKeyword),
    new PatternSyntaxRule("PUT", SyntaxKind.PutMethodKeyword),
    new PatternSyntaxRule("DELETE", SyntaxKind.DeleteMethodKeyword),
    new PatternSyntaxRule("PATCH", SyntaxKind.PatchMethodKeyword),
    new PatternSyntaxRule("HEAD", SyntaxKind.HeadMethodKeyword),
    new PatternSyntaxRule("OPTIONS", SyntaxKind.OptionsMethodKeyword),
    new PatternSyntaxRule("as", SyntaxKind.AsKeyword),
    new PatternSyntaxRule("any", SyntaxKind.AnyTypeKeyword),
    new PatternSyntaxRule("string", SyntaxKind.StringTypeKeyword),
    new PatternSyntaxRule("float", SyntaxKind.FloatTypeKeyword),
    new PatternSyntaxRule("int", SyntaxKind.IntegerTypeKeyword),
    new PatternSyntaxRule("boolean", SyntaxKind.BooleanTypeKeyword),
    new PatternSyntaxRule("datetime", SyntaxKind.DateTimeTypeKeyword),
    new PatternSyntaxRule("date", SyntaxKind.DateTypeKeyword),
    new PatternSyntaxRule("time", SyntaxKind.TimeTypeKeyword),
    new PatternSyntaxRule("public", SyntaxKind.PublicKeyword),
    new PatternSyntaxRule("authenticated", SyntaxKind.AuthenticatedKeyword),
    new PatternSyntaxRule("authenticate", SyntaxKind.AuthenticateKeyword),
    new PatternSyntaxRule("auth", SyntaxKind.AuthKeyword),
    new PatternSyntaxRule("response", SyntaxKind.ResponseKeyword),
    new PatternSyntaxRule("responses", SyntaxKind.ResponsesKeyword),
    new PatternSyntaxRule("render", SyntaxKind.RenderKeyword),
    new PatternSyntaxRule("table", SyntaxKind.TableKeyword),
    new PatternSyntaxRule("list", SyntaxKind.ListKeyword),
    new PatternSyntaxRule("detail", SyntaxKind.DetailKeyword),
    new PatternSyntaxRule("form", SyntaxKind.FormKeyword),

    new CharSyntaxRule("(", SyntaxKind.OpenParenToken),
    new CharSyntaxRule(")", SyntaxKind.CloseParenToken),
    new CharSyntaxRule("{", SyntaxKind.OpenBraceToken),
    new CharSyntaxRule("}", SyntaxKind.CloseBraceToken),
    new CharSyntaxRule("[", SyntaxKind.OpenBracketToken),
    new CharSyntaxRule("]", SyntaxKind.CloseBracketToken),
    new CharSyntaxRule(".", SyntaxKind.DotToken),
    new CharSyntaxRule(",", SyntaxKind.CommaToken),
    new CharSyntaxRule(":", SyntaxKind.ColonToken),
    new CharSyntaxRule(";", SyntaxKind.SemicolonToken),
    new CharSyntaxRule("?", SyntaxKind.QuestionToken),
    new CharSyntaxRule("=", SyntaxKind.EqualsToken),
    new CharSyntaxRule("!", SyntaxKind.ExclamationToken),
    new CharSyntaxRule("<", SyntaxKind.LessThanToken),
    new CharSyntaxRule(">", SyntaxKind.GreaterThanToken),
    new CharSyntaxRule("+", SyntaxKind.PlusToken),
    new CharSyntaxRule("-", SyntaxKind.MinusToken),
    new CharSyntaxRule("*", SyntaxKind.AsteriskToken),
    new CharSyntaxRule("/", SyntaxKind.SlashToken),
    new CharSyntaxRule("%", SyntaxKind.PercentToken),
    new CharSyntaxRule("&", SyntaxKind.AmpersandToken),
    new CharSyntaxRule("|", SyntaxKind.BarToken),
    new CharSyntaxRule("^", SyntaxKind.CaretToken),
    new CharSyntaxRule("~", SyntaxKind.TildeToken),
    new CharSyntaxRule("@", SyntaxKind.AtToken),
    new CharSyntaxRule("#", SyntaxKind.HashToken),

    new IdentifierSyntaxRule()
];