import * as pathApi from "https://deno.land/std@0.182.0/path/mod.ts";
import { encode as base64Encode } from "https://deno.land/std@0.182.0/encoding/base64.ts";

import { AuthBlockNode, GlobalVariable, IPluginContext, Logger, MiddlewareNode, MiddlewareOptions, PluginBase, RouteNode, RouterNode, AuthType, ProjectNode, AuthenticateClauseNode, QueryParameterType } from "../../library/mod.ts";

export default class JavaSpringBootTargetPlugin extends PluginBase {

    private readonly _middlewareHandlers: { [key: string]: (node: MiddlewareNode) => void } = {};
    private readonly _authenticatorData: {[key: string]: { params: FieldBuilder[], field: FieldBuilder, authenticateCode: string[], authorizeCode: ((clause: AuthenticateClauseNode) => string[])|undefined }} = {};
    private readonly _createdDtos: {[key: string]: string} = {};
    private _config: TargetConfig = null!;
    private _mainPackagePath: string = null!;
    private _mainPackage: string = null!;
    private _dtoPackagePath: string = null!;
    private _dtoPackage: string = null!;
    private _configPackagePath: string = null!;
    private _configPackage: string = null!;
    private _controllerPackagePath: string = null!;
    private _controllerPackage: string = null!;
    private _authPackagePath: string = null!;
    private _authPackage: string = null!;

    public get targetFor(): string | undefined {
        return "Java_SpringBoot";
    }

    public compile(context: IPluginContext): void {
        if (context.indexFile === undefined) {
            return;
        }

        this._config = this.getConfig(context.configuration);
        this._mainPackagePath = this.initializePackagePath(context.outputDirectory, this._config.packages.main);
        this._mainPackage = this._config.packages.main;
        this._dtoPackagePath = this.initializePackagePath(this._mainPackagePath, this._config.packages.dto);
        this._dtoPackage = this.joinPackages(this._mainPackage, this._config.packages.dto);
        this._configPackagePath = this.initializePackagePath(this._mainPackagePath, this._config.packages.config);
        this._configPackage = this.joinPackages(this._mainPackage, this._config.packages.config);
        this._controllerPackagePath = this.initializePackagePath(this._mainPackagePath, this._config.packages.controller);
        this._controllerPackage = this.joinPackages(this._mainPackage, this._config.packages.controller);
        this._authPackagePath = this.initializePackagePath(this._mainPackagePath, this._config.packages.auth);
        this._authPackage = this.joinPackages(this._mainPackage, this._config.packages.auth);

        this.registerMiddlewareHandler("cors", this.compileCorsMiddleware.bind(this));

        this.compileProjectNode(context.projectNode);
    }

    private compileProjectNode(node: ProjectNode): void {
        node.middlewares.forEach(middleware => this.handleMiddleware(middleware));

        Object.values(node.authBlocks).forEach(authBlock => this.compileAuthBlockNode(authBlock));
        
        if (node.routes.length <= 0) {
            node.routers.forEach(router => this.compileRouterNode(router));
        } else {
            this.compileRouterNode(node);
        }
    }

    private compileRouterNode(node: RouterNode, parentInterface?: ClassBuilder, parentClass?: ClassBuilder, prefixRoute?: string, prefixName?: string, preAuthenticates?: AuthenticateClauseNode[], preHeaderValidations?: MiddlewareOptions, preBodyValidations?: MiddlewareOptions): void {
        const interfaceBuilder = parentInterface || new ClassBuilder(this._controllerPackage, this.makePascalCase(node.path.name === "" ? "Main" : node.path.name) + "ControllerHandler", true);
        const authenticates = preAuthenticates || [];
        const headerValidations = {...(preHeaderValidations || {}), ...(node.header || {})};
        const bodyValidations = {...(preBodyValidations || {}), ...(node.body || {})};

        const classBuilder = parentClass || new ClassBuilder(this._controllerPackage, this.makePascalCase(node.path.name === "" ? "Main" : node.path.name) + "Controller")
            .addImport("org.springframework.beans.factory.annotation.Autowired")
            .addImport("org.springframework.web.bind.annotation.*")
            .addImport(this._dtoPackage + ".*")
            .addImport(this._authPackage + ".*")
            .addAnnotation("RestController")
            .addAnnotation(`RequestMapping("${node.path.path}")`)
            .addField(new FieldBuilder("handler", interfaceBuilder.name).addAnnotation("Autowired"));

        interfaceBuilder
            .addImport(this._dtoPackage + ".*")
            .addImport(this._authPackage + ".*");

        if (node.authenticate && !authenticates.find(a => a === node.authenticate)) {
            authenticates.push(node.authenticate);
        }
        
        node.routers.forEach(router => {
            this.compileRouterNode(router, interfaceBuilder, classBuilder, (prefixRoute || "") + router.path.path, (prefixName || "") + this.makePascalCase(router.path.name), authenticates, headerValidations, bodyValidations);
        });

        node.routes.forEach(route => {
            this.compileRouteNode(route, interfaceBuilder, classBuilder, (prefixRoute || ""), (prefixName || ""), authenticates, headerValidations, bodyValidations);
        });

        interfaceBuilder.save(this._controllerPackagePath);
        classBuilder.save(this._controllerPackagePath);
    }

