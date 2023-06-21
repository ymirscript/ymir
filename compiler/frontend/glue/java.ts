import { AuthBlockNode, AuthType, MiddlewareOptions, ProjectNode, QueryParameterType, RouteNode, RouterNode } from "../../../library/mod.ts";
import { ClassBuilder, FieldBuilder, MethodBuilder } from "../../../targets/java/springboot.ts";
import { IFrontendGenerator } from "../generator.ts";
import * as path from "https://deno.land/std@0.182.0/path/mod.ts";
import { encode as base64Encode } from "https://deno.land/std@0.182.0/encoding/base64.ts";

export class JavaGlueCodeGenerator implements IFrontendGenerator {

    private _project: ProjectNode = null!;
    private _directory: string = null!;

    async generate(project: ProjectNode, directory: string): Promise<void> {
        this._project = project;
        this._directory = directory;
        
        await this.createDefaultRestClient();
        await this.generateGlueCode();
    }

    private async generateGlueCode() {
        const createdDtos: {[key: string]: string} = {};
        const clazz = new ClassBuilder("ymir_glue", "Api", false);

        clazz
            .addImport("java.util.Map")
            .addImport("java.util.HashMap")
            .addImport("ymir_glue.dto.*");
            
        this.generateAuthCode(clazz);

        await this.generateRouter(createdDtos, clazz, this._project);

        this.createFile("Api.java", clazz);
    }

    private async generateRouter(createdDtos: {[key: string]: string}, clazz: ClassBuilder, router: RouterNode, currentParentPath?: string) {
        const parentPath = currentParentPath ? this.combinePaths([currentParentPath, router.path.path]) : router.path.path;

        await Promise.all(router.routes.map(route => {
            return this.generateRoute(createdDtos, clazz, parentPath, route);
        }));

        await Promise.all(router.routers.map(router => {
            return this.generateRouter(createdDtos, clazz, router, parentPath);
        }));
    }

    private async generateRoute(createdDtos: {[key: string]: string}, clazz: ClassBuilder, parentPath: string, route: RouteNode) {
        const completeRoute = this.combinePaths([parentPath, route.path.path]);
        const responseDto = route.response ? await this.compileBodyOptionsAsDto(createdDtos, route.response, `${this.urlToJavaName(completeRoute)}ResponseDto`) : undefined;
        const requestDto = route.body ? await this.compileBodyOptionsAsDto(createdDtos, route.body, `${this.urlToJavaName(completeRoute)}RequestDto`) : undefined;

        const method = new MethodBuilder(this.makeCamelCase(this.enusreJavaAllowedName(route.path.alias ?? route.path.path)), responseDto ?? "void", "public static");

        const urlParamsNames = route.path.path.split("/").filter(x => x.startsWith(":")).map(x => x.substring(1));
        const urlParamsMapping: {[key: string]: string} = {};
        const reverseUrlParamsMapping: {[key: string]: string} = {};

        urlParamsNames.forEach(x => {
            let paramName = this.makeCamelCase(this.enusreJavaAllowedName(x));
            if (urlParamsMapping[paramName]) {
                paramName += Date.now() + "" + Math.floor(Math.random() * 1000);
            }

            method.addParameter(new FieldBuilder(paramName, "String"));

            urlParamsMapping[paramName] = x;
            reverseUrlParamsMapping[x] = paramName;
        });

        route.path.queryParameters.forEach(queryParam => {
            const paramName = this.makeCamelCase(this.enusreJavaAllowedName(queryParam.name));
            method.addParameter(new FieldBuilder(paramName, this.getJavaTypeOfType(queryParam.type)));
        });

        let bodyVal = "null";

        if (requestDto) {
            method.addParameter(new FieldBuilder("body", requestDto));
            bodyVal = "body";
        }

        method.addBodyLine("Map<String, Object> queryParams = new HashMap<>();");
        route.path.queryParameters.forEach(queryParam => {
            const paramName = this.makeCamelCase(this.enusreJavaAllowedName(queryParam.name));
            method.addBodyLine(`queryParams.put("${queryParam.name}", ${paramName});`);
        });

        method.addBodyLine("Map<String, String> headers = buildHeaders(null);");
        
        let url = completeRoute;
        for (const key in reverseUrlParamsMapping) {
            url = url.replace(":" + reverseUrlParamsMapping[key], "\" + encodeURIComponent(" + key + ") + \"");
        }

        if (responseDto) {
            if (route.isResponsePlural === true) {
                method.addBodyLine(`${responseDto}[] response = RestClient.${route.method.toLowerCase()}("${url}", queryParams, headers, ${bodyVal}, ${responseDto}[].class);`);
            } else {
                method.addBodyLine(`${responseDto} response = RestClient.${route.method.toLowerCase()}("${url}", queryParams, headers, ${bodyVal}, ${responseDto}.class);`);
            }
            method.addBodyLine("return response;");
        } else {
            method.addBodyLine(`RestClient.${route.method.toLowerCase()}("${url}", queryParams, headers, ${bodyVal}, Void.class);`);
        }

        clazz.addMethod(method);
    }

