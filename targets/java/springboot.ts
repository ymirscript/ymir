import * as pathApi from "https://deno.land/std@0.182.0/path/mod.ts";
import { encode as base64Encode } from "https://deno.land/std@0.182.0/encoding/base64.ts";

import { AuthBlockNode, GlobalVariable, IPluginContext, Logger, MiddlewareNode, MiddlewareOptions, PluginBase, RouteNode, RouterNode, AuthType, ProjectNode, AuthenticateClauseNode, QueryParameterType, AbortError, BearerAuthGenerationMode } from "../../library/mod.ts";

export default class JavaSpringBootTargetPlugin extends PluginBase {

    private readonly _middlewareHandlers: { [key: string]: (node: MiddlewareNode) => void } = {};
    private readonly _authenticatorData: {[key: string]: { params: FieldBuilder[], field: FieldBuilder, authenticateCode: string[], authorizeCode: ((clause: AuthenticateClauseNode) => string[])|undefined, additionalHandlerParams: ({name: string, type: string})[] }} = {};
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
    private _defaultAuthenticate: AuthenticateClauseNode | undefined = undefined;

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

        if (authenticates.length <= 0 && this._defaultAuthenticate) {
            authenticates.push(this._defaultAuthenticate);
        }

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
        authenticates = [...authenticates, ...(node.authenticate ? [node.authenticate] : [])];

        const convertPathString = (input: string): string => {
            const regex = /:(\w+)/g;
            return input.replace(regex, '{$1}');
        };

        const convertedPath = convertPathString(`${prefixRoute}${node.path.path}`);
        const methodName = `${this.makePascalCase(prefixName)}${this.makePascalCase(node.path.name)}`;
        const method = new MethodBuilder(`${node.method.toLowerCase()}${methodName}`, "Object")
            .addAnnotation(`RequestMapping(path = "${convertedPath}", method = RequestMethod.${node.method.toUpperCase()})`);
        const interfaceMethod = new MethodBuilder(`handle${this.makePascalCase(prefixName)}${this.makePascalCase(node.path.name)}`, "Object");

        if (node.description) {
            interfaceMethod.addComment(node.description);
        }

        const callParams: string[] = [];

        authenticates.forEach(authenticate => {
            const authData = this._authenticatorData[authenticate.authBlock];
            if (!authData) {
                Logger.error(`Authenticator ${authenticate.authBlock} not found.`);
                return;
            }

            classBuilder.addField(authData.field);

            for (const additionalParam of authData.additionalHandlerParams) {
                interfaceMethod.addParameter(new FieldBuilder(additionalParam.name, additionalParam.type));
                callParams.push(additionalParam.name);
            }

            authData.params.forEach(param => method.addParameter(param));
            authData.authenticateCode.forEach(code => method.addBodyLine(code));
        
            if (authenticate.authorization && authData.authorizeCode) {
                authData.authorizeCode(authenticate).forEach(code => method.addBodyLine(code));
            }
        });