    private compileRouteNode(node: RouteNode, interfaceBuilder: ClassBuilder, classBuilder: ClassBuilder, prefixRoute: string, prefixName: string, authenticates: AuthenticateClauseNode[], headerValidations: MiddlewareOptions, bodyValidations: MiddlewareOptions): void {
        headerValidations = {...headerValidations, ...(node.header || {})};
        bodyValidations = {...bodyValidations, ...(node.body || {})};

        const methodName = `${this.makePascalCase(prefixName)}${this.makePascalCase(node.path.name)}`;
        const method = new MethodBuilder(`${node.method.toLowerCase()}${methodName}`, "Object")
            .addAnnotation(`RequestMapping(path = "${prefixRoute}${node.path.path}", method = RequestMethod.${node.method.toUpperCase()})`);
        const interfaceMethod = new MethodBuilder(`handle${this.makePascalCase(prefixName)}${this.makePascalCase(node.path.name)}`, "Object");

        authenticates.forEach(authenticate => {
            const authData = this._authenticatorData[authenticate.authBlock];
            if (!authData) {
                Logger.error(`Authenticator ${authenticate.authBlock} not found.`);
                return;
            }

            classBuilder.addField(authData.field);

            authData.params.forEach(param => method.addParameter(param));
            authData.authenticateCode.forEach(code => method.addBodyLine(code));
        
            if (authenticate.authorization && authData.authorizeCode) {
                authData.authorizeCode(authenticate).forEach(code => method.addBodyLine(code));
            }
        });

        const callParams: string[] = [];

        if (this._config.appendRequest) {
            method.addParameter(new FieldBuilder("request", "jakarta.servlet.http.HttpServletRequest"));
            callParams.push("request");
        }

        for (const key in headerValidations) {
            if (typeof headerValidations[key] === "string") {
                const name = "header" + this.makePascalCase(this.enusreJavaAllowedName(key));

                method.addParameter(new FieldBuilder(name, this.getJavaTypeOfType(headerValidations[key] as string)).addAnnotation(`RequestHeader("${key}")`));
                interfaceMethod.addParameter(new FieldBuilder(name, this.getJavaTypeOfType(headerValidations[key] as string)));

                callParams.push(name);
            }
        }

        node.path.queryParameters.forEach(param => {
            const name = "query" + this.makePascalCase(param.name);

            method.addParameter(new FieldBuilder(name, this.getJavaTypeOfType(param.type)).addAnnotation(`RequestParam("${param.name}")`));
            interfaceMethod.addParameter(new FieldBuilder(name, this.getJavaTypeOfType(param.type)));

            callParams.push(name);
        });

        if (Object.keys(bodyValidations).length > 0) {
            const className = this.compileBodyOptionsAsDto(bodyValidations, methodName + "Dto");
            const name = "body";

            method.addParameter(new FieldBuilder(name, className).addAnnotation("RequestBody"));
            interfaceMethod.addParameter(new FieldBuilder(name, className));

            callParams.push(name);
        }
    
        method.addBodyLine(`return this.handler.handle${this.makePascalCase(prefixName)}${this.makePascalCase(node.path.name)}(${(callParams.join(", "))});`);

        classBuilder.addMethod(method);
        interfaceBuilder.addMethod(interfaceMethod);
    }

    private compileBodyOptionsAsDto(bodyOptions: MiddlewareOptions, name: string): string {
        const hash = this.generateMiddlewareOptionsHash(bodyOptions);
        if (this._createdDtos[hash]) {
            return this._createdDtos[hash];
        }

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

        const classBuilder = compile(bodyOptions, name, this._dtoPackage);
        classBuilder.save(this._dtoPackagePath);

        this._createdDtos[hash] = classBuilder.name;

        return classBuilder.name;
    }