    private async compileBodyOptionsAsDto(createdDtos: {[key: string]: string}, bodyOptions: MiddlewareOptions, name: string): Promise<string> {
        const hash = this.generateMiddlewareOptionsHash(bodyOptions);
        if (createdDtos[hash]) {
            return createdDtos[hash];
        }

        createdDtos[hash] = name;

        const compile = (options: MiddlewareOptions, name: string, classPackage?: string) => {
            const classBuilder = new ClassBuilder(classPackage || "", name);

            for (const key in options) {
                if (typeof options[key] === "object") {
                    const innerClassBuilder = compile(options[key] as MiddlewareOptions, this.makePascalCase(key) + "Dto");
                    const className = innerClassBuilder.name;
                    classBuilder.addClass(innerClassBuilder);

                    classBuilder.addField(new FieldBuilder(this.makeCamelCase(this.enusreJavaAllowedName(key)), className));
                    classBuilder.addMethod(new MethodBuilder(`get${this.makePascalCase(key)}`, className).addBodyLine(`return this.${this.makeCamelCase(this.enusreJavaAllowedName(key))};`));
                } else if (typeof options[key] === "string") {
                    classBuilder.addField(new FieldBuilder(this.makeCamelCase(this.enusreJavaAllowedName(key)), this.getJavaTypeOfType(options[key] as string)));
                    classBuilder.addMethod(new MethodBuilder(`get${this.makePascalCase(key)}`, this.getJavaTypeOfType(options[key] as string)).addBodyLine(`return this.${this.makeCamelCase(this.enusreJavaAllowedName(key))};`));
                }
            }

            return classBuilder;
        };

        const classBuilder = compile(bodyOptions, name, "ymir_glue.dto");
        await this.createFile(path.join("dto", name + ".java"), classBuilder);

        return classBuilder.name;
    }

    private generateAuthCode(clazz: ClassBuilder) {
        const authBlock = this.getLoginAuthBlock();
        if (!authBlock) {
            return;
        }

        clazz.addField(new FieldBuilder("authToken", "String", "private static").setVal("null"));
        clazz.addMethod(new MethodBuilder("buildHeaders", "Map<String, String>", "private static").addParameter(new FieldBuilder("additionalHeaders", "Map<String, String>"))
            .addBodyLine("Map<String, String> headers = new HashMap<>();")
            .addBodyLine("if (authToken != null) {")
            .addBodyLine("    headers.put(\"Authorization\", \"Bearer \" + authToken);")
            .addBodyLine("}")
            .addBodyLine("if (additionalHeaders != null) {")
            .addBodyLine("    headers.putAll(additionalHeaders);")
            .addBodyLine("}")
            .addBodyLine("return headers;")
        );

        const withLogout = authBlock.options["withLogout"] as boolean ?? false;
        const loginPath = authBlock.options["loginPath"] as string ?? "/login";
        const logoutPath = authBlock.options["logoutPath"] as string ?? "/logout";
        const loginSource = authBlock.options["loginSource"] as string ?? "body";
        const usernameField = authBlock.options["usernameField"] as string ?? "username";
        const passwordField = authBlock.options["passwordField"] as string ?? "password";

        const loginMethod = new MethodBuilder("login", "void", "public static").addParameter(new FieldBuilder("username", "String")).addParameter(new FieldBuilder("password", "String")).throws("Exception")
            .addBodyLine("Map<String, String> headers = buildHeaders(null);")
            .addBodyLine("Map<String, Object> payload = new HashMap<>();")
            .addBodyLine("payload.put(\"" + usernameField + "\", username);")
            .addBodyLine("payload.put(\"" + passwordField + "\", password);");

        if (loginSource === "body") {
            loginMethod
                .addBodyLine("Map<String, String> response = RestClient.post(\"" + loginPath + "\", null, headers, payload, Map.class);")
                .addBodyLine("authToken = response.get(\"token\");");
        } else if (loginSource == "header") {
            loginMethod
                .addBodyLine("headers.put(\"" + usernameField + "\", username);")
                .addBodyLine("headers.put(\"" + passwordField + "\", password);")
                .addBodyLine("Map<String, String> response = RestClient.post(\"" + loginPath + "\", null, headers, null, Map.class);")
                .addBodyLine("authToken = response.get(\"token\");");
        } else if (loginSource === "query") {
            loginMethod
                .addBodyLine("Map<String, String> response = RestClient.post(\"" + loginPath + "\", payload, headers, null, Map.class);")
                .addBodyLine("authToken = response.get(\"token\");");
        } else {
            throw new Error(`Unknown login source '${loginSource}'.`);
        }
                

        clazz.addMethod(loginMethod);
        
        if (withLogout) {
            clazz.addMethod(new MethodBuilder("logout", "void", "public static").throws("Exception")
                .addBodyLine("Map<String, String> headers = buildHeaders(null);")
                .addBodyLine("RestClient.delete(\"" + logoutPath + "\", null, headers, Void.class);")
                .addBodyLine("authToken = null;")
            );
        }
    }