        if (this._config.appendRequest) {
            method.addParameter(new FieldBuilder("request", "jakarta.servlet.http.HttpServletRequest"));
            interfaceMethod.addParameter(new FieldBuilder("request", "jakarta.servlet.http.HttpServletRequest"));
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

        const extractPathVariables = (input: string): string[] => {
            const regex = /{([\w-]+)(?:<[^>]*>)?}/g;
            const matches = Array.from(input.matchAll(regex));
            return matches.map(match => match[1]);
        };

        extractPathVariables(convertedPath).forEach(pathVarName => {
            let varName = this.makeCamelCase(pathVarName);
            if (varName === "class") {
                varName = "clazz";
            } else if (varName === "") {
                varName = "pathVar" + Math.floor(Math.random() * 1000000);
            }

            method.addParameter(new FieldBuilder(varName, "String").addAnnotation(`PathVariable("${pathVarName}")`));
            interfaceMethod.addParameter(new FieldBuilder(varName, "String"));

            callParams.push(varName);
        });
    
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
        const methods: MethodBuilder[] = [];
        const params: FieldBuilder[] = [];
        const authenticateCode: string[] = [];
        let authorizeCode: ((clause: AuthenticateClauseNode) => string[])|undefined = undefined;
        const vars: {name: string, type: string}[] = [];
        const additionalHandlerParams: {name: string, type: string}[] = [];
        const pre: string[] = [];


        if (node.isDefaultAccessPublic === false) {
            if (this._defaultAuthenticate) {
                Logger.fatal("Only one default authentication block can be defined.");
                throw new AbortError();
            }

            this._defaultAuthenticate = new AuthenticateClauseNode(node.id);
        }

        let caller: (authenticator: string) => string[] = (authenticator: string) => {
            return [
                ...pre,
                `if (${(vars.map(x => x.name).map(x => `${x} == null`).join(" || "))} || !this.${authenticator}.authenticate(${vars.map(x => x.name).join(", ")})) {`,
                `    throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED, "You are not authorized to access this resource!");`,
                `}`
            ];
        };

        if (node.type === AuthType.APIKey) {
            this.compileApiKeyAuth(node, methods, params, vars);
        } else if (node.type === AuthType.Bearer) {
            caller = this.compileBearerAuth(node, methods, params, vars, pre, additionalHandlerParams);
        }

        const classBuilder = new ClassBuilder(this._authPackage, this.makePascalCase(node.name) + "Authenticator", true)
        
        for (const method of methods) {
            classBuilder.addMethod(method);
        }

        if (node.isAuthorizationInUse) {
            const authorizeMethod = new MethodBuilder("authorize", "boolean")
                .addParameters(...vars.map(x => new FieldBuilder(x.name, x.type)))
                .addParameter(new FieldBuilder("roles", "String[]"));

            classBuilder.addMethod(authorizeMethod);

            authorizeCode = (clause: AuthenticateClauseNode) => {
                if (clause.authorization) {
                    return [
                        `if (!this.${authenticatorField.name}.authorize(${vars.map(x => x.name).join(", ")}, new String[] { ${clause.authorization.join(", ")} })) {`,
                        `    throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN, "You are not authorized to access this resource!");`,
                        `}`
                    ];
                }

                return [];
            };
        }

        classBuilder.save(this._authPackagePath);

        authenticateCode.push(...caller(authenticatorField.name));

        this._authenticatorData[node.id] = {
            params,
            field: authenticatorField,
            authenticateCode: authenticateCode,
            authorizeCode: authorizeCode,
            additionalHandlerParams
        };
    }

    private compileApiKeyAuth(node: AuthBlockNode, methods: MethodBuilder[], params: FieldBuilder[], vars: {name: string, type: string}[]): void {
        const authenticateMethod = new MethodBuilder("authenticate", "boolean").addParameter(new FieldBuilder("apiKey", "String"));
        methods.push(authenticateMethod);
        if (node.source === "query") {
            params.push(new FieldBuilder("apiKey", "String").addAnnotation(`RequestParam("${node.field}")`));
        } else if (node.source === "header") {
            params.push(new FieldBuilder("apiKey", "String").addAnnotation(`RequestHeader("${node.field}")`));
        } else {
            Logger.fatal("body as authentication source is not supported for APIKey authentication for JavaSpringBoot target!");
            return;
        }
    
        vars.push({name: "apiKey", type: "String"});
    }
    
    private compileBearerAuth(node: AuthBlockNode, methods: MethodBuilder[], params: FieldBuilder[], vars: {name: string, type: string}[], pre: string[], additionalHandlerParams: {name: string, type: string}[]): (authenticator: string) => string[] {
        pre.push("jwt = jwt.substring(7);");

        const mode = node.options["mode"] as BearerAuthGenerationMode ?? BearerAuthGenerationMode.None;
        let caller: (authenticator: string) => string[] = null!;
        
        if (mode === BearerAuthGenerationMode.None) {
            caller = this.compileBearerAuthModeNone(methods, params, vars, pre);
        } else if (mode === BearerAuthGenerationMode.Basic) {
            caller = this.compileBearerAuthModeBasic(node, methods, params, vars, pre);
        } else if (mode === BearerAuthGenerationMode.Full) {
            caller = this.compileBearerAuthModeFull(node, methods, params, vars, pre, additionalHandlerParams);
        } else {
            Logger.fatal("Unknown bearer auth generation mode: %s", mode);
            throw new AbortError();
        }

        return caller;
    }

    private compileBearerAuthModeNone(methods: MethodBuilder[], params: FieldBuilder[], vars: {name: string, type: string}[], pre: string[]): (authenticator: string) => string[] {
        const authenticateMethod = new MethodBuilder("authenticate", "boolean").addParameter(new FieldBuilder("jwt", "String"));
        methods.push(authenticateMethod);
        params.push(new FieldBuilder("jwt", "String").addAnnotation(`RequestHeader("Authorization")`));
    
        vars.push({name: "jwt", type: "String"});

        return (authenticator: string) => {
            return [
                ...pre,
                `if (${(vars.map(x => x.name).map(x => `${x} == null`).join(" || "))} || !this.${authenticator}.authenticate(${vars.map(x => x.name).join(", ")})) {`,
                `    throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED, "You are not authorized to access this resource!");`,
                `}`
            ];
        };
    }

