// deno-lint-ignore-file no-inferrable-types
import * as pathApi from "https://deno.land/std@0.182.0/path/mod.ts";

import { GlobalVariable, Method, MiddlewareNode, MiddlewareOptionValue, ProjectNode, QueryParameterType, RouteNode, Logger, MiddlewareOptions, PathNode, QueryParameterNode, RouterNode, YmirFileKind, AuthBlockNode, AuthType, AuthenticateClauseNode } from "../../library/mod.ts";
import { SourcePosition, SourceSpan, SyntaxKind } from "../lexing/syntax.ts";
import { ISyntaxToken, IStringToken, INumericToken, IBooleanToken } from "../lexing/tokens.ts";
import { DiagnosticSink } from "./diagnostics.ts";
import { Lexer } from "../lexing/lexer.ts";

/**
 * The parser takes a list of tokens and parses them into a syntax tree like structure to pass to the compilation modules.
 */
export class Parser {

    /**
     * The diagnostics sink for the parser.
     */
    public readonly diagnostics: DiagnosticSink;

    private readonly _policy: ParsingPolicy;
    private readonly _context: ParserContext;
    private _workingDirectory: string = Deno.cwd();
    private _currentProjectNode: ProjectNode|undefined;

    constructor(diagnosticSink: DiagnosticSink, policy: ParsingPolicy, tokens: ISyntaxToken[]) {
        this.diagnostics = diagnosticSink;
        this._policy = policy;
        this._context = new ParserContext(this.diagnostics, tokens);
    }

    public setWorkingDirectory(directory: string): void {
        this._workingDirectory = directory;
    }

    public setIndexFile(file: string): void {
        this._context.currentFiles.push(file);
    }

    /**
     * Parses the tokens into a syntax-tree like structure resulting in a project node.
     * 
     * Depending on the parsing policy, the parser will either return a project node or undefined.
     */
    public parse(): ProjectNode|undefined {
        const currentErrorCount = this.diagnostics.errorCount;

        const project = this.parseProject();

        if (this._policy === ParsingPolicy.CancelParsingOnFirstError && this.diagnostics.errorCount > currentErrorCount) {
            return undefined;
        }

        return project;
    }

    private parseProject(): ProjectNode {
        const target = this.parseTarget();

        const projectNode = new ProjectNode(target, {});
        this._currentProjectNode = projectNode;

        this.parseParentNode(projectNode);
        this._currentProjectNode = undefined;

        return projectNode;
    }

    private parseParentNode(parent: RouterNode) {
        while (this._context.hasNextToken) {
            const start = this._context.currentToken;

            this.parseRouterChildren(parent);

            if (this._context.currentToken === start) {
                this._context.jump();
            }
        }
    }

    /**
     * Parses: `target <target>;`
     */
    private parseTarget(): string {
        this._context.matchToken(SyntaxKind.TargetKeyword, false, "target");

        const target = this._context.matchToken(SyntaxKind.Identifier).text;

        this._context.matchToken(SyntaxKind.SemicolonToken, true);

        return target;
    }

    private parseRouterChildren(routerNode: RouterNode): void {
        const current = this._context.currentToken;

        switch (current.kind) {
            case SyntaxKind.UseKeyword:
                if (routerNode instanceof ProjectNode) {
                    routerNode.middlewares.push(this.parseMiddleware());
                } else {
                    this.diagnostics.reportError(new SourcePosition(this._context.workingFile, new SourceSpan(current.line ?? - 1, 1), current.column), "use can only be used in the project node.");
                }
                break;

            case SyntaxKind.GetMethodKeyword:
            case SyntaxKind.PostMethodKeyword:
            case SyntaxKind.PutMethodKeyword:
            case SyntaxKind.DeleteMethodKeyword:
            case SyntaxKind.PatchMethodKeyword:
            case SyntaxKind.HeadMethodKeyword:
            case SyntaxKind.OptionsMethodKeyword:
                routerNode.routes.push(this.parseRoute());
                break;

            case SyntaxKind.RouterKeyword:
                routerNode.routers.push(this.parseRouter());
                break;

            case SyntaxKind.IncludeKeyword:
                this.include(routerNode);
                break;

            case SyntaxKind.AuthKeyword:
                if (routerNode instanceof ProjectNode) {
                    const authBlock = this.parseAuthBlock();
                    if (!authBlock) {
                        return;
                    }

                    if (routerNode.authBlocks[authBlock.id]) {
                        this.diagnostics.reportError(new SourcePosition(this._context.workingFile, new SourceSpan(current.line ?? - 1, 1), current.column), `auth block with id '${authBlock.id}' already exists.`);
                    } else {
                        routerNode.authBlocks[authBlock.id] = authBlock;
                    }
                } else {
                    this.diagnostics.reportError(new SourcePosition(this._context.workingFile, new SourceSpan(current.line ?? - 1, 1), current.column), "auth can only be used in the project node.");
                }
                break;
        }
    }

