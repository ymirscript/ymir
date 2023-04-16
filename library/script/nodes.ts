/**
 * The syntax node is the base class for all nodes in the syntax tree.
 */
export abstract class SyntaxNode {}

/**
 * Describes the allowed validation types for a query parameter.
 */
export enum QueryParameterType {
    Any = "any",
    String = "string",
    Int = "int",
    Float = "float",
    Bool = "bool",
    Date = "date",
    DateTime = "datetime",
    Time = "time"
}

/**
 * The query parameter node describes a query parameter in a route.
 */
export class QueryParameterNode extends SyntaxNode {

    /**
     * The name of the query parameter.
     */
    public readonly name: string;
    /**
     * The type of the query parameter.
     */
    public readonly type: QueryParameterType;

    constructor(name: string, type: QueryParameterType) {
        super();
        this.name = name;
        this.type = type;
    }
}

/**
 * The path node is used to describe a path in the project.
 */
export class PathNode extends SyntaxNode {

    /**
     * The path of the path.
     */
    public readonly path: string;

    /**
     * The optional alias of the path. Used when compiling to target language as reference.
     */
    public readonly alias?: string;

    /**
     * An array of query parameters that are used in the path.
     */
    public readonly queryParameters: QueryParameterNode[];

    constructor(path: string, alias: string|undefined, queryParameters: QueryParameterNode[]) {
        super();
        this.path = path;
        this.alias = alias;
        this.queryParameters = queryParameters;
    }

    /**
     * The name of the path. This is either the alias or the path with all non-alphanumeric characters removed.
     */
    public get name(): string {
        if (this.alias !== undefined) {
            return this.alias;
        }

        const normPath = this.path.replace(/[^a-zA-Z0-9_]/g, "");
        if (normPath.length === 0) {
            return "path" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        }

        if (normPath[0].match(/[0-9]/)) {
            return "_" + normPath;
        }

        return normPath;
    }
}

/**
 * The router node describes a router in the project. It holds routes, middlewares and other information.
 */
export class RouterNode extends SyntaxNode {

    /**
     * The base path of the router.
     */
    public readonly path: PathNode;

    /**
     * All routers that are children of this router.
     */
    public readonly routers: RouterNode[];

    /**
     * All routes that are children of this router.
     */
    public readonly routes: RouteNode[];

    /**
     * The middlewares that are used in this router.
     */
    public readonly middlewares: MiddlewareNode[];

    /**
     * Optional header validation schema defined through middleware options.
     * 
     * Every route in this router will inherit this header validation schema. If a route has its own header validation schema, it will be merged with this one.
     */
    public readonly header?: MiddlewareOptions;

    /**
     * Optional body validation schema defined through middleware options.
     * 
     * Every route in this router will inherit this body validation schema. If a route has its own body validation schema, it will be merged with this one.
     */
    public readonly body?: MiddlewareOptions;

    constructor(path: PathNode, header?: MiddlewareOptions, body?: MiddlewareOptions) {
        super();
        this.path = path;
        this.routers = [];
        this.routes = [];
        this.middlewares = [];
        this.header = header;
        this.body = body;
    }
}

/**
 * The script file node is used as a bridge between the project node and the router node.
 * An included script file is parsed into a script file node and then added to the project node.
 */
export class ScriptFileNode extends RouterNode {
    
    constructor() {
        super(new PathNode("", undefined, []));
    }
}

/**
 * The project node is the root node of the syntax tree.
 */
export class ProjectNode extends ScriptFileNode {

    /**
     * The target language of the compiled project.
     */
    public readonly target: string;

    constructor(target: string) {
        super();
        this.target = target;
    }
}

/**
 * The route node describes a route in the project. It holds the path, the method and validators/authenticators.
 */
export class RouteNode extends SyntaxNode {

    /**
     * The path of the route.
     */
    public readonly path: PathNode;

    /**
     * The method of the route.
     */
    public readonly method: Method;

    /**
     * Optional header validation schema defined through middleware options.
     */
    public readonly header?: MiddlewareOptions;

    /**
     * Optional body validation schema defined through middleware options.
     */
    public readonly body?: MiddlewareOptions;

    constructor(method: Method, path: PathNode, header?: MiddlewareOptions, body?: MiddlewareOptions) {
        super();
        this.path = path;
        this.method = method;
        this.header = header;
        this.body = body;
    }
}

/**
 * The middleware node describes a middleware in the project. It can be used in routers and routes by the "use" keyword.
 */
export class MiddlewareNode extends SyntaxNode {

    /**
     * The name of the middleware that is used.
     */
    public readonly name: string;

    /**
     * The options that are used in the middleware.
     */
    public readonly options: MiddlewareOptions;

    constructor(name: string, options: MiddlewareOptions) {
        super();
        this.name = name;
        this.options = options;
    }

    public getOption<T>(name: string, path: string[]): T|undefined {
        // deno-lint-ignore no-explicit-any
        let current: any = this.options;
        for (const part of path) {
            if (current[part] === undefined) {
                return undefined;
            }

            current = current[part];
        }

        if (current[name] === undefined) {
            return undefined;
        }

        return current[name] as T;
    }
}

/**
 * The options that can be used in a middleware.
 */
export type MiddlewareOptions = {
    [key: string]: MiddlewareOptionValue;    
};

export type MiddlewareOptionValue = string | number | boolean | MiddlewareOptions | MiddlewareOptionValue[] | GlobalVariable;

export class GlobalVariable {

    constructor(
        public readonly name: string,
        public readonly path: string[]
    ) {}
}

/**
 * Methods that can be used in routes.
 */
export enum Method {
    Get = "GET",
    Post = "POST",
    Put = "PUT",
    Delete = "DELETE",
    Patch = "PATCH",
    Options = "OPTIONS",
    Head = "HEAD",
}