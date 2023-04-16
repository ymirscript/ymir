import * as pathApi from "https://deno.land/std@0.182.0/path/mod.ts";

import { GlobalVariable, IPluginContext, Logger, MiddlewareNode, PluginBase, RouterNode } from "../../library/mod.ts";

export default class JavaScriptTargetPlugin extends PluginBase {

    private _middlewareHandlers: Map<string, (router: string, node: MiddlewareNode) => string[]> = new Map();
    private _wasEnvUsed = false;

    public get targetFor(): string | undefined {
        return "JavaScript";
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
            "const errorMessage = {",
            "    400: \"Bad Request: Field {field} of type {type} is required\",",
            "    401: \"Unauthorized: You are not authorized to access this resource\",",
            "    403: \"Forbidden: You are not allowed to access this resource\",",
            "    404: \"Not Found: The requested resource could not be found\",",
            "    Started: \"Server started on port {port}...\",",
            "};",
            "",
            "const express = require(\"express\");",
            "const app = express();",
            ""
        ];

        output.push(...this.handleRouter("app", context.projectNode));

        output.push(...[
            "",
            "const startServer = () => {",
            "    app.listen(process.env.PORT || 3000, () => {",
            "        console.log(errorMessage.Started.replace(\"{port}\", process.env.PORT || 3000));",
            "    });",
            "};",
            "",
            "module.exports = {app, startServer, errorMessage};"
        ]);

        const outputFile = pathApi.join(context.outputDirectory, "ymir_base.js");

        Deno.writeTextFileSync(outputFile, output.join("\r\n"));
    }

    private handleRouter(routerName: string, routerNode: RouterNode): string[] {
        const output: string[] = [];

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

        return output;
    }

    private corsMiddleware(router: string, node: MiddlewareNode): string[] {
        if (node.options === undefined) {
            return [
                `${router}.use(require("cors")());`,
            ];
        }

        let origin = "*";

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
}