    private compileBearerAuthModeBasic(authBlock: AuthBlockNode, methods: MethodBuilder[], params: FieldBuilder[], vars: {name: string, type: string}[], pre: string[]): (authenticator: string) => string[] {
        const withLogout = authBlock.options["withLogout"] as boolean ?? false;
        const loginPath = authBlock.options["loginPath"] as string ?? "/login";
        const loginSource = authBlock.options["loginSource"] as string ?? "body";
        const usernameField = authBlock.options["usernameField"] as string ?? "username";
        const passwordField = authBlock.options["passwordField"] as string ?? "password";
        const logoutPath = authBlock.options["logoutPath"] as string ?? "/logout";

        vars.push({name: "jwt", type: "String"});
        params.push(new FieldBuilder("jwt", "String").addAnnotation(`RequestHeader("Authorization")`));

        methods.push(...[
            new MethodBuilder(`validateJwt`, "java.util.Map<String, Object>")
                .addParameter(new FieldBuilder("jwt", "String"))
                .addComment("Validates the JWT and returns the claims if valid.", "@param jwt The JWT to validate.", "@return The claims of the JWT if valid, null otherwise."),
            new MethodBuilder(`generateJwt`, "String")
                .addParameter(new FieldBuilder("username", "String"))
                .addParameter(new FieldBuilder("password", "String"))
                .addComment("Generates a JWT for the specified user.", "@param username The username/email of the user.", "@param password The password of the user.", "@return The generated JWT, or null if the user could not be authenticated."),
        ]);

        const authController = new ClassBuilder(this._authPackage, this.makePascalCase(authBlock.name) + "AuthController")
            .addImport("org.springframework.beans.factory.annotation.Autowired")
            .addImport("org.springframework.web.bind.annotation.*")
            .addImport(this._authPackage + ".*")
            .addAnnotation("RestController")
            .addField(new FieldBuilder("authenticator", this.makePascalCase(authBlock.name) + "Authenticator").addAnnotation("Autowired"));

        const loginMethod = new MethodBuilder("login", "String")
            .addAnnotation(`RequestMapping(path = "${loginPath}", method = RequestMethod.POST)`);

        if (loginSource === "body") {
            loginMethod.addParameter(new FieldBuilder("body", this.compileBodyOptionsAsDto({[usernameField]: "String", [passwordField]: "String"}, "LoginDto")).addAnnotation("RequestBody"));
            loginMethod.addBodyLine(`return this.authenticator.generateJwt(body.get${this.makePascalCase(usernameField)}(), body.get${this.makePascalCase(passwordField)}());`);
        } else if (loginSource === "query") {
            loginMethod.addParameter(new FieldBuilder("username", "String").addAnnotation(`RequestParam("${usernameField}")`));
            loginMethod.addParameter(new FieldBuilder("password", "String").addAnnotation(`RequestParam("${passwordField}")`));
            loginMethod.addBodyLine(`return this.authenticator.generateJwt(username, password);`);
        } else if (loginSource === "header") {
            loginMethod.addParameter(new FieldBuilder("username", "String").addAnnotation(`RequestHeader("${usernameField}")`));
            loginMethod.addParameter(new FieldBuilder("password", "String").addAnnotation(`RequestHeader("${passwordField}")`));
            loginMethod.addBodyLine(`return this.authenticator.generateJwt(username, password);`);
        } else {
            Logger.fatal("Unknown login source: %s", loginSource);
            throw new AbortError();
        }

        authController.addMethod(loginMethod);

        if (withLogout) {
            methods.push(new MethodBuilder(`logout`, "void")
                .addParameter(new FieldBuilder("jwt", "String"))
                .addComment("Logs out the user with the specified JWT.", "@param jwt The JWT of the user to log out.")
            );

            const logoutMethod = new MethodBuilder("logout", "org.springframework.http.ResponseEntity<Void>")
                .addAnnotation(`RequestMapping(path = "${logoutPath}", method = RequestMethod.POST)`)
                .addParameter(new FieldBuilder("jwt", "String").addAnnotation(`RequestHeader("Authorization")`));

            logoutMethod.addBodyLine("this.authenticator.logout(jwt);");
            logoutMethod.addBodyLine("return org.springframework.http.ResponseEntity.ok().build();");

            authController.addMethod(logoutMethod);
        }

        authController.save(this._authPackagePath);

        return (authenticator: string) => {
            return [
                ...pre,
                `java.util.Map<String, Object> payload = this.${authenticator}.validateJwt(${vars.map(x => x.name).join(", ")});`,
                `if (${(vars.map(x => x.name).map(x => `${x} == null`).join(" || "))} || payload == null) {`,
                `    throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED, "You are not authorized to access this resource!");`,
                `}`
            ];
        };
    }

