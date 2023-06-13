import { AbortError, FrontendType, Logger, Method, MiddlewareOptions, ProjectNode, RouteNode } from "../../../library/mod.ts";
import { VanillaGenerator } from "./index.ts";

/**
 * Generates a list view for the given route.
 * 
 * @param parentPath The path of the parent route.
 * @param route The route to generate the list for.
 * @param proj The project node.
 * @param integrates The list of integrations.
 */
export function generateDetail(parentPath: string, route: RouteNode, integrates: string[], proj: ProjectNode, generator: VanillaGenerator): string[] {
    if (!route.response || !route.rendering || route.rendering.type !== FrontendType.Detail) {
        throw new Error(`The route ${route.path} does not have a response.`);
    }

    if (route.method !== "GET" && route.isResponsePlural !== false) {
        throw new Error(`The route ${route.path} does not support detail.`);
    }

    const integratesCode: string[] = [];
    const integrateMethods: Method[] = [];

    for (const integrateAlias of integrates) {
        const res = proj.findRouteByAlias(integrateAlias);
        if (!res) {
            Logger.error(`Could not find integration ${integrateAlias}.`);

            throw new AbortError();
        }

        const [integrateRoute, integrateParentPath] = res;

        if (integrateRoute.method === Method.Delete) {
            integratesCode.push(...[
                `    function deleteItem() {`,
                `        if (!confirm("Are you sure you want to delete this item?")) {`,
                `            return;`,
                `        }`,
                ``,
                `        restClient.delete(("${integrateParentPath}${integrateParentPath.endsWith("/") ? '' : '/'}${(integrateRoute.path.path.startsWith("/") ? integrateRoute.path.path.substring(1) : integrateRoute.path.path)}").replace(":id", id))`,
                `            .then(() => {`,
                `                window.location.href = "/";`,
                `            })`,
                `            .catch((error) => {`,
                `                alert(error);`,
                `            });`,
                `    }`,
                ``
            ]);

            integrateMethods.push(Method.Delete);
        } else if (integrateRoute.method === Method.Patch) {
            integratesCode.push(...[
                `    function editItem() {`,
                `        window.location.href = "/${generator.getRouteFileName(integrateParentPath, integrateRoute)}?id=" + id;`,
                `    }`,
                ``
            ]);

            integrateMethods.push(Method.Patch);
        }
    }

    return [
        "<form onsubmit=\"return false;\" id=\"detailview\">",
        `    <label>Loading...</label>`,
        "</form>",
        "<script>",
        "const id = new URLSearchParams(window.location.search).get(\"id\");",
        ...integratesCode,
        "function load() {",
        `    restClient.get("${parentPath}${parentPath.endsWith("/") ? '' : '/'}${(route.path.path.startsWith("/") ? route.path.path.substring(1) : route.path.path)}".replace(":id", id))`,
        "        .then((response) => {",
        "            const detailview = document.getElementById(\"detailview\");",
        "            if (detailview === null) {",
        "                return;",
        "            }",
        "",
        `            detailview.innerHTML = \`${getTemplate(route.response, integrateMethods)}\`;`,
        "        })",
        "        .catch((error) => {",
        "            alert(error);",
        "        });",
        "}",
        "",
        "load();",
        "</script>"
    ];
}

function getTemplate(response: MiddlewareOptions, integrates: Method[]): string {
    const code: string[] = [];

    for (const key in response) {
        const value = response[key];

        if (typeof value === "object") {
            parseObject(code, key, value as MiddlewareOptions, "response.data[\"" + key + "\"]");
        } else if (Array.isArray(value)) {
            parseArray(code, key, "response.data[\"" + key + "\"]");
        } else if (typeof value === "string") {
            parseSimpleInput(code, key, "response.data[\"" + key + "\"]");
        } else {
            Logger.error(`The value of ${key} is not a string, object or array.`);

            throw new AbortError();
        }
    }

    if (integrates.length > 0) {
        code.push(`<div class="button-group">`);

        for (const method of integrates) {
            if (method === Method.Delete) {
                code.push(`<button class="button" onclick="deleteItem()">Delete</button>`);
            } else if (method === Method.Patch) {
                code.push(`<button class="button" onclick="editItem()">Edit</button>`);
            }
        }

        code.push(`</div>`);
    }

    return code.join("");
}

function parseObject(code: string[], key: string, obj: MiddlewareOptions, field: string): void {
    code.push(...[
        `<div class="form-control">`,
        `    <label>${key}</label>`,
        `    <div class="form-group">`,
    ]);

    for (const innerKey in obj) {
        const value = obj[innerKey];

        if (typeof value === "object") {
            parseObject(code, innerKey, value as MiddlewareOptions, field + "[\"" + innerKey + "\"]");
        } else if (Array.isArray(value)) {
            parseArray(code, innerKey, field + "[\"" + innerKey + "\"]");
        } else if (typeof value === "string") {
            parseSimpleInput(code, innerKey, field + "[\"" + innerKey + "\"]");
        } else {
            Logger.error(`The value of ${key} is not a string, object or array.`);

            throw new AbortError();
        }
    }

    code.push(...[
        `    </div>`,
        `</div>`
    ]);
}

function parseArray(code: string[], key: string, field: string): void {
    code.push(...[
        `<div class="form-control">`,
        `    <label>${key}</label>`,
        `    <ul>`,
        "        ${" + field + ".map((item) => '<li>' + JSON.stringify(item) + '</li>')}",
        `    </ul>`,
        `</div>`,
    ]);
}

function parseSimpleInput(code: string[], key: string, field: string): void {
    code.push(...[
        `<div class="form-control">`,
        `    <label>${key}</label>`,
        "    <input value=\"${" + field + "}\" readonly>",
        `</div>`
    ]);
}