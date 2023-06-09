import * as pathApi from "https://deno.land/std@0.182.0/path/mod.ts";

import { AuthBlockNode, GlobalVariable, IPluginContext, Logger, MiddlewareNode, MiddlewareOptions, PathNode, PluginBase, RouteNode, RouterNode, AuthType, ProjectNode, AbortError, BearerAuthGenerationMode } from "../../library/mod.ts";

export default class JavaScriptExpressJsTargetPlugin extends PluginBase {

    private _middlewareHandlers: Map<string, (router: string, node: MiddlewareNode) => string[]> = new Map();
    private _exports: string[] = ["startServer", "messages", "YmirRestBase"];
    private _wasEnvUsed = false;
    private _defaultAuthenticate: string|undefined = undefined;
    private _topAppend: string[] = [];
    private readonly _authHandlers: Record<string, string> = {};

    public get targetFor(): string | undefined {
        return "JavaScript_ExpressJS";
    }

    public compile(context: IPluginContext): void {
        if (context.indexFile === undefined) {
            return;
        }

        this.registerMiddlewareHandler("env", this.envMiddleware.bind(this));
        this.registerMiddlewareHandler("json", this.jsonMiddleware.bind(this));
        this.registerMiddlewareHandler("cors", this.corsMiddleware.bind(this));

        const output = [
            "// --- GENERATED BY YMIR ---",
            "",
            "// needed validation functions",
            "const isInt = (str) => {",
            "    const v = parseInt(str);",
            "    return !isNaN(v) && isFinite(v);",
            "};",
            "const isFloat = (str) => {",
            "    const v = parseFloat(str);",
            "    return !isNaN(v) && isFinite(v);",
            "};",
            "const isBoolean = (str) => {",
            "    return str === \"true\" || str === \"false\";",
            "};",
            "const isDate = (str) => {",
            "    return !isNaN(Date.parse(str));",
            "};",
            "const isDatetime = isDate;",
            "const isTime = isDate;",
            "const isString = (str) => true;",
            "const getHeader = (headers, name) => {",
            "    const header = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());",
            "    return header === undefined ? undefined : headers[header];",
            "};",
            "",
            "const messages = {",
            "    _400: \"Bad Request: Field {field} of type {type} is required\",",
            "    _401: \"Unauthorized: You are not authorized to access this resource\",",
            "    _403: \"Forbidden: You are not allowed to access this resource\",",
            "    _404: \"Not Found: The requested resource could not be found\",",
            "    _500: \"Internal Server Error: An internal server error occurred\",",
            "    Started: \"Server started on port {port}...\",",
            "};",
            "",
            "const express = require(\"express\");",
            "const app = express();",
            ""
        ];

        const [routerOutput, _] = this.handleRouter(context.projectNode, true, "");

        output.push(...this._topAppend);
        output.push(...routerOutput);

        output.push(...[
            "",
            "const startServer = (runtime) => {",
            "    const ymir = new runtime();",
            "    ymir.build(app);",
            "    app.listen(process.env.PORT || 3000, () => {",
            "        console.log(messages.Started.replace(\"{port}\", process.env.PORT || 3000));",
            "    });",
            "};",
            "",
            `module.exports = {${(this._exports.join(", "))}};`
        ]);

        const outputFile = pathApi.join(context.outputDirectory, "ymir_base.js");

        Deno.writeTextFileSync(outputFile, output.join("\r\n"));
    }