    private parseAuthBlock(): AuthBlockNode|undefined {
        this._context.jump();

        const type = this._context.matchToken(SyntaxKind.Identifier).text as AuthType;
        if (Object.values(AuthType).indexOf(type) === -1) {
            this.diagnostics.reportError(new SourcePosition(this._context.workingFile, new SourceSpan(this._context.currentToken.line ?? - 1, 1), this._context.currentToken.column), `auth type '${type}' does not exist.`);
            return undefined;
        }

        let body: MiddlewareOptions = {};
        let alias: string = "";

        if (this._context.currentToken.kind === SyntaxKind.OpenParenToken) {
            body = this.parseMiddlewareOptions();

            // @ts-ignore: The cursor gets moved in the parseMiddlewareOptions method, the current token is not a open paren token anymore.
            if (this._context.currentToken.kind === SyntaxKind.AsKeyword) {
                this._context.jump();

                alias = this._context.matchToken(SyntaxKind.Identifier).text;
            }
        } else if (this._context.currentToken.kind === SyntaxKind.AsKeyword) {
            this._context.jump();

            alias = this._context.matchToken(SyntaxKind.Identifier).text;

            // @ts-ignore: The cursor gets moved in the parseMiddlewareOptions method, the current token is not a open paren token anymore.
            if (this._context.currentToken.kind === SyntaxKind.OpenParenToken) {
                body = this.parseMiddlewareOptions();
            } else {
                this.diagnostics.reportError(new SourcePosition(this._context.workingFile, new SourceSpan(this._context.currentToken.line ?? - 1, 1), this._context.currentToken.column), "A auth block must have a body.", "(");
                return undefined;
            }
        }

        this._context.matchToken(SyntaxKind.SemicolonToken, true);

        if (!body["source"] || (body["source"] !== "header" && body["source"] !== "query" && body["source"] !== "body")) {
            this.diagnostics.reportError(new SourcePosition(this._context.workingFile, new SourceSpan(this._context.currentToken.line ?? - 1, 1), this._context.currentToken.column), "A auth block must have a source.", "source: header|query|body");
            return undefined;
        }

        if (!body["field"] || typeof body["field"] !== "string") {
            this.diagnostics.reportError(new SourcePosition(this._context.workingFile, new SourceSpan(this._context.currentToken.line ?? - 1, 1), this._context.currentToken.column), "A auth block must have a field.", "field: <string>");
            return undefined;
        }

        let defaultAccess: "public"|"authenticated" = "public";
        if (body["defaultAccess"]) {
            if (body["defaultAccess"] === "public" || body["defaultAccess"] === "authenticated") {
                defaultAccess = body["defaultAccess"];
            } else {
                this.diagnostics.reportError(new SourcePosition(this._context.workingFile, new SourceSpan(this._context.currentToken.line ?? - 1, 1), this._context.currentToken.column), "A auth block must have a valid defaultAccess.", "defaultAccess: public|authenticated");
                return undefined;
            }
        }

        return new AuthBlockNode(type, body["source"], body["field"], alias, defaultAccess);
    }

    /**
     * Parses: `use <middleware>;`
     * or with options: `use <middleware>(origin: @env.test, something: "test", complex: { another: -10, b: true });`
     */
    private parseMiddleware(): MiddlewareNode {
        this._context.matchToken(SyntaxKind.UseKeyword, false, "use");

        const name = this._context.matchToken(SyntaxKind.Identifier).text;

        const options = this.parseMiddlewareOptions();

        this._context.matchToken(SyntaxKind.SemicolonToken, true);

        return new MiddlewareNode(name, options);

    }