    private compileCorsMiddleware(node: MiddlewareNode): void {
        let origin = "*";

        if (node.options["origin"] !== undefined) {
            const originOption = node.options["origin"];
            if (originOption instanceof GlobalVariable) {
                if (originOption.path.length > 0 && originOption.path[0] === "env") {
                    origin = `System.getenv("${originOption.name}")`;
                }
            } else {
                origin = "\"" + originOption + "\"";
            }
        }

        if (this._config.useSpringSecurity) {
            const configClass = new ClassBuilder(this._configPackage, "CorsConfiguration")
                .addImport("org.springframework.security.config.annotation.web.builders.HttpSecurity")
                .addImport("org.springframework.security.config.annotation.web.configuration.EnableWebSecurity")
                .addImport("org.springframework.context.annotation.Bean")
                .addImport("org.springframework.security.web.SecurityFilterChain")
                .addAnnotation("EnableWebSecurity")
                .addMethod(new MethodBuilder("filterChain", "SecurityFilterChain")
                    .throws("Exception")
                    .addAnnotation("Bean")
                    .addParameter(new FieldBuilder("http", "HttpSecurity"))
                    .addBodyLine(`String allowedOrigin = ${origin};`)
                    .addBodyLine("http.cors().configurationSource(request -> {")
                    .addBodyLine("    org.springframework.web.cors.CorsConfiguration cors = new org.springframework.web.cors.CorsConfiguration();")
                    .addBodyLine("    cors.setAllowedOrigins(java.util.Arrays.asList(allowedOrigin));")
                    .addBodyLine("    cors.setAllowedMethods(java.util.Arrays.asList(\"*\"));")
                    .addBodyLine("    cors.setAllowedHeaders(java.util.Arrays.asList(\"*\"));")
                    .addBodyLine("    return cors;")
                    .addBodyLine("});")
                    .addBodyLine("return http.build();")
                );

            configClass.save(this._configPackagePath);
        }
        
        const configClass = new ClassBuilder(this._configPackage, "CorsConfigurationMVC")
            .addImport("org.springframework.web.servlet.config.annotation.CorsRegistry")
            .addImport("org.springframework.web.servlet.config.annotation.WebMvcConfigurer")
            .addImport("org.springframework.context.annotation.Configuration")
            .implements("WebMvcConfigurer")
            .addAnnotation("Configuration")
            .addAnnotation("EnableWebMvc")
            .addMethod(new MethodBuilder("addCorsMappings")
                .addAnnotation("Override")
                .addParameter(new FieldBuilder("registry", "CorsRegistry"))
                .addBodyLine(`String allowedOrigin = ${origin};`)
                .addBodyLine(`registry.addMapping("/**").allowedOrigins(allowedOrigin).allowedMethods("*").allowedHeaders("*");`)
            );

        configClass.save(this._configPackagePath);
    }