    private handleRouter(routerNode: RouterNode, isApp: boolean, parentName: string): [string[], string[]] {
        const routerName = isApp ? 'app' : routerNode.path.name;
        const output: string[] = [];
        const preBuildFunctionLines: string[] = [];

        if (isApp) {
            if (routerNode instanceof ProjectNode) {
                for (const middleware of routerNode.middlewares) {
                    const handler = this._middlewareHandlers.get(middleware.name);
                    if (handler === undefined) {
                        Logger.warning("No handler for middleware \"%s\" found.", middleware.name);
                        continue;
                    }
        
                    const handlerCode = handler(routerName, middleware);
                    if (handlerCode.length <= 0) {
                        Logger.debug("WARNING: Handler for middleware \"%s\" returned undefined.", middleware.name);
                        continue;
                    }
        
                    output.push(...handlerCode);
                }
            }

            output.push(...["", `class YmirRestBase {`]);

            if (routerNode instanceof ProjectNode) {
                for (const authBlock of Object.values(routerNode.authBlocks)) {
                    const [authBlockOutput, authBlockBuildOutput] = this.handleAuthBlock(authBlock);
                    output.push(...authBlockOutput.map((line) => "    " + line));
                    preBuildFunctionLines.push(...authBlockBuildOutput);
                }
            }
        }

        const routerBuildFunctionLines: string[] = [];

        if (!isApp) {
            routerBuildFunctionLines.push(`const ${routerName} = express.Router();`);
            routerBuildFunctionLines.push(`outRouters["${routerName}"] = ${routerName};`);

            const validationCode = this.generateValidationCode(routerNode.header, routerNode.body, routerNode.path);
            if (validationCode.length > 0) {
                routerBuildFunctionLines.push(`${routerName}.use((req, res, next) => {`);
                routerBuildFunctionLines.push("    const validate = (req, res) => {")
                routerBuildFunctionLines.push(...validationCode.map((line) => "    " + line));
                routerBuildFunctionLines.push("        return true;");
                routerBuildFunctionLines.push("    };");
                routerBuildFunctionLines.push("");
                routerBuildFunctionLines.push("    if (!validate(req, res)) {");
                routerBuildFunctionLines.push("        return;");
                routerBuildFunctionLines.push("    }");
                routerBuildFunctionLines.push("");
                routerBuildFunctionLines.push("    next();");
                routerBuildFunctionLines.push("});");
            }

            if (routerNode.authenticate && this._authHandlers[routerNode.authenticate.authBlock]) {
                routerBuildFunctionLines.push(...[
                    `${routerName}.use(async (req, res, next) => {`,
                    `    const authResult = await this.#handle${this._authHandlers[routerNode.authenticate.authBlock]}Authentication(req, res);`,
                    "    if (authResult === undefined) {",
                    "        return false;",
                    "    }",
                ]);
    
                if (routerNode.authenticate.authorization) {
                    routerBuildFunctionLines.push(...[
                        `    const isAuthorized = await this.authorize${this._authHandlers[routerNode.authenticate.authBlock]}(authResult, [${routerNode.authenticate.authorization.join(", ")}]);`,
                        "    if (!isAuthorized) {",
                        "        res.status(403).send(messages._403);",
                        "        return false;",
                        "    }",
                    ]);
                }

                routerBuildFunctionLines.push(...[
                    "",
                    "    next();",
                    "});",
                ]);
            }

            routerBuildFunctionLines.push(`${parentName}.use("${routerNode.path.path}", ${routerName});`);
        }

        if (routerNode.routers.length > 0) {
            routerBuildFunctionLines.push("// Routers");

            for (const router of routerNode.routers) {
                const [routerCode, routerBuildFunctionLinesInternal] = this.handleRouter(router, false, routerName);
                output.push(...routerCode);
                routerBuildFunctionLines.push(...routerBuildFunctionLinesInternal);
            }
        }

        if (routerNode.routes.length > 0) {
            routerBuildFunctionLines.push("// Routes");
        }

        for (const route of routerNode.routes) {
            const [routeLines, buildFunctionLines] = this.handleRoute(route, routerName);
            output.push(...routeLines.map((line) => "    " + line));
            routerBuildFunctionLines.push(...buildFunctionLines);
        }

        if (isApp) {
            output.push(...[
                "",
                "    build(app) {",
                "        const outRouters = {};"
            ]);

            for (const line of routerBuildFunctionLines) {
                output.push(`        ${line}`);
            }

            for (const line of preBuildFunctionLines) {
                output.push(`        ${line}`);
            }

            output.push(...[
                "        app.use((err, req, res, next) => {",
                "            if (err) {",
                "                res.status(500).send(messages._500);",
                "            } else {",
                "                res.status(404).send(messages._404);",
                "            }",
                "        });",
                "        return outRouters;",
                "    }",
                "}",
            ]);
        }
        return [output, isApp ? [] : routerBuildFunctionLines];
    }