    private async createDefaultRestClient() {
        const clazz = new ClassBuilder("ymir_glue", "RestClient", false);
        clazz
            .addImport("java.net.URI")
            .addImport("java.net.URISyntaxException")
            .addImport("java.net.http.HttpClient")
            .addImport("java.net.http.HttpClient.Redirect")
            .addImport("java.net.http.HttpClient.Version")
            .addImport("java.net.http.HttpRequest")
            .addImport("java.net.http.HttpResponse")
            .addImport("java.net.http.HttpResponse.BodyHandlers")
            .addImport("java.util.Map")
            .addImport("com.google.gson.Gson")
            .addImport("com.google.gson.GsonBuilder")
            .addField(new FieldBuilder("API_URL", "String", "private static final").setVal("\"http://localhost:3000\""))
            .addField(new FieldBuilder("CLIENT", "HttpClient", "private static final").setVal("HttpClient.newBuilder().followRedirects(Redirect.NORMAL).version(Version.HTTP_2).build()"))
            .addField(new FieldBuilder("GSON", "Gson", "private static final").setVal("new GsonBuilder().setPrettyPrinting().create()"))
            .addMethod(new MethodBuilder("get", "<T> T", "public static").addParameter(new FieldBuilder("url", "String")).addParameter(new FieldBuilder("queryParams", "Map<String, Object>")).addParameter(new FieldBuilder("headers", "Map<String, String>")).addParameter(new FieldBuilder("requestObject", "Object")).addParameter(new FieldBuilder("responseType", "Class<T>")).throws("Exception")
                .addBodyLine("headers = headers == null ? Map.of() : headers;")
                .addBodyLine("HttpRequest request = HttpRequest.newBuilder()")
                .addBodyLine("    .uri(buildUri(url, queryParams))")
                .addBodyLine("    .headers(headers.entrySet().stream()")
                .addBodyLine("            .map(e -> e.getKey() + \":\" + e.getValue())")
                .addBodyLine("            .toArray(String[]::new))")
                .addBodyLine("    .method(\"GET\", HttpRequest.BodyPublishers.ofString(toJson(requestObject)))")
                .addBodyLine("    .build();")
                .addBodyLine("HttpResponse<String> response = CLIENT.send(request, BodyHandlers.ofString());")
                .addBodyLine("return fromJson(response.body(), responseType);")
            )
            .addMethod(new MethodBuilder("post", "<T> T", "public static").addParameter(new FieldBuilder("url", "String")).addParameter(new FieldBuilder("queryParams", "Map<String, Object>")).addParameter(new FieldBuilder("headers", "Map<String, String>")).addParameter(new FieldBuilder("requestObject", "Object")).addParameter(new FieldBuilder("responseType", "Class<T>")).throws("Exception")
                .addBodyLine("headers = headers == null ? Map.of() : headers;")
                .addBodyLine("HttpRequest request = HttpRequest.newBuilder()")
                .addBodyLine("    .uri(buildUri(url, queryParams))")
                .addBodyLine("    .headers(headers.entrySet().stream()")
                .addBodyLine("            .map(e -> e.getKey() + \":\" + e.getValue())")
                .addBodyLine("            .toArray(String[]::new))")
                .addBodyLine("    .POST(HttpRequest.BodyPublishers.ofString(toJson(requestObject)))")
                .addBodyLine("    .build();")
                .addBodyLine("HttpResponse<String> response = CLIENT.send(request, BodyHandlers.ofString());")
                .addBodyLine("return fromJson(response.body(), responseType);")
            )
            .addMethod(new MethodBuilder("put", "<T> T", "public static").addParameter(new FieldBuilder("url", "String")).addParameter(new FieldBuilder("queryParams", "Map<String, Object>")).addParameter(new FieldBuilder("headers", "Map<String, String>")).addParameter(new FieldBuilder("requestObject", "Object")).addParameter(new FieldBuilder("responseType", "Class<T>")).throws("Exception")
                .addBodyLine("headers = headers == null ? Map.of() : headers;")
                .addBodyLine("HttpRequest request = HttpRequest.newBuilder()")
                .addBodyLine("    .uri(buildUri(url, queryParams))")
                .addBodyLine("    .headers(headers.entrySet().stream()")
                .addBodyLine("            .map(e -> e.getKey() + \":\" + e.getValue())")
                .addBodyLine("            .toArray(String[]::new))")
                .addBodyLine("    .PUT(HttpRequest.BodyPublishers.ofString(toJson(requestObject)))")
                .addBodyLine("    .build();")
                .addBodyLine("HttpResponse<String> response = CLIENT.send(request, BodyHandlers.ofString());")
                .addBodyLine("return fromJson(response.body(), responseType);")
            )
            .addMethod(new MethodBuilder("delete", "<T> T", "public static").addParameter(new FieldBuilder("url", "String")).addParameter(new FieldBuilder("queryParams", "Map<String, Object>")).addParameter(new FieldBuilder("headers", "Map<String, String>")).addParameter(new FieldBuilder("requestObject", "Object")).addParameter(new FieldBuilder("responseType", "Class<T>")).throws("Exception")
                .addBodyLine("headers = headers == null ? Map.of() : headers;")
                .addBodyLine("HttpRequest request = HttpRequest.newBuilder()")
                .addBodyLine("    .uri(buildUri(url, queryParams))")
                .addBodyLine("    .headers(headers.entrySet().stream()")
                .addBodyLine("            .map(e -> e.getKey() + \":\" + e.getValue())")
                .addBodyLine("            .toArray(String[]::new))")
                .addBodyLine("    .method(\"DELETE\", HttpRequest.BodyPublishers.ofString(toJson(requestObject)))")
                .addBodyLine("    .build();")
                .addBodyLine("HttpResponse<String> response = CLIENT.send(request, BodyHandlers.ofString());")
                .addBodyLine("return fromJson(response.body(), responseType);")
            )
            .addMethod(new MethodBuilder("patch", "<T> T", "public static").addParameter(new FieldBuilder("url", "String")).addParameter(new FieldBuilder("queryParams", "Map<String, Object>")).addParameter(new FieldBuilder("headers", "Map<String, String>")).addParameter(new FieldBuilder("requestObject", "Object")).addParameter(new FieldBuilder("responseType", "Class<T>")).throws("Exception")
                .addBodyLine("headers = headers == null ? Map.of() : headers;")
                .addBodyLine("HttpRequest request = HttpRequest.newBuilder()")
                .addBodyLine("    .uri(buildUri(url, queryParams))")
                .addBodyLine("    .headers(headers.entrySet().stream()")
                .addBodyLine("            .map(e -> e.getKey() + \":\" + e.getValue())")
                .addBodyLine("            .toArray(String[]::new))")
                .addBodyLine("    .method(\"PATCH\", HttpRequest.BodyPublishers.ofString(toJson(requestObject)))")
                .addBodyLine("    .build();")
                .addBodyLine("HttpResponse<String> response = CLIENT.send(request, BodyHandlers.ofString());")
                .addBodyLine("return fromJson(response.body(), responseType);")
            );
        
        clazz
            .addMethod(
                new MethodBuilder("buildUri", "URI", "private static")
                    .addParameter(new FieldBuilder("url", "String"))
                    .addParameter(new FieldBuilder("queryParams", "Map<String, Object>"))
                    .throws("URISyntaxException")
                    .addBodyLine("StringBuilder sb = new StringBuilder(API_URL + url);")
                    .addBodyLine("if (queryParams != null && !queryParams.isEmpty()) {")
                    .addBodyLine("    sb.append(\"?\");")
                    .addBodyLine("    queryParams.forEach((k, v) -> sb.append(k).append(\"=\").append(encodeURIComponent(v.toString())).append(\"&\"));")
                    .addBodyLine("    sb.deleteCharAt(sb.length() - 1);")
                    .addBodyLine("}")
                    .addBodyLine("return new URI(sb.toString());")
            )
            .addMethod(
                new MethodBuilder("fromJson", "<T> T", "private static")
                    .addParameter(new FieldBuilder("json", "String"))
                    .addParameter(new FieldBuilder("responseType", "Class<T>"))
                    .addBodyLine("return GSON.fromJson(json, responseType);")
            )
            .addMethod(
                new MethodBuilder("toJson", "String", "private static")
                    .addParameter(new FieldBuilder("obj", "Object"))
                    .addBodyLine("return GSON.toJson(obj);")
            )
            .addMethod(
                new MethodBuilder("encodeURIComponent", "String", "private static")
                    .addParameter(new FieldBuilder("str", "String"))
                    .addBodyLine("return str.replaceAll(\"[^\\\\w]\", \"%$0\");")
            )

        await this.createFileOnce("RestClient.java", clazz);
    }