    private parseMiddlewareOptions(): MiddlewareOptions {
        const options: MiddlewareOptions = {};

        if (this._context.currentToken.kind === SyntaxKind.OpenParenToken) {
            this._context.jump();

            // @ts-ignore: The cursor gets moved, the current token is not a open paren token anymore.
            while (this._context.currentToken.kind !== SyntaxKind.CloseParenToken) {
                const key = this._context.matchToken(SyntaxKind.Identifier).text;
                this._context.matchToken(SyntaxKind.ColonToken, false, ":");

                const value = this.parseMiddlewareOptionValue();
                if (value) {
                    options[key] = value;

                    // @ts-ignore: The cursor gets moved, the current token is not a open paren token anymore.
                    if (this._context.currentToken.kind === SyntaxKind.CommaToken) {
                        this._context.jump();
                    }
                } else {
                    this._context.jump();
                }
            }

            this._context.jump();
        }

        return options;
    }

    private parseMiddlewareOptionValue(): MiddlewareOptionValue|undefined {
        const current = this._context.currentToken;

        switch (current.kind) {
            case SyntaxKind.AtToken:
                this._context.jump();
                return this.parseGlobalVariable();

            case SyntaxKind.StringLiteral:
                this._context.jump();
                return (<IStringToken>current).value;

            case SyntaxKind.NumericLiteral:
                this._context.jump();
                return (<INumericToken>current).value;

            case SyntaxKind.BooleanLiteral:
                this._context.jump();
                return (<IBooleanToken>current).value;

            case SyntaxKind.OpenBraceToken:
                return this.parseMiddlewareOptionObject();

            case SyntaxKind.OpenBracketToken:
                return this.parseMiddlewareOptionArray();

            case SyntaxKind.StringTypeKeyword:
            case SyntaxKind.IntegerTypeKeyword:
            case SyntaxKind.FloatTypeKeyword:
            case SyntaxKind.BooleanTypeKeyword:
            case SyntaxKind.AnyTypeKeyword:
            case SyntaxKind.DateTimeTypeKeyword:
            case SyntaxKind.DateTypeKeyword:
            case SyntaxKind.TimeTypeKeyword:
            case SyntaxKind.HeaderKeyword:
            case SyntaxKind.QueryKeyword:
            case SyntaxKind.BodyKeyword:
            case SyntaxKind.PublicKeyword:
            case SyntaxKind.AuthenticatedKeyword:
                this._context.jump();
                return current.text;
                
            default:
                this.diagnostics.reportUnexpectedToken(current, [SyntaxKind.StringLiteral, SyntaxKind.NumericLiteral, SyntaxKind.BooleanLiteral, SyntaxKind.OpenBraceToken], undefined, this._context.workingFile);
                return undefined;
        }
    }

    private parseGlobalVariable(): GlobalVariable {
        const path = [this._context.matchToken(SyntaxKind.Identifier).text];

        while (this._context.currentToken.kind === SyntaxKind.DotToken) {
            this._context.jump();
            path.push(this._context.matchToken(SyntaxKind.Identifier).text);
        }

        return new GlobalVariable(path.pop()!, path);
    }

    private parseMiddlewareOptionObject(): MiddlewareOptions {
        const options: MiddlewareOptions = {};

        this._context.jump();

        while (this._context.currentToken.kind !== SyntaxKind.CloseBraceToken) {
            const key = this._context.matchToken(SyntaxKind.Identifier).text;
            this._context.matchToken(SyntaxKind.ColonToken, false, ":");

            const value = this.parseMiddlewareOptionValue();
            if (value) {
                options[key] = value;

                if (this._context.currentToken.kind === SyntaxKind.CommaToken) {
                    this._context.jump();
                }
            }
        }

        this._context.jump();

        return options;
    }

    private parseMiddlewareOptionArray(): MiddlewareOptionValue[] {
        const values: MiddlewareOptionValue[] = [];

        this._context.jump();

        while (this._context.currentToken.kind !== SyntaxKind.CloseBracketToken) {
            const value = this.parseMiddlewareOptionValue();
            if (value) {
                values.push(value);

                if (this._context.currentToken.kind === SyntaxKind.CommaToken) {
                    this._context.jump();
                }
            }
        }

        this._context.jump();

        return values;
    }

    private parseRoute(): RouteNode {
        const method = this.parseMethod();

        const path = this.parsePath();

        let body: MiddlewareOptions|undefined;
        let header: MiddlewareOptions|undefined;
        let authenticate: AuthenticateClauseNode|undefined;

        while (this._context.currentToken.kind === SyntaxKind.HeaderKeyword 
            || this._context.currentToken.kind === SyntaxKind.BodyKeyword
            || this._context.currentToken.kind === SyntaxKind.AuthenticateKeyword) {
            const current = this._context.currentToken;

            this._context.jump();

            const start = this._context.currentToken;

            if (current.kind === SyntaxKind.HeaderKeyword) {
                header = this.parseMiddlewareOptions();
            } else if (current.kind === SyntaxKind.BodyKeyword) {
                body = this.parseMiddlewareOptions();
            } else if (current.kind === SyntaxKind.AuthenticateKeyword) {
                authenticate = this.parseAuthenticateClause();
            }

            if (this._context.currentToken === start) {
                this._context.jump();
            }
        }

        this._context.matchToken(SyntaxKind.SemicolonToken, true);

        return new RouteNode(method, path, header, body, authenticate);
    }