    private handleAuthBlock(authBlock: AuthBlockNode): [string[], string[]] {
        const output: string[] = [];
        const buildOutput: string[] = [];

        if (authBlock.isDefaultAccessPublic === false) {
            if (this._defaultAuthenticate) {
                Logger.fatal("Only one default authentication block can be defined.");
                throw new AbortError();
            }

            this._defaultAuthenticate = authBlock.id;
        }

        switch (authBlock.type) {
            case AuthType.APIKey:
                this._authHandlers[authBlock.id] = authBlock.name; 

                output.push(...[
                    "",
                    `async authenticate${authBlock.name}(apiKey) {`,
                    "    return true;",
                    "}",
                    "",
                    `async #handle${authBlock.name}Authentication(req, res) {`,
                ]);

                if (authBlock.source === "header") {
                    output.push(`    const apiKey = getHeader(req.headers, \"${authBlock.field}\");`);
                } else if (authBlock.source === "query") {
                    output.push(`    const apiKey = req.query[\"${authBlock.field}\"];`);
                } else {
                    output.push(`    const apiKey = req.body[\"${authBlock.field}\"];`);
                }

                output.push(...[
                    "    if (apiKey === undefined) {",
                    "        res.status(401).send(messages._401);",
                    "        return undefined;",
                    "    }",
                    "",
                    "    const isValid = await this.authenticate" + authBlock.name + "(apiKey);",
                    "    if (!isValid) {",
                    "        res.status(401).send(messages._401);",
                    "        return undefined;",
                    "    }",
                    "",
                    "    return apiKey;",
                    "}",
                ]);

                if (authBlock.isAuthorizationInUse) {
                    output.push(...[
                        "",
                        `async authorize${authBlock.name}(apiKey, roles) {`,
                        "    return true;",
                        "}"
                    ]);
                }
                break;
            // deno-lint-ignore no-case-declarations
            case AuthType.Bearer:
                this._authHandlers[authBlock.id] = authBlock.name; 
                output.push("");

                const mode = authBlock.options["mode"] as BearerAuthGenerationMode ?? BearerAuthGenerationMode.None;
                const postValidOutput: string[] = [];
                let caller = [];
    
                if (mode === BearerAuthGenerationMode.None) {
                    caller = this.handleBearerAuthForModeNone(output, postValidOutput, authBlock);
                } else if (mode === BearerAuthGenerationMode.Basic) {
                    caller = this.handleBearerAuthForModeBasic(output, buildOutput, postValidOutput, authBlock);
                } else if (mode === BearerAuthGenerationMode.Full) {
                    caller = this.handleBearerAuthForModeFull(output, buildOutput, postValidOutput, authBlock);
                } else {
                    Logger.error("Unknown bearer auth generation mode.");
                    throw new AbortError();
                }

                output.push(...[
                    "",
                    `async #handle${authBlock.name}Authentication(req, res) {`,
                ]);

                if (authBlock.source === "header") {
                    output.push(`    const jwt = getHeader(req.headers, \"Authorization\")?.replace(\"Bearer \", \"\");`);
                } else {
                    Logger.error("Bearer authentication only supports header source.");
                    throw new AbortError();
                }

                output.push(...[
                    "    if (jwt === undefined) {",
                    "        res.status(401).send(messages._401);",
                    "        return undefined;",
                    "    }",
                    "",
                    ...caller.map((line) => "    " + line),
                    "",
                    "    if (!data) {",
                    "        res.status(401).send(messages._401);",
                    "        return undefined;",
                    "    }",
                    "",
                    ...postValidOutput.map((line) => "    " + line),
                    "",
                    "    return jwt;",
                    "}",
                ]);

                if (authBlock.isAuthorizationInUse) {
                    output.push(...[
                        "",
                        `async authorize${authBlock.name}(req, roles) {`,
                        "    return true;",
                        "}"
                    ]);
                }
                break;
        }

        return [output, buildOutput];
    }

    private handleBearerAuthForModeNone(output: string[], postValidOutput: string[], authBlock: AuthBlockNode): string[] {
        output.push(...[
            `async authenticate${authBlock.name}(jwt) {`,
            "    return true;",
            "}",
        ]);

        postValidOutput.push(`req.user = jwt;`);

        return [`const data = await this.authenticate${authBlock.name}(jwt);`];
    }