    private compileBearerAuthModeFull(authBlock: AuthBlockNode, methods: MethodBuilder[], params: FieldBuilder[], vars: {name: string, type: string}[], pre: string[], additionalHandlerParams: {name: string, type: string}[]): (authenticator: string) => string[] {
        const withLogout = authBlock.options["withLogout"] as boolean ?? false;
        const loginPath = authBlock.options["loginPath"] as string ?? "/login";
        const loginSource = authBlock.options["loginSource"] as string ?? "body";
        const usernameField = authBlock.options["usernameField"] as string ?? "username";
        const passwordField = authBlock.options["passwordField"] as string ?? "password";
        const logoutPath = authBlock.options["logoutPath"] as string ?? "/logout";
        const expirationTime = authBlock.options["exp"] as number ?? 3600;
        let secret = `"${this.randomString(32)}"`;

        if (authBlock.options["secret"] instanceof GlobalVariable) {
            if (authBlock.options["secret"].path.length > 0 && authBlock.options["secret"].path[0] === "env") {
                secret = `process.env.${authBlock.options["secret"].name}`;
            }
        }

        vars.push({name: "jwt", type: "String"});
        params.push(new FieldBuilder("jwt", "String").addAnnotation(`RequestHeader("Authorization")`));

        methods.push(...[
            new MethodBuilder(`validateJwtPayload`, "Object")
                .addParameter(new FieldBuilder("payload", "java.util.Map<String, Object>"))
                .addComment("Validates the JWT payload and returns the transformed user data.", "@param payload The payload of the JWT to validate.", "@return The transformed user data of the JWT if valid, null otherwise."),
            new MethodBuilder(`getJwtPayload`, "Map<String, Object>")
                .addParameter(new FieldBuilder("username", "String"))
                .addParameter(new FieldBuilder("password", "String"))
                .addComment("Gets the JWT payload for the specified user.", "@param username The username/email of the user.", "@param password The password of the user.", "@return The JWT payload, or null if the user could not be authenticated."),
        ]);

        const authUtilClass = new ClassBuilder(this._authPackage, this.makePascalCase(authBlock.name) + "AuthUtil")
            .addImport("com.auth0.jwt.JWT")
            .addImport("com.auth0.jwt.algorithms.Algorithm")
            .addField(new FieldBuilder("secret", "Algorithm", "private static final").setVal(`Algorithm.HMAC256(${secret})`))
            .addField(new FieldBuilder("expirationTime", "long", "private static final").setVal(`${expirationTime}L`));

        authUtilClass.addMethod(new MethodBuilder("generateJwt", "String")
            .addParameter(new FieldBuilder("payload", "java.util.Map<String, Object>"))
            .addComment("Generates a JWT for the specified payload.", "@param payload The payload of the JWT to generate.", "@return The generated JWT.")
            .addBodyLine(`if (payload == null) {`)
            .addBodyLine(`    throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED, "You are not authorized to access this resource!");`)
            .addBodyLine(`}`)
            .addBodyLine("return JWT.create().withPayload(payload).withExpiresAt(new java.util.Date(java.lang.System.currentTimeMillis() + expirationTime * 1000L)).sign(secret);")
        );
        authUtilClass.addMethod(new MethodBuilder("validateJwt", "java.util.Map<String, Object>")
            .addParameter(new FieldBuilder("jwt", "String"))
            .addComment("Validates the JWT and returns the claims if valid.", "@param jwt The JWT to validate.", "@return The claims of the JWT if valid, null otherwise.")
            .addBodyLine("try {")
            .addBodyLine("    return JWT.require(secret).build().verify(jwt).getClaims();")
            .addBodyLine("} catch (com.auth0.jwt.exceptions.JWTVerificationException e) {")
            .addBodyLine("    return null;")
            .addBodyLine("}")
        );

        authUtilClass.save(this._authPackagePath);

        const authController = new ClassBuilder(this._authPackage, this.makePascalCase(authBlock.name) + "AuthController")
            .addImport("org.springframework.beans.factory.annotation.Autowired")
            .addImport("org.springframework.web.bind.annotation.*")
            .addImport(this._authPackage + ".*")
            .addAnnotation("RestController")
            .addField(new FieldBuilder("authenticator", this.makePascalCase(authBlock.name) + "Authenticator").addAnnotation("Autowired"));

        const loginMethod = new MethodBuilder("login", "String")
            .addAnnotation(`RequestMapping(path = "${loginPath}", method = RequestMethod.POST)`);

        if (loginSource === "body") {
            loginMethod.addParameter(new FieldBuilder("body", this.compileBodyOptionsAsDto({[usernameField]: "String", [passwordField]: "String"}, "LoginDto")).addAnnotation("RequestBody"));
            loginMethod.addBodyLine(`return ${this._authPackage}.${this.makePascalCase(authBlock.name)}AuthUtil.generateJwt(this.authenticator.getJwtPayload(body.get${this.makePascalCase(usernameField)}(), body.get${this.makePascalCase(passwordField)}()));`);
        } else if (loginSource === "query") {
            loginMethod.addParameter(new FieldBuilder("username", "String").addAnnotation(`RequestParam("${usernameField}")`));
            loginMethod.addParameter(new FieldBuilder("password", "String").addAnnotation(`RequestParam("${passwordField}")`));
            loginMethod.addBodyLine(`return ${this._authPackage}.${this.makePascalCase(authBlock.name)}AuthUtil.generateJwt(this.authenticator.getJwtPayload(username, password));`);
        } else if (loginSource === "header") {
            loginMethod.addParameter(new FieldBuilder("username", "String").addAnnotation(`RequestHeader("${usernameField}")`));
            loginMethod.addParameter(new FieldBuilder("password", "String").addAnnotation(`RequestHeader("${passwordField}")`));
            loginMethod.addBodyLine(`return ${this._authPackage}.${this.makePascalCase(authBlock.name)}AuthUtil.generateJwt(this.authenticator.getJwtPayload(username, password));`);
        } else {
            Logger.fatal("Unknown login source: %s", loginSource);
            throw new AbortError();
        }

        authController.addMethod(loginMethod);

        if (withLogout) {
            methods.push(new MethodBuilder(`logout`, "void")
                .addParameter(new FieldBuilder("jwt", "String"))
                .addComment("Logs out the user with the specified JWT.", "@param jwt The JWT of the user to log out.")
            );

            const logoutMethod = new MethodBuilder("logout", "org.springframework.http.ResponseEntity<Void>")
                .addAnnotation(`RequestMapping(path = "${logoutPath}", method = RequestMethod.POST)`)
                .addParameter(new FieldBuilder("jwt", "String").addAnnotation(`RequestHeader("Authorization")`));

            logoutMethod.addBodyLine("this.authenticator.logout(jwt);");
            logoutMethod.addBodyLine("return org.springframework.http.ResponseEntity.ok().build();");

            authController.addMethod(logoutMethod);
        }

        authController.save(this._authPackagePath);
        additionalHandlerParams.push({name: "userData", type: "Object"});

        return (authenticator: string) => {
            return [
                ...pre,
                `java.util.Map<String, Object> payload = ${this._authPackage}.${this.makePascalCase(authBlock.name)}AuthUtil.validateJwt(${vars.map(x => x.name).join(", ")});`,
                `if (${(vars.map(x => x.name).map(x => `${x} == null`).join(" || "))} || payload == null) {`,
                `    throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED, "You are not authorized to access this resource!");`,
                `}`,
                "",
                `Object userData = this.${authenticator}.validateJwtPayload(payload);`,
                `if (userData == null) {`,
                `    throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED, "You are not authorized to access this resource!");`,
                `}`
            ];
        };
    }

    private randomString(length: number): string {
        const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let result = "";
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
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
    private readonly _commentLines: string[] = [];

    constructor(
        private _name: string,
        private _returnType: string = "void",
        private _accessModifier: string = "public"
    ) {}

    public addComment(...lines: string[]): MethodBuilder {
        this._commentLines.push(...lines);
        return this;
    }

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

        if (this._commentLines.length > 0) {
            result += "    /**\n";
            this._commentLines.forEach(line => {
                result += `     * ${line}\n`;
            });
            result += "     */\n";
        }

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
    private _value: string;

    constructor(
        private readonly _name: string,
        private readonly _type: string,
        private _accessModifier: string = ""
    ) {
        this._value = "";
    }

    public get name(): string {
        return this._name;
    }

    public setVal(value: string): FieldBuilder {
        this._value = value;
        return this;
    }

    public setAsField(): FieldBuilder {
        if (this._accessModifier === "") {
            this._accessModifier = "private ";
        }   
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

        if (!this._accessModifier.endsWith(" ") && this._accessModifier !== "") {
            this._accessModifier += " ";
        }

        result += `${this._accessModifier}${this._type} ${this._name}`;

        if (this._value !== "") {
            result += ` = ${this._value}`;
        }

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