    private parseAuthenticateClause(): AuthenticateClauseNode|undefined {
        let authBlock: string = "";
        let authorization: string[]|undefined;

        if (this._context.currentToken.kind === SyntaxKind.Identifier) {
            authBlock = this._context.matchToken(SyntaxKind.Identifier, false, "<string>").text;
        } else if (Object.values(this._currentProjectNode!.authBlocks).length > 1) {
            this.diagnostics.reportUnexpectedToken(this._context.currentToken, [SyntaxKind.Identifier], "<authblock>", this._context.workingFile);
            return undefined;
        }

        if (authBlock === "") {
            authBlock = Object.keys(this._currentProjectNode!.authBlocks)[0];
            if (!authBlock) {
                this.diagnostics.reportError(new SourcePosition(this._context.workingFile, new SourceSpan(this._context.currentToken.line ?? - 1, 1), this._context.currentToken.column), `No default auth block found.`);
                return undefined;
            }
        }

        const authBlockNode = this._currentProjectNode!.authBlocks[authBlock];
        if (!authBlockNode) {
            this.diagnostics.reportError(new SourcePosition(this._context.workingFile, new SourceSpan(this._context.currentToken.line ?? - 1, 1), this._context.currentToken.column), `No auth block found for '${authBlock}'.`);
            return undefined;
        }

        if (this._context.currentToken.kind === SyntaxKind.WithKeyword) {
            this._context.jump();
            authBlockNode.isAuthorizationInUse = true;
            authorization = [];

            // @ts-ignore: The cursor was moved.
            if (this._context.currentToken.kind === SyntaxKind.StringLiteral) {
                authorization.push((<IStringToken>this._context.matchToken(SyntaxKind.StringLiteral, false, "<string>")).text);
                
            // @ts-ignore: The cursor was moved.
            } else if (this._context.currentToken.kind === SyntaxKind.OpenBracketToken) {
                this._context.jump();

                while (this._context.currentToken.kind !== SyntaxKind.CloseBracketToken && this._context.currentToken.kind !== SyntaxKind.EndOfFileToken) {
                    authorization.push((<IStringToken>this._context.matchToken(SyntaxKind.StringLiteral, false, "<string>")).text);

                    if (this._context.currentToken.kind === SyntaxKind.CommaToken) {
                        this._context.jump();
                    }
                }

                this._context.jump();
            } else {
                this.diagnostics.reportUnexpectedToken(this._context.currentToken, [SyntaxKind.StringLiteral, SyntaxKind.OpenBracketToken], undefined, this._context.workingFile);
                return undefined;
            }
        }

        return new AuthenticateClauseNode(authBlock, authorization);
    }

    private parseMethod(): Method {
        const current = this._context.currentToken;

        switch (current.kind) {
            case SyntaxKind.GetMethodKeyword:
                this._context.jump();
                return Method.Get;

            case SyntaxKind.PostMethodKeyword:
                this._context.jump();
                return Method.Post;

            case SyntaxKind.PutMethodKeyword:
                this._context.jump();
                return Method.Put;

            case SyntaxKind.DeleteMethodKeyword:
                this._context.jump();
                return Method.Delete;

            case SyntaxKind.PatchMethodKeyword:
                this._context.jump();
                return Method.Patch;

            case SyntaxKind.HeadMethodKeyword:
                this._context.jump();
                return Method.Head;

            case SyntaxKind.OptionsMethodKeyword:
                this._context.jump();
                return Method.Options;

            default:
                this.diagnostics.reportUnexpectedToken(current, [SyntaxKind.GetMethodKeyword, SyntaxKind.PostMethodKeyword, SyntaxKind.PutMethodKeyword, SyntaxKind.DeleteMethodKeyword, SyntaxKind.PatchMethodKeyword, SyntaxKind.HeadMethodKeyword, SyntaxKind.OptionsMethodKeyword], undefined, this._context.workingFile);
                return Method.Get;
        }
    }