    private handleBearerAuthForModeBasic(output: string[], buildOutput: string[], postValidOutput: string[], authBlock: AuthBlockNode): string[] {
        const withLogout = authBlock.options["withLogout"] as boolean ?? false;
        const loginPath = authBlock.options["loginPath"] as string ?? "/login";
        const loginSource = authBlock.options["loginSource"] as string ?? "body";
        const usernameField = authBlock.options["usernameField"] as string ?? "username";
        const passwordField = authBlock.options["passwordField"] as string ?? "password";
        const logoutPath = authBlock.options["logoutPath"] as string ?? "/logout";

        output.push(...[
            "/**",
            " * Validates the given JWT.",
            " * @param {string} jwt The JWT to validate.",
            " * @returns {object|undefined} The payload of the JWT or undefined if the validation failed.",
            " */",
            `async validateJwtFor${authBlock.name}(jwt) {`,
            "    return undefined;",
            "}",
            "",
            "/**",
            " * Generates a JWT for the given username/email and password.",
            " * @param {string} username The username/email.",
            " * @param {string} password The password.",
            " * @returns {string|undefined} The generated JWT or undefined if the authentication failed.",
            " */",
            `async generateJwtFor${authBlock.name}(username, password) {`,
            "    return undefined;",
            "}"
        ]);

        if (withLogout) {
            output.push(...[
                "",
                "/**",
                " * Logs the user out/ invalidates the JWT.",
                " * @param {string} jwt The JWT of the user.",
                " */",
                `async logout${authBlock.name}(jwt) {`,
                "    return;",
                "}",
            ]);
        }

        buildOutput.push(...[
            `app.post("${loginPath}", async (req, res) => {`,
            `    const ${usernameField} = req.${loginSource}[\"${usernameField}\"];`,
            `    const ${passwordField} = req.${loginSource}[\"${passwordField}\"];`,
            "",
            `    const jwt = await this.generateJwtFor${authBlock.name}(${usernameField}, ${passwordField});`,
            "",
            "    if (jwt === undefined) {",
            "        res.status(401).send(messages._401);",
            "        return;",
            "    }",
            "",
            "    res.send(jwt);",
            "});",
        ]);

        if (withLogout) {
            buildOutput.push(...[
                "",
                `app.post("${logoutPath}", async (req, res) => {`,
                `    const jwt = getHeader(req.headers, \"Authorization\")?.replace(\"Bearer \", \"\");`,
                "",
                `    if (jwt === undefined) {`,
                "        res.status(401).send(messages._401);",
                "        return;",
                "    }",
                "",
                `    await this.logout${authBlock.name}(jwt);`,
                "",
                "    res.send();",
                "});",
            ]);
        }

        postValidOutput.push(`req.user = data;`);

        return [`const data = await this.validateJwtFor${authBlock.name}(jwt);`];
    }

    private handleBearerAuthForModeFull(output: string[], buildOutput: string[], postValidOutput: string[], authBlock: AuthBlockNode): string[] {
        const withLogout = authBlock.options["withLogout"] as boolean ?? false;
        const loginPath = authBlock.options["loginPath"] as string ?? "/login";
        const loginSource = authBlock.options["loginSource"] as string ?? "body";
        const usernameField = authBlock.options["usernameField"] as string ?? "username";
        const passwordField = authBlock.options["passwordField"] as string ?? "password";
        const logoutPath = authBlock.options["logoutPath"] as string ?? "/logout";
        const expirationTime = authBlock.options["exp"] as number ?? 3600;
        let secret = `"${this.randomString(32)}"`;

        this._topAppend.push("const jsonwebtoken_ = require(\"jsonwebtoken\");");

        if (authBlock.options["secret"] instanceof GlobalVariable) {
            if (authBlock.options["secret"].path.length > 0 && authBlock.options["secret"].path[0] === "env") {
                secret = `process.env.${authBlock.options["secret"].name}`;
            }
        }

        output.push(...[
            "/**",
            " * Validates the given JWT payload.",
            " * @param {object} payload The payload of the JWT.",
            " * @returns {boolean|object} Whether or not the payload is valid or the transformed payload.",
            " */",
            `async validateJwtPayloadFor${authBlock.name}(payload) {`,
            "    return false;",
            "}",
            "",
            "/**",
            " * Returns the payload for the given username/email and password.",
            " * @param {string} username The username/email.",
            " * @param {string} password The password.",
            " * @returns {object|undefined} The payload or undefined if the authentication failed.",
            " */",
            `async getJwtPayloadFor${authBlock.name}(username, password) {`,
            "    return undefined;",
            "}"
        ]);

        if (withLogout) {
            output.push(...[
                "",
                "/**",
                " * Logs the user out/ invalidates the JWT. E.g: Integrate an ID in the payload and invalidate this ID on logout.",
                " * @param {object} payload The payload of the JWT.",
                " */",
                `async logout${authBlock.name}(payload) {`,
                "    return;",
                "}",
            ]);
        }

        buildOutput.push(...[
            `app.post("${loginPath}", async (req, res) => {`,
            `    const ${usernameField} = req.${loginSource}[\"${usernameField}\"];`,
            `    const ${passwordField} = req.${loginSource}[\"${passwordField}\"];`,
            "",
            `    const payload = await this.getJwtPayloadFor${authBlock.name}(${usernameField}, ${passwordField});`,
            "",
            "    if (payload === undefined) {",
            "        res.status(401).send(messages._401);",
            "        return;",
            "    }",
            "",
            `    const jwt = jsonwebtoken_.sign(payload, ${secret}, { expiresIn: '${expirationTime}s' });`,
            "",
            "    res.json({token: jwt});",
            "});",
        ]);

        if (withLogout) {
            buildOutput.push(...[
                "",
                `app.post("${logoutPath}", async (req, res) => {`,
                `    const jwt = getHeader(req.headers, \"Authorization\")?.replace(\"Bearer \", \"\");`,
                "",
                `    if (jwt === undefined) {`,
                "        res.status(401).send(messages._401);",
                "        return;",
                "    }",
                "",
                `    const payload = jsonwebtoken_.verify(jwt, ${secret});`,
                "",
                `    await this.logout${authBlock.name}(payload);`,
                "",
                "    res.send();",
                "});",
            ]);
        }

        postValidOutput.push(`req.user = data;`);

        return [
            `const payload = jsonwebtoken_.verify(jwt, ${secret});`,
            `const result = await this.validateJwtPayloadFor${authBlock.name}(payload);`,
            `const data = typeof result === "boolean" ? result ? payload : undefined : result;`
        ];
    }