    private async createFileOnce(name: string, classBuilder: ClassBuilder) {
        const filePath = path.join(this._directory, name);
        if (!await Deno.stat(filePath).then(x => x.isFile).catch(() => false)) {
            await Deno.writeTextFile(filePath, classBuilder.toString());
        }
    }

    private async createFile(name: string, classBuilder: ClassBuilder) {
        const filePath = path.join(this._directory, name);

        const directories = path.dirname(filePath).split(path.SEP);
        for (let i = 0; i < directories.length; i++) {
            const directory = directories.slice(0, i + 1).join(path.SEP);
            if (!await Deno.stat(directory).then(x => x.isDirectory).catch(() => false)) {
                await Deno.mkdir(directory);
            }
        }

        await Deno.writeTextFile(filePath, classBuilder.toString());
    }

    private getLoginAuthBlock(): AuthBlockNode|undefined {
        return Object.values(this._project.authBlocks).find(x => x.type === AuthType.Bearer && x.options["mode"] === "FULL");
    }

    private combinePaths(paths: string[]): string {
        return paths.join("/").replace(/\/+/g, "/");
    }

    private urlToJavaName(url: string): string {
        return this.enusreJavaAllowedName(url.split("/").map(x => this.makePascalCase(x)).join(""));
    }

    private enusreJavaAllowedName(name: string): string {
        if (name === "default") {
            return "default_";
        }
        if (name === "package") {
            return "package_";
        }

        const trimmed = name.replace(/[^a-zA-Z0-9]/g, "");
        if (trimmed.length === 0) {
            return "param" + Date.now();
        }
        if (trimmed[0].match(/[0-9]/)) {
            return "_" + trimmed;
        }
        return trimmed;
    }