    private parseRouter(): RouterNode {
        this._context.matchToken(SyntaxKind.RouterKeyword, false, "router");

        const path = this.parsePath();

        let body: MiddlewareOptions|undefined;
        let header: MiddlewareOptions|undefined;
        let authenticate: AuthenticateClauseNode|undefined;

        while (this._context.currentToken.kind === SyntaxKind.HeaderKeyword 
            || this._context.currentToken.kind === SyntaxKind.BodyKeyword
            || this._context.currentToken.kind === SyntaxKind.AuthenticateKeyword) {
            const current = this._context.currentToken;

            this._context.jump();

            const start = this._context.currentToken;

            if (current.kind === SyntaxKind.HeaderKeyword) {
                header = this.parseMiddlewareOptions();

                if (this._context.currentToken === start) {
                    this._context.jump();
                }
            } else if (current.kind === SyntaxKind.BodyKeyword) {
                body = this.parseMiddlewareOptions();

                if (this._context.currentToken === start) {
                    this._context.jump();
                }
            } else if (current.kind === SyntaxKind.AuthenticateKeyword) {
                authenticate = this.parseAuthenticateClause();
            }
        }

        this._context.matchToken(SyntaxKind.OpenBraceToken, false, "{");

        const router = new RouterNode(path, header, body, authenticate);

        while (this._context.currentToken.kind !== SyntaxKind.CloseBraceToken && this._context.currentToken.kind !== SyntaxKind.EndOfFileToken) {
            const start = this._context.currentToken;

            this.parseRouterChildren(router);

            if (this._context.currentToken === start) {
                this._context.jump();
            }
        }

        this._context.matchToken(SyntaxKind.CloseBraceToken, false, "}");

        return router;
    }

    private parsePath(): PathNode {
        let path = "/";
        let alias: string|undefined;
        let queryParameters: QueryParameterNode[] = [];

        this._context.matchToken(SyntaxKind.SlashToken, false, "/");

        while (this._context.currentToken.kind === SyntaxKind.SlashToken || this._context.currentToken.kind === SyntaxKind.Identifier || this._context.currentToken.kind === SyntaxKind.HashToken || this._context.currentToken.kind === SyntaxKind.MinusToken) {
            path += this._context.currentToken.text;

            this._context.jump();
        }

        if (this._context.currentToken.kind === SyntaxKind.QuestionToken) {
            queryParameters = this.parseQueryParameters();
        }

        if (this._context.currentToken.kind === SyntaxKind.AsKeyword) {
            this._context.jump();

            alias = this._context.matchToken(SyntaxKind.Identifier).text;
            // make sure the alias is a valid identifier for variable names in other languages
            alias = alias.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_$&");
        }

        return new PathNode(path, alias, queryParameters);
    }

    private parseQueryParameters(): QueryParameterNode[] {
        const parameters: QueryParameterNode[] = [];

        while (this._context.currentToken.kind === SyntaxKind.QuestionToken || this._context.currentToken.kind === SyntaxKind.AmpersandToken) {
            this._context.jump();

            const parameter = this.parseQueryParameter();
            if (parameter) {
                parameters.push(parameter);
            }
        }

        return parameters;
    }

    private parseQueryParameter(): QueryParameterNode|undefined {
        const name = this._context.matchToken(SyntaxKind.Identifier).text;

        if (this._context.currentToken.kind === SyntaxKind.EqualsToken) {
            this._context.jump();

            const type = this.parseQueryParameterType();

            return new QueryParameterNode(name, type);
        }
    }

    private parseQueryParameterType(): QueryParameterType {
        const current = this._context.currentToken;

        switch (current.kind) {
            case SyntaxKind.AnyTypeKeyword:
                this._context.jump();
                return QueryParameterType.Any;

            case SyntaxKind.StringTypeKeyword:
                this._context.jump();
                return QueryParameterType.String;

            case SyntaxKind.IntegerTypeKeyword:
                this._context.jump();
                return QueryParameterType.Int;

            case SyntaxKind.FloatTypeKeyword:
                this._context.jump();
                return QueryParameterType.Float;

            case SyntaxKind.BooleanTypeKeyword:
                this._context.jump();
                return QueryParameterType.Bool;

            case SyntaxKind.DateTypeKeyword:
                this._context.jump();
                return QueryParameterType.Date;

            case SyntaxKind.DateTimeTypeKeyword:
                this._context.jump();
                return QueryParameterType.DateTime;

            case SyntaxKind.TimeTypeKeyword:
                this._context.jump();
                return QueryParameterType.Time;

            default:
                this._context.jump();
                this.diagnostics.reportUnexpectedToken(current, [SyntaxKind.AnyTypeKeyword, SyntaxKind.StringTypeKeyword, SyntaxKind.IntegerTypeKeyword, SyntaxKind.FloatTypeKeyword, SyntaxKind.BooleanTypeKeyword, SyntaxKind.DateTypeKeyword, SyntaxKind.DateTimeTypeKeyword, SyntaxKind.TimeTypeKeyword], undefined, this._context.workingFile);
                return QueryParameterType.Any;
        }
    }