    private handleRoute(route: RouteNode, routerName: string): [string[], string[]] {
        const output: string[] = [];
        const buildFunctionLines: string[] = [];

        const routeName = route.path.name;
        const handlerName = "on" + (routerName === "" ? "" : routerName.charAt(0).toUpperCase() + routerName.slice(1)) + routeName.charAt(0).toUpperCase() + routeName.slice(1);

        buildFunctionLines.push(`${(routerName === "" ? "app" : routerName)}.${route.method.toLowerCase()}("${route.path.path}", this.${handlerName}.bind(this));`);

        const methodPrefix = route.authenticate || this._defaultAuthenticate ? "async " : "";

        output.push("");

        if (route.description) {
            output.push(`/** ${route.description} */`);
        }

        output.push(`${methodPrefix}${handlerName}(req, res) {`);

        if (route.authenticate && this._authHandlers[route.authenticate.authBlock]) {
            output.push(...[
                `    const authResult = await this.#handle${this._authHandlers[route.authenticate.authBlock]}Authentication(req, res);`,
                "    if (authResult === undefined) {",
                "        return false;",
                "    }",
            ]);

            if (route.authenticate.authorization) {
                output.push(...[
                    `    const isAuthorized = await this.authorize${this._authHandlers[route.authenticate.authBlock]}(req, [${route.authenticate.authorization.join(", ")}]);`,
                    "    if (!isAuthorized) {",
                    "        res.status(403).send(messages._403);",
                    "        return false;",
                    "    }",
                ]);
            }
        } else if (this._defaultAuthenticate) {
            output.push(...[
                `    const authResult = await this.#handle${this._authHandlers[this._defaultAuthenticate]}Authentication(req, res);`,
                "    if (authResult === undefined) {",
                "        return false;",
                "    }",
            ]);
        }

        output.push(...this.generateValidationCode(route.header, route.body, route.path));
        output.push(...[
            "    return true;",
            "}"
        ]);


        return [output, buildFunctionLines];
    }

