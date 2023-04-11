// deno-lint-ignore-file no-inferrable-types

import { IYmirFile } from "../../library/mod.ts";
import { RuleSet } from "./rules.ts";
import { SourceSpan, SyntaxKind } from "./syntax.ts";
import { ISyntaxToken } from "./tokens.ts";

export class Lexer {

    private readonly _context: LexerContext;
    private _line: number;

    constructor(file: IYmirFile|undefined, text: string) {
        this._context = new LexerContext(file, text);
        this._line = 1;
    }

    public tokenize(): ISyntaxToken[] {
        const tokens = new Array<ISyntaxToken>();

        while (this._context.currentCharacter !== "\0") {
            switch (this._context.currentCharacter) {
                case "\r":
                case "\t":
                    this._context.nextToken();
                    continue;
                case "\n":
                    this._context.newLine();
                    this._context.nextToken();
                    this._line++;
                    continue;

            }

            let found = false;

            for (const rule of RuleSet) {
                if (!rule.isMatch(this._context)) {
                    continue;
                }

                console.log(`Found ${rule.constructor.name} at ${this._context.sourcePosition} (${this._context.currentCharacter})`);

                const result = rule.transform(this._context);
                result.line = this._line;
                tokens.push(result);

                found = true;
                break;
            }

            if (found) {
                continue;
            }

            if (this._context.currentCharacter === " ") {
                this._context.nextToken();
                continue;
            }

            tokens.push({
                kind: SyntaxKind.BadToken,
                column: new SourceSpan(this._context.sourcePosition, 1),
                text: this._context.read(),
                line: this._line
            });
        }

        tokens.push({
            kind: SyntaxKind.EndOfFileToken,
            column: new SourceSpan(this._context.sourcePosition, 1),
            text: "\0",
            line: this._line
        });

        return tokens;
    }
}

/**
 * The context in which the lexer is running. From here it can grab string data and information about the current position.
 */
export class LexerContext {

    private readonly _file?: IYmirFile;
    private readonly _text: string;
    private _position: number;
    private _sourcePosition: number;

    constructor(file: IYmirFile|undefined, text: string) {
        this._file = file;
        this._text = text;
        this._position = 0;
        this._sourcePosition = 0;
    }

    /**
     * Returns the current character in the text. The pointer is not moved.
     */
    public get currentCharacter(): string {
        return this.peek(0);
    }

    /**
     * Returns the next character in the text. The pointer is not moved.
     */
    public get nextCharacter(): string {
        return this.peek(1);
    }

    /**
     * Returns the current file.
     */
    public get file(): IYmirFile|undefined {
        return this._file;
    }

    /**
     * The text that is being lexed.
     */
    public get text(): string {
        return this._text;
    }

    /**
     * The current position in the text.
     */
    public get position(): number {
        return this._position;
    }
    
    /**
     * The source position in the text (the column number).
     */
    public get sourcePosition(): number {
        return this._sourcePosition;
    }

    /**
     * Sets the source position.
     */
    public set sourcePosition(value: number) {
        this._sourcePosition = value;
    }

    /**
     * Tells the lexer that there is a new line.
     */
    public newLine(): void {
        this._sourcePosition = 0;
    }

    /**
     * Peek at the next character in the text.
     * 
     * @param offset The offset from the current position to peek at. 
     * @param skipWhitespace Whether or not to skip whitespace characters.
     * @returns The character at the specified offset.
     */
    public peek(offset: number = 0, skipWhitespace: boolean = false): string {
        return this.peekWithIndex(offset, skipWhitespace)[0];
    }

    /**
     * Peek at the next character in the text.
     * 
     * @param offset The offset from the current position to peek at. 
     * @param skipWhitespace Whether or not to skip whitespace characters.
     * @returns The character at the specified offset and the index of the character.
     */
    public peekWithIndex(offset: number, skipWhitespace: boolean = false): [string, number] {
        let index = this._position + offset;
        if (index >= this._text.length) {
            return ['\0', index];
        }

        let character = this._text[index];
        if (!skipWhitespace) {
            return [character, index];
        }

        while (character === ' ' || character === '\t' || character === '\r' || character === '\n') {
            index++;
            if (index >= this._text.length) {
                return ['\0', index];
            }

            character = this._text[index];
        }

        return [character, index];
    }

    /**
     * Skips the next token in the text.
     * 
     * @param skipWhitespace Whether or not to skip whitespace characters.
     */
    public nextToken(skipWhitespace: boolean = false) {
        return this.jump(1, skipWhitespace);
    }

    /**
     * Jump to the next character in the text.
     * 
     * @param offset The offset from the current position to jump to.
     * @param skipWhitespace Whether or not to skip whitespace characters.
     */
    public jump(offset: number, skipWhitespace: boolean = false) {
        this._position += offset;
        this._sourcePosition += offset;

        if (!skipWhitespace) {
            return;
        }

        let character = this.currentCharacter;
        while (character === ' ' || character === '\t' || character === '\r' || character === '\n') {
            this._position++;
            this._sourcePosition++;
            character = this.currentCharacter;
        }
    }

    /**
     * Like jump, but returns the skipped text.
     * 
     * @param skipWhitespace Whether or not to skip whitespace characters.
     */
    public read(skipWhitespace: boolean = false): string {
        const current = this.currentCharacter;
        this.nextToken(skipWhitespace);
        return current;
    }

    /**
     * Reads the tokens for the given length in the text.
     * 
     * @param length The length of the text to read.
     * @returns The text that was read.
     */
    public readLength(length: number): string {
        const current = this._text.substring(this._position, length);
        this._position += length;
        this._sourcePosition += length;
        return current;
    }
}