    private include(parent: RouterNode) {
        this._context.matchToken(SyntaxKind.IncludeKeyword, false, "include");

        const path = (<IStringToken>this._context.matchToken(SyntaxKind.StringLiteral)).value;

        this._context.matchToken(SyntaxKind.SemicolonToken, true);
        this._context.currentFiles.push(path);

        this._include(parent, path);

        this._context.currentFiles.pop();
    }

    private _include(parent: RouterNode, path: string) {
        Logger.info(`Including ${path}...`);

        const fullPath = pathApi.join(this._workingDirectory, path);
        const workingDir = pathApi.dirname(fullPath);
        const decoder = new TextDecoder("utf-8");

        Logger.info(`Lexing...`);
        const lexer = new Lexer({
            path: fullPath,
            filename: pathApi.basename(fullPath),
            kind: YmirFileKind.Script
        }, decoder.decode(Deno.readFileSync(fullPath)));

        const tokens = lexer.tokenize();

        Logger.info("Found %d tokens. Lets parse them...", tokens.length);
        Logger.info("Parsing...");

        const parser = new Parser(this.diagnostics, this._policy, tokens);
        parser.setWorkingDirectory(workingDir);

        const beforeRoutes = parent.routes.length;
        const beforeRouters = parent.routers.length;
        parser.parseParentNode(parent);

        Logger.success("Include-Parsing complete! Added %d routes and %d routers.", parent.routes.length - beforeRoutes, parent.routers.length - beforeRouters);
    }
}

/**
 * The context of the parser.
 */
export class ParserContext {

    private readonly _diagnostics: DiagnosticSink;
    private readonly _tokens: ISyntaxToken[];
    private _position: number;

    public currentFiles: string[] = [];

    constructor(diagnostics: DiagnosticSink, tokens: ISyntaxToken[]) {
        this._diagnostics = diagnostics;
        this._tokens = tokens;
        this._position = 0;
    }

    public get currentToken(): ISyntaxToken {
        return this.peek();
    }

    public get nextToken(): ISyntaxToken {
        return this.peek(1);
    }

    public get hasNextToken(): boolean {
        return this.currentToken.kind !== SyntaxKind.EndOfFileToken;
    }

    public get workingFile(): string|undefined {
        if (this.currentFiles.length === 0) {
            return undefined;
        }

        return this.currentFiles[this.currentFiles.length - 1];
    }

    public peek(offset: number = 0): ISyntaxToken {
        return this._position + offset < this._tokens.length ? this._tokens[this._position + offset] : this._tokens[this._tokens.length - 1];
    }

    public jump(offset: number = 1): void {
        this._position += offset;
    }

    public readToken(): ISyntaxToken {
        const token = this.currentToken;
        this.jump();
        return token;
    }

    public matchToken(kind: SyntaxKind, optional: boolean = false, hint?: string): ISyntaxToken {
        const current = this.currentToken;

        Logger.debug("Matching kind: " + this._diagnostics.transformSyntaxKind(kind) + " with current kind: " + this._diagnostics.transformSyntaxKind(current.kind) + " value: " + current.text);

        if (current.kind === kind) {
            return this.readToken();
        }

        if (optional) {
            return {
                kind,
                text: "",
                column: current.column,
                line: current.line
            };
        }

        this._diagnostics.reportError(new SourcePosition(this.workingFile, new SourceSpan(current.line ?? - 1, 1), current.column), `Expected token of kind ${this._diagnostics.transformSyntaxKind(kind)} but got ${this._diagnostics.transformSyntaxKind(current.kind)} instead.`, hint);

        return {
            kind,
            text: "",
            column: current.column,
            line: current.line
        };
    }
}

export enum ParsingPolicy {
    /**
     * The default policy. If an error is encountered, the parser will stop parsing the current script and will not add it to the list of parsed scripts.
     */
    CancelParsingOnFirstError,
    /**
     * Any errors are reported but ingored. The finished parsed script will be added to the parsing result list.
     */
    IgnoreErrors
}