    private compileAuthBlockNode(node: AuthBlockNode): void {
        const authenticatorField = new FieldBuilder("authenticator", this.makePascalCase(node.name) + "Authenticator").addAnnotation("Autowired");
        const authenticateMethod = new MethodBuilder("authenticate", "boolean");
        const params: FieldBuilder[] = [];
        const authenticateCode: string[] = [];
        let authorizeCode: ((clause: AuthenticateClauseNode) => string[])|undefined = undefined;
        let vars: string[] = [];
        let pre: string[] = [];

        if (node.type === AuthType.APIKey) {
            authenticateMethod.addParameter(new FieldBuilder("apiKey", "String"));
            if (node.source === "query") {
                params.push(new FieldBuilder("apiKey", "String").addAnnotation(`RequestParam("${node.field}")`));
            } else if (node.source === "header") {
                params.push(new FieldBuilder("apiKey", "String").addAnnotation(`RequestHeader("${node.field}")`));
            } else {
                Logger.fatal("body as authentication source is not supported for APIKey authentication for JavaSpringBoot target!");
                return;
            }

            vars = ["apiKey"];
        } else if (node.type === AuthType.Bearer) {
            authenticateMethod.addParameter(new FieldBuilder("jwt", "String"));
            params.push(new FieldBuilder("jwt", "String").addAnnotation(`RequestHeader("Authorization")`));
            
            vars = ["jwt"];
            pre = ["jwt = jwt.substring(7);"];
        }

        const classBuilder = new ClassBuilder(this._authPackage, this.makePascalCase(node.name) + "Authenticator", true)
            .addMethod(authenticateMethod);

        if (node.isAuthorizationInUse) {
            const authorizeMethod = new MethodBuilder("authorize", "boolean")
                .addParameters(...vars.map(x => new FieldBuilder(x, "String")))
                .addParameter(new FieldBuilder("roles", "String[]"));

            classBuilder.addMethod(authorizeMethod);

            authorizeCode = (clause: AuthenticateClauseNode) => {
                if (clause.authorization) {
                    return [
                        `if (!this.${authenticatorField.name}.authorize(${vars.join(", ")}, new String[] { ${clause.authorization.join(", ")} })) {`,
                        `    throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN, "You are not authorized to access this resource!");`,
                        `}`
                    ];
                }

                return [];
            };
        }

        classBuilder.save(this._authPackagePath);

        authenticateCode.push(...[
            ...pre,
            `if (apiKey == null || !this.${authenticatorField.name}.authenticate(${vars.join(", ")})) {`,
            `    throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED, "You are not authorized to access this resource!");`,
            `}`
        ]);

        this._authenticatorData[node.id] = {
            params,
            field: authenticatorField,
            authenticateCode: authenticateCode,
            authorizeCode: authorizeCode
        };
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

    private initializePackagePath(base: string, packageName: string): string {
        let packagePath = base;

        packageName.split(".").forEach(part => {
            packagePath = pathApi.join(packagePath, part);

            if (!this.doesDirectoryExist(packagePath)) {
                Deno.mkdirSync(packagePath);
            }
        });

        return packagePath;
    }

    private doesDirectoryExist(path: string): boolean {
        try {
            return Deno.statSync(path).isDirectory;
        } catch {
            return false;
        }
    }

    private joinPackages(...packages: string[]): string {
        return packages.filter(p => p !== "").join(".");
    }

    private getConfig(baseConfig: {[key: string]: unknown}): TargetConfig {
        const config: TargetConfig = {
            useSpringSecurity: false,
            appendRequest: false,
            packages: {
                main: "com.example",
                dto: "dto",
                config: "config",
                controller: "controllers",
                auth: "auth",
            },
        };

        if (baseConfig.useSpringSecurity !== undefined && typeof baseConfig.useSpringSecurity === "boolean") {
            config.useSpringSecurity = baseConfig.useSpringSecurity as boolean;
        }

        if (baseConfig.appendRequest !== undefined && typeof baseConfig.appendRequest === "boolean") {
            config.appendRequest = baseConfig.appendRequest as boolean;
        }

        if (baseConfig.packages !== undefined && typeof baseConfig.packages === "object") {
            const packages = baseConfig.packages as {[key: string]: string};
            if (packages.main !== undefined && typeof packages.main === "string") {
                config.packages!.main = packages.main;
            }
            if (packages.dto !== undefined && typeof packages.dto === "string") {
                config.packages!.dto = packages.dto;
            }
            if (packages.config !== undefined && typeof packages.config === "string") {
                config.packages!.config = packages.config;
            }
            if (packages.controller !== undefined && typeof packages.controller === "string") {
                config.packages!.controller = packages.controller;
            }
            if (packages.auth !== undefined && typeof packages.auth === "string") {
                config.packages!.auth = packages.auth;
            }
        }

        return config;
    }

    private registerMiddlewareHandler(name: string, handler: (node: MiddlewareNode) => void): void {
        this._middlewareHandlers[name] = handler;
    }

    private handleMiddleware(node: MiddlewareNode): void {
        if (this._middlewareHandlers[node.name] !== undefined) {
            this._middlewareHandlers[node.name](node);
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

class ClassBuilder {

    private readonly _imports: string[] = [];
    private readonly _annotations: string[] = [];
    private readonly _methods: MethodBuilder[] = [];
    private readonly _fields: FieldBuilder[] = [];
    private readonly _innerClasses: ClassBuilder[] = [];
    private _implements: string[] = [];

    constructor(
        private readonly _package: string,
        private readonly _name: string,
        private readonly _isInterface: boolean = false
    ) {}

    public get name(): string {
        return this._name;
    }

    public implements(...interfaces: string[]): ClassBuilder {
        this._implements.push(...interfaces);
        return this;
    }

    public addImport(importPath: string): ClassBuilder {
        if (this._imports.find(i => i === importPath) !== undefined) {
            return this;
        }
        this._imports.push(importPath);
        return this;
    }

    public addAnnotation(annotation: string): ClassBuilder {
        this._annotations.push(annotation);
        return this;
    }

    public addMethod(method: MethodBuilder): ClassBuilder {
        this._methods.push(method);
        return this;
    }

    public addField(field: FieldBuilder): ClassBuilder {
        if (this._fields.find(f => f.name === field.name) !== undefined) {
            return this;
        }
        this._fields.push(field.setAsField());
        return this;
    }

    public addClass(clazz: ClassBuilder): ClassBuilder {
        if (this._isInterface) {
            throw new Error("Cannot add inner class to interface");
        }

        this._innerClasses.push(clazz);
        return this;
    }

    public save(path: string): void {
        const filePath = pathApi.join(path, `${this._name}.java`);

        Deno.writeTextFileSync(filePath, this.toString());
    }

    public toString(): string {
        let result = this._package === "" ? "" : `package ${this._package};\n`;

        if (this._imports.length > 0) {
            result += "\n";
        }

        this._imports.forEach(importPath => {
            result += `import ${importPath};\n`;
        });

        result += "\n/**\n";
        result += ` * This class was generated by YmirScript. Do not edit it manually.\n`;
        result += " */\n";

        this._annotations.forEach(annotation => {
            result += `@${annotation}\n`;
        });

        result += `public ${(this._isInterface ? 'interface' : 'class')} ${this._name} `;
        if (this._implements.length > 0) {
            result += `implements ${this._implements.join(", ")} `;
        }
        result += "{\n";

        if (this._fields.length > 0) {
            result += "\n";
        }

        this._fields.forEach(field => {
            result += "    " + field.toString() + ";\n";
        });

        this._methods.forEach(method => {
            result += "\n";
            result += method.toString(this._isInterface);
        });

        this._innerClasses.forEach(clazz => {
            result += "\n";
            result += clazz.toString();
        });

        result += "\n}\n";

        return result;
    }
}

class MethodBuilder {

    private readonly _parameters: FieldBuilder[] = [];
    private readonly _annotations: string[] = [];
    private readonly _body: string[] = [];
    private readonly _exceptions: string[] = [];

    constructor(
        private _name: string,
        private _returnType: string = "void",
        private _accessModifier: string = "public"
    ) {}

    public addParameter(parameter: FieldBuilder): MethodBuilder {
        this._parameters.push(parameter);
        return this;
    }

    public addParameters(...parameters: FieldBuilder[]): MethodBuilder {
        this._parameters.push(...parameters);
        return this;
    }

    public addAnnotation(annotation: string): MethodBuilder {
        this._annotations.push(annotation);
        return this;
    }

    public addBodyLine(line: string): MethodBuilder {
        this._body.push(line);
        return this;
    }

    public throws(...exceptions: string[]): MethodBuilder {
        this._exceptions.push(...exceptions);
        return this;
    }

    // deno-lint-ignore no-inferrable-types
    public toString(omitBody: boolean = false): string {
        let result = "";

        this._annotations.forEach(annotation => {
            result += `    @${annotation}\n`;
        });

        result += `    ${this._accessModifier} ${this._returnType} ${this._name}(`;

        if (this._parameters.length > 0) {
            this._parameters.forEach((parameter, index) => {
                result += parameter.toString();

                if (index < this._parameters.length - 1) {
                    result += ", ";
                }
            });
        }

        result += ")";

        if (this._exceptions.length > 0) {
            result += ` throws ${this._exceptions.join(", ")}`;
        }

        if (!omitBody) {
            result += " {\n";
            this._body.forEach(line => {
                result += `        ${line}\n`;
            });

            result += "    }\n";
        } else {
            result += ";\n";
        }

        return result;
    }
}

class FieldBuilder {

    private readonly _annotations: string[] = [];
    
    constructor(
        private readonly _name: string,
        private readonly _type: string,
        private _accessModifier: string = ""
    ) {}

    public get name(): string {
        return this._name;
    }

    public setAsField(): FieldBuilder {
        this._accessModifier = "private ";
        return this;
    }

    public addAnnotation(annotation: string): FieldBuilder {
        this._annotations.push(annotation);
        return this;
    }

    public toString(): string {
        let result = "";

        this._annotations.forEach(annotation => {
            result += `@${annotation} `;
        });

        result += `${this._accessModifier}${this._type} ${this._name}`;

        return result;
    }
}

interface TargetConfig {
    useSpringSecurity: boolean;
    appendRequest: boolean;
    packages: {
        main: string;
        dto: string;
        config: string;
        controller: string;
        auth: string;
    };
}