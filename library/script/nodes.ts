/**
 * The syntax node is the base class for all nodes in the syntax tree.
 */
export abstract class SyntaxNode {}

/**
 * The router node describes a router in the project. It holds routes, middlewares and other information.
 */
export class RouterNode extends SyntaxNode {

    /**
     * The base path of the router.
     */
    public readonly path: string;

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

    constructor(path: string) {
        super();
        this.path = path;
        this.routers = [];
        this.routes = [];
        this.middlewares = [];
    }
}

/**
 * The script file node is used as a bridge between the project node and the router node.
 * An included script file is parsed into a script file node and then added to the project node.
 */
export class ScriptFileNode extends RouterNode {
    
    constructor() {
        super("");
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
    public readonly path: string;

    /**
     * The method of the route.
     */
    public readonly method: Method;

    constructor(method: Method, path: string) {
        super();
        this.path = path;
        this.method = method;
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