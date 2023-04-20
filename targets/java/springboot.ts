import * as pathApi from "https://deno.land/std@0.182.0/path/mod.ts";

import { AuthBlockNode, GlobalVariable, IPluginContext, Logger, MiddlewareNode, MiddlewareOptions, PathNode, PluginBase, RouteNode, RouterNode, AuthType, ProjectNode } from "../../library/mod.ts";

export default class JavaSpringBootTargetPlugin extends PluginBase {

    private _config: TargetConfig = null!;
    private _mainPackagePath: string = null!;
    private _mainPackage: string = null!;
    private _dtoPackagePath: string = null!;
    private _dtoPackage: string = null!;
    private _configPackagePath: string = null!;
    private _configPackage: string = null!;
    private _controllerPackagePath: string = null!;
    private _controllerPackage: string = null!;

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

        this.compileProjectNode(context.projectNode);
    }

    private compileProjectNode(node: ProjectNode): void {

        this.compileRouterNode(node);
    }

    private compileRouterNode(node: RouterNode): void {
        const interfaceBuilder = new ClassBuilder(this._controllerPackage, this.makePascalCase(node.path.name === "root" ? "Main" : node.path.name) + "ControllerHandler", true);

        const classBuilder = new ClassBuilder(this._controllerPackage, this.makePascalCase(node.path.name === "root" ? "Main" : node.path.name) + "Controller")
            .addImport("org.springframework.beans.factory.annotation.Autowired")
            .addImport("org.springframework.web.bind.annotation.*")
            .addAnnotation("RestController")
            .addAnnotation(`RequestMapping("${node.path.path}")`)
            .addField(new FieldBuilder("handler", interfaceBuilder.name).addAnnotation("Autowired"));
            

        interfaceBuilder.save(this._controllerPackagePath);
        classBuilder.save(this._controllerPackagePath);
    }

    private makePascalCase(name: string): string {
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
            packages: {
                main: "com.example",
                dto: "dto",
                config: "config",
                controller: "controllers"
            },
        };

        if (baseConfig.useSpringSecurity !== undefined && typeof baseConfig.useSpringSecurity === "boolean") {
            config.useSpringSecurity = baseConfig.useSpringSecurity as boolean;
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
        }

        return config;
    }
}

class ClassBuilder {

    private readonly _imports: string[] = [];
    private readonly _annotations: string[] = [];
    private readonly _methods: MethodBuilder[] = [];
    private readonly _fields: FieldBuilder[] = [];

    constructor(
        private readonly _package: string,
        private readonly _name: string,
        private readonly _isInterface: boolean = false
    ) {}

    public get name(): string {
        return this._name;
    }

    public addImport(importPath: string): ClassBuilder {
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
        this._fields.push(field.setAsField());
        return this;
    }

    public save(path: string): void {
        const filePath = pathApi.join(path, `${this._name}.java`);

        Deno.writeTextFileSync(filePath, this.toString());
    }

    public toString(): string {
        let result = `package ${this._package};\n`;

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

        result += `public ${(this._isInterface ? 'interface' : 'class')} ${this._name} {\n`;

        this._fields.forEach(field => {
            result += "\n";
            result += "    " + field.toString() + ";\n";
        });

        this._methods.forEach(method => {
            result += "\n";
            result += "    " + method.toString(this._isInterface);
        });

        result += "\n}\n";

        return result;
    }
}

class MethodBuilder {

    private readonly _parameters: FieldBuilder[] = [];
    private readonly _annotations: string[] = [];
    private readonly _body: string[] = [];

    constructor(
        private _name: string,
        private _returnType: string = "void",
        private _accessModifier: string = "public"
    ) {}

    public addParameter(parameter: FieldBuilder): MethodBuilder {
        this._parameters.push(parameter);
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
    packages: {
        main: string;
        dto: string;
        config: string;
        controller: string;
    };
}