    private generateValidationCode(header: MiddlewareOptions|undefined, body: MiddlewareOptions|undefined, path: PathNode): string[] {
        const output: string[] = [];

        if (header !== undefined) {
            output.push(`    if (req.headers === undefined) {`);
            output.push(`        res.status(400).send(messages._400.replace("{field}", "header").replace("{type}", "object"));`);
            output.push(`        return false;`);
            output.push(`    }`);
            output.push("");
            output.push(`    const header = req.headers;`);

            for (const key in header) {
                if (!(header[key] instanceof Object)) {
                    output.push(`    if (getHeader(header, "${key}") === undefined) {`);
                    output.push(`        res.status(400).send(messages._400.replace("{field}", "header.${key}").replace("{type}", "${header[key]}"));`);
                    output.push(`        return false;`);
                    output.push(`    }`);
                    // @ts-ignore - we can assume, that the schema value is of string type, cause for schema validation only objects and strings are allowed
                    output.push(`    if (!is${header[key].charAt(0).toUpperCase() + header[key].slice(1)}(getHeader(header, "${key}"))) {`);
                    output.push(`        res.status(400).send(messages._400.replace("{field}", "header.${key}").replace("{type}", "${header[key]}"));`);
                    output.push(`        return false;`);
                    output.push(`    }`);
                    output.push("");
                }
            }
        }
        
        if (path.queryParameters.length > 0) {
            output.push(`    if (req.query === undefined) {`);
            output.push(`        res.status(400).send(messages._400.replace("{field}", "query").replace("{type}", "object"));`);
            output.push(`        return false;`);
            output.push(`    }`);
            output.push("");
            output.push(`    const query = req.query;`);

            for (const queryParameter of path.queryParameters) {
                output.push(`    if (query.${queryParameter.name} === undefined) {`);
                output.push(`        res.status(400).send(messages._400.replace("{field}", "query.${queryParameter.name}").replace("{type}", "${queryParameter.type}"));`);
                output.push(`        return false;`);
                output.push(`    }`);
                output.push(`    if (!is${queryParameter.type.charAt(0).toUpperCase() + queryParameter.type.slice(1)}(query.${queryParameter.name})) {`);
                output.push(`        res.status(400).send(messages._400.replace("{field}", "query.${queryParameter.name}").replace("{type}", "${queryParameter.type}"));`);
                output.push(`        return false;`);
                output.push(`    }`);
                output.push("");
            }
        }

        if (body !== undefined) {
            output.push(`    if (req.body === undefined) {`);
            output.push(`        res.status(400).send(messages._400.replace("{field}", "body").replace("{type}", "object"));`);
            output.push(`        return false;`);
            output.push(`    }`);
            output.push("");
            output.push(`    const body = req.body;`);
    
            const bodyValidation = this.generateDeepObjectValidation("body", body);
            output.push(...bodyValidation.map((line) => line));
        }

        return output;
    }

    private generateDeepObjectValidation(objName: string, schema: MiddlewareOptions): string[] {
        const output: string[] = [];

        for (const key in schema) {
            if (schema[key] instanceof Object) {
                output.push(`    if (${objName}["${key}"] === undefined) {`);
                output.push(`        res.status(400).send(messages._400.replace("{field}", "${objName}.${key}").replace("{type}", "object"));`);
                output.push(`        return false;`);
                output.push(`    }`);
                output.push("");
                output.push(...this.generateDeepObjectValidation(`${objName}.${key}`, schema[key] as MiddlewareOptions));
            } else {
                output.push(`    if (${objName}["${key}"] === undefined) {`);
                output.push(`        res.status(400).send(messages._400.replace("{field}", "${objName}.${key}").replace("{type}", "${schema[key]}"));`);
                output.push(`        return false;`);
                output.push(`    }`);
                // @ts-ignore - we can assume, that the schema value is of string type, cause for schema validation only objects and strings are allowed
                output.push(`    if (!is${schema[key].charAt(0).toUpperCase() + schema[key].slice(1)}(${objName}["${key}"])) {`);
                output.push(`        res.status(400).send(messages._400.replace("{field}", "${objName}.${key}").replace("{type}", "${schema[key]}"));`);
                output.push(`        return false;`);
                output.push(`    }`);
                output.push("");
            }
        }

        return output;
    }

    private corsMiddleware(router: string, node: MiddlewareNode): string[] {
        if (node.options === undefined) {
            return [
                `${router}.use(require("cors")());`,
            ];
        }

        let origin = "\"*\"";

        if (node.options["origin"] !== undefined) {
            const originOption = node.options["origin"];
            if (originOption instanceof GlobalVariable) {
                if (originOption.path.length > 0 && originOption.path[0] === "env") {
                    origin = `process.env.${originOption.name}`;
                }
            } else {
                origin = "\"" + originOption + "\"";
            }
        }

        return [
            `${router}.use(require("cors")({origin: ${origin}}));`,
        ];
    }

    private jsonMiddleware(router: string, _node: MiddlewareNode): string[] {
        return [
            `${router}.use(express.json());`,
        ];
    }

    private envMiddleware(_router: string, _node: MiddlewareNode): string[] {
        if (!this._wasEnvUsed) {
            this._wasEnvUsed = true;
        }

        return [
            `require("dotenv").config();`,
        ];
    }

    private registerMiddlewareHandler(name: string, handler: (router: string, node: MiddlewareNode) => string[]): void {
        this._middlewareHandlers.set(name, handler);
    }

    private randomString(length: number): string {
        const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let result = "";
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
}