    private makeCamelCase(name: string): string {
        if (name.length === 0) {
            return name;
        }
        return name[0].toLowerCase() + name.slice(1);
    }

    private makePascalCase(name: string): string {
        if (name.length === 0) {
            return name;
        }
        return name[0].toUpperCase() + name.slice(1);
    }

    private getJavaTypeOfType(queryType: string): string {
        switch (queryType) {
            case QueryParameterType.String:
                return "String";
            case QueryParameterType.Int:
                return "long";
            case QueryParameterType.Float:
                return "double";
            case QueryParameterType.Bool:
                return "boolean";
            case QueryParameterType.Date:
                return "java.time.LocalDate";
            case QueryParameterType.DateTime:
                return "java.time.LocalDateTime";
            case QueryParameterType.Time:
                return "java.time.LocalTime";
            default:
                return "Object";
        }
    }

    private generateMiddlewareOptionsHash(options: MiddlewareOptions): string {
        const sortObjectKeysRecursively = (obj: {[key: string]: unknown}): {[key: string]: unknown} => {
            const sorted: {[key: string]: unknown} = {};

            Object.keys(obj).sort().forEach(key => {
                if (typeof obj[key] === "object" && obj[key] !== null) {
                    sorted[key] = sortObjectKeysRecursively(obj[key] as {[key: string]: unknown});
                } else {
                    sorted[key] = obj[key];
                }
            });

            return sorted;
        }

        const sortedOptions = sortObjectKeysRecursively(options);
        const trimmedOptions = JSON.stringify(sortedOptions).replace(/ /g, "").replace(/\n/g, "");
        
        return base64Encode(trimmedOptions);
    }
}