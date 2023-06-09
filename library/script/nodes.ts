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
            return "";
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

    /**
     * The authenticator that is used for this route.
     */
    public readonly authenticate?: AuthenticateClauseNode;

    constructor(path: PathNode, header?: MiddlewareOptions, body?: MiddlewareOptions, authenticate?: AuthenticateClauseNode) {
        super();
        this.path = path;
        this.routers = [];
        this.routes = [];
        this.header = header;
        this.body = body;
        this.authenticate = authenticate;
    }

    /**
     * Finds a route by its alias.
     * 
     * @param alias The alias of the route to find.
     * @returns The route with the given alias or undefined if no route with the given alias exists.
     */
    public findRouteByAlias(alias: string, parentPath?: string): [RouteNode, string] | undefined {
        for (const route of this.routes) {
            if (route.path.alias === alias) {
                return [route, parentPath ?? ""];
            }
        }

        for (const router of this.routers) {
            const route = router.findRouteByAlias(alias, this.combinePaths([parentPath ?? "", router.path.path]));
            if (route !== undefined) {
                return route;
            }
        }

        return undefined;
    }

    private combinePaths(paths: string[]): string {
        return paths.filter(x => x.trim().length > 0).join("/").replace(/\/+/g, "/");
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
     * The target languages of the compiled project.
     */
    public readonly targets: string[];

    /**
     * The authenticators that are used in the project.
     */
    public readonly authBlocks: { [key: AuthType|string]: AuthBlockNode; }

    /**
     * The middlewares that are used in this router.
     */
    public readonly middlewares: MiddlewareNode[];

    constructor(targets: string[], authBlocks: { [key: AuthType|string]: AuthBlockNode; }) {
        super();
        this.middlewares = [];
        this.targets = targets;
        this.authBlocks = authBlocks;
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

    /**
     * The authenticator that is used for this route.
     */
    public readonly authenticate?: AuthenticateClauseNode;

    /**
     * The description of the route.
     */
    public readonly description?: string;

    /**
     * Optional response entitiy representation defined through middleware options used for frontend code generation.
     */
    public readonly response?: MiddlewareOptions;

    /**
     * Whether the response is a single entity or a list of entities.
     */
    public readonly isResponsePlural?: boolean;

    /**
     * The frontend code generation block.
     */
    public readonly rendering?: RenderBlock;

    constructor(method: Method, path: PathNode, header?: MiddlewareOptions, body?: MiddlewareOptions, authenticate?: AuthenticateClauseNode, description?: string, reponse?: MiddlewareOptions, isResponsePlural?: boolean, rendering?: RenderBlock) {
        super();
        this.path = path;
        this.method = method;
        this.header = header;
        this.body = body;
        this.authenticate = authenticate;
        this.description = description;
        this.response = reponse;
        this.isResponsePlural = isResponsePlural;
        this.rendering = rendering;
    }
}

/**
 * The render block node describes a render block in the project. It holds information about the frontend code generation.
 */
export class RenderBlock extends SyntaxNode {

    /**
     * The type of the frontend code generation.
     */
    public readonly type: FrontendType;

    /**
     * Optional options that are used in the frontend code generation.
     */
    public readonly options?: MiddlewareOptions;

    constructor(type: FrontendType, options?: MiddlewareOptions) {
        super();
        this.type = type;
        this.options = options;
    }
}

/**
 * The auth block node describes the basic information about the authentication process.
 */
export class AuthBlockNode extends SyntaxNode {

    /**
     * The alias of the authenticator that is used.
     */
    public readonly alias?: string;

    /**
     * The type of the authentication process.
     */
    public readonly type: AuthType;

    /**
     * The source from which the authentication information is taken.
     */
    public readonly source: "header"|"body"|"query";

    /**
     * The name of the field that is used for authentication.
     */
    public readonly field: string;

    /**
     * Whether the default access is public or not.
     */
    public readonly isDefaultAccessPublic?: boolean;

    /**
     * Additional options that are used in the authentication process.
     */
    public readonly options: MiddlewareOptions;

    /**
     * Whether the authorization is in use or not.
     */
    public isAuthorizationInUse: boolean;

    constructor(type: AuthType, source: "header"|"body"|"query", field: string, alias?: string, isDefaultAccessPublic?: "public"|"authenticated", options?: MiddlewareOptions) {
        super();
        this.type = type;
        this.source = source;
        this.field = field;
        this.alias = alias;
        this.options = options ?? {};
        this.isDefaultAccessPublic = isDefaultAccessPublic === "authenticated" ? false : true;
        this.isAuthorizationInUse = false;
    }

    public get id(): string {
        return this.alias !== undefined ? this.alias : this.type;
    }

    public get name(): string {
        const id = this.id.replaceAll(/[^a-zA-Z0-9_]/g, "");
        return id[0].toUpperCase() + id.substring(1);
    }
}

/**
 * The authenticate clause node describes the authenticate for routes and routers.
 */
export class AuthenticateClauseNode extends SyntaxNode {

    /**
     * The alias or type of the auth block to use. If this is undefined, the default auth block is used.
     */
    public readonly authBlock: string;

    /**
     * The roles that are required to access the route.
     */
    public readonly authorization?: string[];


    constructor(authBlock: string, authorization?: string[]) {
        super();
        this.authBlock = authBlock;
        this.authorization = authorization;
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

/**
 * The type of authentication that is used.
 */
export enum AuthType {
    APIKey = "API-Key",
    Bearer = "Bearer",
}

/**
 * The generation mode of the bearer authentication.
 */
export enum BearerAuthGenerationMode {
    /**
     * Generates no bearer boilerplate code only the required authentication methods which are getting called from the routes.
     */
    None = 'NONE',
    /**
     * Generates everything but the JWT generation and validation.
     */
    Basic = 'BASIC',
    /**
     * Generates everything.
     */
    Full = 'FULL',
}

export enum FrontendType {
    List = "list",
    Table = "table",
    Detail = "detail",
    Form = "form"
}